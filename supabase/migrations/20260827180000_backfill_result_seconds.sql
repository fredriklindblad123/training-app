-- Backfill av competition_events.result_seconds för rader som fick ett
-- resultat inlagt i appen i stället för via scripts/import_results.py.
--
-- Bakgrund: saveEventResult (tavlingsresultat/actions.ts) skrev actual_result
-- och placement men aldrig result_seconds, medan progressionsgrafen filtrerar
-- på just result_seconds. Följden var att ett inlagt resultat syntes i listan
-- men aldrig i kurvan. Skrivvägen är lagad i samma ändring
-- (lib/race-results.ts); den här migrationen tar de rader som redan hunnit bli
-- fel.
--
-- Avgränsningen är formatet, inte en lista över löpgrenar: mätt 2026-08-27
-- innehåller alla 147 rader med result_seconds ett kolon, och noll saknar det,
-- medan varje fältresultat (Höjd 1.12, Längd 4.27, Kula 6.13, Spjut 16.3,
-- Stav 1.89) saknar kolon. `like '%:%'` skiljer alltså tid från meter utan att
-- gissa, och lämnar DNF/DNS och tomma fält orörda.
--
-- Samma tolkning som lib/race-results.ts gör för de två kolonformerna. Rena
-- sekunder utan kolon ("8.12" på 60m) hanteras inte här: den formen finns inte
-- i materialet, och att tolka den kräver grennamnet som kontext — det gör
-- TS-parsern i skrivvägen i stället.
-- --------------------------------------------------------------------------
-- Steg 1: slå ihop grennamn som delats av en tusenavgränsare.
--
-- "4.000m" och "4000m" är samma gren, men lagras som två och ritas som två
-- kurvor i progressionsgrafen. scripts/import_results.py har en EVENT_ALIASES
-- för precis det här ("4.000m" -> "4000m"), men två rader slank igenom.
--
-- Måste ske FÖRE backfillen nedan: annars får de två raderna sina sekunder,
-- dyker upp som en egen chip "4.000m (2)" bredvid "4000m (2)", och fixen hade
-- infört en synlig dubblett samtidigt som den löste något annat.
--
-- Mönstret är siffror + punkt + exakt tre siffror + m, dvs. en
-- tusenavgränsare. Ingen verklig gren skrivs med decimalpunkt i meter, så
-- regeln kan inte träffa fel.
update competition_events
set event = replace(event, '.', '')
where event ~ '^\d+\.\d{3}m$';

-- --------------------------------------------------------------------------
-- Steg 2: sekunderna.
update competition_events
set result_seconds =
  case
    -- H:MM:SS
    when actual_result ~ '^\d+:\d{1,2}:\d{1,2}([.,]\d+)?$' then
      split_part(actual_result, ':', 1)::numeric * 3600
      + split_part(actual_result, ':', 2)::numeric * 60
      + replace(split_part(actual_result, ':', 3), ',', '.')::numeric
    -- M:SS(.hh)
    when actual_result ~ '^\d+:\d{1,2}([.,]\d+)?$' then
      split_part(actual_result, ':', 1)::numeric * 60
      + replace(split_part(actual_result, ':', 2), ',', '.')::numeric
  end
where result_seconds is null
  and actual_result is not null
  and actual_result like '%:%';
