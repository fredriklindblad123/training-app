-- Multi-user Garmin-koppling: varje användare ansluter sitt eget Garmin-konto
-- via en inloggningsflöde i appen (POST /api/garmin/login, en Python
-- serverless-funktion). Lösenordet sparas aldrig — bara den token
-- (garth Client.dumps()) som Garmin-inloggningen ger tillbaka, så framtida
-- synk (manuell "Synka nu"-knapp eller schemalagd cron) kan återanvända den
-- utan att fråga efter lösenordet igen.

create table garmin_connections (
  user_id uuid primary key references profiles(id) on delete cascade,
  status text not null default 'connected' check (status in ('connected', 'needs_reauth', 'error')),
  last_synced_at timestamptz,
  last_error text,
  connected_at timestamptz not null default now()
);

-- Ingen policy alls för insert/update/delete: bara service_role (som
-- kringgår RLS) skriver hit, från Python-funktionerna. Användaren får bara
-- läsa sin egen status/senast-synkad, aldrig token:en.
alter table garmin_connections enable row level security;

create policy "garmin_connections: läs egen status"
  on garmin_connections for select
  using (auth.uid() = user_id);

create table garmin_tokens (
  user_id uuid primary key references profiles(id) on delete cascade,
  token text not null,
  updated_at timestamptz not null default now()
);

-- Helt utan policies: varken läsbar eller skrivbar för anon/authenticated,
-- bara för service_role. Token:en ska aldrig nå klienten.
alter table garmin_tokens enable row level security;
