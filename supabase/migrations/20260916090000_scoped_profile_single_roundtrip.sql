-- Hela ScopedProfile i EN nätverksrunda i stället för tre.
--
-- getScopedProfile gjorde fyra sekventiella rundor mot Supabase innan sidan
-- ens fick börja hämta sin egen data: auth.getUser, profiles (roll),
-- coach_athletes (länkar) och profiles igen (adepternas namn). Uppmätt kostar
-- en runda omkring 200 ms, och funktionen anropas på varje sidvisning från
-- både layouten och sidan.
--
-- SECURITY DEFINER därför att en coach måste kunna läsa sina adepters namn ur
-- profiles, vilket RLS annars hindrar. Funktionen tar INGA argument och läser
-- alltid auth.uid() — det finns alltså inget id att byta ut för att få se
-- någon annans data. search_path är låst, som för appens övriga
-- definer-funktioner.
create or replace function public.scoped_profile()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with me as (select auth.uid() as id),
  r as (
    select coalesce(
      (select p.role from profiles p, me where p.id = me.id),
      'athlete'
    ) as role
  )
  select jsonb_build_object(
    'role', (select role from r),
    -- Bara relevant för en löpare. Produkten har hittills bara ett
    -- coach-till-löpare-förhållande; första länken vinner, som i TS-koden.
    'coach_id', case
      when (select role from r) = 'coach' then null
      else (
        select ca.coach_id from coach_athletes ca, me
        where ca.athlete_id = me.id limit 1
      )
    end,
    'linked_athletes', case
      when (select role from r) = 'coach' then coalesce((
        select jsonb_agg(
                 jsonb_build_object('id', p2.id, 'full_name', p2.full_name)
                 order by p2.full_name
               )
        from coach_athletes ca2
        join profiles p2 on p2.id = ca2.athlete_id, me
        where ca2.coach_id = me.id
      ), '[]'::jsonb)
      else '[]'::jsonb
    end
  );
$$;

revoke all on function public.scoped_profile() from public;
grant execute on function public.scoped_profile() to authenticated;
