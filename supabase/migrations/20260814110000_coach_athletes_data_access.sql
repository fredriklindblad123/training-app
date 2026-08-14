-- Fortsättning på 20260814100000_coach_athletes.sql: /sasongen läser och
-- skriver även aktivitets-/dagboks-/mätvärdestabeller som den förra
-- migrationen inte rörde (den höll sig medvetet till tabeller /sasongen
-- själv äger). Utan det här skulle en coach som skapar ett block eller lägger
-- ett pass i en veckomall få passet TYST avvisat av RLS när det ska rullas
-- ut i planned_workouts (syncTemplateIntoBlock i sasongen/actions.ts skriver
-- med löparens user_id, inte coachens auth.uid()) — och "Jämför block" +
-- avbrottstidslinjen (K6) på /sasongen skulle visa tomt för varje löpare en
-- coach tittar på, eftersom de läser activities/daily_metrics/diary_entries
-- direkt.
--
-- Kalendern/dashboarden/trender/tävlingsresultat läser fortfarande bara
-- inloggad persons egna user_id (ingen appkod ändrad där) — den här
-- migrationen breddar bara ÅTKOMSTEN (RLS), den ändrar inget i hur de
-- sidorna frågar. En löpare som loggar in ser exakt samma sak som innan.
--
-- garmin_connections/garmin_tokens/lactate_readings rörs medvetet INTE —
-- /sasongen varken läser eller skriver dem, och Garmin-inloggningsuppgifter
-- ska inte bli coach-åtkomliga bara för att planeringen blir det.

-- activities (full åtkomst — /sasongen läser för blockjämförelsen/K6,
-- skriver aldrig direkt men delar policy för läs+skriv som övriga tabeller)
drop policy "activities: full åtkomst till egna rader" on activities;
create policy "activities: egna rader eller coachad löpares"
  on activities for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = activities.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = activities.user_id
    )
  );

-- planned_workouts (full åtkomst — kritisk: här skriver mallutrullningen)
drop policy "planned_workouts: full åtkomst till egna rader" on planned_workouts;
create policy "planned_workouts: egna rader eller coachad löpares"
  on planned_workouts for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = planned_workouts.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = planned_workouts.user_id
    )
  );

-- planned_rep_groups (ärver via planned_workouts, samma tvåstegsmönster som
-- template_rep_groups i förra migrationen)
drop policy "planned_rep_groups: via eget planerat pass" on planned_rep_groups;
create policy "planned_rep_groups: via eget planerat pass eller coachad löpares"
  on planned_rep_groups for all
  using (
    exists (
      select 1 from planned_workouts w
      where w.id = planned_rep_groups.planned_workout_id
        and (
          w.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = w.user_id
          )
        )
    )
  )
  with check (
    exists (
      select 1 from planned_workouts w
      where w.id = planned_rep_groups.planned_workout_id
        and (
          w.user_id = auth.uid()
          or exists (
            select 1 from coach_athletes ca
            where ca.coach_id = auth.uid() and ca.athlete_id = w.user_id
          )
        )
    )
  );

-- diary_entries (full åtkomst — K6-tidslinjen läser sjuk-/skadedagar och
-- anteckningar; skrivs inte från /sasongen idag, men delar samma
-- läs+skriv-policy som resten av appen redan gör för den här tabellen)
drop policy "diary_entries: full åtkomst till egna rader" on diary_entries;
create policy "diary_entries: egna rader eller coachad löpares"
  on diary_entries for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = diary_entries.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = diary_entries.user_id
    )
  );

-- daily_metrics (bara läsning, precis som den befintliga policyn — skrivs
-- fortfarande bara av service_role från synken)
drop policy "daily_metrics: läs egen data" on daily_metrics;
create policy "daily_metrics: läs egen data eller coachad löpares"
  on daily_metrics for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = daily_metrics.user_id
    )
  );
