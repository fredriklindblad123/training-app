# Tränarloopen

Hur kalender, trender och planering knyts ihop till en process i stället för
fyra vyer. Skriven 2026-08-03, efter att K1–K8 i `docs/tranarperspektiv.md`
byggts.

Målgrupp: den som implementerar.

---

## 1. Diagnosen

`docs/tranarperspektiv.md` identifierade att tränarens loop var bruten på tre
ställen och byggde datan för att laga den: strukturerad ordination (K1), plan
mot utfall (K2), beredskap (K3), veckans arbetsvy (K4), tävlingsanalys (K5),
kontinuitet (K6), tillgänglighet (K7), tröskeltest (K8).

**Allt det stämmer. Loopen fungerar ändå inte.**

> Vi byggde **datan** för varje steg i loopen, men aldrig **flödet** mellan
> dem. Varje förslag lades på den sida som råkade finnas — K2 i veckovyn, K3
> på dashboarden, K5 på trends, K1 i planeringen. Det finns ingen väg genom
> appen som går runt loopen.

Symptomen är mätbara:

| Symptom | Bevis |
|---|---|
| Navigering efter artefakt, inte process | `Dashboard · Kalender · Trender · Planering` — inget av dem är ett verb |
| Analysen är en vägg | `/trends` har **nio** sektioner. Ingen läser nio sektioner varje vecka |
| Ingen yta svarar på "vad ska jag göra nu?" | Fyra sidor svarar på "vad hände?", noll på "vad är nästa steg?" |
| Plan och utvärdering är åtskilda | Du planerar på `/planering`, utvärderar på `/trends`. Loopen kräver att de sitter ihop |
| Insikter är råa siffror | Appen visar 74 % tröskelandel. Den säger aldrig *"det här har stigit tre veckor i rad"* |

### 1.1 Den djupare orsaken

Sidorna är indelade efter **vilken sorts sak** de visar (en kalender, ett
diagram, en plan) i stället för efter **vilken fråga** man har. Det gör att
varje sida försöker svara på alla tidshorisonter samtidigt:

- `/dashboard` har en periodväljare (Idag / 7 dagar / Månad / År) — ett
  försök att pressa fyra kadenser in i en vy.
- `/trends` blandar veckofrågor (steg volymen?), blockfrågor (var träningen
  jämn?) och säsongsfrågor (hur går 1500m?) i nio sektioner.
- `/planering` blandar säsongsnivå (block, tävlingar) med vecknivå
  (veckomallar).

**Det är därför loopen inte syns.** Den snurrar i tre hastigheter, och ingen
sida äger en av dem.

---

## 2. Loopen och dess kadenser

```
        ┌──────────────────────────────────────────────┐
        │                                              │
   ORDINERA  ──▶  GENOMFÖRA  ──▶  ÅTERKOPPLA  ──▶  UTVÄRDERA
        ▲                                              │
        └──────────────────────────────────────────────┘
```

Loopen snurrar i tre hastigheter samtidigt:

| Kadens | Frågan | Rytm |
|---|---|---|
| **Dag** | Är hon redo för det som ligger idag? | Varje morgon, 20 sekunder |
| **Vecka** | Blev veckan gjord, och vad ska nästa innehålla? | Söndag kväll, 10 minuter |
| **Block (~6 v)** | Gav blocket det vi ville, och hur ska nästa se ut? | Var sjätte vecka, en halvtimme |
| **Säsong** | Vad gjorde vi inför de lopp som gick bra? | Ett par gånger per år |

**Veckan är hjärtslaget.** Det är i veckan träning faktiskt planeras (en
veckomall *är* en vecka), och det är den kadens som saknas mest.

---

## 3. Lösningen: en sida per kadens

I stället för att lappa den befintliga indelningen byter vi ut den. **Varje
sida äger en tidshorisont och svarar på både "vad hände?" och "vad händer
härnäst?" för just den horisonten.** Det är det som gör loopen sluten: plan
och utvärdering hamnar på samma sida i stället för på var sitt håll.

```
före:   Dashboard · Kalender · Trender · Planering · Inställningar
efter:  Idag · Veckan · Blocket · Säsongen · Kalender · Inställningar
```

| Sida | Kadens | Slutar med |
|---|---|---|
| **Idag** | Dag | Dagens pass |
| **Veckan** | Vecka | → Planera nästa vecka |
| **Blocket** | Block | → Skapa nästa block |
| **Säsongen** | Säsong | → Lägg till tävling / periodisera |
| **Kalender** | — (uppslagsverk) | — |

