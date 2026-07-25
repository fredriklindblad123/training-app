-- planned_workouts.workout_type ska använda samma medeldistans-taxonomi som
-- activities.category, så planerat pass kan jämföras direkt mot utfall
-- (se web/src/lib/categories.ts). Tabellen har hittills ingen UI, men
-- migrera ev. gamla fritextvärden (se ursprunglig kommentar i schemat)
-- defensivt innan constrainten läggs på.

update planned_workouts set workout_type = 'threshold' where workout_type = 'tempo';
update planned_workouts set workout_type = 'long_run' where workout_type = 'long';
delete from planned_workouts where workout_type = 'rest';
update planned_workouts set workout_type = 'other' where workout_type not in (
  'easy', 'long_run', 'threshold', 'interval', 'repetition', 'race', 'strength', 'other'
);

alter table planned_workouts
  add constraint planned_workouts_workout_type_check
  check (workout_type in (
    'easy', 'long_run', 'threshold', 'interval', 'repetition', 'race', 'strength', 'other'
  ));
