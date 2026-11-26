-- Vilka löpare ett pass i blockets veckomönster gäller för (2026-11-26).
--
-- null = alla löpare på blocket (season_block_athletes), som hittills.
-- En lista = bara de löparna. Utrullningen (lib/template-sync.ts) och
-- tränarens val per pass på /blockplan läser och skriver kolumnen.
--
-- En lista i stället för en kopplingstabell: den läses alltid tillsammans
-- med passet, och null bär "alla — även löpare som läggs till blocket
-- senare", vilket en kopplingstabell hade behövt en egen regel för.

alter table week_template_items
  add column if not exists athlete_ids uuid[];