`/trends` och `/planering` försvinner som begrepp. Innehållet finns kvar, men
fördelat dit frågan hör hemma.

### 3.1 Vad som flyttar vart

**Idag** (`/idag`, dagens `/dashboard`)
- Nästa steg *(nytt, L2)*
- Dagens incheckning (P0.4) — om ogjord
- Beredskap inför morgondagen (K3)
- Status mot baslinje (P1.2)
- Dagens pass
- Kontinuitetsringarna (K6) — den enda långa horisonten här, som ankare

**Periodväljaren tas bort.** Idag betyder idag. Att den finns är själva
symptomet.

**Veckan** (`/veckan`, ny — hjärtslaget)
- Veckans insikter *(nytt, L3)*
- Efterlevnad: blev veckan gjord? (K2)
- Genomgång, en rad per pass med varvtider och Alices ord (K4)
- Veckans volym och kategorifördelning *(från `/trends`)*
- **→ Planera nästa vecka** *(mot veckomallen)*

**Blocket** (`/blocket`, ny)
- Blockets insikter
- Belastning och återhämtning (P1.1)
- Intensitetsfördelning (P1.3)
- Formkurva (P1.4)
- Konsekvens, CV (P1.5)
- Jämförelse mot föregående block av samma typ (P1.5)
- Passkvalitet (P2.1) och korrelationer — hopfällda, det är utforskning
- **→ Skapa nästa block**

**Säsongen** (`/sasongen`)
- Säsongstidslinjen med block (från `/planering`)
- Tävlingar och progressionskurva per gren (K5)
- Kontinuitet och avbrottstidslinje (K6)
- Veckomallar (från `/planering`)
- Tillgänglighet: skola, läger, resor (K7)

**Kalender** — oförändrad. Dag/vecka/månad/år som uppslagsverk, dit man går
för att slå upp en specifik dag. Flyttas bakåt i menyn.

### 3.2 Varför det här är värt en stor ändring

Tre saker faller ut gratis:

1. **Veckoritualen och blockavslutet behöver inte byggas.** De *är* sidorna.
   En sida som äger veckan och slutar med "planera nästa vecka" är ritualen.
2. **Periodväljaren försvinner.** Fyra sidor med var sin fast horisont
   ersätter en väljare som fanns för att en sida försökte vara alla fyra.
3. **`/trends` nio sektioner blir tre sidor med tre–sex vardera** — läsbart i
   en sittning, vilket nio aldrig blir.

### 3.3 Vad det kostar

Ärligt: det är en stor diff. Men den är **omflyttning, inte omskrivning** —
komponenterna, hämtningarna och beräkningarna finns och följer med. Risken
ligger i att tappa bort en sektion på vägen, inte i ny logik.

Behåll gamla URL:er som redirects (`/dashboard` → `/idag`, `/trends` →
`/blocket`, `/planering` → `/sasongen`). Kostar fyra rader och gör
ändringen ofarlig för bokmärken och för `revalidatePath`-anrop som finns
utspridda i serveråtgärder.

---

## 4. Stegen

```
L1  Sidindelning efter kadens        ← störst, görs först: definierar hemvisterna
L2  Nästa steg (åtgärdsytan)
L3  Insiktsflöde
L4  Tre korttyper (visuellt)         ← görs ihop med L2/L3
L5  Loopens utgångar                 ← knyter ihop sidorna
```

---

## L1 — Sidindelning efter kadens

**Ren omflyttning. Ingen ny logik, ingen migration.**

1. `/dashboard` → `/idag`. Ta bort periodväljaren; allt scopas till idag.
   Flytta volymringarna (Pass/Distans/Tid/Belastning) till `/veckan`.
2. Ny `/veckan`. Absorberar `calendar/vecka/[date]`s genomgångsläge (K4),
   `ComplianceCard` (K2), och volym-/kategorisektionerna från `/trends`.
   Default: innevarande vecka, med `?vecka=YYYY-MM-DD` för andra.
3. Ny `/blocket`. Absorberar `/trends` analytiska sektioner. Default: aktivt
   block, med `?block=<id>`. Utan aktivt block: senaste avslutade.
4. Ny `/sasongen`. Absorberar `/planering` plus `/trends` tävlings- och
   avbrottssektioner.
