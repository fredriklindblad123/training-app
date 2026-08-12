-- Ersätter den dagliga incheckningen (diary_entries.feeling/rpe m.fl., från
-- 20260726120000_diary_checkin_fields.sql) som självrapporterad källa för
-- känsla/ansträngning — incheckningen användes för sällan för att ge
-- meningsfull data. Alice fyller redan i motsvarande skattning per pass
-- direkt i Garmin Connect-appen ("Utvärdering": Känsla + Upplevd
-- ansträngning), vilket ger samma sorts data utan extra klick i vår app.
--
-- Kolumnerna på diary_entries lämnas kvar orörda (samma mönster som
-- goals/plan_phases, se docs/data-model.md) — bara appkoden slutar
-- läsa/skriva dem.
--
-- Källa: Garmins inofficiella "self evaluation"-endpoint
-- (get_activity_evaluation, /activity-service/activity/{id}),
-- summaryDTO.directWorkoutFeel och .directWorkoutRpe. Verifierat mot skarp
-- data 2026-08-12: directWorkoutFeel är 0/25/50/75/100 (Mycket svag .. Mycket
-- stark), directWorkoutRpe är 0-100 i steg om 10 (Borg-liknande 0-10-skala).
-- Mappas i synkkoden till samma 1-5- respektive 0-10-skala som restes av
-- appen redan använder, snarare än att spara Garmins råa kodning.
alter table activities
  add column garmin_feel smallint check (garmin_feel between 1 and 5),
  add column garmin_rpe smallint check (garmin_rpe between 0 and 10);

comment on column activities.garmin_feel is
  'Alices egen "Känsla"-skattning i Garmin Connect-appen efter passet (1=Mycket svag .. 5=Mycket stark). Mappat från directWorkoutFeel/25 + 1.';
comment on column activities.garmin_rpe is
  'Alices egen "Upplevd ansträngning"-skattning i Garmin Connect-appen (0-10, Borg-liknande). Mappat från directWorkoutRpe/10.';
