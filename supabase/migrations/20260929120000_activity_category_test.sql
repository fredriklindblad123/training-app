-- Aktivitetskategori 'test' (2026-09-29, uttrycklig begäran): Alices
-- laktattest hos Aktivitus är ett stegtest, 10→16 km/h med puls 152→202.
-- Som 'easy' räknades det in i disciplinen på de lugna passen, och som
-- 'threshold' hade de sju stegen dragit ner tröskelväxelns medianpuls
-- (lib/training-gears.ts). Ett test är varken — det ska inte in i någon av
-- växlarna. planned_workouts har haft 'test' sedan
-- 20260728100000_threshold_test_workout_type.sql; nu matchar plan och utfall.
--
-- categorize_activity() ändras inte: den ger aldrig 'test', så ingen rad
-- byter kategori här och triggerns ordningsproblem (se
-- 20260725160000_cross_training_category.sql) uppstår inte. Kategorin sätts
-- bara för hand (category_source = 'manual').

alter table activities drop constraint activities_category_check;
alter table activities add constraint activities_category_check
  check (category in ('easy','long_run','threshold','interval','race','strength','cross_training','test'));