5. `calendar/vecka/[date]` behåller **bara rutnätet**. Genomgångsläget
   flyttar till `/veckan` — två hem för samma sak var förvirrande från början.
6. Redirects från `/dashboard`, `/trends`, `/planering`.
7. Uppdatera `navLinks` i `(app)/layout.tsx` och alla `revalidatePath`-anrop.

**Fallgropar:**

1. **Tappa inte en sektion.** Gör en checklista över `/trends` nio sektioner
   och `/planering`s alla block innan du börjar, och bocka av. Det är den
   enda verkliga risken i hela steget.
2. **`revalidatePath` är utspritt** i serveråtgärder (`settings/actions.ts`,
   `calendar/.../actions.ts`, `planering/actions.ts`). Gå igenom dem — en
   missad väg gör att en sida tyst slutar uppdateras efter en ändring.
3. Flytta hämtningarna med sektionerna. Varje sida ska hämta bara det den
   visar — `/trends` är redan tung och blir tre lättare sidor, inte tre
   tunga.

**Klart när:** menyn namnger loopens kadenser, och varje sida går att läsa i
en sittning.

---

## L2 — Nästa steg

**Ny fil `lib/next-actions.ts`. Ren logik, ingen React.**

```ts
export type LoopPhase = "dag" | "vecka" | "block" | "sasong";

export type NextAction = {
  id: string;
  phase: LoopPhase;
  /** Imperativ: "Checka in för idag". */
  title: string;
  /** En mening om varför just nu. Aldrig tillrättavisande. */
  why: string;
  href: string;
  /** Lägre = viktigare. Bara de tre lägsta visas. */
  priority: number;
};

export function nextActions(input: NextActionInput): NextAction[];
```

Reglerna, i prioritetsordning:

| # | Villkor | Åtgärd → |
|---|---|---|
| 1 | Incheckning saknas för idag | "Checka in för idag" → `/idag` |
| 2 | `shouldEaseOff` **och** kvalitetspass imorgon | "Titta på morgondagens pass" → dagvyn *(K3-kortet finns, lägg bara till raden)* |
| 3 | Gårdagens pass saknar anteckning | "Skriv om gårdagens pass" → dagvyn |
| 4 | Veckan tog slut, nästa vecka är oplanerad | "Gå igenom veckan" → `/veckan` |
| 5 | Aktivt block slutar inom 14 dagar | "Utvärdera blocket" → `/blocket` |
| 6 | `profiles.lt2_hr` är null, och ≥30 dagars data | "Ordinera ett tröskeltest" → `/sasongen` |

**"Granskad" behöver inget minne.** Räkna veckan som klar när nästa veckas
plan har minst ett pass — sant i praktiken, och undviker en ny tabell.

Visas överst på `/idag`, och de som gäller vecka/block även överst på
respektive sida.

**Fallgropar:**

1. **Appen får aldrig gnälla.** Max tre poster, ingen räknare över missade
   saker, ingen röd färg. En 17-åring som möts av en lista över vad hon inte
   gjort slutar öppna appen. Samma språkkrav som `DailyStatus.tsx`.
2. **Tom lista är ett gott tillstånd** och ska visa en neutral rad, inte
   försvinna — annars hoppar layouten och ytan känns opålitlig.

---

## L3 — Insiktsflöde

**Ny fil `lib/insights.ts`. Ren logik, ingen React, ingen språkmodell.**

```ts
export type Insight = {
  id: string;
  phase: LoopPhase;
  /** Påståendet: "Formkurvan har stigit fyra veckor i rad." */
  headline: string;
  /** Siffran bakom, för den som vill se den. */
  detail: string;
  href: string;
  tone: "positiv" | "neutral" | "att-bevaka";
};

export function buildInsights(input: InsightInput): Insight[];
```

Regler att börja med — alla räknas på värden som redan beräknas:

| Insikt | Kadens | Källa |
|---|---|---|
| Formkurvan har stigit/fallit N veckor i rad | block | `efWeekly` |
| Tröskelandelen har stigit N veckor i rad | block | `intensityWeeks` |
| Kontinuitetssviten är den längsta hittills | säsong | `lib/continuity.ts` |
| Kvalitetspassen gjorda N veckor i rad | vecka | `summarizeCompliance` |
| Sömnen under baslinjen N dagar | dag | `computeDailyStatus` |
| Nytt personbästa på en distans | säsong | `competition_events.result_seconds` |
| Veckovolymen ökade mer än 30 % | vecka | veckoserien |

