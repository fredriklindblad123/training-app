-- Egen passtyp för häck, och ett pass per dag i stället för två (2026-09-13).
--
-- Två ändringar som hör ihop, båda på uttrycklig begäran:
--
-- 1. HÄCK FÅR EN EGEN TYP. Häckträningen låg som `interval` med
--    träningsfaktorn koordination, vilket blåste upp intervallstatistiken för
--    den som faktiskt kör den — häckskolning är teknikarbete, inte ett
--    intervallpass. `hurdles` saknar motsvarighet bland genomförda pass
--    precis som `rest` och `test` (Garmin har ingen häck-kategori), och är
--    därför färglös i workoutTypeColorVar.
--
-- 2. DIST + STYRKA RÄKNAS SOM ETT PASS. Veckomönstret lade måndagens distans
--    och bålstyrka som två rader i slot 1 och 2. De är ett träningstillfälle,
--    inte två, och att räkna dem som två gjorde att appens passantal aldrig
--    kunde gå ihop med Antal pass-raden i Daniels mall. Nu en rad per dag med
--    styrkan i titeln ("Distans + styrka (bål)").
--
--    Enda dagen med två pass är därmed Nikes måndag: distans med de andra på
--    förmiddagen, häck på eftermiddagen. Det ger 7 pass/vecka för Alice, Emma
--    och Signe och 8 för Nike — samma 8 som mallens Antal pass-rad.
--
--    Priset är att styrkan inte längre bär en egen träningsfaktor de dagarna;
--    en rad kan bara ha en, och distansen är passets huvudsakliga innehåll.
--    Fredagens rena styrkepass har kvar styrka_grund.
--
-- Ombyggnaden är en radering + återinsättning, inte en uppdatering: samtliga
-- berörda pass ligger i framtiden (tidigast 2026-09-28) och ingen har utfall.

alter table planned_workouts drop constraint planned_workouts_workout_type_check;
alter table planned_workouts add constraint planned_workouts_workout_type_check
  check (workout_type in ('easy','long_run','threshold','interval','repetition','race',
                          'strength','cross_training','test','rest','hurdles'));

delete from planned_workouts
 where block_id in (select id from season_blocks where start_date >= '2026-09-28');
delete from week_template_items
 where block_id in (select id from season_blocks where start_date >= '2026-09-28');

-- Veckomönstret per FAS. Ett pass per dag; styrkan namnges i titeln.
insert into week_template_items (block_id, weekday, slot, workout_type, title, training_factor)
select sb.id, t.weekday, t.slot, t.workout_type, t.title, t.training_factor
from season_blocks sb join (values
  ('allman', 1, 1, 'easy', 'Distans + styrka (bål)', 'endurance_aerob_distans'),
  ('allman', 2, 1, 'interval', 'Intervaller, avslut i backe', 'endurance_aerob_intervall'),
  ('allman', 3, 1, 'easy', 'Distans + styrka (medicinboll)', 'endurance_aerob_distans'),
  ('allman', 4, 1, 'threshold', 'Tröskel', 'endurance_aerob_troskel'),
  ('allman', 5, 1, 'strength', 'Styrka – blandat', 'styrka_grund'),
  ('allman', 6, 1, 'interval', 'Intervaller', 'endurance_aerob_intervall'),
  ('allman', 7, 1, 'long_run', 'Långpass + styrka (gym)', 'endurance_aerob_distans'),
  ('tavlingsforberedande', 1, 1, 'easy', 'Distans + styrka (bål)', 'endurance_aerob_distans'),
  ('tavlingsforberedande', 2, 1, 'interval', 'Intervaller – kortare och snabbare', 'endurance_snabbhet'),
  ('tavlingsforberedande', 3, 1, 'easy', 'Distans + styrka (medicinboll)', 'endurance_aerob_distans'),
  ('tavlingsforberedande', 4, 1, 'threshold', 'Tröskel – högre intensitet', 'endurance_aerob_troskel'),
  ('tavlingsforberedande', 5, 1, 'strength', 'Styrka – blandat', 'styrka_grund'),
  ('tavlingsforberedande', 6, 1, 'interval', 'Intervaller – tävlingsfart', 'endurance_sprint'),
  ('tavlingsforberedande', 7, 1, 'long_run', 'Långpass + styrka (gym)', 'endurance_aerob_distans'),
  ('tavling_form', 1, 1, 'easy', 'Distans + styrka (bål)', 'endurance_aerob_distans'),
  ('tavling_form', 2, 1, 'interval', 'Korta, snabba intervaller', 'endurance_sprint'),
  ('tavling_form', 3, 1, 'easy', 'Distans – underhåll', 'endurance_aerob_distans'),
  ('tavling_form', 4, 1, 'threshold', 'Tröskel – underhåll', 'endurance_aerob_troskel'),
  ('tavling_form', 6, 1, 'interval', 'Tävlingsfart', 'endurance_sprint'),
  ('tavling_form', 7, 1, 'easy', 'Distans', 'endurance_aerob_distans'),
  ('tavling_stabiliserande', 1, 1, 'easy', 'Distans + styrka (bål)', 'endurance_aerob_distans'),
  ('tavling_stabiliserande', 2, 1, 'interval', 'Intervaller – underhåll', 'endurance_aerob_intervall'),
  ('tavling_stabiliserande', 3, 1, 'easy', 'Distans – underhåll', 'endurance_aerob_distans'),
  ('tavling_stabiliserande', 4, 1, 'threshold', 'Tröskel – underhåll', 'endurance_aerob_troskel'),
  ('tavling_stabiliserande', 5, 1, 'strength', 'Styrka – blandat', 'styrka_grund'),
  ('tavling_stabiliserande', 6, 1, 'interval', 'Tävlingsfart', 'endurance_sprint'),
  ('tavling_stabiliserande', 7, 1, 'long_run', 'Långpass', 'endurance_aerob_distans'),
  ('stabiliserande', 1, 1, 'easy', 'Distans + styrka (bål)', 'endurance_aerob_distans'),
  ('stabiliserande', 2, 1, 'interval', 'Korta intervaller, bibehållen fart', 'endurance_sprint'),
  ('stabiliserande', 3, 1, 'easy', 'Distans – lugnt', 'endurance_aerob_distans'),
  ('stabiliserande', 4, 1, 'threshold', 'Tröskel – kort', 'endurance_aerob_troskel'),
  ('stabiliserande', 6, 1, 'easy', 'Distans', 'endurance_aerob_distans'),
  ('stabiliserande', 7, 1, 'long_run', 'Långpass – kortare', 'endurance_aerob_distans'),
  ('vila', 2, 1, 'cross_training', 'Alternativ träning', 'alternativ_traning'),
  ('vila', 4, 1, 'cross_training', 'Alternativ träning', 'alternativ_traning'),
  ('vila', 6, 1, 'easy', 'Lugn distans', 'endurance_aerob_distans')
) as t(phase, weekday, slot, workout_type, title, training_factor) on t.phase = sb.phase
where sb.start_date >= '2026-09-28';

