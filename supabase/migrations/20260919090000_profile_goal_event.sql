-- Måltid på en medeldistansgren, per löpare.
--
-- Fartbanden i Form-vyns växeldiagram härleddes tidigare ur löparens bästa
-- resultat de senaste två åren. Det fungerar bara för den som redan tävlat,
-- och det säger dessutom fel sak: träningsfarter ska utgå från vad man siktar
-- mot, inte från vad man redan sprungit. En adept utan resultat fick ingen
-- fartvy alls.
--
-- Målet ligger på profilen och inte på en tävling: det är en säsongsavsikt
-- som styr träningsfarter under hela perioden, inte en anmälan till ett
-- enskilt lopp. Kopplingen till en A-tävling görs i stället i planen.
--
-- `goal_event` begränsas till bangrenar på medeldistans. Häck- och
-- hindergrenar är medvetet uteslutna: farten där är inte jämförbar med
-- intervallöpning på bana, och att härleda träningsfarter ur ett hinderlopp
-- hade gett fel band.

alter table public.profiles
  add column if not exists goal_event text,
  add column if not exists goal_seconds numeric;

alter table public.profiles
  drop constraint if exists profiles_goal_event_check;

alter table public.profiles
  add constraint profiles_goal_event_check
  check (goal_event is null or goal_event in ('800m', '1000m', '1500m', '3000m', '5000m'));

alter table public.profiles
  drop constraint if exists profiles_goal_seconds_check;

-- Golvet stoppar uppenbara inmatningsfel (sekunder förväxlade med minuter).
alter table public.profiles
  add constraint profiles_goal_seconds_check
  check (goal_seconds is null or (goal_seconds > 60 and goal_seconds < 3600));

-- Båda eller ingen: ett mål utan gren går inte att räkna på, och en gren
-- utan tid säger ingenting.
alter table public.profiles
  drop constraint if exists profiles_goal_pair_check;

alter table public.profiles
  add constraint profiles_goal_pair_check
  check ((goal_event is null) = (goal_seconds is null));

comment on column public.profiles.goal_event is
  'Målgren på medeldistans (800m–5000m). Styr fartbanden i Form-vyn.';
comment on column public.profiles.goal_seconds is
  'Måltid i sekunder för goal_event. Räknas om till 1500-ekvivalent innan fartbanden härleds.';
