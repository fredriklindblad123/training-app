-- Årsplan 2026/2027 ur Daniels mall ("Träningsplanering Friidrottstränare steg 3_DP.xlsx",
-- arket Årsplan, sparad 2026-09-08). Uttrycklig begäran 2026-09-13.
--
-- Blockgränserna kommer ur de SAMMANSLAGNA cellerna på rad 5 (Period) och rad 6 (Fas) —
-- en merge-range är den enda entydiga källan till var ett block slutar, till skillnad från
-- var värdena råkar stå. Kolumn 3 = v40/2026, kolumn 54 = v39/2027.
--
-- Veckomönstret för Allmän är Fredriks uttryckliga schema. Övriga faser ärver samma skelett
-- med intensiteten skruvad enligt arkets rader 23-25 ("Underhåll" respektive "Kortare och
-- snabbare intervaller samt tävling"). Mönstret hänger på FASEN, inte på blocket, så de två
-- Allmän-blocken delar definition i stället för att skrivas av två gånger.
--
-- Glappet 14-27 september fylls MEDVETET inte: adepterna kör lugnt efter en hård
-- tävlingssäsong, och planen tar vid v40.

-- 1. Bort med planeringen framåt. Historik (< 2026-09-14) och "Tävlingsperiod 2026 Aug"
--    (ligger bakåt) rörs inte. planned_workouts.block_id är ON DELETE SET NULL, så passen
--    måste bort FÖRE blocket — annars blir de kvar som föräldralösa rader.
delete from planned_workouts where user_id in ('7db90b90-adc9-45c6-bc33-6f28b4939c2a', 'b230f931-c74e-47c8-acb1-d6ec8c46bfdc', '756d864b-8999-48fb-8021-d12dde86115a', 'e8f7affd-5237-4d90-b4da-fd03262f135f') and scheduled_date >= '2026-09-14';
delete from season_blocks where name = 'Grundträning 2026 HT';  -- kaskad: adepter + veckomönster

-- 2. Blocken.
insert into season_blocks (user_id, name, period, phase, season, start_date, end_date) values
  -- v40/26–v51/26
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Allmän förberedelse ht 2026', 'forberedelse', 'allman', NULL, '2026-09-28', '2026-12-20'),
  -- v52/26–v2/27
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Tävlingsförberedande inne 2027', 'forberedelse', 'tavlingsforberedande', 'indoor', '2026-12-21', '2027-01-17'),
  -- v3/27–v11/27
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Inomhussäsong 2027', 'tavling', 'tavling_form', 'indoor', '2027-01-18', '2027-03-21'),
  -- v12/27–v18/27
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Allmän förberedelse vår 2027', 'forberedelse', 'allman', NULL, '2027-03-22', '2027-05-09'),
  -- v19/27–v20/27
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Tävlingsförberedande ute 2027', 'forberedelse', 'tavlingsforberedande', 'outdoor', '2027-05-10', '2027-05-23'),
  -- v21/27–v24/27
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Utesäsong stabiliserande 2027', 'tavling', 'tavling_stabiliserande', 'outdoor', '2027-05-24', '2027-06-20'),
  -- v25/27–v27/27
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Utesäsong form juni–juli 2027', 'tavling', 'tavling_form', 'outdoor', '2027-06-21', '2027-07-11'),
  -- v28/27–v30/27
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Stabiliserande juli 2027', 'tavling', 'stabiliserande', 'outdoor', '2027-07-12', '2027-08-01'),
  -- v31/27–v35/27
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Utesäsong form aug 2027', 'tavling', 'tavling_form', 'outdoor', '2027-08-02', '2027-09-05'),
  -- v36/27–v39/27
  ('73243132-f73c-4330-b770-0fb4a7c152e4', 'Återhämtning ht 2027', 'atehamtning', 'vila', NULL, '2027-09-06', '2027-10-03');

-- 3. Alla fyra adepter på samtliga nya block.
insert into season_block_athletes (block_id, athlete_id)
select sb.id, a.athlete_id from season_blocks sb cross join (values
  ('7db90b90-adc9-45c6-bc33-6f28b4939c2a'::uuid),
  ('b230f931-c74e-47c8-acb1-d6ec8c46bfdc'::uuid),
  ('756d864b-8999-48fb-8021-d12dde86115a'::uuid),
  ('e8f7affd-5237-4d90-b4da-fd03262f135f'::uuid)
) as a(athlete_id) where sb.start_date >= '2026-09-28';

-- 4. Veckomönstret, kopplat på FAS så varje fas definieras en gång.
insert into week_template_items (block_id, weekday, slot, workout_type, title, training_factor)
select sb.id, t.weekday, t.slot, t.workout_type, t.title, t.training_factor
from season_blocks sb join (values
  ('allman', 1, 1, 'easy', 'Distans', 'endurance_aerob_distans'),
  ('allman', 1, 2, 'strength', 'Styrka – bål', 'styrka_grund'),
  ('allman', 2, 1, 'interval', 'Intervaller, avslut i backe', 'endurance_aerob_intervall'),
  ('allman', 3, 1, 'easy', 'Distans', 'endurance_aerob_distans'),
  ('allman', 3, 2, 'strength', 'Styrka – medicinboll', 'styrka_grund'),
  ('allman', 4, 1, 'threshold', 'Tröskel', 'endurance_aerob_troskel'),
  ('allman', 5, 1, 'strength', 'Styrka – blandat', 'styrka_grund'),
  ('allman', 6, 1, 'interval', 'Intervaller', 'endurance_aerob_intervall'),
  ('allman', 7, 1, 'long_run', 'Långpass', 'endurance_aerob_distans'),
  ('allman', 7, 2, 'strength', 'Styrka – gym', 'styrka_grund'),
  ('tavlingsforberedande', 1, 1, 'easy', 'Distans', 'endurance_aerob_distans'),
  ('tavlingsforberedande', 1, 2, 'strength', 'Styrka – bål', 'styrka_grund'),
  ('tavlingsforberedande', 2, 1, 'interval', 'Intervaller – kortare och snabbare', 'endurance_snabbhet'),
  ('tavlingsforberedande', 3, 1, 'easy', 'Distans', 'endurance_aerob_distans'),
  ('tavlingsforberedande', 3, 2, 'strength', 'Styrka – medicinboll', 'styrka_grund'),
  ('tavlingsforberedande', 4, 1, 'threshold', 'Tröskel – högre intensitet', 'endurance_aerob_troskel'),
  ('tavlingsforberedande', 5, 1, 'strength', 'Styrka – blandat', 'styrka_grund'),
  ('tavlingsforberedande', 6, 1, 'interval', 'Intervaller – tävlingsfart', 'endurance_sprint'),
  ('tavlingsforberedande', 7, 1, 'long_run', 'Långpass', 'endurance_aerob_distans'),
  ('tavlingsforberedande', 7, 2, 'strength', 'Styrka – gym', 'styrka_grund'),
  ('tavling_form', 1, 1, 'easy', 'Distans – underhåll', 'endurance_aerob_distans'),
  ('tavling_form', 1, 2, 'strength', 'Styrka – bål', 'styrka_grund'),
  ('tavling_form', 2, 1, 'interval', 'Korta, snabba intervaller', 'endurance_sprint'),
  ('tavling_form', 3, 1, 'easy', 'Distans – underhåll', 'endurance_aerob_distans'),
  ('tavling_form', 4, 1, 'threshold', 'Tröskel – underhåll', 'endurance_aerob_troskel'),
  ('tavling_form', 6, 1, 'interval', 'Tävlingsfart', 'endurance_sprint'),
  ('tavling_form', 7, 1, 'easy', 'Distans', 'endurance_aerob_distans'),
  ('tavling_stabiliserande', 1, 1, 'easy', 'Distans – underhåll', 'endurance_aerob_distans'),
  ('tavling_stabiliserande', 1, 2, 'strength', 'Styrka – bål', 'styrka_grund'),
  ('tavling_stabiliserande', 2, 1, 'interval', 'Intervaller – underhåll', 'endurance_aerob_intervall'),
  ('tavling_stabiliserande', 3, 1, 'easy', 'Distans – underhåll', 'endurance_aerob_distans'),
  ('tavling_stabiliserande', 4, 1, 'threshold', 'Tröskel – underhåll', 'endurance_aerob_troskel'),
  ('tavling_stabiliserande', 5, 1, 'strength', 'Styrka – blandat', 'styrka_grund'),
  ('tavling_stabiliserande', 6, 1, 'interval', 'Tävlingsfart', 'endurance_sprint'),
  ('tavling_stabiliserande', 7, 1, 'long_run', 'Långpass', 'endurance_aerob_distans'),
  ('stabiliserande', 1, 1, 'easy', 'Distans – lugnt', 'endurance_aerob_distans'),
  ('stabiliserande', 1, 2, 'strength', 'Styrka – bål', 'styrka_grund'),
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

-- 5. Rulla ut mönstret till faktiska pass.
--    Blocken skapas i SQL, så appens rollout-motor (lib/template-sync.ts) kör aldrig —
--    utan det här steget finns block och mönster men en tom kalender. Logiken speglar
--    generateFromTemplate i lib/planning.ts: en rad per (måndag i blocket + veckodag),
--    beskuren mot blockets datum så varken första eller sista delvisa veckan spiller över.
--    date_trunc('week', ...) ger måndag i Postgres, samma veckostart som mondayOf().
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

-- 6. Nikes häckträning, måndagar, bara hon.
--    Går inte att uttrycka i veckomönstret: week_template_items hänger på BLOCKET och
--    rullas ut likadant till alla taggade adepter. Ett pass för EN löpare kräver ingen ny
--    tabell — planned_workouts har redan en rad per löpare och datum, vilket är precis den
--    modell Detaljplanens veckovy bygger på. Slot 3, efter dagens distans och styrka.
--    Passtyp: appen saknar en teknik-typ, så grenteknik får närmaste körbaserade typ
--    (interval) med träningsfaktorn koordination — den rad i mallen häckskolningen hör till.
insert into planned_workouts
  (user_id, block_id, scheduled_date, slot, workout_type, title, training_factor, status)
select '756d864b-8999-48fb-8021-d12dde86115a', sb.id, x.d, 3, 'interval', 'Häckträning', 'koordination', 'planned'
from season_blocks sb
cross join lateral generate_series(
  date_trunc('week', sb.start_date::timestamp)::date, sb.end_date, interval '1 week') as g(wk)
cross join lateral (select g.wk::date as d) as x
where sb.start_date >= '2026-09-28' and sb.phase <> 'vila'
  and x.d between sb.start_date and sb.end_date;

-- 7. Tävlingarna ur rad 7. Arket ger bara veckonummer, så var och en läggs på LÖRDAGEN i
--    sin vecka. competitions har ingen delningstabell, alltså en rad per adept.
insert into competitions (user_id, name, competition_date, priority, venue)
select a.athlete_id, c.name, c.competition_date, c.priority, c.venue from (values
  -- v43/26
  ('Terräng SM', '2026-10-24'::date, 'C', NULL),
  -- v7/27
  ('Bannister', '2027-02-20'::date, 'C', 'indoor'),
  -- v10/27
  ('USM', '2027-03-13'::date, 'A', 'indoor'),
  -- v22/27
  ('Sävedalsspelen', '2027-06-05'::date, 'C', 'outdoor'),
  -- v24/27
  ('SAYO', '2027-06-19'::date, 'C', 'outdoor'),
  -- v26/27
  ('VU-spelen', '2027-07-03'::date, 'C', 'outdoor'),
  -- v27/27
  ('Folksam GP', '2027-07-10'::date, 'C', 'outdoor'),
  -- v29/27
  ('UEM', '2027-07-24'::date, 'A', 'outdoor'),
  -- v31/27
  ('USM', '2027-08-07'::date, 'A', 'outdoor'),
  -- v34/27
  ('Bannister', '2027-08-28'::date, 'C', 'outdoor'),
  -- v34/27
  ('Folksam GP', '2027-08-28'::date, 'C', 'outdoor'),
  -- v35/27
  ('Finnkampen', '2027-09-04'::date, 'A', 'outdoor')
) as c(name, competition_date, priority, venue) cross join (values
  ('7db90b90-adc9-45c6-bc33-6f28b4939c2a'::uuid),
  ('b230f931-c74e-47c8-acb1-d6ec8c46bfdc'::uuid),
  ('756d864b-8999-48fb-8021-d12dde86115a'::uuid),
  ('e8f7affd-5237-4d90-b4da-fd03262f135f'::uuid)
) as a(athlete_id);

-- 8. Självkontroll. Migrationen körs i en transaktion, så ett felaktigt antal
--    avbryter och rullar tillbaka HELA ändringen i stället för att lämna en
--    halv årsplan i produktion. Talen är uträknade ur mallen, inte avlästa ur
--    resultatet: 10 block, 4 adepter styck, 79 mönsterrader (10+10+7+8+7+3 per
--    fas gånger antalet block med den fasen), och 12 tävlingar per adept.
do $$
declare
  n_block int; n_ath int; n_item int; n_pw int; n_hack int; n_comp int;
begin
  select count(*) into n_block from season_blocks where start_date >= '2026-09-28';
  select count(*) into n_ath from season_block_athletes sba
    join season_blocks sb on sb.id = sba.block_id where sb.start_date >= '2026-09-28';
  select count(*) into n_item from week_template_items wti
    join season_blocks sb on sb.id = wti.block_id where sb.start_date >= '2026-09-28';
  select count(*) into n_pw from planned_workouts where scheduled_date >= '2026-09-28' and slot < 3;
  select count(*) into n_hack from planned_workouts where title = 'Häckträning';
  -- Avgränsat till adepterna: Fredrik har egna framtida lopp (Göteborg halvmaraton,
  -- Stockholm maraton) som inte hör till Daniels årsplan. Första försöket räknade
  -- dem med och fick 50 i stället för 48 — självkontrollen fångade det och rullade
  -- tillbaka hela migrationen, vilket är precis vad den är till för.
  select count(*) into n_comp from competitions
   where competition_date >= '2026-10-01'
     and user_id in ('7db90b90-adc9-45c6-bc33-6f28b4939c2a', 'b230f931-c74e-47c8-acb1-d6ec8c46bfdc',
                     '756d864b-8999-48fb-8021-d12dde86115a', 'e8f7affd-5237-4d90-b4da-fd03262f135f');

  if n_block <> 10 then raise exception 'Fel antal block: % (väntade 10)', n_block; end if;
  if n_ath <> 40 then raise exception 'Fel antal block-adepter: % (väntade 40)', n_ath; end if;
  if n_item <> 79 then raise exception 'Fel antal mönsterrader: % (väntade 79)', n_item; end if;
  if n_pw <> 1736 then raise exception 'Fel antal utrullade pass: % (väntade 1736)', n_pw; end if;
  if n_hack <> 49 then raise exception 'Fel antal häckpass: % (väntade 49)', n_hack; end if;
  if n_comp <> 48 then raise exception 'Fel antal tävlingar: % (väntade 48)', n_comp; end if;

  raise notice 'Årsplan 2026/2027: % block, % mönsterrader, % pass, % häckpass, % tävlingar',
    n_block, n_item, n_pw, n_hack, n_comp;
end $$;
