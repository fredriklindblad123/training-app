-- Kontoförfrågningar från inloggningssidan.
--
-- Registrering är spärrad av auth-hooken hook_restrict_signup_by_email: bara
-- adresser i allowed_signup_emails släpps igenom. Hittills fylldes den listan
-- bara av en coach som la till en löpare — den som hittade appen själv hade
-- ingen väg in alls, och fick ett obegripligt felmeddelande.
--
-- Den här tabellen är den vägen. En förfrågan skrivs utan inloggning, en coach
-- läser och godkänner, och godkännandet lägger adressen i
-- allowed_signup_emails så att hooken släpper igenom den.
--
-- Målsmans samtycke är ett villkor i INSERT-policyn, inte bara en kryssruta i
-- formuläret: adepterna är 15–18 år, och ett samtycke som går att kringgå
-- genom att posta formuläret direkt är inget samtycke.

create table if not exists public.signup_requests (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  email text not null,
  birth_year integer,
  guardian_name text,
  guardian_email text,
  guardian_consent boolean not null default false,
  note text,
  status text not null default 'vantar',
  handled_at timestamptz,
  handled_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  constraint signup_requests_status_check check (status in ('vantar','godkand','avvisad')),
  constraint signup_requests_email_check check (email ~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'),
  constraint signup_requests_birth_year_check
    check (birth_year is null or (birth_year > 1900 and birth_year < 2100))
);

-- En väntande förfrågan per adress. Skickar någon formuläret två gånger ska
-- det inte bli två rader att hantera; en avvisad adress kan däremot begära på
-- nytt.
create unique index if not exists signup_requests_pending_email_idx
  on public.signup_requests (lower(email)) where status = 'vantar';

alter table public.signup_requests enable row level security;

-- Insert utan inloggning, men bara som väntande och bara med samtycke.
drop policy if exists "signup_requests: vem som helst får begära" on public.signup_requests;
create policy "signup_requests: vem som helst får begära"
  on public.signup_requests for insert to anon, authenticated
  with check (status = 'vantar' and guardian_consent = true);

-- Ingen SELECT för anon: den som skickat en förfrågan ska inte kunna läsa
-- andras.
drop policy if exists "signup_requests: coach läser" on public.signup_requests;
create policy "signup_requests: coach läser"
  on public.signup_requests for select to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'coach'));

drop policy if exists "signup_requests: coach hanterar" on public.signup_requests;
create policy "signup_requests: coach hanterar"
  on public.signup_requests for update to authenticated
  using (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'coach'))
  with check (exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'coach'));

comment on table public.signup_requests is
  'Kontoförfrågningar från inloggningssidan. Godkännande lägger e-posten i allowed_signup_emails, som auth-hooken hook_restrict_signup_by_email släpper igenom.';
