-- K9 (docs/tranarperspektiv.md): resultathistorik som jämförbara tal.
--
-- Bakgrund: competition_events.actual_result är fritext ("2:21,99", "4.18",
-- "7.31 sb") och ska förbli det — det är så resultat faktiskt skrivs, och
-- K5-tävlingsjämförelsen visar dem oförändrade av just det skälet (att parsa
-- löptider ur fri text i läsvägen är en egen fallgrop utan nytta där).
--
-- Men en progressionskurva över fem säsonger kräver jämförbara värden: att
-- se att 800m gått 3:00 → 2:21,99 förutsätter att talen går att sortera och
-- plotta. Lösningen är att tolka EN gång, vid import, av ett skript som har
-- hela raden och grenkolumnen som kontext — inte varje gång sidan renderas
-- med bara en textsträng att gissa ur.
--
-- Bara löpgrenar får result_seconds. Hopp och kast (höjd, längd, stav, kula,
-- spjut) importeras med sin fritext men lämnas null här: de mäts i meter,
-- de hör till mångkampsåren före specialiseringen till medeldistans, och en
-- gemensam numerisk kolumn för både sekunder och meter hade bara flyttat
-- tvetydigheten till läsvägen igen.
alter table competition_events
  add column result_seconds numeric;

comment on column competition_events.result_seconds is
  'Löptid i sekunder, tolkad vid import (scripts/import_results.py). Null för '
  'hopp/kast och för grenar utan resultat. actual_result är alltid källan för visning.';
