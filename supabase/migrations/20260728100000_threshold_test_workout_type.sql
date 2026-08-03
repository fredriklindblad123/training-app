-- K8 (docs/tranarperspektiv.md): tröskeltest som ordinerbart pass.
--
-- Bakgrund: intensitetsfördelningen på /trends (P1.3 i
-- docs/insikter-roadmap.md) mäter Garmins autozoner i stället för atletens
-- fysiologi eftersom lt1_hr/lt2_hr/threshold_hr_low/high/max_hr alla är
-- null. Utredningen där (2026-07-27) landade i att nästa steg är ett
-- tröskeltest, inte ett kodbygge — men appen kan göra testet mycket mer
-- sannolikt att faktiskt bli av. Den här migrationen gör två saker:
--
-- 1. workout_type 'test' på planned_workouts, så ett tröskeltest går att
--    ordinera precis som vilket annat pass som helst. Fältprotokollet ligger
--    som text i web/src/lib/planning.ts (THRESHOLD_TEST_PROTOCOL): 30
--    minuters maxinsats, snittpuls för de sista 20 minuterna ≈ LT2. När
--    passet är synkat räknar web/src/lib/threshold-test.ts ut ett förslag på
--    LT2 ur varvdatan — atleten/tränaren bekräftar med en spara-knapp,
--    appen skriver aldrig automatiskt.
--
-- 2. workout_type 'rest' läggs också till. Det här är en latent bugg, inte
--    en ny typ: workout_type-väljaren i UI:t har erbjudit "Vila" sedan
--    20260725140000_planned_workout_category.sql, men den migrationen tog
--    bort 'rest' ur listan (och RADERADE dåvarande vilodagar) utan att
--    någonsin lägga tillbaka värdet i constrainten. Ett försök att spara ett
--    vilopass har alltså misslyckats tyst mot check-constrainten sedan dess.
--
-- 'repetition' behålls i listan trots att UI:t inte längre erbjuder den
-- (slogs ihop med 'interval' i 20260727140000_merge_repetition_into_interval.sql)
-- — historiska rader kan fortfarande ha värdet, och att ta bort det ur
-- constrainten utan att migrera datan skulle bara byta ett synligt fel mot
-- ett dolt.
--
-- ORDNING: constrainten släpps dynamiskt (samma mönster som
-- 20260725160000_cross_training_category.sql) i stället för att hårdkoda
-- dagens constraint-namn, så migrationen inte är beroende av exakt vilket
-- namn Postgres/Supabase råkade generera.

do $$
declare
  v_conname text;
begin
  select conname into v_conname
  from pg_constraint
  where conrelid = 'planned_workouts'::regclass
    and contype = 'c'
    and pg_get_constraintdef(oid) like '%workout_type%';
  if v_conname is not null then
    execute format('alter table planned_workouts drop constraint %I', v_conname);
  end if;
end $$;

alter table planned_workouts add constraint planned_workouts_workout_type_check
  check (workout_type in (
    'easy', 'long_run', 'threshold', 'interval', 'repetition', 'race', 'strength',
    'cross_training', 'test', 'rest'
  ));

-- Ett LT2-värde kan komma från ett fälttest (uppskattning ur ett
-- 30-minuterspass, ovan) eller ett laktattest (mätning — lactate_readings
-- finns redan för det, P0.3b). De är inte lika säkra, så värdet ska bära sin
-- källa i UI:t i stället för att stå som en anonym siffra under
-- Inställningar. 'manuell' täcker värden som skrivits in utan något av de
-- två testen (t.ex. ett tal från en tidigare tränare).
alter table profiles
  add column lt2_source text check (lt2_source in ('test_field', 'test_lactate', 'manuell')),
  add column lt2_measured_on date;
