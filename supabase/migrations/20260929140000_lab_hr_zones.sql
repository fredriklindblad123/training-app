-- Zontid mot uppmätta zoner, bredvid klockans (2026-09-29, uttrycklig begäran).
--
-- Bakgrund: lib/intensity.ts har sedan starten sagt att Garmins zontider inte
-- går att räkna om, eftersom klockan bara levererar sekunder per zon. Det
-- stämmer för aktivitetslistan, men två andra Garmin-anrop ger det som
-- saknades:
--
--   get_activity_details          pulsen sekund för sekund
--   get_activity_hr_in_timezones  vilka gränser klockan räknade mot
--
-- Verifierat 2026-09-29 på fem av Alices pass: att räkna om klockans egna
-- gränser ur pulskurvan ger samma sekunder per zon som Garmin (inom 1–2 %).
-- Metoden håller, så samma kurva kan räknas mot labbets zoner.
--
-- Klockans gränser för Alice var 103/121/141/165/181 — zon 4 från 165, zon 5
-- från 181. Aktivitus laktattest samma dag gav LT1 183 och LT2 197. Ett
-- distanspass på 177 i snitt låg alltså i klockans zon 4–5 men under LT1.
--
-- Zontiden mot labbzonerna räknas i databasen (compute_lab_zones) och
-- sparas på activities, så den följer med samma select som klockans
-- zontider (lib/sessions.ts SESSION_ACTIVITY_COLUMNS) utan nya läsvägar.

-- ---------------------------------------------------------------------------
-- 1. Uppmätta zonuppsättningar. En rad per test. Undre gräns per zon; zon 1
--    är allt under z2_low.
-- ---------------------------------------------------------------------------
create table hr_zone_sets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  valid_from date not null,
  source text not null check (source in ('test_lactate', 'test_field', 'manuell')),
  label text not null,
  z2_low integer not null,
  z3_low integer not null,
  z4_low integer not null,
  z5_low integer not null,
  max_hr integer,
  created_at timestamptz not null default now(),
  check (z2_low < z3_low and z3_low < z4_low and z4_low < z5_low),
  unique (user_id, valid_from)
);

alter table hr_zone_sets enable row level security;

create policy "hr_zone_sets: egna rader eller coachad löpares"
  on hr_zone_sets for all
  using (
    auth.uid() = user_id
    or exists (select 1 from coach_athletes ca
               where ca.coach_id = auth.uid() and ca.athlete_id = hr_zone_sets.user_id)
  )
  with check (
    auth.uid() = user_id
    or exists (select 1 from coach_athletes ca
               where ca.coach_id = auth.uid() and ca.athlete_id = hr_zone_sets.user_id)
  );

-- ---------------------------------------------------------------------------
-- 2. Pulskurvan per aktivitet. Sekunder från start och puls, som två
--    parallella arrayer (~3000 punkter för en timme). Skrivs bara av synken
--    och backfill-skriptet (service_role) — ingen insert-policy.
-- ---------------------------------------------------------------------------
create table activity_hr_streams (
  activity_id uuid primary key references activities(id) on delete cascade,
  user_id uuid not null references profiles(id) on delete cascade,
  offsets integer[] not null,
  hr smallint[] not null,
  fetched_at timestamptz not null default now(),
  check (cardinality(offsets) = cardinality(hr))
);

create index activity_hr_streams_user_id_idx on activity_hr_streams(user_id);

alter table activity_hr_streams enable row level security;

create policy "activity_hr_streams: läs egna eller coachad löpares"
  on activity_hr_streams for select
  using (
    auth.uid() = user_id
    or exists (select 1 from coach_athletes ca
               where ca.coach_id = auth.uid() and ca.athlete_id = activity_hr_streams.user_id)
  );

