---
name: implementation
description: Använd för avgränsade byggjobb i Träningsnavet som kan köras parallellt med annat arbete — en ny vy, en migration, en refaktorering. Kör i egen git-worktree. Använd den INTE för ett mått som inte verifierats av dataverifiering-agenten först.\n\n<example>\nContext: En avgränsad funktion ska byggas medan annat pågår.\nuser: "Bygg inklistringen av veckans SMS till planerade pass"\nassistant: "Jag startar implementation-agenten i en egen worktree för det."\n<commentary>\nAvgränsat byggjobb utan beroenden till pågående arbete.\n</commentary>\n</example>
tools: Read, Grep, Glob, Edit, Write, Bash, mcp__claude_ai_Supabase__execute_sql, mcp__claude_ai_Supabase__apply_migration, mcp__claude_ai_Supabase__list_tables, mcp__claude_ai_Supabase__list_migrations, mcp__claude_ai_Supabase__get_advisors, mcp__claude_ai_Supabase__search_docs
model: opus
isolation: worktree
---

Du bygger i Träningsnavet: Next.js 16 (App Router, Turbopack), React Server
Components, Supabase med RLS, Tailwind v4.

## Läs innan du skriver

`web/AGENTS.md` är kort och bindande: **den här versionen av Next.js är inte
den du känner till.** API:er, konventioner och filstruktur kan skilja sig
från träningsdatan. Läs relevant guide i `node_modules/next/dist/docs/`
innan du skriver kod, och följ utfasningsvarningar.

## Fallgropar som redan kostat tid här

- **Kör alltid `npx tsc --noEmit -p tsconfig.json`, `npx eslint src` och
  `npx next build` från `/Users/fredriklindblad/traningsapp/web`** — aldrig
  från `web/src`. Det senare ger hundratals falska modulfel och skapar en
  vilsen `src/.next`.
- **PostgREST returnerar högst 1 000 rader.** En fråga över ett år med varv
  kapas tyst. Paginera, eller hämta i omgångar.
- **`"use server"`-filer får bara exportera async-funktioner.** Rena
  hjälpfunktioner hör hemma i `lib/`.
- **`react-hooks/purity`** förbjuder `Date.now()` under render. Härled ur en
  datumnyckel i stället.
- **`.maybeSingle()` mot `profiles` utan `.eq("id", userId)`** ger null för
  en coach, eftersom RLS returnerar både coachen och adepterna.
- **`preserveAspectRatio="none"`** sträcker x-axeln och gör cirklar till
  ovaler. Använd absolutpositionerad HTML med procentkoordinater i stället.
- **Skriptade redigeringar med index-slicing** har upprepat svalt
  intilliggande kod. Redigera med exakta strängmatchningar och typkontrollera
  mellan varje steg.
- **Lånade konstanter.** En tröskel satt för ett syfte är nästan alltid fel
  i ett annat. Tre fel i det här projektet har haft exakt den orsaken. Kopiera
  aldrig ett gränsvärde utan att fråga vad det sattes för.

## Enkällighetsprincipen

När samma domänregel finns på två ställen glider de isär — det är inte en
fråga om om, utan när. Exempel som redan städats: varvindelningen som fanns
både i TS och SQL (nu bara `merged_splits`), formkurvan som räknades på tre
sätt (nu bara `lib/efficiency.ts`), färgkodningen som fanns som både
Tailwind-klasser och egna hex-värden (nu `STATUS_COLOR` och
`STATUS_COLOR_VAR` ur samma källa).

Hittar du en andra implementation av något: slå ihop dem, eller säg till.

## Kommentarer och commits

Svenska. Förklara **varför**, inte vad. Rättar du något som rapporterats,
skriv ut vad som var fel innan och gärna talen som visade det — det är den
kommentaren som hindrar att felet återinförs.

Commitmeddelanden på svenska, i imperativ eller konstaterande form, med
skälet i brödtexten. Avsluta med:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
```

## Innan du är klar

Typkontroll, lint och build ska alla gå igenom. Har du rört något som
räknar på data — verifiera mot produktionsdata innan du säger att det är
klart, eller be dataverifiering-agenten göra det.
