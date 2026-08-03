# Tränarperspektivet

Vad en tränare för aktiva medeldistanslöpare skulle vilja att appen gjorde,
ställt mot vad som faktiskt är byggt.

Skriven 2026-08-01. Målgrupp: den som implementerar. Läs hela förslaget du
bygger — fallgroparna är det viktigaste. Komplement till
`docs/insikter-roadmap.md` (P0–P3); numreringen här är K1–K8 för att inte
krocka, och korsrefererar roadmapen där förslagen överlappar.

---

## 1. Den strukturella observationen

Appen är byggd som **atletens självmonitorering**: den tittar bakåt på data
som redan finns och beskriver vad som hänt. Dashboard med KPI-ringar, trender,
kalender, dagbok. Det är väl byggt och det är rätt för Alice.

En tränare arbetar tvärtom **framåt, i en loop**:

```
   ordinera pass  →  atleten genomför  →  utfall + känsla tillbaka
        ↑                                          │
        └──────────  justera nästa pass  ←─────────┘
```

**Den loopen är bruten på tre ställen i dagens app**, och det är samma tre
ställen som skiljer ett analysverktyg från ett tränarverktyg:

| Steg | Vad som finns | Vad som saknas |
|---|---|---|
| **Ordinera** | `planned_workouts` med `title` + `description` (fritext) | Ingen struktur på passet. "5x1000m @ 3:15, 2 min vila" är en textsträng appen inte kan räkna på. |
| **Koppla ihop** | `planned_workouts.status` och `.linked_activity_id` finns i schemat | **Skrivs aldrig.** Verifierat med grep 2026-08-01: `linked_activity_id` och statusarna `completed`/`skipped`/`modified` förekommer inte en enda gång i `web/src/`. Planen och utfallet är två parallella spår som aldrig möts. |
| **Justera** | `DailyStatus` (P1.2) säger "2+ markörer utanför normalt → överväg sänkt belastning" | Signalen når aldrig planen. Morgondagens tröskelpass ligger kvar oförändrat i `planned_workouts` och ingenting kopplar ihop de två. |

Allt annat nedan följer ur detta. **K1–K3 lagar loopen och bör byggas i den
ordningen.** K4–K8 är fristående och kan tas i valfri ordning.

### 1.1 Det appen redan har som gör detta billigt

Tre saker finns redan byggda som gör förslagen nedan mycket mindre än de låter:

1. **Passignaturer** (`web/src/lib/session-signature.ts`, P2.1 i roadmapen).
   `buildSessionSignature(laps)` räknar redan fram `{ key: "2x1000+4x600",
   label: "2×1000 m + 4×600 m", groups: RepGroup[], ... }` ur `activity_splits`
   (3 206 varv på 242 aktiviteter). **Det är exakt den struktur ett ordinerat
   pass behöver** — samma format i planen ger plan-mot-utfall på repnivå
   nästan gratis.
2. **Gemensamt ordförråd.** `WORKOUT_TYPES` (`lib/planning.ts`) är medvetet
   identisk med `activities.category` plus `rest`. Plan och utfall talar redan
   samma språk — det var ett uttalat designbeslut och det är förutsättningen
   för K2.
3. **Veckomallar som synkar automatiskt** in i alla block med samma
   `block_type` (`planering/actions.ts`: `syncTemplateIntoBlock`,
   `syncBlockWithTemplates`, `syncTemplateAcrossBlocks`). Ordinationsflödet
   finns, det är bara innehållet i ordinationen som är för tunt.

---

## 2. Vad en medeldistanstränare faktiskt följer

Grundat i samma källor som roadmapens avsnitt 2, men läst med tränarens
frågeställning i stället för atletens.

**Tränarens fyra frågor, i den ordning de ställs:**

1. *Blev veckan gjord?* — inte "hur mycket tränade hon" utan "hur mycket av
   det jag skrev blev av, och vad hände med resten". Detta är operationa­li­se­ringen
   av det både Lindh och Almgren pekar ut som avgörande: kontinuitet och
   upprepbarhet (roadmapen 2.1, 2.3).
2. *Går nyckelpassen framåt?* — samma pass, samma eller lägre puls, snabbare
   tider. Inte veckovolym.
3. *Är hon redo för det som ligger imorgon?* — och specifikt: är hon redo för
   *just den passtypen*. Låg HRV inför ett lugnt distanspass är en notering.
   Låg HRV inför dubbeltröskel är ett beslut.
