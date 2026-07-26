# Datamodell (förslag)

Postgres-schema (Supabase), baserat på fälten vi hittade i Garmin-testet
(`garmin_sample_activity.json`) och de fyra kärnfunktionerna: kalender,
träningsdagbok, långsiktig planering, AI-förslag via RAG.

## Översikt över tabeller

- **profiles** – en rad per användare (utökar Supabase auth.users)
- **goals** – långsiktigt mål, t.ex. en tävling om ett år
- **plan_phases** – periodiseringsblock inom ett mål (grundträning, uppbyggnad, skärpning, nedtrappning)
- **planned_workouts** – enskilda planerade pass i kalendern
- **activities** – faktiskt genomförda pass, synkade från Garmin/Strava (eller manuellt inlagda)
- **activity_splits** – delsträckor/intervaller inom ett genomfört pass
- **diary_entries** – fria dagboksanteckningar, kan länkas till ett pass
- **reference_documents** – uppladdade PDF:er (t.ex. Almgren-boken)
- **document_chunks** – textbitar + embeddings för RAG-sökning
- **ai_suggestions** – logg över AI-genererade träningsförslag

Kopplingen mellan planering och verklighet: `planned_workouts.linked_activity_id`
pekar på den faktiska `activities`-raden när ett planerat pass genomförs, så
kalendern kan visa plan vs. utfall.

## SQL

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

create table goals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  title text not null,                  -- t.ex. "SM 1500m 2027"
  event_date date not null,
  target_result text,                   -- t.ex. "3:45"
  distance_meters integer,
  notes text,
  status text not null default 'active' check (status in ('active','completed','abandoned')),
  created_at timestamptz not null default now()
);

create table plan_phases (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  name text not null,                   -- "Grundträning", "Uppbyggnad", "Skärpning", "Nedtrappning"
  start_date date not null,
  end_date date not null,
  focus text,
  sort_order integer not null default 0
);

create table activities (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  source text not null default 'garmin' check (source in ('garmin','strava','manual')),
  external_id text not null,             -- activityId från Garmin/Strava
  activity_type text,
  name text,
  start_time timestamptz not null,
  duration_seconds numeric,
  distance_meters numeric,
  avg_pace_seconds_per_km numeric,
  avg_hr integer,
  max_hr integer,
  hr_zone_1_seconds numeric,
  hr_zone_2_seconds numeric,
  hr_zone_3_seconds numeric,
  hr_zone_4_seconds numeric,
  hr_zone_5_seconds numeric,
  aerobic_training_effect numeric,
  anaerobic_training_effect numeric,
  training_effect_label text,
  training_load numeric,
  vo2max numeric,
  avg_cadence numeric,
  avg_stride_length numeric,
  elevation_gain numeric,
  elevation_loss numeric,
  calories numeric,
  location_name text,
  start_lat double precision,
  start_lng double precision,
  raw_data jsonb,                        -- fullständig rådata som backup
  category text check (category in (
    'easy','long_run','threshold','interval','repetition','race','strength','cross_training'
  )),                                     -- medeldistans-taxonomi, satt av trigger vid synk
  category_source text not null default 'auto' check (category_source in ('auto','manual')),
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);
```

`category` sätts automatiskt av en trigger (`categorize_activity`, se
migration `20260725120000_activity_category.sql`) baserat på `activity_type`,
passnamn (nyckelord från träningsplaner) och Garmins `training_effect_label`,
med fallback på distans/tid för långpass. En manuell ändring i UI:t sätter
`category_source = 'manual'`, vilket gör att triggern lämnar värdet ifred vid
nästa Garmin-synk. `category_source = 'auto'` återställer den automatiska
kategoriseringen.

```sql

create table activity_splits (
  id uuid primary key default gen_random_uuid(),
  activity_id uuid not null references activities(id) on delete cascade,
  split_index integer not null,
  distance_meters numeric,
  duration_seconds numeric,
  avg_pace_seconds_per_km numeric,
  avg_hr integer,
  elevation_gain numeric,
  unique (activity_id, split_index)
);

-- garmin_connections + garmin_tokens ------------------------------------------
-- Multi-user Garmin-koppling (web/api/index.py, migration
-- 20260725150000_garmin_connections.sql). Varje användare ansluter sitt eget
-- Garmin-konto via ett formulär i appen (/settings); lösenordet skickas bara
-- en gång till login-endpointen och sparas aldrig — bara den token
-- (garth Client.dumps()) som Garmin-inloggningen ger tillbaka, i
-- garmin_tokens (ingen RLS-policy alls, bara service_role kommer åt den).
-- garmin_connections har en läs-policy så användaren kan se sin egen
-- status/senast-synkad, men aldrig token:en.

