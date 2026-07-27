-- P0.2 (docs/insikter-roadmap.md): varvdata per pass. activity_splits fanns
-- redan i schemat men har aldrig fyllts — tabellen var tom.
--
-- För en medeldistanslöpare ÄR varvtiderna träningen: passets snitt blandar
-- löpning och vila och är därför meningslöst för ett intervallpass. Med varv
-- går det att se att 400:orna gick på 87,9 / 88,2 / 88,7 — det som avgör om
-- formen går åt rätt håll.
--
-- split_type: Garmins intensityType visade sig vara "INTERVAL" för *alla*
-- varv, även vilovarven, och duger alltså inte till att skilja aktivt från
-- vila. Klassificeringen görs i stället på fart relativt passets snabbaste
-- varv (se scripts/backfill_activity_splits.py) — separationen är knivskarp,
-- ca 4,5 m/s aktivt mot 0,8 m/s vila.

alter table activity_splits
  add column split_type text check (split_type in ('active', 'rest')),
  add column max_hr integer,
  add column avg_cadence numeric,
  add column avg_power numeric,
  add column avg_gap_seconds_per_km numeric,
  add column start_time timestamptz;

-- Varvtabellen läses alltid per pass och i varvordning.
create index if not exists activity_splits_activity_id_split_index_idx
  on activity_splits(activity_id, split_index);
