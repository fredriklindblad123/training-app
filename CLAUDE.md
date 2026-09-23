# Träningsnavet

Träningsapp för medeldistansgruppen i IFK Göteborg Friidrott. Next.js 16 +
Supabase. Koden ligger i `web/`, se även `web/AGENTS.md`.

## Kör alltid från `web/`

```
cd /Users/fredriklindblad/traningsapp/web
npx tsc --noEmit -p tsconfig.json && npx eslint src && npx next build
```

Kör man dem från `web/src` ger de hundratals falska modulfel och skapar en
vilsen `src/.next`. Det har hänt om och om igen — kontrollera katalogen först.

## Verifiera mot produktionsdata innan något levereras

Allt som räknar på träningsdata ska mätas mot riktig data innan det byggs
in, inte efteråt. Tre mått har tagit sig hela vägen till implementation här
innan någon mätte dem, och alla tre var fel:

- Riegels formel på intervallrep: 40–90 sekunder fel mot faktiska lopp.
- Pulsslag per meter som formmått: mätte fart, inte form (r²=0,37), och
  bruset mellan pass var större än signalen över en säsong.
- Lånade trösklar (`GEAR_MIN_REP_*`) som sållade bort varenda rep i ett
  tidsbaserat intervallpass.

Använd `dataverifiering`-agenten för det. Kontrollräkna helst mot en
oberoende källa — passens egna namn ("10x400m" ska ge tio rep) och
`competition_events` är facit.

## Lånade konstanter är den vanligaste felkällan

En tröskel satt för ett syfte är nästan alltid fel i ett annat. Kopiera
aldrig ett gränsvärde utan att ta reda på vad det sattes för.

## Ton mot adepterna

Observation, aldrig betyg. Ingen röd nivå för något en människa gjort eller
inte gjort. Säg ut när ett underlag är självskattat. Rita hellre ingenting
än att gissa. Se `.claude/agents/ux.md`.

## Agenter

| Agent | När |
|---|---|
| `dataverifiering` | innan ett nytt mått byggs, och när en siffra ser fel ut |
| `ux` | gränssnitt, svensk copy, ton, och allt som behöver ses renderat |
| `medeldistans` | fysiologi, periodisering, passval |
| `implementation` | avgränsade byggjobb, kör i egen worktree |

Kodgranskning görs med `/code-review ultra`, inte med en egen agent.

## Dokumentation

`docs/tranarperspektiv.md` (K1–K8, tränarens behov), `docs/tranarloopen.md`
(processen), `docs/insikter-roadmap.md` (P0–P3, vad datan räcker till),
`docs/data-model.md`, `docs/garmin-api.md`, `docs/auth.md`. Alla riktar sig
till den som implementerar, och alla säger att fallgroparna är det
viktigaste avsnittet.
