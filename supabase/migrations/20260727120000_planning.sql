-- Träningsplanering: säsongsblock, tävlingar och återkommande veckoupplägg.
-- Ersätter goals/plan_phases som planeringsmodell.
--
-- Varför inte bygga vidare på plan_phases: den kräver ett goal_id (not null),
-- alltså att varje period tillhör ett mål. Men periodiseringen hör till
-- säsongen, inte till en enskild tävling — grundperioden finns oavsett vilka
-- lopp som ligger i maj. Att tvinga in den i en måltillhörighet gör att samma
-- period måste dupliceras per mål.
--
-- Almgren beskriver att han håller en fast struktur i ungefär sex veckor och
-- är konsekvent inom perioden (avsnitt 2.3 i docs/insikter-roadmap.md). Det
-- är precis vad ett block är här: en period med en avsikt, som man planerar
-- en gång och upprepar, i stället för att fylla i vecka för vecka.

-- --------------------------------------------------------------------------
-- Säsongsblock
-- --------------------------------------------------------------------------
create table season_blocks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,                       -- "Grundträning 1", "Uppbyggnad inne"
  block_type text not null check (block_type in (
    'grund',         -- volym, kontrollerad intensitet
    'uppbyggnad',    -- mer specifikt arbete
    'skarpning',     -- tävlingsfart, lägre volym
    'tavling',       -- tävlingsperiod
    'nedtrappning',  -- taper inför A-tävling
    'vila'           -- övergångsperiod
  )),
  -- Vilken tävlingssäsong blocket siktar mot. null = ren träningsperiod utan
  -- säsongstillhörighet (t.ex. hösten före inomhussäsongen).
  season text check (season in ('indoor', 'outdoor')),
  start_date date not null,
  end_date date not null,
  focus text,                                -- fritext: "tröskelvolym, 2 pass/vecka"
  created_at timestamptz not null default now(),
  constraint season_blocks_dates_ok check (end_date >= start_date)
);

create index season_blocks_user_start_idx on season_blocks(user_id, start_date);

alter table season_blocks enable row level security;
create policy "season_blocks: full åtkomst till egna rader"
  on season_blocks for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- --------------------------------------------------------------------------
-- Tävlingar och grenar
-- --------------------------------------------------------------------------
-- Egen tabell i stället för goals: en tävling har flera grenar (hon kan
-- springa både 800 m och 1500 m samma helg), en prioritet som styr
-- periodiseringen, och en inne/ute-tillhörighet. goals kunde bara uttrycka
-- ett måltid för en distans.
create table competitions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,                        -- "Inomhus-SM"
  competition_date date not null,
  location text,
  venue text check (venue in ('indoor', 'outdoor')),
  -- A = säsongens huvudmål, planeringen toppar hit. B = viktig men inte
  -- avgörande. C = träningstävling, ingen nedtrappning.
  priority text not null default 'C' check (priority in ('A', 'B', 'C')),
  notes text,
  created_at timestamptz not null default now()
);

create index competitions_user_date_idx on competitions(user_id, competition_date);

alter table competitions enable row level security;
create policy "competitions: full åtkomst till egna rader"
  on competitions for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table competition_events (
  id uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  event text not null,                       -- "1500m", "2000m hinder"
  target_result text,                        -- "4:35.00"
  actual_result text,
  placement integer,
  sort_order integer not null default 0
);

create index competition_events_competition_idx on competition_events(competition_id);

alter table competition_events enable row level security;
-- Grenar ärver tävlingens ägare: policyn går via competitions så att en
-- användare aldrig kan nå grenar på någon annans tävling.
create policy "competition_events: via egen tävling"
  on competition_events for all
  using (
    exists (
      select 1 from competitions c
      where c.id = competition_events.competition_id and c.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from competitions c
      where c.id = competition_events.competition_id and c.user_id = auth.uid()
    )
  );

-- --------------------------------------------------------------------------
-- Återkommande veckoupplägg
-- --------------------------------------------------------------------------
-- Kärnan i "slippa fylla i samma sak varje vecka": en mall beskriver en
-- typisk vecka i ett block och kan rullas ut över ett datumintervall.
create table week_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  name text not null,                        -- "Grundvecka med dubbeltröskel"
  block_type text,                           -- vilken blocktyp mallen hör hemma i
  notes text,
  created_at timestamptz not null default now()
);

alter table week_templates enable row level security;
create policy "week_templates: full åtkomst till egna rader"
  on week_templates for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);

create table week_template_items (
  id uuid primary key default gen_random_uuid(),
  template_id uuid not null references week_templates(id) on delete cascade,
  weekday smallint not null check (weekday between 1 and 7),  -- 1 = måndag (ISO)
  -- Två pass samma dag är inte ett undantag utan själva poängen med
  -- dubbeltröskel — därför slot, inte ett pass per dag.
  slot smallint not null default 1 check (slot between 1 and 3),
  workout_type text not null,
  title text,
  description text,
  target_distance_meters integer,
  target_duration_seconds integer,
  unique (template_id, weekday, slot)
);

create index week_template_items_template_idx on week_template_items(template_id);

alter table week_template_items enable row level security;
create policy "week_template_items: via egen mall"
  on week_template_items for all
  using (
    exists (
      select 1 from week_templates t
      where t.id = week_template_items.template_id and t.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from week_templates t
      where t.id = week_template_items.template_id and t.user_id = auth.uid()
    )
  );

-- --------------------------------------------------------------------------
-- planned_workouts: koppling till block och stöd för flera pass per dag
-- --------------------------------------------------------------------------
alter table planned_workouts
  add column block_id uuid references season_blocks(id) on delete set null,
  add column slot smallint not null default 1 check (slot between 1 and 3),
  -- Varifrån passet kom, så en utrullad mall kan rullas tillbaka igen utan
  -- att råka radera pass som lagts in för hand.
  add column template_id uuid references week_templates(id) on delete set null;

create index planned_workouts_user_date_idx on planned_workouts(user_id, scheduled_date);
