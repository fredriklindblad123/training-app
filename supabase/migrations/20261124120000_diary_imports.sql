-- Dagboken skickas in från appen (2026-11-24).
--
-- Löparen laddar upp sin PDF (FIG:s mall). Appen tolkar den, visar vad som
-- blir nytt och vad som skiljer sig från det som redan finns, och skriver
-- först när hon bekräftar. Det här är loggen över varje inskick och
-- lagringen av själva filen.
--
-- `previous` sparar raderna som de såg ut innan inskicket skrev över dem
-- ({entry_date: {fält: värde}}). Utan den går ett inskick av fel fil inte att
-- ångra — inskicken kan överlappa och det som skrivs över är ofta tillrättad
-- text.

create table diary_imports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  uploaded_by uuid not null references profiles(id),
  file_name text,
  file_path text,
  first_date date,
  last_date date,
  inserted integer not null default 0,
  filled integer not null default 0,
  replaced integer not null default 0,
  kept integer not null default 0,
  previous jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index diary_imports_user_id_created_at_idx on diary_imports(user_id, created_at desc);

alter table diary_imports enable row level security;

create policy "diary_imports: egna eller coachad löpares"
  on diary_imports for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = diary_imports.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = diary_imports.user_id
    )
  );

-- Filerna: privat bucket, sökväg <löparens user_id>/<tidsstämpel>.pdf.
insert into storage.buckets (id, name, public)
values ('diary-pdfs', 'diary-pdfs', false)
on conflict (id) do nothing;

create policy "diary-pdfs: egna eller coachad löpares"
  on storage.objects for all
  using (
    bucket_id = 'diary-pdfs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from coach_athletes ca
        where ca.coach_id = auth.uid() and ca.athlete_id::text = (storage.foldername(name))[1]
      )
    )
  )
  with check (
    bucket_id = 'diary-pdfs'
    and (
      (storage.foldername(name))[1] = auth.uid()::text
      or exists (
        select 1 from coach_athletes ca
        where ca.coach_id = auth.uid() and ca.athlete_id::text = (storage.foldername(name))[1]
      )
    )
  );
