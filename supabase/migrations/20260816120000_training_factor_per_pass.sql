-- Rättning av ett designfel (uttryckligen påpekat): träningsfaktorerna
-- (Snabbhet/Uthållighet/Styrka/Rörlighet, ur Årsplan-fliken) fångades som
-- EN aggregerad "standardvecka" per block — men planeringen sker per PASS,
-- inte som en klumpsumma för hela blocket. Ett pass är antingen ett
-- tröskelpass, ett maximal snabbhetspass, ett uthållighetspass osv, och det
-- är den taggningen — inte ett fritextfält på blocket — som ska styra vad
-- Årsplan-exporten visar för varje vecka.
--
-- Flyttar därför faktorn till pass-nivå: week_template_items (mallradens
-- standardtaggning, ärvs av varje utrullat pass) och planned_workouts
-- (så ett enskilt tillagt eller senare omtaggat pass också bär sin egen
-- faktor, oavsett om det kom från en mall). Bekräftat tomt på season_blocks
-- (alla rader hade training_factors='{}') — ingen data att migrera.
--
-- Nullable text, ingen check-constraint — samma mönster som workout_type
-- redan använder på planned_workouts, validerat i appen (TRAINING_FACTORS i
-- lib/training-factors.ts), inte i databasen.

alter table season_blocks drop column training_factors;

alter table week_template_items add column training_factor text;
alter table planned_workouts add column training_factor text;
