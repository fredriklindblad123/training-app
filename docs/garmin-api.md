# Garmin Connect API – utredning (2026-07-23)

## Slutsats

Garmin Connect Developer Program (Training API, Activity API m.fl.) är **endast
för företag/juridiska personer** — bekräftat direkt från developer.garmin.com/gc-developer-program/program-faq/.
Privatpersoner/hobbyprojekt kan inte ansöka som de är. Enligt några tredjepartskällor
(ej bekräftat av Garmin själva) ska programmet dessutom vara pausat för nya
ansökningar för närvarande — osäkert, kräver att man faktiskt testar ansöka för
att verifiera.

Detaljer:
- Ingen licensavgift för grundåtkomst, vissa metrics kan kräva avgift/min. orderkvantitet
- Handläggning: ~2 arbetsdagar för godkännandebesked, integration tar sedan 1–4 veckor
- Kräver ansökan som legal entity (företag, universitet, etc.)

## Beslut: bygg mot Strava API istället

Strava har betydligt enklare åtkomst för individuella utvecklare (gratis, inget
företagskrav). De flesta Garmin-användare synkar redan sina pass till Strava
automatiskt, så det ger i praktiken samma data.

## Alternativ, om Strava inte räcker

1. **Strava API** (rekommenderas) — enkel individuell utvecklaråtkomst, gratis
2. **Manuell export/import av FIT-filer** från Garmin Connect — fungerar alltid,
   men kräver manuellt steg av användaren
3. **Inofficiella bibliotek** (t.ex. `python-garminconnect`) som loggar in med
   Garmin-kontouppgifter — fungerar ofta för personligt bruk, men bryter mot
   Garmins användarvillkor och kan sluta fungera utan förvarning

## Uppdatering 2026-07-25: multi-user-synk trots allt på det inofficiella biblioteket

Strava-planen ovan blev aldrig implementerad — `scripts/sync_garmin.py` byggdes
istället mot `python-garminconnect`/`garth` (alternativ 3), och användes
manuellt lokalt av en användare. Det är nu ombyggt till multi-user och
automatiskt:

- **`web/api/index.py`** — en FastAPI-baserad Vercel Python-funktion med två
  endpoints: `/api/garmin/login` (ansluter ett Garmin-konto till en
  app-användare, sparar bara en session-token, aldrig lösenordet) och
  `/api/garmin/sync` (synkar en specifik användare on-demand, eller alla
  anslutna användare via `vercel.json`s dagliga cron).
- **`garmin_connections` + `garmin_tokens`** (se data-model.md) — status per
  användare respektive den sparade token:en.
- UI: `/settings`-sidan i webappen (anslut-formulär + "Synka nu"-knapp).

**Känd risk, upptäckt vid research 2026-07-25:** `garth` (som både
`python-garminconnect` och de flesta JS-motsvarigheter bygger på) blev
formellt **övergivet av sin maintainer under 2026**, efter att Garmin ändrade
sitt SSO-inloggningsflöde i feb–apr 2026 och orsakade utbredda 429/Cloudflare-
blockeringar för den här typen av inofficiell inloggning
(`cyberjunky/python-garminconnect` #337, #344, #348, #350). Automatiserad,
schemalagd inloggning från en molnserver (vårt cron-jobb) är precis det
mönster som är mest utsatt för sådan blockering — mer än enstaka manuella
körningar. `/api/garmin/sync` sätter därför `garmin_connections.status =
'needs_reauth'` när en synk misslyckas med ett auth-fel, så det syns i UI:t
istället för att tyst sluta fungera. Om detta blir ett återkommande problem är
Strava OAuth (alternativ 1 nedan) fortfarande den robusta långsiktiga lösningen.

**Sportfilter (2026-07-25):** Garmin synkar ibland in aktiviteter som inte är
relevanta för träningsappen (t.ex. en GPS-loggad båttur, vilket blåste upp
distansstatistiken felaktigt). `_is_allowed_activity` i `web/api/index.py`
(speglad i `scripts/sync_garmin.py`) filtrerar nu bort allt utom löpning,
styrka, cykel, simning och längdskidåkning (uttryckligen *inte*
utförsskidåkning) innan raden ens sparas i `activities`.

## Att göra

- [x] Utreda Garmin Connect Developer Program-krav
- [x] Multi-user Garmin-synk (inofficiellt bibliotek, se ovan) — klart 2026-07-25
- [ ] Sätta upp Strava API-integration (OAuth + aktivitetshämtning) — reservplan om/när garth-baserad inloggning slutar fungera pålitligt
- [ ] Ha FIT-filimport som backup-plan i UI:t
