---
name: ux-genomgang
description: Kör en genomgång av Träningsnavets gränssnitt med ux-agenten — antingen konsekvens (formspråk, färger, terminologi) eller användbarhet (informationsordning, logik, ton). Resultatet skrivs till docs/ux-genomgang.md.
argument-hint: "[konsekvens|anvandbarhet]"
---

# UX-genomgång

Två körningar, i ordning. Konsekvens är mekaniskt och har tydliga kriterier;
användbarhet är omdöme. Blandar man dem i en körning vinner alltid det
mekaniska, och resultatet blir ytligt över arton vyer.

## Innan du startar agenten

1. **Avgör vilken körning.** Argumentet styr. Utan argument: finns
   `docs/ux-genomgang.md` med en konsekvensdel redan, kör användbarhet —
   annars konsekvens.

2. **Starta dev-servern om den inte kör.** Kontrollera först:
   `curl -sS -o /dev/null -w '%{http_code}' http://localhost:3000/login`
   Svarar den inte, starta `npm run dev` i `web/` i bakgrunden och vänta
   tills den svarar.

3. **Skaffa inloggning.** Allt under `/(app)` kräver konto — utan det når
   agenten bara inloggningssidan och bedömer koden i stället, vilket är
   precis vad genomgången ska undvika. Läs `UX_TEST_EMAIL` och
   `UX_TEST_PASSWORD` ur miljön om de finns; annars fråga användaren.
   Skriv aldrig in lösenordet i en fil.

Starta sedan `ux`-agenten med prompten nedan, i förgrunden, så du kan
sammanfatta resultatet när den är klar.

## Körning 1 — konsekvens

> Gå igenom hela Träningsnavet renderat och inventera formspråket. Logga in
> på http://localhost:3000 med de uppgifter du fått.
>
> Alla vyer: dashboard, trender, uppfoljning, calendar (år, månad, vecka,
> dag, block), detaljplan, arsplan, flerarsplan, sasongsoversikt, blockplan,
> tavlingar, tavlingsresultat, settings, login.
>
> Notera per vy: färganvändning mot de fyra systemen i `globals.css`
> (`--cat-*`, `--day-*`, `--status-*`, `--ink-note`), rubriknivåer och
> typografisk skala, kortform och ramar, knappstilar mot
> `components/ui/controls`, tomma tillstånd, och terminologi — heter samma
> sak samma sak överallt?
>
> Kontrollera varje vy i **390 px bredd** och i **både ljust och mörkt läge**.
>
> Skriv till `docs/ux-genomgang.md`: en tabell över avvikelser med vy, vad
> som avviker, vad normen är, och hur allvarligt. **Rätta ingenting** —
> inventera först. Ändrar du i vy tre har du tappat överblicken vid vy tio.

## Körning 2 — användbarhet

> Läs `docs/ux-genomgang.md` och gå sedan igenom samma vyer igen, med
> frågan: vad kommer användaren hit för, och står svaret först?
>
> Två målgrupper: adepten (15–17 år, ser sin egen data) och tränaren (ser
> alla adepter). Växla mellan lägena.
>
> Bedöm informationsordning, navigationslogik, tonen mot adepten, och vad
> som saknas respektive är överflödigt. Lägg förslagen i
> `docs/ux-genomgang.md` under egen rubrik, rangordnade efter förbättring
> per arbetsinsats.

## Efteråt

Sammanfatta för användaren vad som hittades och vad som är värt att rätta
först — agentens egen rapport visas inte för dem. Rätta inget utan att
fråga: inventeringen är underlaget för ett val, inte en arbetsorder.

De nyaste vyerna bär sannolikt mest: blockvyn, uppföljningens
frånvaro- och distanspasskolumner och passläsningen byggdes i september
2026 utan någon designgranskning.
