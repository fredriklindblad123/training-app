-- Bugfix: "infinite recursion detected in policy for relation
-- season_blocks" — upptäckt när ett block inte gick att skapa alls från
-- appen (Daniel-testet: samma fel både vid create och update).
--
-- Orsak: season_blocks SELECT-policy (migration 20260816100000) kollar
-- season_block_athletes ("är jag en mållöpare för blocket?"), och
-- season_block_athletes SELECT-policy kollar season_blocks ("äger/coachar
-- jag blockets ägare?"). Två tabeller vars policyer pekar på varandra i en
-- cirkel. Ett vanligt SELECT mot bara en av dem märks aldrig av — men
-- Postgres RETURNING (INSERT/UPDATE ... RETURNING, exakt vad
-- createBlock/updateBlock gör via `.insert(...).select(...)`) utvärderar
-- SELECT-policyn på den skrivna raden, vilket startar cirkeln: season_blocks
-- → season_block_athletes → season_blocks → ... tills Postgres ger upp.
--
-- Fix: en security definer-funktion slår upp season_block_athletes-
-- medlemskap UTAN att gå via dess RLS-policy — season_blocks policy anropar
-- funktionen i stället för att fråga tabellen direkt, vilket bryter cirkeln
-- (season_block_athletes kan fortfarande fråga season_blocks rakt av; det är
-- bara den andra riktningen som behövde brytas för att cirkeln ska
-- försvinna).

create or replace function public.is_targeted_athlete(p_block_id uuid, p_athlete_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from season_block_athletes sba
    where sba.block_id = p_block_id and sba.athlete_id = p_athlete_id
  );
$$;

revoke all on function public.is_targeted_athlete(uuid, uuid) from public;
grant execute on function public.is_targeted_athlete(uuid, uuid) to authenticated;

drop policy "season_blocks: läs egna, coachad löpares, eller där man är löpare" on season_blocks;

create policy "season_blocks: läs egna, coachad löpares, eller där man är löpare"
  on season_blocks for select
  using (
    auth.uid() = user_id
    or exists (
      select 1 from coach_athletes ca
      where ca.coach_id = auth.uid() and ca.athlete_id = season_blocks.user_id
    )
    or public.is_targeted_athlete(season_blocks.id, auth.uid())
  );
