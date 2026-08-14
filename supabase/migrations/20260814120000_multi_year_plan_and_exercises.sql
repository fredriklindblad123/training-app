-- Fas 0 steg 4: Flerårsplan, Årsplan (vecka-för-vecka) och övningsbibliotek,
-- ur "Träningsplanering Friidrottstränare steg 3" (Svensk Friidrott). Se
-- konversationen för bakgrunden — Daniel (coach) ska kunna hålla den mallen
-- uppdaterad och skicka in den, appen ska kunna fylla i den åt honom.
--
-- Samma RLS-mönster som 20260814100000_coach_athletes.sql: egen rad eller en
-- rad som tillhör en löpare man coachar. exercise_routines går åt andra
-- hållet (se motivering vid den tabellen).

-- --------------------------------------------------------------------------
-- multi_year_plans: Flerårsplan, en rad per (löpare, årsetikett)
-- --------------------------------------------------------------------------
-- Fri text/löst formulerad, precis som originalfliken faktiskt är (mål,
-- huvudtävlingar och läger är kryssrutor/fritext i Excel, ingen strikt
-- struktur att spegla här utan att uppfinna en striktare modell än källan
-- har). result_targets är den enda delen med lätt struktur (gren + måltid),
-- eftersom Excel redan håller den som tydliga rader ("800 m: 2.20").
create table multi_year_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  year_label text not null,              -- "16 år", "2027" — vad tränaren råkar kalla året
  sort_order integer not null default 0,
  overall_goal text,
  general_training_goal text,
  specific_training_goal text,
  weekly_hours numeric,
  weekly_days integer,
  weekly_sessions integer,
  target_competitions text,              -- "DM, Kraftmätningen, USM" — fri text
  camps text,                            -- "Sverigeläger, Utomlandsläger" — fri text
  result_targets jsonb not null default '[]'::jsonb,   -- [{"event":"800 m","target":"2.20"}]
  evaluations text,                      -- "Individuellt samtal, Tröskeltest" — fri text
  created_at timestamptz not null default now(),
  unique (user_id, year_label)
);

create index multi_year_plans_user_idx on multi_year_plans(user_id, sort_order);

alter table multi_year_plans enable row level security;
create policy "multi_year_plans: egna rader eller coachad löpares"
  on multi_year_plans for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = multi_year_plans.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = multi_year_plans.user_id
    )
  );

-- --------------------------------------------------------------------------
-- season_week_plans: Årsplan, en rad per (löpare, veckans måndag)
-- --------------------------------------------------------------------------
-- training_factors är en öppen nyckel→text-karta (se lib/training-factors.ts
-- för den fasta listan av ~25 nycklar/etiketter/ordning) i stället för en
-- kolumn per faktor — cellerna i originalmallen blandar betoningsord och fri
-- text för samma sorts rad, en striktare struktur hade tvingat in data
-- källan själv inte har.
create table season_week_plans (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  week_start_date date not null,         -- måndagen i veckan (isoWeekStart-konventionen)
  period_type text,                      -- "Förberedelseperiod" / "Tävlingsperiod" / "Återhämtning" — fri text
  sub_phase text,                        -- "Tävling (form)", "Tävlingsförberedande" m.m. — fri text
  note text,                             -- "Tävlingar / Läger / Skola"-kolumnen
  sessions_count integer,
  days_count integer,
  starts_count integer,
  hours_count numeric,
  has_test boolean not null default false,
  training_factors jsonb not null default '{}'::jsonb,   -- {"speed_max": "Stor betoning", ...}
  created_at timestamptz not null default now(),
  unique (user_id, week_start_date)
);

create index season_week_plans_user_week_idx on season_week_plans(user_id, week_start_date);

alter table season_week_plans enable row level security;
create policy "season_week_plans: egna rader eller coachad löpares"
  on season_week_plans for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = season_week_plans.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = season_week_plans.user_id
    )
  );

-- --------------------------------------------------------------------------
-- exercise_routines: övningsbibliotek (uppvärmning, koordination, löpformer,
-- styrka, rörlighet — sex av originalmallens flikar)
-- --------------------------------------------------------------------------
-- user_id är COACHEN som skrev rutinen, inte löparen — biblioteket är
-- coachens verktyg, återanvänt över flera löpare. RLS går därför åt andra
-- hållet mot övriga tabeller i den här migrationen: en löpare (auth.uid())
-- ska kunna LÄSA sin egen coachs bibliotek, men bara coachen får skriva.
create table exercise_routines (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,   -- coachen
  category text not null check (category in (
    'uppvarmning', 'koordination', 'lopform', 'styrka_snabb', 'styrka_stang', 'rorlighet'
  )),
  name text not null,                    -- "Koordination 1"
  items jsonb not null default '[]'::jsonb,   -- [{"label": "Hoppsasteg med knälyft", "detail": "2x20m"}]
  created_at timestamptz not null default now()
);

create index exercise_routines_user_category_idx on exercise_routines(user_id, category);

alter table exercise_routines enable row level security;

create policy "exercise_routines: coachen hanterar sitt eget bibliotek"
  on exercise_routines for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "exercise_routines: löparen läser sin coachs bibliotek"
  on exercise_routines for select
  using (
    exists (
      select 1 from coach_athletes ca
      where ca.athlete_id = auth.uid() and ca.coach_id = exercise_routines.user_id
    )
  );

-- planned_workouts: en rutin kan länkas till ett specifikt planerat pass.
alter table planned_workouts
  add column exercise_routine_id uuid references exercise_routines(id) on delete set null;