-- ---------------------------------------------------------------------------
-- 3. Per aktivitet: klockans gränser, och tid i de uppmätta zonerna.
-- ---------------------------------------------------------------------------
alter table activities
  add column hr_zone_bounds integer[],       -- klockans undre gräns för zon 1–5
  add column lab_zone_1_seconds numeric,
  add column lab_zone_2_seconds numeric,
  add column lab_zone_3_seconds numeric,
  add column lab_zone_4_seconds numeric,
  add column lab_zone_5_seconds numeric,
  add column lab_zone_set_id uuid references hr_zone_sets(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4. Omräkningen.
--
-- Vilken uppsättning ett pass räknas mot: den senaste med valid_from <= passets
-- datum, annars den tidigaste som finns. Pass före första testet räknas alltså
-- mot det testet — det är den bästa skattningen av hennes fysiologi som finns,
-- mycket bättre än klockans gissning. Kommer ett nytt test ändras bara passen
-- från och med det.
--
-- Glapp över 30 s i kurvan räknas inte (klockan pausad, tappad puls), och
-- inte heller punkter utan puls. Samma regler som verifieringen ovan.
--
-- Ett pass som saknar kurva får null i lab-kolumnerna, inte 0 — det är
-- skillnaden mellan "ingen tid i zonen" och "vet inte", och UI:t redovisar
-- täckningen.
--
-- OBS: UPDATE på activities triggar set_activity_category(). Det är ofarligt
-- här — kategorin räknas om med oförändrad funktion på oförändrad data —
-- men se traningsapp-minnet om triggern innan categorize_activity() ändras.
-- ---------------------------------------------------------------------------
create or replace function compute_lab_zones(p_user_id uuid, p_activity_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_count integer;
begin
  with target as (
    select a.id, a.start_time::date as day
    from activities a
    where a.user_id = p_user_id
      and (p_activity_id is null or a.id = p_activity_id)
  ),
  chosen as (
    select t.id,
      coalesce(
        (select z.id from hr_zone_sets z
          where z.user_id = p_user_id and z.valid_from <= t.day
          order by z.valid_from desc limit 1),
        (select z.id from hr_zone_sets z
          where z.user_id = p_user_id
          order by z.valid_from asc limit 1)
      ) as set_id
    from target t
  ),
  samples as (
    select c.id, c.set_id, u.hr,
      u.off - lag(u.off) over (partition by c.id order by u.i) as dt
    from chosen c
    join activity_hr_streams s on s.activity_id = c.id
    cross join lateral unnest(s.offsets, s.hr) with ordinality as u(off, hr, i)
    where c.set_id is not null
  ),
  zoned as (
    select sm.id, sm.set_id, sm.dt,
      case
        when sm.hr >= z.z5_low then 5
        when sm.hr >= z.z4_low then 4
        when sm.hr >= z.z3_low then 3
        when sm.hr >= z.z2_low then 2
        else 1
      end as zone
    from samples sm
    join hr_zone_sets z on z.id = sm.set_id
    where sm.hr > 0 and sm.dt > 0 and sm.dt <= 30
  ),
  totals as (
    select id, set_id,
      sum(dt) filter (where zone = 1) as z1,
      sum(dt) filter (where zone = 2) as z2,
      sum(dt) filter (where zone = 3) as z3,
      sum(dt) filter (where zone = 4) as z4,
      sum(dt) filter (where zone = 5) as z5
    from zoned group by id, set_id
  ),
  -- Alla målaktiviteter, även de utan kurva eller utan uppsättning, så att
  -- gamla värden nollställs till null när underlaget försvinner.
  result as (
    select c.id, t.set_id,
      coalesce(t.z1, case when t.id is not null then 0 end) as z1,
      coalesce(t.z2, case when t.id is not null then 0 end) as z2,
      coalesce(t.z3, case when t.id is not null then 0 end) as z3,
      coalesce(t.z4, case when t.id is not null then 0 end) as z4,
      coalesce(t.z5, case when t.id is not null then 0 end) as z5
    from chosen c left join totals t on t.id = c.id
  )
  update activities a set
    lab_zone_1_seconds = r.z1,
    lab_zone_2_seconds = r.z2,
    lab_zone_3_seconds = r.z3,
    lab_zone_4_seconds = r.z4,
    lab_zone_5_seconds = r.z5,
    lab_zone_set_id = r.set_id
  from result r
  where a.id = r.id
    and (a.lab_zone_set_id is distinct from r.set_id
      or a.lab_zone_1_seconds is distinct from r.z1
      or a.lab_zone_2_seconds is distinct from r.z2
      or a.lab_zone_3_seconds is distinct from r.z3
      or a.lab_zone_4_seconds is distinct from r.z4
      or a.lab_zone_5_seconds is distinct from r.z5);
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function compute_lab_zones(uuid, uuid) from public, anon, authenticated;

-- Ny eller ändrad kurva: räkna om just den aktiviteten.
create or replace function activity_hr_streams_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform compute_lab_zones(new.user_id, new.activity_id);
  return new;
end;
$$;

create trigger activity_hr_streams_recompute
  after insert or update on activity_hr_streams
  for each row execute function activity_hr_streams_recompute();

-- Ny, ändrad eller borttagen zonuppsättning: räkna om hela användaren.
create or replace function hr_zone_sets_recompute()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform compute_lab_zones(coalesce(new.user_id, old.user_id));
  return null;
end;
$$;

create trigger hr_zone_sets_recompute
  after insert or update or delete on hr_zone_sets
  for each row execute function hr_zone_sets_recompute();

-- ---------------------------------------------------------------------------
-- 5. Alices första uppsättning: Aktivitus laktattest 2026-09-29.
--    Z1 <160, Z2 160–183, Z3 183–193, Z4 193–200 (T− + T+), Z5 200–207.
--    Aktivitus Z4− och Z4+ utgör tillsammans zon 4, enligt rapporten.
-- ---------------------------------------------------------------------------
insert into hr_zone_sets (user_id, valid_from, source, label, z2_low, z3_low, z4_low, z5_low, max_hr)
select id, '2026-09-29', 'test_lactate', 'Laktattest Aktivitus', 160, 183, 193, 200, 207
from profiles where id = '7db90b90-adc9-45c6-bc33-6f28b4939c2a';