4. *Vad gjorde vi inför de lopp som gick bra?* — den enda frågan som
   validerar hela upplägget i efterhand.

Ingen av de fyra går att besvara i appen idag. Fråga 2 är närmast — P2.1
finns på `/trends` men är framställd som analys, inte som uppföljning av en
ordination.

**En sak till, specifik för att atleten är 17 år:** en junior­tränare planerar
runt saker som inte är träning — prov, lov, läger, resor, skolidrott.
Roadmapen noterar redan (P1.5) att hög CV i ett block "ofta är tecken på
sjukdom, skola eller överambition". Skolan är alltså redan identifierad som
förklaringsvariabel men finns inte modellerad någonstans. Se K7.

---

## 3. Förslag

```
K1  Strukturerad ordination (reps i planen)      ← störst värde, lagar grunden
K2  Plan mot utfall: koppling och efterlevnad    ← förutsätter K1
K3  Beredskap kopplad till morgondagens pass     ← förutsätter K2
K4  Veckans arbetsvy för tränare
K5  Tävlingsanalys och upptrappning              ≈ P2.3 i roadmapen
K6  Kontinuitet och avbrott                      ≈ P2.4 i roadmapen
K7  Tillgänglighet: skola, läger, resor
K8  Tröskeltest som ordinerbart pass             ← lås upp P1.3
```

---

## K1 — Strukturerad ordination

**Problemet.** En tränare skriver `5x1000m @ 3:15/km, 2 min jogg`. Idag
hamnar det i `planned_workouts.description` som en sträng. Konsekvenser:

- Appen kan inte jämföra planen med utfallet, trots att utfallet finns
  strukturerat i `activity_splits`.
- "Planerad kvalitetsvolym den här veckan" går inte att räkna.
- En veckomall kan inte återanvända ett pass — bara texten kopieras.

**Lösningen: spegla `SessionSignature`-formatet i planen.**

Ny tabell, hellre än fler kolumner på `planned_workouts` — ett pass har flera
repgrupper (`2×1000 + 4×600` är två grupper) och det är en 1:N-relation:

```sql
create table planned_rep_groups (
  id uuid primary key default gen_random_uuid(),
  planned_workout_id uuid not null
    references planned_workouts(id) on delete cascade,
  sort_order smallint not null default 0,
  reps smallint not null check (reps > 0),
  distance_meters integer,               -- 1000
  duration_seconds integer,              -- alternativ till distans: "5x3min"
  target_pace_seconds_per_km integer,    -- 195 = 3:15/km
  target_hr_low smallint,                -- personligt tröskelband, se K8
  target_hr_high smallint,
  recovery_seconds integer,              -- 120
  recovery_kind text check (recovery_kind in ('jogg','stående','gång')),
  note text,
  constraint rep_has_a_measure
    check (distance_meters is not null or duration_seconds is not null)
);
```

