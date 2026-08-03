-- Tillgänglighetsperioder: skola/prov, läger, resor, ledighet (K7).
--
-- Varför den här tabellen finns: Alice är 17. Tentaveckor, lov, läger och
-- resor styr träningen minst lika mycket som periodiseringen, men syns
-- ingenstans i appen idag — en tentavecka med låg volym ser ut som antingen
-- en medveten nedtrappning eller ingenting alls. P1.5 i insikter-roadmapen
-- noterar redan att hög CV inom ett block "ofta är tecken på sjukdom, skola
-- eller överambition": skolan är alltså en känd förklaringsvariabel utan att
-- vara data. Den här tabellen gör den till data.
--
-- Vad tabellen medvetet INTE är: den är inte ett schemaläggningsverktyg och
-- innehåller ingen logik alls. Inga justerade riktvärden för volym under en
-- tentavecka, ingen automatisk nedtrappning, ingen påverkan på KPI-ringar
-- eller efterlevnadsberäkningen (K2) — bara ett datumintervall och en
-- etikett, till för att göra en avvikelse förklarlig i efterhand i stället
-- för mystisk. Växer den till mer än så används den inte, precis som
-- planned_workouts inte gjorde med två rader innan K1/K2.
create table availability_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  kind text not null check (kind in ('skola', 'lager', 'resa', 'ledighet', 'annat')),
  label text,
  note text,
  created_at timestamptz not null default now(),
  constraint availability_dates_ok check (end_date >= start_date)
);

create index availability_periods_user_start_idx on availability_periods(user_id, start_date);

alter table availability_periods enable row level security;
create policy "availability_periods: full åtkomst till egna rader"
  on availability_periods for all
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
