-- Initial schema for träningsapp, se docs/data-model.md för bakgrund.

create extension if not exists vector;

-- profiles ------------------------------------------------------------

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now()
);

-- Skapa automatiskt en profile-rad när ett nytt auth-konto registreras.
create function handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, new.raw_user_meta_data ->> 'full_name');
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure handle_new_user();

-- goals -----------------------------------------------------------------

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

create index goals_user_id_idx on goals(user_id);

-- plan_phases -------------------------------------------------------------

create table plan_phases (
  id uuid primary key default gen_random_uuid(),
  goal_id uuid not null references goals(id) on delete cascade,
  name text not null,                   -- "Grundträning", "Uppbyggnad", "Skärpning", "Nedtrappning"
  start_date date not null,
  end_date date not null,
  focus text,
  sort_order integer not null default 0
);

create index plan_phases_goal_id_idx on plan_phases(goal_id);

-- activities --------------------------------------------------------------

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

create index activities_user_id_start_time_idx on activities(user_id, start_time desc);

-- activity_splits -----------------------------------------------------------

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

-- planned_workouts ------------------------------------------------------------

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

create index planned_workouts_user_id_scheduled_date_idx on planned_workouts(user_id, scheduled_date);

-- diary_entries -----------------------------------------------------------------

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

create index diary_entries_user_id_entry_date_idx on diary_entries(user_id, entry_date);

-- reference_documents -------------------------------------------------------------

create table reference_documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references profiles(id) on delete cascade,  -- null = delad/global referens
  title text not null,
  author text,
  file_path text not null,               -- sökväg i Supabase Storage
  uploaded_at timestamptz not null default now()
);

-- document_chunks -------------------------------------------------------------------

create table document_chunks (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references reference_documents(id) on delete cascade,
  chunk_index integer not null,
  content text not null,
  embedding vector(1536),
  page_number integer,
  unique (document_id, chunk_index)
);

create index document_chunks_embedding_idx on document_chunks
  using ivfflat (embedding vector_cosine_ops);

-- ai_suggestions ----------------------------------------------------------------------

create table ai_suggestions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  goal_id uuid references goals(id) on delete set null,
  prompt text not null,
  suggestion text not null,
  source_chunk_ids uuid[],               -- vilka document_chunks som användes som kontext
  created_at timestamptz not null default now()
);

create index ai_suggestions_user_id_idx on ai_suggestions(user_id);

-- Row Level Security ------------------------------------------------------------------
-- Varje användare ser och äger bara sina egna rader. reference_documents med
-- user_id = null är delade/globala referenser (t.ex. inköpta träningsböcker) och
-- är läsbara för alla inloggade användare men bara redigerbara av admin/service role.

alter table profiles enable row level security;
alter table goals enable row level security;
alter table plan_phases enable row level security;
alter table activities enable row level security;
alter table activity_splits enable row level security;
alter table planned_workouts enable row level security;
alter table diary_entries enable row level security;
alter table reference_documents enable row level security;
alter table document_chunks enable row level security;
alter table ai_suggestions enable row level security;

create policy "profiles: läs och ändra egen rad"
  on profiles for all
  using (auth.uid() = id)
  with check (auth.uid() = id);

create policy "goals: full åtkomst till egna rader"
  on goals for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "plan_phases: åtkomst via ägt mål"
  on plan_phases for all
  using (exists (select 1 from goals where goals.id = plan_phases.goal_id and goals.user_id = auth.uid()))
  with check (exists (select 1 from goals where goals.id = plan_phases.goal_id and goals.user_id = auth.uid()));

create policy "activities: full åtkomst till egna rader"
  on activities for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "activity_splits: åtkomst via ägd aktivitet"
  on activity_splits for all
  using (exists (select 1 from activities where activities.id = activity_splits.activity_id and activities.user_id = auth.uid()))
  with check (exists (select 1 from activities where activities.id = activity_splits.activity_id and activities.user_id = auth.uid()));

create policy "planned_workouts: full åtkomst till egna rader"
  on planned_workouts for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "diary_entries: full åtkomst till egna rader"
  on diary_entries for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reference_documents: läs egna och delade"
  on reference_documents for select
  using (user_id is null or auth.uid() = user_id);

create policy "reference_documents: ändra egna"
  on reference_documents for insert
  with check (auth.uid() = user_id);

create policy "reference_documents: uppdatera/ta bort egna"
  on reference_documents for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy "reference_documents: ta bort egna"
  on reference_documents for delete
  using (auth.uid() = user_id);

create policy "document_chunks: läs via läsbart dokument"
  on document_chunks for select
  using (exists (
    select 1 from reference_documents
    where reference_documents.id = document_chunks.document_id
      and (reference_documents.user_id is null or reference_documents.user_id = auth.uid())
  ));

create policy "ai_suggestions: full åtkomst till egna rader"
  on ai_suggestions for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
