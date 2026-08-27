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

**Vad som triggar en synk (uppdaterat 2026-08-27):**

| Trigger | Vilka som synkas | Strypning |
|---|---|---|
| Cron, 05:00 UTC (`vercel.json`) | alla med `status = 'connected'` | ingen |
| Inloggning (`app/login/actions.ts`) | den inloggade; en **tränare** även alla länkade adepter | 15 min |
| "Till appen" på startsidan (`app/actions.ts`) | samma som ovan | 15 min |
| "Synka nu" på `/settings` | bara den inloggade | **ingen** — uttrycklig begäran ska alltid ge färsk data |

Vem som ska synkas avgörs av `resolveSyncTargets` i `lib/garmin-sync.ts`, som
läser `coach_athletes` genom den inloggades **egen** klient (inte
`service_role`). RLS avgör därmed vilka länkar som syns, så listan kan aldrig
innehålla en löpare anroparen inte faktiskt coachar — viktigt, eftersom id:na
sedan skickas till en endpoint som med `INTERNAL_API_SECRET` får synka vilken
användare som helst.

Strypningen (`AUTO_SYNC_MIN_INTERVAL_MINUTES = 15` i `web/api/index.py`) är
inte en optimering utan ett skydd: utan den drar en tränare med fyra adepter
igång fem Garmin-sessioner vid varje inloggning, vilket är precis det mönster
som blockeras enligt risken nedan. Beslutet fattas i Python, som äger
`last_synced_at`; Next skickar bara med önskat intervall.

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

**Sömn & återhämtning (2026-07-25):** synken hämtar även daglig sömndata,
vilopuls och HRV till `daily_metrics` (se data-model.md), så sömn inte behöver
skrivas in för hand i dagboken. Viktig skillnad mot aktiviteter: Garmins
`get_sleep_data` tar **en dag per API-anrop** (aktiviteter kommer i ett svep),
så ett års backfill skulle bli 365 anrop — flera minuter och en nästan säker
rate-limiting-träff. Sömnfönstret hålls därför kort och separat:
`SLEEP_SYNC_DAYS = 7` vid vanlig synk, `FIRST_SLEEP_SYNC_DAYS = 30` vid
första. Fel på enskilda dagar hoppas över tyst — sömn är sekundärt mot
aktiviteterna och ska inte kunna få hela synken att fallera.

Datamappningen är verifierad mot ett riktigt API-svar (`dailySleepDTO`), inte
gissad: `sleepTimeSeconds`, `deep/light/rem/awakeSleepSeconds`,
`sleepScores.overall.value`, samt `restingHeartRate` och `avgOvernightHrv` på
toppnivå i svaret.

## Att göra

- [x] Utreda Garmin Connect Developer Program-krav
- [x] Multi-user Garmin-synk (inofficiellt bibliotek, se ovan) — klart 2026-07-25
- [ ] Sätta upp Strava API-integration (OAuth + aktivitetshämtning) — reservplan om/när garth-baserad inloggning slutar fungera pålitligt
- [ ] Ha FIT-filimport som backup-plan i UI:t
