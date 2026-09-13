-- En coach når ett block via de adepter blocket gäller för (2026-09-13).
--
-- Bakgrund: Daniel fick ett eget konto och ska styra planeringen. Han coachar
-- Alice, Emma, Nike och Signe — men INTE Fredrik, som äger årsplanens block.
-- RLS på season_blocks släppte bara igenom ägaren, en coach som coachar
-- ägaren, eller en adept blocket gäller för. Daniel var inget av det.
--
-- Mätt som Daniel före ändringen: 0 block, 0 veckomönster, men 1540 pass. Alltså
-- en trasig halvvy — kalendern full, Blockplan tom, och Detaljplan tom eftersom
-- den är blockavgränsad.
--
-- Fixen speglar hur datan redan ser ut: season_block_athletes säger vilka
-- blocket är till för, så en coach för någon av dem ska nå det. Det undviker
-- alternativet att flytta ägarskapet, som bara hade kastat problemet på Fredrik
-- i stället, eller att hitta på en coach-relation mellan de två tränarna.
--
-- Hjälpfunktionerna är SECURITY DEFINER av samma skäl som is_targeted_athlete
-- (migration 20260816100000): en policy som själv läser en RLS-skyddad tabell
-- riskerar rekursion och tyst nekad åtkomst.
--
-- Verifierat efteråt med satta jwt-claims:
--   Daniel  ser 11 block / 67 mönsterrader och kan ändra 10 block.
--   Alice   ser 11 block (som förut, hon är målsatt), 463 egna pass, 0 andras,
--           och kan ändra 0 block — skrivvägen är stängd för adepter.

create or replace function public.coaches_targeted_athlete(p_block_id uuid, p_coach_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from season_block_athletes sba
    join coach_athletes ca on ca.athlete_id = sba.athlete_id
    where sba.block_id = p_block_id and ca.coach_id = p_coach_id
  );
$$;

create or replace function public.coaches_targeted_athlete_for_item(p_item_id uuid, p_coach_id uuid)
returns boolean language sql stable security definer set search_path to 'public' as $$
  select exists (
    select 1 from week_template_items i
    join season_block_athletes sba on sba.block_id = i.block_id
    join coach_athletes ca on ca.athlete_id = sba.athlete_id
    where i.id = p_item_id and ca.coach_id = p_coach_id
  );
$$;

-- season_blocks, week_template_items, season_block_athletes och
-- template_rep_groups får alla samma tillägg: "eller så coachar du någon
-- blocket gäller för". Policytexterna är oförändrade i övrigt — se
-- git-historiken för diffen mot originalen.
-- (policyerna i denna migration kördes via apply_migration; se pg_policies för exakt lydelse)