`description` behålls som fritext för det som inte är reps ("sista två i
tävlingsfart om det känns bra") — den ska inte ersättas, bara kompletteras.

**Nyckeldetalj som gör hela K2 möjlig:** lägg en hjälpfunktion i
`lib/session-signature.ts` som producerar samma `key` ur en planerad
repgrupp som `buildSessionSignature` gör ur verkliga varv:

```ts
/** "2x1000+4x600" ur planerade repgrupper — samma nyckelformat som
 * buildSessionSignature ger ur activity_splits, så plan och utfall kan
 * jämföras direkt. */
export function plannedSignatureKey(groups: PlannedRepGroup[]): string
```

Håll de två i synk i samma fil. Divergerar formaten går K2 sönder tyst.

**UI.** I `PlannedSessions.tsx`, inuti det befintliga `<details>`-formuläret:
en rad per repgrupp med fälten `antal × distans @ pace, vila`, plus en
"lägg till grupp"-knapp. Håll det på en rad per grupp — en tränare skriver
passet på tio sekunder eller låter bli.

**Fallgropar:**

1. **Tvinga inte fram struktur.** Ett lugnt distanspass har inga repgrupper
   och ska inte kräva några. Repgrupper är för kvalitetspass; `easy`,
   `long_run`, `rest` ska fungera precis som idag.
2. **Pace vs puls.** Almgren styr tröskelarbete mot ett pulsband, inte mot
   pace (roadmapen 2.3). Stöd båda och tvinga ingen — men notera att
   `target_hr_low/high` är meningslöst tills K8 är gjord.
3. **Veckomallarna måste följa med.** `week_template_items` behöver samma
   struktur, annars tappar utrullningen repgrupperna. Enklast: identisk
   `template_rep_groups`-tabell, och kopiera i `generateFromTemplate`
   (`lib/planning.ts`). Missas detta blir mallarna tomma skal och tränaren
   skriver om passen varje vecka.

---

## K2 — Plan mot utfall: koppling och efterlevnad

**Förutsätter K1.**

**Problemet.** `planned_workouts.status` och `.linked_activity_id` finns i
schemat sedan första migrationen men skrivs aldrig (verifierat 2026-08-01).
Det betyder att appen aldrig kan svara på tränarens första fråga: *blev
veckan gjord?*

Notera att dagvyns plan-mot-utfall-jämförelse **medvetet togs bort**
2026-07-30 — den var för atleten, som redan vet vad hon gjorde. Det som
föreslås här är inte att återinföra den, utan att bygga aggregatet: en vecka
i taget, inte ett pass i taget.

### Steg 1 — automatisk koppling

En ren funktion, `lib/plan-matching.ts`, som parar ihop dagens planerade pass
med dagens genomförda pass (`TrainingSession` från `lib/sessions.ts`):

```ts
export type PlanMatch = {
  planned: PlannedWorkout;
  session: TrainingSession | null;
  outcome: "genomfört" | "avvikande typ" | "ej genomfört" | "oplanerat";
};
```

Matchningsregler, i ordning:

1. Samma dag och samma `slot` → parade.
2. Flera pass samma dag utan slot-träff → para i tidsordning.
3. `planned.workout_type === session.category` → `genomfört`.
4. Passtyperna skiljer sig → `avvikande typ` (veckovyn har redan exakt den
   här jämförelsen inline, se `calendar/vecka/[date]/page.tsx` — flytta in
   den hit och låt veckovyn använda funktionen i stället).
5. Planerat pass utan genomfört → `ej genomfört`.
6. Genomfört pass utan planerat → `oplanerat`. **Detta är inte ett fel** —
   se fallgrop 2.

**Beräkna i läsvägen, skriv inte till databasen.** Samma principiella val som
`lib/sessions.ts` gjorde för passgruppering, och av samma skäl: kopplingen
blir trivialt reversibel, ingen migration behövs, och en omkategorisering av
ett pass slår igenom direkt utan backfill. `status`/`linked_activity_id`
lämnas orörda i schemat.

### Steg 2 — efterlevnad per vecka

Ett kort i veckovyn och i blockvyn på `/trends`:

```
 Vecka 31                      5 av 6 planerade pass genomförda
 ─────────────────────────────────────────────────────────────
 Kvalitetspass    2 av 2  ✓
 Volym            48 km av planerade 52 km   (−8 %)
 Ej genomfört     tors: 6x400m               (dagboken: "sjuk")
 Oplanerat        lör: 8 km lugnt
```

Kvalitetspassraden är den viktiga. Roadmapen (P2.4) identifierar
*"antal veckor i rad med minst X kvalitetspass genomförda"* som den siffra
båda svenska källorna oberoende pekar mot. Det är den här datan som gör den
mätbar — se K6.

**Fallgropar:**

1. **Efterlevnad är inte ett betyg.** 100 % efterlevnad kan betyda att
   atleten körde ett kvalitetspass hon inte var redo för. Ordval: "5 av 6
   genomförda", aldrig "83 % — bra jobbat" eller en färgad varning.
   Motiveringen finns redan i appens språkkrav (P1.2): appen beskriver, den
   dömer inte.
2. **Oplanerat är normalfallet, inte ett undantag.** `planned_workouts` hade
   2 rader när roadmapen skrevs. Även med veckomallar kommer merparten av
   historiken sakna plan. Vyn måste vara meningsfull när planen är tom — visa
   då bara utfallet, inte "0 % efterlevnad" i rött. Det är precis så
   `planned_workouts` dog första gången.
3. **Sjukdom är inte samma sak som skippat.** Om `diary_entries.day_type` är
   `sick` eller `injured` ska passet redovisas som *inställt*, inte som
   missat. Skillnaden är hela poängen när man tittar bakåt på ett block.

---

## K3 — Beredskap kopplad till morgondagens pass

**Förutsätter K2.**

**Problemet.** `computeDailyStatus` (`lib/daily-status.ts`) räknar redan ut
att två eller fler markörer ligger utanför normalintervallet och
`DailyStatus.tsx` visar `shouldEaseOff` med en väl formulerad text. Men
signalen är generisk. Den vet inte att det ligger dubbeltröskel imorgon.

**Lösningen.** Ett kort på dashboarden, ovanför träningsringarna, som bara
visas när det finns något att säga — alltså när `shouldEaseOff` är sant
**och** morgondagen har ett planerat kvalitetspass
(`workout_type ∈ {threshold, interval, race}`):

```
 Imorgon: 5×1000 m tröskel
 ─────────────────────────────────────────────────────────
 HRV och sömn ligger under ditt normala andra dagen i rad.

 I studier på elitlöpare är det den punkt där tränaren sänker
 belastningen i nästa pass. Värt att väga in — tillsammans med
 hur du faktiskt känner dig.
```

Ingen knapp som ändrar passet automatiskt. Beslutet är tränarens och
atletens; appens jobb är att lägga de två uppgifterna bredvid varandra vid
rätt tillfälle.

**Fallgropar:**

1. **Får aldrig bli en daglig notis.** Visas kortet ofta slutar det läsas.
   Villkoret ska vara konjunktivt (avvikelse **och** kvalitetspass imorgon)
   just för att göra det sällsynt. Ett lugnt distanspass triggar inget.
2. **Språkkravet gäller.** Aldrig "hoppa över passet", aldrig "du är
   överbelastad". Återanvänd formuleringen som redan finns i
   `DailyStatus.tsx` — den är genomarbetad och godkänd.
3. **Baslinjen måste vara mogen.** `MIN_BASELINE_DAYS` gäller. Utan tillräcklig
   historik ska kortet inte visas alls, inte visas med förbehåll.

---

## K4 — Veckans arbetsvy

**Problemet.** En tränare lever i veckan, men appens veckovy
(`calendar/vecka/[date]`) är en kalender — sju kolumner, en cell per dag.
Bra för överblick, fel form för det tränaren gör: läsa igenom veckan pass för
pass med atletens ord bredvid siffrorna, och skriva nästa vecka.

**Lösningen.** En vy, `/vecka` eller en flik i veckovyn, med **en rad per
pass i kronologisk ordning** — inte ett rutnät:

```
 Mån 4 aug
   Plan    5×1000 m @ 3:15, 2 min jogg          [tröskel]
   Utfall  5×1000: 3:14 · 3:16 · 3:15 · 3:18 · 3:22    snittpuls 174
   Alice   "Tungt de sista två, blåsigt på upploppet."
   ─ känsla 3/5 · ansträngning 4/5 · sömn 7h10 · HRV 68 (−1,2 SD)

 Tis 5 aug
   Plan    8 km lugnt                            [easy]
   Utfall  8,2 km · 42:10 · snittpuls 152
```

Allt som visas finns redan: planen (K1), varvtiderna (`activity_splits`),
dagbokstexten (`diary_entries.notes`), incheckningen (P0.4), sömn/HRV
(`daily_metrics`). Det som saknas är att lägga dem på samma rad.

**Varför detta är värt en egen vy:** kopplingen mellan varvtiderna och
Alices egen mening är den enda platsen där "varv 4–5 rasade" får sin
förklaring. Roadmapen konstaterar det redan under P2.1 — blåst och att dra
ensam är den vanligaste förklaringen i hennes dagbok, och utan texten blir
det en falsk trend i datan.

**Fallgrop:** frestelsen att göra den här vyn redigerbar överallt. Håll den
läsande. Att skriva nästa vecka hör hemma i `/planering`, där veckomallarna
redan finns.

---

## K5 — Tävlingsanalys och upptrappning

Motsvarar **P2.3** i roadmapen, som är fullständigt specificerad där. Två
tillägg ur tränarperspektivet:

1. **Resultatfältet finns redan.** `competition_events.actual_result` och
   `.placement` är byggda och har inmatning (`saveEventResult` i
   `planering/actions.ts`). Roadmapens P2.3 föreslår en ny `race_results`-tabell
   — **bygg inte den.** Den skrevs innan `competition_events` fanns. Använd
   det som finns.
2. **Upptrappningen ska jämföras, inte beskrivas.** Att visa en profil över
   de 21 dagarna före ett lopp är intressant en gång. Det tränaren vill är två
   lopp bredvid varandra: *"inför 4:32 gjorde vi det här, inför 4:41 det
   här."* Blockjämförelsen på `/trends` (P1.5) har redan exakt det mönstret,
   inklusive tabellayouten — återanvänd `blockComparisonRows`-strukturen med
   tävlingsdatum i stället för blockgränser.

**Fallgrop:** med ~10 lopp per säsong är detta beskrivande, aldrig
statistiskt. Roadmapen säger det redan; det tål att upprepas i UI-texten.

---

## K6 — Kontinuitet och avbrott

Motsvarar **P2.4**. Ur tränarperspektiv är det viktigaste av allt i den här
listan att **kontinuitetsmätaren blir en huvudsiffra, inte en undersida**.

Roadmapen (2.1, 2.3, P2.4) landar i att upprepbarhet är den starkaste
signalen i hela researchen — två av Sveriges bästa säger samma sak oberoende
av varandra. Ändå är dashboardens huvudsiffror volym och belastning.

**Konkret:**

- **Två tal på dashboarden**, som KPI-ringar bland de befintliga:
  - *Sammanhängande veckor utan sjuk-/skadedag* (nuvarande svit, och
    personbästa som riktvärde i ringen — det är precis vad `KpiRing`s
    `targetText` är byggd för sedan 2026-07-30).
  - *Veckor i rad med minst 2 genomförda kvalitetspass* — kräver K2.
- **En tidslinje** över alla sjuk-/skadeperioder med det som föregick dem:
  belastning veckorna innan, sömn, HRV-trend, dagbokens ord dagarna före.

**Fallgropar:**

1. **En svit som bryts får inte se ut som ett misslyckande.** Sjukdom
   händer. Ordval och färg: neutral, beskrivande. Ringen ska inte bli röd
   för att hon var förkyld i mars.
2. **ACWR, om det byggs, är en signal bland flera.** Roadmapen 2.6 går
   igenom kritiken — författarna har själva tagit tillbaka ordet "predicts".
   Aldrig ensam grund för en varning.

---

## K7 — Tillgänglighet: skola, läger, resor

**Problemet.** Alice är 17. Tentaveckor, lov, läger och resor styr träningen
minst lika mycket som periodiseringen — men finns inte modellerade. Appen
tolkar en tentavecka med låg volym som antingen en medveten nedtrappning
eller ingenting alls.

Roadmapen har redan identifierat detta indirekt: P1.5 noterar att hög CV
inom ett block "ofta är tecken på sjukdom, skola eller överambition". Skolan
är alltså redan en känd förklaringsvariabel utan att vara data.

**Lösningen — medvetet minimal:**

```sql
create table availability_periods (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  kind text not null check (kind in ('skola','lager','resa','ledighet','annat')),
  label text,
  note text,
  constraint availability_dates_ok check (end_date >= start_date)
);
```

Visas som ett tunt band i kalendervyerna och som kontext i blockjämförelsen
("grundperioden 25/26 innehöll två tentaveckor, 26/27 ingen"). Ingen logik,
ingen tolkning, ingen justering av riktvärden — bara kontext som gör
avvikelser förklarliga i stället för mystiska.

**Fallgrop:** låt det inte växa till ett schemaläggningsverktyg. Ett datum­intervall
och en etikett räcker. Blir det ett kalendersystem används det inte, precis
som `planned_workouts` med sina två rader.

---

## K8 — Tröskeltest som ordinerbart pass

**Detta är den enskilt högsta hävstången i hela dokumentet.**

**Problemet, ordagrant ur roadmapen (P1.3):** intensitetsfördelningen mäter
Garmins autozoner, inte Alices fysiologi. Uppmätt utfall: **74,4 % på eller
över tröskel, 5,1 % lugnt**, vilket är fysiologiskt orimligt för ett
träningsår. Sju slag/min på tröskelantagandet flyttar fördelningen 24
procentenheter. `lt1_hr`, `lt2_hr`, `threshold_hr_low/high` och `max_hr` är
alla `null`.

Roadmapens slutsats är att nästa steg är *ett tröskeltest, inte ett
kodbygge*. Det stämmer — men appen kan göra testet mycket mer sannolikt att
bli av, och det är ett kodbygge:

1. **Ordinera testet som ett pass.** En `workout_type: "test"` med ett
   färdigt protokoll i `description`: *30 minuter maxinsats, jämn fart.
   Snittpuls för de sista 20 minuterna ≈ LT2.* Fältprotokollet står redan i
   roadmapen P1.3.
2. **Räkna ut svaret automatiskt.** När passet är synkat: plocka snittpulsen
   för de sista 20 minuterna ur varvdatan och **föreslå** `lt2_hr` med en
   spara-knapp. Inte skriva automatiskt — men inte heller låta atleten räkna
   för hand, för då blir det inte gjort.
3. **Visa vad det låser upp.** Innan värdena finns: en rad på `/trends`
   intensitetssektion som säger vad siffrorna vore värda med ett kalibrerat
   band. Efter: hela P1.3 blir meningsfull.

**Fallgropar:**

1. **Ett fälttest är inte ett laktattest.** LT2 ur ett 30-minuterstest är en
   uppskattning. Märk värdet med sin källa (`test_field` vs `test_lactate`)
   och visa vilken som används. `lactate_readings` finns redan för det
   riktiga testet (P0.3b).
2. **Zonsekunderna kan ändå inte räknas om.** Roadmapen är tydlig:
   `hr_zone_1..5_seconds` är förberäknade av Garmin, som aldrig levererar
   gränserna den räknat mot. Ett personligt band kan användas som facit att
   jämföra mot och för nya beräkningar ur varvdata — men det räknar inte om
   de befintliga staplarna. Lova inte det i UI:t.
3. **Ett test på en 17-åring är fysiskt krävande.** Ordinera det i ett
   grundblock, aldrig nära tävling, och aldrig som något appen påminner om
   upprepade gånger.

---

## 4. Det stora arkitekturvalet: ska tränaren in i appen?

Allt ovan fungerar i dagens enanvändarmodell — det är Alice som ser
tränarens perspektiv på sin egen träning. Det räcker långt och är rätt första
steg.

Men om en riktig tränare ska in behövs tre saker som inte finns:

1. **Roller och delning.** RLS är idag `user_id = auth.uid()` rakt igenom.
   En tränarroll kräver en `coach_athletes`-relation och omskrivna policyer
   på varje tabell. Det är ett stort och riskfyllt ingrepp — gör det inte
   som en sidoeffekt av något annat.
2. **Tvåvägskommunikation.** `diary_entries.coach_notes` finns men är
   read-only, importerad ur PDF:en. Ska tränaren skriva behövs det som en
   riktig funktion.
3. **`P3.1` måste undantas.** Roadmapen är kategorisk: menscykel- och
   energitillgänglighetsdata ska ha striktare RLS än övriga tabeller och
   **aldrig delas med en tränarvy**. Byggs delning måste den tabellen vara
   explicit utesluten från dag ett, inte efteråt.

**Rekommendation:** bygg K1–K8 i enanvändarmodellen först. De ger hela
tränarnyttan utan arkitekturrisken. Ta delning som ett eget projekt om och
när en faktisk tränare ska använda appen.

---

## 5. Föreslagen ordning

| Steg | Förslag | Varför just då |
|---|---|---|
| 1 | **K8** tröskeltest | Fristående, litet, och lås upp P1.3 som annars mäter fel. Störst insikt per rad kod. |
| 2 | **K1** strukturerad ordination | Grunden för K2 och K3. Utan den är resten fritext. |
| 3 | **K2** plan mot utfall | Besvarar tränarens första fråga. Förutsätter K1. |
| 4 | **K6** kontinuitet | Kräver K2 för kvalitetspass-sviten, men halva (sjuk/skadesviten) går att bygga direkt. |
| 5 | **K3** beredskap mot morgondagens pass | Liten när K2 finns. Hög upplevd nytta. |
| 6 | **K4** veckans arbetsvy | Ren presentation av data som redan finns efter K1–K2. |
| 7 | **K5** tävlingsanalys | Störst värde efter en hel säsong med resultatdata ifylld. |
| 8 | **K7** tillgänglighet | Ökar värdet av K6 och blockjämförelsen, men står inte på egna ben. |

**Om bara en sak byggs: K8.** Den kostar minst och gör att en hel befintlig
sektion (P1.3) slutar mäta fel sak.

**Om bara en kedja byggs: K1 → K2.** Det är den som flyttar appen från
självmonitorering till tränarverktyg.
