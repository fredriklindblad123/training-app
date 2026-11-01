-- Klocknycklar för IFK-urtavlan (watchface/, 2026-11-01).
--
-- Urtavlan på adeptens Garmin hämtar dagens pass från /api/watch/today med en
-- personlig nyckel. Klockan har ingen inloggning, så nyckeln ÄR behörigheten —
-- därför sparas bara en SHA-256-hash av den, aldrig nyckeln själv. Den visas
-- en gång när den skapas och byggs sedan in i urtavlans fil (watchface/build.sh).
--
-- Nyckeln ger bara läsning av en enda sak: dagens planerade pass för en
-- användare. Läsningen görs i Python-API:t med service_role; RLS nedan gäller
-- appens egna sidor, där löparen själv eller hennes tränare skapar och
-- återkallar nyckeln.

create table watch_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  token_hash text not null unique,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id),
  last_used_at timestamptz
);

create index watch_tokens_user_idx on watch_tokens(user_id);

alter table watch_tokens enable row level security;

create policy "watch_tokens: egna rader eller coachad löpares"
  on watch_tokens for all
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = watch_tokens.user_id
    )
  )
  with check (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = watch_tokens.user_id
    )
  );
