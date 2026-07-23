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

## Att göra

- [x] Utreda Garmin Connect Developer Program-krav
- [ ] Sätta upp Strava API-integration (OAuth + aktivitetshämtning)
- [ ] Ha FIT-filimport som backup-plan i UI:t