create table garmin_connections (
  user_id uuid primary key references profiles(id) on delete cascade,
  status text not null default 'connected' check (status in ('connected','needs_reauth','error')),
  last_synced_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now()
);

create table garmin_tokens (
  user_id uuid primary key references profiles(id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);

-- daily_metrics ---------------------------------------------------------------
-- Daglig återhämtningsdata från Garmin (sömn, vilopuls, HRV), hämtad
-- automatiskt vid synk. Egen tabell istället för kolumner på diary_entries:
-- det här är mätdata från klockan, inte användarens anteckningar, och finns
-- även för dagar utan dagboksinlägg. diary_entries.sleep_hours finns kvar som
-- manuellt reservalternativ och visas i UI:t bara när Garmin-data saknas.
-- OBS: Garmins sömn-endpoint tar en dag per anrop, så synkfönstret för sömn
-- är kortare än för aktiviteter (se docs/garmin-api.md).

create table daily_metrics (
  user_id uuid not null references profiles(id) on delete cascade,
  metric_date date not null,
  sleep_seconds numeric,
  deep_sleep_seconds numeric,
  light_sleep_seconds numeric,
  rem_sleep_seconds numeric,
  awake_seconds numeric,
  nap_seconds numeric,
  sleep_score integer,                   -- sleepScores.overall.value (0-100)
  resting_hr integer,
  hrv_overnight_avg numeric,             -- avgOvernightHrv, ms
  avg_respiration numeric,
  avg_sleep_stress numeric,
  raw_data jsonb,
  synced_at timestamptz not null default now(),
  primary key (user_id, metric_date)
);

create table planned_workouts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  goal_id uuid references goals(id) on delete set null,
  phase_id uuid references plan_phases(id) on delete set null,
  scheduled_date date not null,
  workout_type text not null,            -- 'interval','tempo','easy','long','race','rest','strength'
  title text,
  description text,                      -- t.ex. "6x1000m @ 3:15/km, 2 min vila"
  target_distance_meters integer,
  target_duration_seconds integer,
  target_pace_seconds_per_km integer,
  status text not null default 'planned' check (status in ('planned','completed','skipped','modified')),
  linked_activity_id uuid references activities(id) on delete set null,
  created_at timestamptz not null default now()
);

create table diary_entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  entry_date date not null,
  activity_id uuid references activities(id) on delete set null,
  planned_workout_id uuid references planned_workouts(id) on delete set null,
  rpe integer check (rpe between 1 and 10),  -- upplevd ansträngning
  mood text,
  soreness text,
  sleep_hours numeric,
  notes text,                            -- idrottarens egna ord (manuellt, eller importerat från PDF)
  session_log text,                      -- rå träningsloggtext, importerad från PDF-dagbok
  coach_notes text,                      -- tränarens kommentarer, importerad från PDF-dagbok
  day_type text check (day_type in ('training','rest','sick','injured')),  -- driver kalenderns årsvy
  created_at timestamptz not null default now(),
  unique (user_id, entry_date)
);

-- PDF-dagboksimport (t.ex. FIG:s mall) sker inte via appen — fanns tidigare
-- som /api/diary/import (uppladdning + Anthropic-tolkning), men görs sen
-- 2026-07-26 istället manuellt några gånger per år: veckonummer, veckodagar
-- och färgkodade kommentarer (grönt/rosa = idrottarens egna, blått/rött =
-- tränarens) tolkas ur PDF:ens text-/färg-/positionsdata och skrivs direkt
-- till session_log/notes/coach_notes ovan.

create table reference_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,  -- null = delad/global referens
  title text not null,
  author text,
  file_path text not null,               -- sökväg i Supabase Storage
  uploaded_at timestamptz not null default now()
);

create extension if not exists vector;

create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references reference_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  page_number integer,
  unique (document_id, chunk_index)
);

create index on document_chunks using ivfflat (embedding vector_cosine_ops);

create table ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  goal_id uuid references goals(id) on delete set null,
  prompt text not null,
  suggestion text not null,
  source_chunk_ids uuid[],               -- vilka document_chunks som användes som kontext
  created_at timestamptz not null default now()
);
```

## Att göra

- [ ] Skapa Supabase-projekt och köra schemat som migration
- [ ] Row Level Security-policyer (varje användare ser bara sina egna rader)
- [ ] Välj embeddingmodell och bekräfta vektordimension (1536 antar OpenAI/Voyage-standard)
