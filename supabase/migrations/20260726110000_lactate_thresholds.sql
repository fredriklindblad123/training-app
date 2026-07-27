-- P0.3b (docs/insikter-roadmap.md): laktatvärden och personligt kalibrerat
-- tröskelband. Andreas Almgren följer fyra mätvärden — fart, laktat, puls,
-- känsla (avsnitt 2.3 i roadmapen) — och styr intensiteten mot ett eget
-- pulsband (167–178 för honom), inte klockans gissade autozoner. Laktat är
-- den enda av de fyra som aldrig kan komma automatiskt från en klocka: det
-- kommer från ett stick vid ett laktattest (stegrande fart, ett värde per
-- steg), därför en egen tabell istället för en kolumn på activities.

create table lactate_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  activity_id uuid references activities(id) on delete set null,
  measured_at timestamptz not null default now(),
  lactate_mmol numeric not null,          -- t.ex. 2.8
  pace_seconds_per_km numeric,            -- farten mätvärdet togs vid
  heart_rate integer,
  context text check (context in ('test', 'workout', 'race')),
  note text
);

create index lactate_readings_user_id_measured_at_idx
  on lactate_readings(user_id, measured_at desc);

alter table lactate_readings enable row level security;

create policy "lactate_readings: full åtkomst till egna rader"
  on lactate_readings for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Personligt kalibrerade trösklar, inte klockans zoner.
-- threshold_hr_low/high är bandet dagligt tröskelarbete siktar mot (Almgren:
-- 167–178). lt1_hr/lt2_hr är de fysiologiska brytpunkterna (aerob/anaerob
-- tröskel) ett laktattest visar.
alter table profiles
  add column lt1_hr integer,              -- aerob tröskel, slag/min
  add column lt2_hr integer,              -- anaerob tröskel
  add column threshold_hr_low integer,    -- Almgren: 167
  add column threshold_hr_high integer,   -- Almgren: 178
  add column max_hr integer;
