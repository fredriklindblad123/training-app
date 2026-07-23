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
  created_at timestamptz not null default now(),
  unique (user_id, source, external_id)
);

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
  notes text,
  created_at timestamptz not null default now()
);

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
