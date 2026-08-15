-- Fas 0-uppföljning: Dashboard, Kalender (dag/vecka/månad/år), Trender och
-- Tävlingsresultat blir coach-medvetna (samma athlete=-mönster som redan
-- finns på /sasongen och /flerårsplan). Två RLS-luckor upptäcktes under det
-- arbetet — ingen av dem rörda av 20260814110000, som medvetet höll sig till
-- activities/planned_workouts/planned_rep_groups/diary_entries/daily_metrics:
--
-- 1. activity_splits (varv/delsträckor på en aktivitet) har sin egen RLS-
--    policy, skild från activities — att activities breddades för coach-
--    åtkomst spred sig aldrig hit automatiskt. Dagvyns tröskeltest-kort
--    (K8) läser splits för att uppskatta LT2, och skulle tyst visa tomma
--    varv för en coach som tittar på en löpares dag.
-- 2. profiles tillät bara LÄSNING för en coach (migration 20260814130000)
--    — dagvyns "Spara som LT2"-knapp (samma tröskeltest-kort) skriver till
--    profiles.lt2_hr, vilket en coach inte kunde göra åt en löpares vägnar.
--    Additiv policy, rör inte löparens egen fulla rätt till sin rad.

-- Döper om vad tabellen nu faktiskt heter i stället för att gissa namnet —
-- "drop policy <hårdkodat namn>" gav "policy ... does not exist" när det här
-- kördes, den ursprungliga policyn hette tydligen inte exakt vad
-- 20260723213258_initial_schema.sql påstår.
do $$
declare
  pol record;
begin
  for pol in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'activity_splits'
  loop
    execute format('drop policy %I on public.activity_splits', pol.policyname);
  end loop;
end $$;

create policy "activity_splits: åtkomst via ägd aktivitet eller coachad löpares"
  on activity_splits for all
  using (
    exists (
      select 1 from activities a
      where a.id = activity_splits.activity_id
        and (
          a.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = a.user_id
          )
        )
    )
  )
  with check (
    exists (
      select 1 from activities a
      where a.id = activity_splits.activity_id
        and (
          a.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = a.user_id
          )
        )
    )
  );

create policy "profiles: coach uppdaterar länkad löpares rad"
  on profiles for update
  using (
    exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = profiles.id
    )
  )
  with check (
    exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = profiles.id
    )
  );
