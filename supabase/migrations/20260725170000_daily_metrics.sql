-- Daglig återhämtningsdata från Garmin (sömn, vilopuls, HRV). Hämtas
-- automatiskt vid synk (web/api/index.py) så användaren slipper skriva in
-- sömn för hand i dagboken.
--
-- Egen tabell istället för kolumner på diary_entries: det här är mätdata
-- från klockan, inte användarens egna anteckningar, och finns för dagar
-- utan dagboksinlägg. diary_entries.sleep_hours finns kvar som manuellt
-- reservalternativ för dagar då klockan inte användes.

create table daily_metrics (
  user_id uuid not null references profiles(id) on delete cascade,
  metric_date date not null,
  sleep_seconds numeric,
  deep_sleep_seconds numeric,
  light_sleep_seconds numeric,
  rem_sleep_seconds numeric,
  awake_seconds numeric,
  nap_seconds numeric,
  sleep_score integer,                  -- sleepScores.overall.value (0-100)
  resting_hr integer,
  hrv_overnight_avg numeric,            -- avgOvernightHrv, ms
  avg_respiration numeric,              -- andetag/min under sömn
  avg_sleep_stress numeric,
  raw_data jsonb,                       -- dailySleepDTO som backup
  synced_at timestamptz not null default now(),
  primary key (user_id, metric_date)
);

create index daily_metrics_user_id_metric_date_idx
  on daily_metrics(user_id, metric_date desc);

alter table daily_metrics enable row level security;

-- Bara läsning för användaren själv; skrivning sker via service_role från
-- synk-funktionen (som kringgår RLS).
create policy "daily_metrics: läs egen data"
  on daily_metrics for select
  using (auth.uid() = user_id);
