-- Ersätter block-modellen (grund/uppbyggnad/skärpning/tävling/nedtrappning/
-- vila) med Årsplan-flikens eget tvånivå-vokabulär ur "Träningsplanering
-- Friidrottstränare steg 3" (rad 5-6): Period (Förberedelseperiod/
-- Tävlingsperiod/Återhämtning) och en undertyp (Allmän/Tävlingsförberedande/
-- Tävling (form)/Tävling (stabiliserande)/Stabiliserande/Vila).
--
-- Uttrycklig instruktion: ta bort den gamla blockfunktionen helt och synka
-- den med Årsplan-planeringen, i stället för att bygga period/fas som ett
-- separat lager ovanpå det gamla block_type-fältet.
--
-- Samtidigt flyttas Årsplanets vecko-parametrar (pass/dagar/starter/timmar/
-- test/träningsfaktorer) från en egen rad per vecka (season_week_plans,
-- bekräftat tom — noll rader, ingen data att migrera) till en "standardvecka"
-- direkt på blocket: samma värden gäller varje vecka inom blockets
-- datumintervall, så en tränare fyller i det en gång per block i stället för
-- 52 gånger per år.
--
-- week_templates.block_type matchar idag mot season_blocks.block_type för
-- att rulla ut veckomallar automatiskt (se syncBlockWithTemplates i
-- sasongen/actions.ts) — den mekaniken behålls oförändrad, bara omdöpt till
-- att matcha mot den nya, finare `phase`-kolumnen (samma detaljnivå som det
-- gamla block_type hade).
--
-- Existerande data (7 season_blocks-rader, 3 week_templates-rader för Alice/
-- Fredrik) migreras med en explicit mappning nedan, inte manuell
-- återinmatning — planned_workouts (kalendern) rörs inte alls: den pekar på
-- block_id (ett stabilt uuid), aldrig på block_type/phase-värdet.

-- ---------------------------------------------------------------------------
-- season_blocks: period + phase ersätter block_type, plus standardvecka
-- ---------------------------------------------------------------------------

alter table season_blocks add column period text;
alter table season_blocks add column new_phase text;

update season_blocks set
  period = case block_type
    when 'grund' then 'forberedelse'
    when 'uppbyggnad' then 'forberedelse'
    when 'skarpning' then 'tavling'
    when 'tavling' then 'tavling'
    when 'nedtrappning' then 'tavling'
    when 'vila' then 'atehamtning'
  end,
  new_phase = case block_type
    when 'grund' then 'allman'
    when 'uppbyggnad' then 'tavlingsforberedande'
    when 'skarpning' then 'tavling_form'
    when 'tavling' then 'tavling_stabiliserande'
    when 'nedtrappning' then 'stabiliserande'
    when 'vila' then 'vila'
  end;

alter table season_blocks drop column block_type;
alter table season_blocks rename column new_phase to phase;

alter table season_blocks alter column period set not null;
alter table season_blocks alter column phase set not null;

alter table season_blocks add constraint season_blocks_period_check
  check (period in ('forberedelse', 'tavling', 'atehamtning'));
alter table season_blocks add constraint season_blocks_phase_check
  check (phase in (
    'allman', 'tavlingsforberedande', 'tavling_form',
    'tavling_stabiliserande', 'stabiliserande', 'vila'
  ));

-- Standardvecka: samma kolumner som season_week_plans hade, nu på blocket
-- i stället för på en enskild vecka.
alter table season_blocks add column sessions_count integer;
alter table season_blocks add column days_count integer;
alter table season_blocks add column starts_count integer;
alter table season_blocks add column hours_count numeric;
alter table season_blocks add column has_test boolean not null default false;
alter table season_blocks add column training_factors jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------------
-- week_templates: samma mappning, samma matchningsgranularitet som förut
-- (block_type -> phase), så syncBlockWithTemplates/syncTemplateAcrossBlocks
-- fortsätter fungera oförändrat, bara mot det nya kolumnnamnet/vokabuläret.
-- ---------------------------------------------------------------------------

alter table week_templates add column phase text;

update week_templates set phase = case block_type
    when 'grund' then 'allman'
    when 'uppbyggnad' then 'tavlingsforberedande'
    when 'skarpning' then 'tavling_form'
    when 'tavling' then 'tavling_stabiliserande'
    when 'nedtrappning' then 'stabiliserande'
    when 'vila' then 'vila'
  end
where block_type is not null;

alter table week_templates drop column block_type;

-- ---------------------------------------------------------------------------
-- season_week_plans: ersatt av standardveckan på season_blocks ovan.
-- Bekräftat tom (SELECT * gav []) — ingen data att bevara.
-- ---------------------------------------------------------------------------

drop table season_week_plans;