Varje insikt visas på **sidan för sin kadens** — det är hela poängen med
`phase`-fältet.

**Uttryckligen ingen språkmodell.** `docs/insikter-roadmap.md` P3.2 slår fast
att AI-insikter ska vara manuella backend-körningar av kostnadsskäl.
Regelbaserat räcker: allt ovan är jämförelser mot egen historik, vilket är
precis vad avsnitt 2.4 säger att insikter ska vara.

**Fallgropar:**

1. **Minst tre veckors underlag** innan en trend påstås. Två punkter är en
   linje, inte en trend.
2. **Aldrig kausalt.** "Tröskelandelen har stigit" — inte "därför blev du
   trött".
3. **Max fem per sida.** Annars är det en vägg igen, med ord i stället för
   diagram.
4. Ingen insikt får vara enbart negativ i sin formulering.

---

## L4 — Tre korttyper

**Görs ihop med L2 och L3.** Problemet i dag: allt ser lika viktigt ut. Något
du *ska göra* har samma visuella vikt som en siffra du *kan läsa*.

| Typ | När | Uttryck |
|---|---|---|
| **Åtgärd** | Något ska göras | Färgad vänsterkant, rubrik i imperativ, tydlig länk. Max 3 |
| **Insikt** | Något är värt att förstå | Påståendet som rubrik, siffran sekundär, diagram bakom `<details>` |
| **Data** | Något ska slås upp | Dagens kortstil, neutral, ingen accent |

- Nya `components/ActionCard.tsx` och `components/InsightCard.tsx`.
- Två CSS-variabler i `globals.css` (ljust + mörkt), samma mönster som
  `--status-*`. **Återanvänd `--status-*` för allvarsgrad** — paletten är
  redan CVD-validerad.
- Befintliga kort rörs inte; de är "Data" och ser redan rätt ut.

**Fallgrop:** färgsätt inte åtgärder efter brådska. Alla får samma dämpade
accent, ordningen bär prioriteten. Rött på "skriv om gårdagens pass" vore
absurt.

---

## L5 — Loopens utgångar

Det som gör sidorna till en loop i stället för fyra hus: **varje sida slutar
med nästa steg.**

| Sida | Utgång |
|---|---|
| Idag | → Dagens pass i kalendern |
| Veckan | → **Planera nästa vecka** (veckomallen, förvald på nästa vecka) |
| Blocket | → **Skapa nästa block** (`/sasongen`, med föreslagna datum) |
| Säsongen | → Lägg till tävling · periodisera bakåt från A-loppet |

Kräver en liten tillägg: `/sasongen` tar emot `?vecka=` och `?nyttBlockFran=`
så utgångarna landar på rätt ställe i stället för på sidans topp.

**Fallgrop:** bygg inte en wizard med "steg 1 av 3". Det är en väg, inte ett
formulär — man ska kunna hoppa av var som helst och ändå ha fått ut något.

---

## 5. Ordning och storlek

| Steg | Nya filer | Karaktär |
|---|---|---|
| **L1** | 3 sidor (omflyttat innehåll) | Stor diff, låg risk — omflyttning, inte ny logik |
| **L2 + L4** | `lib/next-actions.ts`, 2 komponenter | Liten, störst upplevd effekt |
| **L3** | `lib/insights.ts` | Liten |
| **L5** | — | Trivial när L1 finns |

**Ingen av stegen kräver en databasmigration.** Allt räknas i läsvägen —
samma val som `lib/sessions.ts` och `lib/plan-matching.ts` redan gjort, av
samma skäl: trivialt reversibelt.

**L1 först.** Att bygga åtgärdsytan och insikterna innan hemvisterna finns
betyder att de byggs två gånger.

---

## 6. Det överordnade språkkravet

Appen används av en 17-åring. Den ska kännas som en tränare som säger *"kolla
här"* — aldrig som ett system som säger *"du missade"*.

- Åtgärder formuleras som nästa steg, aldrig som försummelser.
- Ingen räknare över missade dagar, pass eller incheckningar.
- Rött används inte för något som handlar om vad hon gjort eller inte gjort.
- En tom åtgärdslista är ett gott tillstånd och ska se ut som ett.

Samma krav som `DailyStatus.tsx` redan uppfyller och som
`docs/insikter-roadmap.md` P1.2 formulerar: appen säger vad som avviker och
överlåter slutsatsen.
