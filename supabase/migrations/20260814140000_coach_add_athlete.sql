-- Fas 0 steg 7: en coach lägger till en löpare från /settings, i stället för
-- att göra det manuellt mot databasen (som Alice-kopplingen gjordes med i
-- den här sessionen). Två delar:
--
-- 1. allowed_signup_emails (docs/auth.md) spärrar idag signup till en
--    hårdkodad allowlist som bara service_role kunde skriva till — en coach
--    måste kunna bjuda in en ny löpares e-post själv.
-- 2. Att LÄNKA en redan existerande löpare (som Alice, som redan har ett
--    konto) kräver att slå upp e-post -> auth.users.id. Vanliga klienter kan
--    inte läsa auth.users alls (inte ens sin egen rad, PostgREST exponerar
--    inte det schemat) — därför en `security definer`-funktion: kör med
--    förhöjd rättighet för just den uppslagningen, men bara för en coach
--    (kontrolleras inne i funktionen) och returnerar bara ett id, aldrig
--    något annat ur auth.users.

-- --------------------------------------------------------------------------
-- allowed_signup_emails: en coach får bjuda in (bara lägga till, aldrig
-- läsa/ändra/ta bort någon annans rader — se docs/auth.md, ägaren
-- fredrik_lindblad@hotmail.com hanterar spärren i övrigt via dashboarden).
-- --------------------------------------------------------------------------
create policy "allowed_signup_emails: coach bjuder in löpare"
  on allowed_signup_emails for insert
  with check (
    exists (select 1 from profiles where id = auth.uid() and role = 'coach')
  );

-- --------------------------------------------------------------------------
-- find_user_id_by_email: slår upp ett existerande konto på e-post, bara för
-- en coach, bara ett id ut. `security definer` + låst search_path
-- (annars kan en anropare skriva om vilken `profiles`-tabell funktionen ser).
-- --------------------------------------------------------------------------
create or replace function public.find_user_id_by_email(lookup_email text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  result uuid;
begin
  if not exists (select 1 from profiles where id = auth.uid() and role = 'coach') then
    raise exception 'Bara en coach kan slå upp löpare på e-post';
  end if;

  select id into result from auth.users where lower(email) = lower(lookup_email) limit 1;
  return result;
end;
$$;

revoke all on function public.find_user_id_by_email(text) from public;
grant execute on function public.find_user_id_by_email(text) to authenticated;
