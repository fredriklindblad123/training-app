-- P0.3 (docs/insikter-roadmap.md): mappa fält som redan ligger i
-- activities.raw_data men aldrig fått egna kolumner. Ingen ny
-- Garmin-integration behövs — datan finns redan för alla befintliga
-- aktiviteter och fylls i retroaktivt av scripts/backfill_activity_fields.py.
-- Alla kolumner är nullable: äldre aktiviteter och pass loggade med andra
-- klockor saknar ofta dessa fält i raw_data.

alter table activities
  add column avg_power numeric,                  -- watt, löpeffekt
  add column norm_power numeric,                 -- watt, normaliserad effekt
  add column avg_ground_contact_time numeric,     -- ms
  add column avg_vertical_oscillation numeric,    -- cm
  add column avg_vertical_ratio numeric,          -- %
  add column avg_gap_seconds_per_km numeric,      -- gradjusterad fart (GAP)
  add column fastest_1k_seconds numeric,          -- snabbaste kilometern i passet
  add column body_battery_drain integer,          -- Body Battery-tapp under passet
  add column moderate_intensity_minutes integer,
  add column vigorous_intensity_minutes integer;
