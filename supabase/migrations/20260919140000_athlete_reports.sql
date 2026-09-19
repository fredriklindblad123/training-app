-- Djupanalyser per löpare.
--
-- Vissa frågor går inte att svara på med ett diagram: vad dagboksorden
-- korrelerar med, var en säsong tog fel väg, vilka pass som faktiskt bär
-- formen. De analyserna görs utanför appen och publiceras som en rapport.
-- Tabellen fäster dem vid rätt löpare så att Form-vyn kan länka dit, i
-- stället för att rapporten lever i en chatt ingen hittar tillbaka till.
--
-- Bara URL och rubrik lagras. Innehållet ligger kvar där det publicerats —
-- att kopiera in det i databasen hade skapat två versioner som glider isär.

create table if not exists public.athlete_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles(id) on delete cascade,
  title text not null,
  url text not null,
  summary text,
  published_on date not null default current_date,
  created_at timestamptz not null default now()
);

create index if not exists athlete_reports_user_published_idx
  on public.athlete_reports (user_id, published_on desc);

alter table public.athlete_reports enable row level security;

-- Löparen läser sina egna rapporter; coachen läser och skriver sina
-- länkade löpares. Samma mönster som profiles.
drop policy if exists "athlete_reports: läs egen" on public.athlete_reports;
create policy "athlete_reports: läs egen"
  on public.athlete_reports for select
  using (auth.uid() = user_id);

drop policy if exists "athlete_reports: coach läser länkad löpares" on public.athlete_reports;
create policy "athlete_reports: coach läser länkad löpares"
  on public.athlete_reports for select
  using (exists (
    select 1 from public.coach_athletes ca
    where ca.coach_id = auth.uid() and ca.athlete_id = athlete_reports.user_id
  ));

drop policy if exists "athlete_reports: coach skriver länkad löpares" on public.athlete_reports;
create policy "athlete_reports: coach skriver länkad löpares"
  on public.athlete_reports for all
  using (exists (
    select 1 from public.coach_athletes ca
    where ca.coach_id = auth.uid() and ca.athlete_id = athlete_reports.user_id
  ))
  with check (exists (
    select 1 from public.coach_athletes ca
    where ca.coach_id = auth.uid() and ca.athlete_id = athlete_reports.user_id
  ));

comment on table public.athlete_reports is
  'Djupanalyser per löpare, publicerade utanför appen och länkade från Form-vyn.';