-- Utrullning, speglar generateFromTemplate i lib/planning.ts.
insert into planned_workouts
  (user_id, block_id, scheduled_date, slot, workout_type, title, training_factor, status)
select sba.athlete_id, wti.block_id, x.d, wti.slot, wti.workout_type, wti.title,
       wti.training_factor, 'planned'
from week_template_items wti
join season_blocks sb on sb.id = wti.block_id
join season_block_athletes sba on sba.block_id = sb.id
cross join lateral generate_series(
  date_trunc('week', sb.start_date::timestamp)::date, sb.end_date, interval '1 week') as g(wk)
cross join lateral (select (g.wk::date + (wti.weekday - 1)) as d) as x
where sb.start_date >= '2026-09-28' and x.d between sb.start_date and sb.end_date;

-- Nikes häck, måndag eftermiddag i slot 2 — den enda dagen någon har två pass.
insert into planned_workouts
  (user_id, block_id, scheduled_date, slot, workout_type, title, description, training_factor, status)
select '756d864b-8999-48fb-8021-d12dde86115a', sb.id, x.d, 2, 'hurdles', 'Häck',
       'Eftermiddag, efter förmiddagens distanspass.', 'koordination', 'planned'
from season_blocks sb
cross join lateral generate_series(
  date_trunc('week', sb.start_date::timestamp)::date, sb.end_date, interval '1 week') as g(wk)
cross join lateral (select g.wk::date as d) as x
where sb.start_date >= '2026-09-28' and sb.phase <> 'vila'
  and x.d between sb.start_date and sb.end_date;

do $$
declare n_item int; n_pw int; n_hack int; n_slot2 int;
begin
  select count(*) into n_item from week_template_items wti
    join season_blocks sb on sb.id = wti.block_id where sb.start_date >= '2026-09-28';
  select count(*) into n_pw from planned_workouts pw
    join season_blocks sb on sb.id = pw.block_id
   where sb.start_date >= '2026-09-28' and pw.workout_type <> 'hurdles';
  select count(*) into n_hack from planned_workouts where workout_type = 'hurdles';
  select count(*) into n_slot2 from planned_workouts pw
    join season_blocks sb on sb.id = pw.block_id
   where sb.start_date >= '2026-09-28' and pw.slot > 1 and pw.workout_type <> 'hurdles';

  if n_item <> 62 then raise exception 'Monsterrader: % (vantade 62)', n_item; end if;
  if n_pw <> 1340 then raise exception 'Pass: % (vantade 1340)', n_pw; end if;
  if n_hack <> 49 then raise exception 'Hackpass: % (vantade 49)', n_hack; end if;
  if n_slot2 <> 0 then raise exception 'Slot>1 utan hack: % (vantade 0)', n_slot2; end if;
end $$;
