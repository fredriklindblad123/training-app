-- lactate_readings skapades 2026-07-26, innan coach_athletes fanns, och fick
-- därför bara policyn "auth.uid() = user_id". När gränssnittet byggdes
-- 2026-09-26 visade det sig att en tränare varken kunde spara eller läsa en
-- adepts stick: insert blockerades tyst av RLS och listan var alltid tom.
--
-- Samma uttryck som diary_entries redan använder, så laktat följer samma
-- regel som resten av adeptens data.
drop policy if exists "lactate_readings: full åtkomst till egna rader" on lactate_readings;

create policy "lactate_readings: egna rader eller coachad löpares"
  on lactate_readings
  for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = lactate_readings.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = lactate_readings.user_id
    )
  );
