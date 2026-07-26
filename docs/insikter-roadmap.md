# Insikter & UX-roadmap

Underlag för nästa utvecklingsfas: kombinera sömn, löpdata och dagbok till
insikter om vad som faktiskt gör en bättre medeldistanslöpare.

Skriven 2026-07-26. Målgrupp: den som implementerar (läs hela avsnittet för
det förslag du bygger — fallgroparna är det viktigaste).

---

## 1. Utgångsläge: vad finns i databasen idag

Faktiska siffror, mätta 2026-07-26:

| Tabell | Rader | Täckning |
|---|---|---|
| `activities` | 666 | 2025-07-25 → 2026-07-26 (två användare) |
| `diary_entries` | 268 | Alice: 2025-08-18 → 2026-05-31 (253 st) |
| `daily_metrics` | **34** | **2026-06-25 → 2026-07-26** |
| `activity_splits` | **0** | tom |
| `planned_workouts` | 2 | i praktiken oanvänd |
| `goals` | 2 | |

`rpe`, `mood`, `soreness` i `diary_entries` är **null i samtliga rader**.

### 1.1 Den viktigaste observationen

**Dagboksperioden och sömn-/HRV-perioden överlappar inte med en enda dag.**

Dagbok: aug 2025 → maj 2026. Sömn/HRV: juni 2026 → juli 2026.

Det betyder att varenda korrelation på `/trends` idag räknas på tom mängd —
sidan är byggd, men den kan strukturellt inte visa något. Detta är den enskilt
största blockeraren och styr prioriteringen nedan.

### 1.2 Data som redan synkas men aldrig används

`activities.raw_data` (99 nycklar) innehåller redan, utan ett enda nytt
Garmin-anrop:

- `avgPower`, `normPower`, `maxPower`, `powerTimeInZone_1..5` — löpeffekt
- `avgGroundContactTime`, `avgVerticalOscillation`, `avgVerticalRatio` — löpteknik
- `avgGradeAdjustedSpeed` — GAP, gör kuperade och platta pass jämförbara
- `fastestSplit_1000` / `_1609` / `_5000` — snabbaste km/mile/5k *inom* passet
- `differenceBodyBattery` — hur mycket passet kostade i återhämtning
- `moderateIntensityMinutes`, `vigorousIntensityMinutes`, `steps`
- `lapCount` (15, 26, 45 på intervallpassen), `hasIntensityIntervals`

Oanvända endpoints i `garminconnect`-klienten: `get_activity_splits()`,
`get_hrv_data()`, `get_training_readiness()`, `get_training_status()`,
`get_race_predictions()`.

---

## 2. Vad eliten och forskningen faktiskt följer

Kort research-sammanfattning, för att förslagen ska vila på något.

### 2.1 Kontinuitet slår enskilda pass

Lovisa Lindh (EM-brons 800m 2016) om vad som avgör: **"det viktigaste är
kontinuiteten"**. Hon beskriver att hon gått från hög volym till *"en något
lägre volym per vecka men kunnat springa på den väldigt länge"* — alltså att
uthållig, skadefri träning över tid slår enskilda hårda veckor.
([Marathon.se](https://www.marathon.se/lopningen/traning/lovisa-lindh-kanner-medvind-igen-efter-segern-i-inomhus-sm-sa-tranar-hon-just-nu))

**Konsekvens för appen:** det som ska mätas är inte "hur hård var veckan" utan
*antal sammanhängande veckor utan avbrott* och *vad som föregick avbrotten*.
En "kontinuitetsmätare" är en mer träffsäker huvudsiffra än veckovolym.

### 2.2 Intensitetsfördelning är det elitens system faktiskt handlar om

Den norska modellen (Marius Bakken, 5 500+ laktattester; tillämpad av bröderna
Ingebrigtsen) styr på tid i ett smalt intensitetsfönster, 2,5–4 mmol/L. Under
förberedelseperioden 2018–19 låg **23–25 % av veckovolymen på eller över
tröskel**, med zon 2-träning 4 ggr/vecka och två tröskelpass samma dag
("double threshold") två gånger i veckan.
([Marius Bakken](https://www.mariusbakken.com/the-norwegian-model.html),
[systematisk översikt](https://www.researchgate.net/publication/376465773_Norwegian_double-threshold_method_in_distance_running_Systematic_literature_review))

**Konsekvens:** appen har redan `hr_zone_1..5_seconds` per pass. Att räkna
faktisk intensitetsfördelning i *tid* (inte antal pass) och ställa den mot en
målmodell är fullt möjligt idag och är förmodligen den mest "elitlika" insikten
som går att bygga utan ny data.

### 2.3 Andreas Almgren: fyra mätvärden och sexveckorsblock

Den mest direkt tillämpbara källan i hela dokumentet — svensk, samtida, och
redan tänkt som referensmaterial enligt `README.md`.

**Hans egen uppföljningsmodell, ordagrant:**

> *"I usually check four things: speed, lactate, heart rate, and overall
> feeling."*
> ([COROS](https://corosnordic.com/blogs/coros-stories/behind-the-training-of-andreas-almgren))

Fyra axlar: **fart, laktat, puls, känsla.** Appen har i dag fart och puls.
Känsla saknas helt som mätbar storhet (P0.4 + P2.2). Laktat finns inte alls.
Det är i praktiken en kravspecifikation för vilka fyra serier som ska gå att
lägga i samma graf.

**Om att intensiteten styrs mot personliga värden, inte generiska zoner:**

> *"I've been doing threshold training for a while, so I know how I want each
> workout to feel and what lactate values work for me long-term."*

Han siktar på ett **pulsintervall på 167–178** för tröskelarbete. Alltså inte
"zon 4" enligt klockans gissning, utan ett personligt kalibrerat band. Notera
också att *känsla* är en av de fyra mätvärdena — inte ett mjukt komplement till
datan, utan en likvärdig del av den.

**Om periodisering — sexveckorsblock:**

> *"I'll keep a set structure for maybe six weeks, and adjust if needed... I
> don't think training should be too static. But once you decide on a period,
> you should be quite consistent within that period."*

**Om volymen och skadefriheten.** Mellan 2016 och 2019 hade Almgren upprepade
stressrelaterade skador. Övergången till dubbeltröskel 2019 vände förloppet:
han gick från ca **110–120 km/vecka till 190–200 km/vecka** vid kontrollerad
intensitet — och blev *både* skadefri och snabbare.
([Sweat Elite](https://articles.sweatelite.co/inside-the-mind-and-training-regimen-of-swedish-distance-runner-andreas-almgren/),
[löpning.se](https://xn--lpning-wxa.se/hur-tr%C3%A4nar-andreas-almgren))
Hans egen förklaring: *"Det här gör att du kan träna väldigt mycket – men det
sliter inte lika mycket."*
([SVT](https://www.svt.se/nyheter/vetenskap/hemligheten-bakom-andreas-almgrens-succelopp))

**Viktig varning som måste följa med.** Lektor Filip Larsen påpekar i samma
SVT-artikel att metoden **inte är för alla** — för den som inte är elit är den
"för intensiv vilket innebär en ökad risk för skador". Alice är 17 år och
junior, inte senioreliten. Appen ska därför **aldrig** presentera Almgrens
volym eller passupplägg som ett mål att matcha. Det som är överförbart är
*principerna* (kontrollerad intensitet, personligt kalibrerade zoner, block,
upprepbarhet) — inte siffrorna.

**Konsekvenser för appen (fyra konkreta):**

1. **Fyra parallella serier** är designmålet för huvudgrafen, inte två.
   Laktat bör finnas som manuellt fält (P0.3b) — laktattest förekommer på
   friidrottsgymnasium och är den enda av de fyra som aldrig kan komma
   automatiskt.
2. **Personligt tröskelpulsband** i stället för klockans zoner (skärper P1.3).
3. **Träningsblock som tidsenhet** i stället för godtyckliga 12/26/52 veckor
   (nytt förslag P1.5).
4. **Upprepbarhet är målet, inte topparna** — samma sak som Lovisa Lindh säger
   om kontinuitet (2.1). Två av Sveriges bästa säger samma sak oberoende av
   varandra, vilket gör det till den starkaste signalen i hela researchen.

### 2.4 Monitorering: avvikelse från egen baslinje, inte absoluta tal

En studie på elittyska distanslöpare på höghöjdsläger mätte dagligen vilopuls,
kroppsvikt, sömn- och kroppsupplevelse, syremättnad och kreatinkinas. Regeln
var konkret: **om två eller fler stressmarkörer ligger utanför idrottarens egna
normalintervall sänks belastningen i nästa pass.**
([PMC4926021](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4926021/))

För HRV är enskilda dagsvärden brus. Det som används är 7-dagars rullande
snitt mot en längre baslinje, **plus variationskoefficienten (CV)**: stabil
baslinje men stigande CV = stressen ackumuleras, ofta tidigare varning än
baslinjen själv. Kollapsande CV (onaturligt stabilt runt baslinjen) kan tvärtom
signalera non-functional overreaching.
([Elite HRV](https://elitehrv.com/improving-hrv-data-interpretation-coefficient-variation))

**Konsekvens:** visa aldrig ett rått HRV-tal som en bedömning. Visa avvikelse
mot personlig baslinje, och kräv 2+ samtidiga avvikelser innan appen säger
något.

### 2.5 Sömn är den starkaste enskilda skadefaktorn

Löpare med kort och dålig sömn hade **1,78 gånger högre sannolikhet** att
rapportera skada, motsvarande 68 % risk att skadas inom ett år.
([Runner's World SE](https://test.runnersworld.se/blogg/somn-mer-an-bara-aterhamtning/))
Mycket höga träningsbelastningar är i sin tur kopplade till minskad tid i säng,
kortare total sömn och mindre REM — det går alltså åt båda hållen.
([PMC11209026](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11209026/))

### 2.6 ACWR — användbart, men inte som sanning

Acute:Chronic Workload Ratio (senaste 7 dagar / snitt senaste 28) med
"sweet spot" 0,8–1,3 är populärt men kritiserat: sambanden var korrelationella,
författarna har själva ångrat ordet "predicts", och studier visar idrottare som
upprepat passerat 1,5 utan att skadas.
([Science for Sport](https://www.scienceforsport.com/acutechronic-workload-ratio/),
[Sports Injury Bulletin](https://www.sportsinjurybulletin.com/improve/the-acutechronic-workload-ratio--science-or-religion))

**Konsekvens:** bygg det, men som *en* signal bland flera och med synlig
osäkerhet. Aldrig en röd varning i sig själv.

### 2.7 Efficiency Factor — form utan att tävla

EF = hastighet / puls för ett pass. Stigande EF vid samma puls betyder att
formen förbättras. Aerob decoupling (EF första halvan vs andra halvan) under
5 % indikerar god aerob uthållighet. Känsligt för värme, stress och vätska —
kräver jämförbara förhållanden.
([TrainingPeaks](https://www.trainingpeaks.com/blog/efficiency-factor-and-decoupling/))

**Konsekvens:** går att räkna på befintlig data (snittfart + snittpuls) och ger
en formkurva mellan tävlingar. Filtrera hårt på passtyp och längd.

### 2.8 Träningsdagbokens tre fält

Svensk löpcoachning kokar ner dagboken till tre saker: **passtyp** (så
specifikt som möjligt), **tid** (viktigare än km), och **känsla** (var kroppen
pigg eller trött). Nyttan är att hitta samband mellan träning och skador, och
att kunna gå tillbaka och återfinna vad som fungerade inför en lyckad
formtoppning.
([Marathon.se](https://www.marathon.se/lopningen/traning/skriv-traningsdagbok-och-bli-en-battre-lopare))

Alices egen dagbok har passtyp och tid i överflöd — men känslan finns bara som
fritext, aldrig som något mätbart.

### 2.9 Kvinnlig idrottare: energitillgänglighet är överordnat

För en ung kvinnlig medeldistanslöpare är RED-S (relativ energibrist) den
enskilt största hälso- och prestationsrisken. Viktig nyans från forskningen:
regelbunden mens är **inte** en tillräcklig kontroll — subkliniska
ägglossningsstörningar förekommer hos idrottare som rapporterar 9+ blödningar
per år, och för den som använder hormonella preventivmedel säger cykeln
ingenting alls om energitillgängligheten.
([ScienceDirect](https://www.sciencedirect.com/science/article/pii/S2667268524001281),
[Frontiers](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2026.1776533/full))

**Konsekvens:** om detta byggs får det aldrig bli en grön bock som invaggar i
trygghet. Se P3.1 — och behandla det som stöd för samtal med tränare/läkare,
aldrig som bedömning.

---

## 3. Prioriteringsordning

```
P0  Fundament — utan detta kan inga insikter beräknas
    P0.1  Backfill sömn/HRV-historik          ← största blockeraren
    P0.2  Lap-/intervalldata
    P0.3  Mappa fält som redan finns i raw_data   ← billigast, gör först
    P0.3b Laktat + personligt tröskelband (manuell inmatning)
    P0.4  Daglig subjektiv check-in

P1  Kombinerade grafer — det som efterfrågats
    P1.1  Belastning vs återhämtning (huvudgrafen)
    P1.2  Baslinjeavvikelse & dagsstatus
    P1.3  Intensitetsfördelning
    P1.4  Formkurva (Efficiency Factor)
    P1.5  Träningsblock som tidsenhet          ← Almgrens sexveckorsstruktur

P2  Djupare analys
    P2.1  Passkvalitet för nyckelpass
    P2.2  Dagbokstext → strukturerad data     ← ger retroaktiv historik
    P2.3  Tävlings- och formtoppningsanalys
    P2.4  Skade-/sjukdomstidslinje

P3  Känsligt / avancerat
    P3.1  Menscykel & energitillgänglighet
    P3.2  AI-insikter (kostar tokens — sist)
```

Bygg **P0.3 först** (ren mappning, ingen ny integration), sedan **P0.1**
(annars står allt annat still), sedan P1.1.

---

## P0.1 — Backfill av sömn- och HRV-historik

**Problem.** `daily_metrics` täcker 34 dagar. Dagboken täcker 287 dagar, helt
utanför det fönstret. Ingen kombinerad insikt är möjlig förrän detta löses.

**Varför det ser ut så.** `web/api/index.py` har `SLEEP_SYNC_DAYS = 7` och
`FIRST_SLEEP_SYNC_DAYS = 30`, medvetet lågt satt: Garmins sömn-endpoint tar
**ett anrop per dag**, så ett års backfill = 365 anrop, vilket enligt
`docs/garmin-api.md` nästan säkert triggar rate-limiting/429.

**Lösning: fristående CLI-script, inte en app-endpoint.**

Skapa `scripts/backfill_metrics.py` enligt samma mönster som
`scripts/sync_garmin.py`:

- Argument: `--user-id`, `--from YYYY-MM-DD`, `--to YYYY-MM-DD`, `--sleep-seconds 2`
- Hämtar per dag: `get_sleep_data(date)` + `get_hrv_data(date)`
- Idempotent upsert mot `daily_metrics` på `(user_id, metric_date)` — kan köras
  om utan dubbletter
- Hoppar över datum som redan finns, om inte `--force`
- Skriver framsteg per dag så avbrott går att återuppta
- **Kör lokalt, inte på Vercel** (5 min-gränsen räcker inte)

Rate-limiting: 1,5–3 s paus mellan anrop, kör i block om ~60 dagar, och avbryt
med tydligt fel vid första 429 i stället för att fortsätta hamra.

**Realistisk förväntan:** Garmin sparar inte nödvändigtvis sömndata lika långt
bak för alla konton, och `garth` är övergivet av sin underhållare (se
`docs/garmin-api.md`). Räkna med att backfill kan misslyckas delvis. Scriptet
ska rapportera hur många dagar som faktiskt hämtades, inte påstå framgång.

**Klart när:** `daily_metrics` täcker minst hela dagboksperioden, och
korrelationskorten på `/trends` visar riktiga tal i stället för
"För lite data ännu".

---

## P0.2 — Lap- och intervalldata

**Problem.** `activity_splits` är tom. Intervallpassen har 15, 26 och 45 varv.
För en medeldistanslöpare *är* intervalltiderna träningen — "74-72 på
400ingarna" är det som avgör om formen går åt rätt håll. Appen ser i dag bara
passets snitt, vilket för ett intervallpass är en meningslös siffra (snittet
blandar löpning och vila).

**Lösning.** Nytt steg i synken: för aktiviteter med `lapCount > 1`, hämta
`client.get_activity_splits(activity_id)` och skriv till `activity_splits`.

Schema-tillägg (ny migration):

```sql
alter table activity_splits
  add column split_type text,        -- 'active' | 'rest' | 'other'
  add column max_hr integer,
  add column avg_cadence numeric,
  add column avg_power numeric;
```

**Fallgropar:**

1. **Ett extra API-anrop per aktivitet.** Med 666 aktiviteter blir en backfill
   dyr. Gör den i ett CLI-script (samma mönster som P0.1), och i den löpande
   synken bara för nya aktiviteter med `lapCount > 1`.
2. **Varv ≠ intervall.** Garmin-varv inkluderar uppvärmning, vila och nerjogg.
   Klassificera varv som "aktivt" respektive "vila" — enklast via varvets fart
   relativt passets median, inte via varvnummer.
3. **Autolap förstör allt.** Om klockan är inställd på autolap per km blir
   varven kilometermarkeringar, inte intervaller. Använd
   `hasIntensityIntervals` för att skilja riktiga intervallpass från autolap.

**Klart när:** ett intervallpass i dagvyn visar en varvtabell med aktiva varv
markerade, och P2.1 kan bygga vidare på den.

---

## P0.3 — Mappa fält som redan finns i `raw_data`

**Gör detta först.** Ingen ny integration, ingen rate-limiting-risk, ingen ny
Garmin-inloggning. Bara en migration och utökad mappning i `_map_activity()`
i `web/api/index.py` — plus ett engångsskript som fyller i historiken från
`raw_data` som redan ligger i databasen för alla 666 aktiviteter.

```sql
alter table activities
  add column avg_power numeric,
  add column norm_power numeric,
  add column avg_ground_contact_time numeric,   -- ms
  add column avg_vertical_oscillation numeric,  -- cm
  add column avg_vertical_ratio numeric,        -- %
  add column avg_gap_seconds_per_km numeric,    -- gradjusterad fart
  add column fastest_1k_seconds numeric,
  add column body_battery_drain integer,
  add column moderate_intensity_minutes integer,
  add column vigorous_intensity_minutes integer;
```

Källfält i `raw_data`: `avgPower`, `normPower`, `avgGroundContactTime`,
`avgVerticalOscillation`, `avgVerticalRatio`, `avgGradeAdjustedSpeed` (m/s →
sek/km), `fastestSplit_1000`, `differenceBodyBattery`,
`moderateIntensityMinutes`, `vigorousIntensityMinutes`.

**Varför just dessa är värda något:**

- **GAP** gör kuperade och platta pass jämförbara — utan det är all
  fartutveckling över tid delvis brus från terrängval.
- **`fastestSplit_1000`** är en gratis formkurva: snabbaste kilometern i varje
  distanspass över en säsong.
- **Body Battery-tapp** är Garmins egen skattning av vad passet kostade — bra
  komplement till `training_load`, som bara mäter det som gjordes.
- **Löpteknik (GCT, vertikal oscillation)** förändras mätbart vid trötthet och
  är intressant just runt hårda veckor.

**Fallgrop:** vissa fält är `null` för äldre aktiviteter och för pass loggade
med annan klocka. Allt måste vara nullable, och UI får aldrig anta att de finns.

**Klart när:** kolumnerna är fyllda retroaktivt för alla aktiviteter där
`raw_data` innehåller värdet.

---

## P0.3b — Laktat & personligt tröskelband

**Varför.** Almgrens fyra mätvärden är fart, laktat, puls, känsla (2.3).
Laktat är det enda som aldrig kan komma automatiskt från en klocka — men det är
också det som gör intensitetsstyrningen exakt i stället för ungefärlig.
Laktattest förekommer på friidrottsgymnasium och i testverksamhet, och de
värdena hamnar i dag ingenstans.

**Schema:**

```sql
create table lactate_readings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  activity_id uuid references activities(id) on delete set null,
  measured_at timestamptz not null,
  lactate_mmol numeric not null,          -- t.ex. 2.8
  pace_seconds_per_km numeric,            -- farten mätvärdet togs vid
  heart_rate integer,
  context text,                           -- 'test' | 'workout' | 'race'
  note text
);

-- Personligt kalibrerade trösklar, inte klockans zoner
alter table profiles
  add column lt1_hr integer,              -- aerob tröskel, slag/min
  add column lt2_hr integer,              -- anaerob tröskel
  add column threshold_hr_low integer,    -- Almgren: 167
  add column threshold_hr_high integer,   -- Almgren: 178
  add column max_hr integer;
```

**UX:** enkel inmatning från passets dagvy ("lägg till laktatvärde") — fart,
puls, mmol. Flera värden per pass ska gå att lägga in (det är så ett
laktattest fungerar: stegrande fart, ett stick per steg).

**Insikten det låser upp:** laktat–fart-kurvan över tid. Samma fart vid lägre
laktat = förbättrad tröskelkapacitet. Det är det mest direkta måttet på om
tröskelträningen ger effekt, och det Bakkens hela modell bygger på (2.2).

**Fallgrop:** med få mätvärden blir kurvan brus. Visa punkter, inte en
självsäker trendlinje, förrän det finns minst tre tester.

---

## P0.4 — Daglig subjektiv check-in

**Problem.** `rpe`, `mood`, `soreness` är null i alla 268 rader. Utan subjektiv
data finns ingen "hur kändes det"-axel att korrelera mot — bara fritext.

**Insikt om varför fälten aldrig fylldes:** de sitter i ett formulär inne på
dagvyn (`calendar/[year]/[month]/[day]`), bakom flera klick, blandat med
redigering av dagbokstext. Det blir aldrig gjort. Lösningen är inte fler fält
utan **radikalt lägre friktion**.

**UX-krav:**

- Check-in ska ta **under 15 sekunder** och gå att göra med tummen
- Placeras överst på startsidan/kalendern när dagens är ogjord — inte bakom
  navigering
- Skalor 1–5, inte 1–10. Tryckbara knappar med färg och ord, inte sifferfält
  eller slider. (RPE 1–10 är standard i litteraturen, men fylls i sämre av en
  17-åring varje dag än en 5-gradig skala som faktiskt blir gjord.)
- Fält: **känsla i kroppen**, **upplevd ansträngning i dagens pass**,
  **muskelömhet**, **motivation/ork**. Fyra tryck, klart.
- Bekräftelse ska visa något direkt tillbaka — t.ex. "3:e dagen i rad" eller
  var värdet ligger mot senaste veckan. Belöning driver ifyllnad.

**Schema:** utöka `diary_entries` (fälten finns delvis) hellre än ny tabell —
unik constraint på `(user_id, entry_date)` finns redan och gör upsert enkel.

```sql
alter table diary_entries
  add column feeling smallint check (feeling between 1 and 5),
  add column motivation smallint check (motivation between 1 and 5),
  add column soreness_level smallint check (soreness_level between 1 and 5);
```

Behåll `rpe` (1–10) som det är men mata den från en 5-gradig knapprad ×2.

**Fallgrop:** börja inte samla subjektiv data *och* be om det retroaktivt.
Retroaktiv historik löses i stället av P2.2 (textparsning).

---

## P1.1 — "Belastning vs återhämtning": huvudgrafen

Det här är den kombinerade grafen som efterfrågats. En vy, fyra datakällor,
tänkt att vara appens startsida på sikt.

**Design:**

```
 Belastning & återhämtning            [12 v] [26 v] [52 v]
 ┌──────────────────────────────────────────────────────┐
 │  ███                    ███                          │  ← staplar: veckans
 │  ███ ███      ███       ███ ███                      │    träningsload,
 │  ███ ███ ███  ███  ███  ███ ███ ███                  │    stackad per kategori
 │ ~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~      │  ← HRV, 7d rullande
 │ ------------------------------------------------     │  ← vilopuls
 │ ░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░      │  ← sömn (band)
 │        ▲sjuk              ▲tävling      ▲skada        │  ← händelsemarkörer
 └──────────────────────────────────────────────────────┘
```

**Konkret:**

- **Staplar (vänster y-axel):** summa `training_load` per vecka, stackad per
  `category` med befintliga färger från `web/src/lib/categories.ts`. Använd
  `training_load`, inte km — km jämför inte intervaller med långpass rättvist.
- **Linje 1 (höger y-axel):** HRV, 7-dagars rullande snitt. Rita **baslinjeband**
  (±1 SD över 60 dagar) som svagt fält bakom linjen — det är avvikelsen som
  betyder något, inte nivån.
- **Linje 2:** vilopuls, samma princip.
- **Band längst ned:** sömn per natt, färgat mot personligt snitt.
- **Markörer på tidsaxeln:** `day_type = 'sick' | 'injured'` från
  `diary_entries` och `category = 'race'` från `activities`. Det är dessa som
  gör grafen till en insikt i stället för en dashboard — man ser direkt vad
  som föregick varje avbrott.

**Interaktion:** hovra/tryck på en vecka → panel med veckans siffror,
förändring mot föregående vecka, och dagbokens egna ord den veckan (`notes`).
Kopplingen mellan siffra och Alices egen text är hela poängen.

**Almgrens fyra axlar som designmål (2.3):** *fart, laktat, puls, känsla*.
Grafen ovan täcker puls (via HRV/vilopuls) och belastning. Bygg den så att
**fart** (P1.4/formkurvan), **laktat** (P0.3b) och **känsla** (P0.4/P2.2) kan
tändas och släckas som egna serier i samma vy. Fyra serier samtidigt blir
oläsligt — lösningen är växlingsbara lager med max 2–3 aktiva, inte att välja
bort tre av dem permanent.

**Implementationsnoter:**

- Befintliga chart-komponenter (`BarChart`, `LineChart`) är enkelserie och
  klarar inte dubbla y-axlar eller stacking. Antingen utöka dem eller bygg en
  ny `ComboChart` i samma stil (ren SVG, inga externa bibliotek — matcha
  befintligt mönster i `web/src/components/charts/`).
- Läs `dataviz`-skillen innan diagramkod skrivs.
- Dubbla y-axlar är visuellt vilseledande om de skalas godtyckligt — förankra
  återhämtningsaxeln i baslinjen, inte i min/max.
- **Luckor får aldrig interpoleras.** `LineChart` bryter redan linjen vid
  `null` — behåll det beteendet. Med 34 dagars sömndata är luckor normalfallet.

---

## P1.2 — Baslinjeavvikelse & dagsstatus

**Problem.** Ett HRV-tal på 77 ms betyder ingenting utan Alices egen historik.

**Lösning.** Ett statuskort som svarar på en fråga: *avviker något från ditt
normala just nu?*

Beräkning per markör (HRV, vilopuls, sömnlängd, sömnpoäng, subjektiv känsla):

1. Baslinje = rullande 60-dagars median
2. Normalintervall = ±1 SD
3. Dagens värde = 7-dagars rullande snitt (inte enskild dag)
4. Flagga om utanför intervallet
5. Räkna även **CV över 7 dagar** — stigande CV är tidig varning även när
   baslinjen ser stabil ut (se 2.4)

**Regeln, direkt från forskningen:** **2+ markörer utanför normalintervall →
föreslå sänkt belastning.** En markör = information, inte varning.

**UI:**

```
 Dagens status              Allt inom ditt normala
 ─────────────────────────────────────────────────
 HRV        76 ms   ●  normalt (baslinje 74)
 Vilopuls   52      ●  normalt (baslinje 53)
 Sömn       7h05    ▲  under ditt snitt (7h40)
 Känsla     —       ○  ingen check-in idag
```

**Språkkrav:** appen ska aldrig säga "du är övertränad" eller ge diagnos. Den
säger vad som avviker och överlåter slutsatsen. Formulering i stil med
*"Två av dina markörer ligger under ditt normala den här veckan — värt att
titta på inför morgondagens pass."*

**Fallgrop:** kräv minst 30 dagars historik innan baslinjen visas. Innan dess:
"Bygger baslinje — {n} av 30 dagar." Att flagga avvikelser mot en baslinje på
fem dagar är rent brus.

---

## P1.3 — Intensitetsfördelning

**Detta går att bygga i dag, utan ny data.** `hr_zone_1..5_seconds` finns redan
på alla aktiviteter.

**Insikt:** medeldistansträning handlar mindre om hur mycket och mer om
*fördelningen*. Norska modellen: ~23–25 % av volymen på/över tröskel, resten
tydligt lugnt (se 2.2). Det vanligaste felet hos ambitiösa juniorer är att de
lugna passen blir för snabba och tröskelpassen för hårda — allt hamnar i mitten.

**UI, tre delar:**

1. **Stackad area över tid** — % av veckans tid per HR-zon, 52 veckor. Visar
   om fördelningen förändras genom säsongen (den *ska* göra det: mer volym på
   hösten, mer intensitet mot tävling).
2. **Donut för vald period** med målmodell bredvid. Inte "rätt/fel" — visa
   faktisk fördelning mot en vald modell (pyramidal / polariserad / norsk) och
   låt användaren välja modell.
3. **"Mittenzonen"-varning:** andel tid i zon 3 som varken är lugnt eller
   tröskel. Stiger den över tid är det ofta första tecknet på att lugna pass
   blivit för snabba.

**Fallgrop (den viktigaste i hela dokumentet):** HR-zoner är bara meningsfulla
om maxpuls/tröskelpuls är rätt satt. Garmins zoner är en gissning från ålder
och autodetektion. Almgren styr mot ett **personligt kalibrerat band, 167–178**
(2.3) — inte mot "zon 4".

Använd därför `threshold_hr_low` / `threshold_hr_high` från P0.3b som primär
zonindelning så snart de är ifyllda, och fall tillbaka på Garmins zoner först
när de saknas. Visa alltid vilka gränser som används och gör dem redigerbara.
Utan detta mäter hela grafen klockans gissning snarare än Alices fysiologi.

---

## P1.4 — Formkurva (Efficiency Factor)

**Insikt:** man vill veta om formen går åt rätt håll *mellan* tävlingar.
EF = hastighet ÷ snittpuls. Stiger den vid samma puls går formen åt rätt håll.

**Beräkning:**

```
EF = (distans_m / duration_s) / avg_hr        // m/s per slag
```

Filtrera hårt — annars blir kurvan brus:

- Endast `category IN ('easy', 'long_run')` — jämför aldrig intervaller
- Minst 20 minuter
- `avg_hr` måste finnas
- Använd **GAP** i stället för rå fart när P0.3 är på plats (kuperat vs platt)

**UI:** scatter med en punkt per pass + rullande trendlinje (t.ex. 4-veckors
median). Tävlingsresultat som markörer på samma tidsaxel — då syns det direkt
om stigande EF faktiskt föll ut i resultat.

**Fallgrop (viktig):** EF påverkas kraftigt av värme, uttorkning, stress och
höjd. En dipp i juli är sannolikt väder, inte form. Skriv ut den brasklappen i
UI:t, och överväg att markera pass över ~20 °C annorlunda om temperatur finns
i `raw_data`.

**Bonus, nästan gratis:** plotta `fastest_1k_seconds` (P0.3) över tid som
komplement — snabbaste kilometern i varje distanspass, ett rått mått som inte
alls beror på puls.

---

## P1.5 — Träningsblock som tidsenhet

**Insikt.** `/trends` erbjuder i dag 12 / 26 / 52 veckor — godtyckliga fönster
som inte motsvarar hur träning faktiskt planeras. Almgren beskriver i stället
sexveckorsblock med fast struktur inom blocket (2.3), och `plan_phases` finns
redan i schemat men är oanvänt.

Frågan en idrottare vill ha svar på är inte "hur såg de senaste 26 veckorna
ut" utan **"hur gick grundperioden jämfört med förra året, och var jag
konsekvent inom den?"**

**Lösning.** Låt användaren definiera block (namn, startdatum, slutdatum,
fokus) — återanvänd `plan_phases` i stället för ny tabell. Varje graf i P1
ska kunna växla mellan rullande fönster och blockvy.

**Två blockspecifika mått som inte finns någon annanstans:**

1. **Konsekvens inom blocket** — variationskoefficienten för veckobelastning
   inom blocket. Låg CV = jämn träning, vilket är själva poängen med Almgrens
   *"quite consistent within that period"*. Hög CV = ryckig träning, ofta
   tecken på sjukdom, skola eller överambition.
2. **Blockjämförelse** — samma blocktyp mellan säsonger sida vid sida
   (grundperiod 25/26 vs 26/27): volym, intensitetsfördelning, sömn,
   skadedagar, och vad det gav i tävling efteråt.

**UI:** blockväljare överst på `/trends` med tidslinje av block, plus ett
jämförelseläge som lägger två block bredvid varandra.

**Fallgrop:** kräv inte att block definieras i förväg för att appen ska
fungera. Föreslå block automatiskt ur datan (t.ex. via `day_type`-mönster och
volymskiften) och låt användaren justera — annars blir funktionen aldrig
använd, precis som `planned_workouts` (2 rader).

---

## P2.1 — Passkvalitet för återkommande nyckelpass

**Förutsätter P0.2.**

**Insikt:** Alice kör återkommande nyckelpass ("10x400m", "5x1000m",
"1600m tröskel + 3x500m"). Frågan som betyder något är: *går samma pass
snabbare nu än för tre månader sedan, vid samma eller lägre puls?*

**Lösning:** gruppera intervallpass på en **passignatur** — antal aktiva varv +
ungefärlig distans per varv (t.ex. `10×400m`). Signaturen räknas fram ur
`activity_splits`, inte ur passets namn (namnen är inkonsekventa).

**UI:** lista över återkommande signaturer med antal genomföranden. Klick →
diagram med ett spår per genomförande (x = varvnummer, y = varvtid), färgat
efter datum. Då syns både utveckling över tid och hur passet höll ihop internt
— om varv 8–10 rasar är det uthålligheten som brister, inte farten.

**Koppling till dagboken:** visa Alices egen kommentar för passet bredvid
kurvan. Hennes text ("kändes lätt", "fick dra själv och blåste väldigt mycket")
förklarar ofta avvikelser som datan annars gör till en falsk trend — blåst och
att dra ensam är den vanligaste förklaringen i hennes egen dagbok.

---

## P2.2 — Dagbokstext → strukturerad data

**Det här är den smartaste kvarvarande möjligheten.** 253 dagboksdagar
innehåller redan strukturerad information, men som svensk fritext.

Exempel ur `session_log`:

```
"1600m tröskel /3min vila + 3x500m/1min vila + 2x400m/30sek vila
 3.55 på tröskeln, 1.35-1.35-1.37 på 500ingarna, 72 och 77 på 400ingarna"
```

Och ur `notes`:

```
"Helt okej känsla men gick inte så snabbt på grund av vinden."
"Kändes väldigt lätt och bra"
"Kände mig typ orkeslös och som att jag inte hade någon energi"
```

**Detta är den enda vägen till subjektiv historik för 2025–2026.** P0.4 ger
data framåt; textparsning ger 253 dagar bakåt.

**Två extraktioner:**

1. **Intervalltider** — regex mot mönster som `3.55`, `1.35-1.35-1.37`,
   `72 och 77`, `53-55`. Ger faktiska passtider även för perioden innan
   lap-synken fanns, och för pass som kördes utan klocka.
2. **Känsloindex** — nyckelordsmatchning mot ordlistor:
   - positivt: *lätt, bra, pigg, stark, kändes bra, rullade på, kul*
   - negativt: *tungt, trött, seg, orkeslös, stel, död, väggade, ont*
   - hälsoflagga: *sjuk, förkyld, skada, stukade, ont i*
   Poäng per dag → tidsserie som kan korreleras mot belastning och sömn precis
   som RPE.

**Fallgropar:**

- **Negationer och förstärkare.** "kändes *inte* bra", "*väldigt* trött".
  Enkel ordlista räcker inte — hantera minst negation inom några ord, och
  intensifierare (*väldigt, ganska, lite*) som vikt.
- **Färgkodningen är redan gjord åt er.** I PDF-importen skildes idrottarens
  egna ord (`notes`) från träningsloggen (`session_log`) och tränarens
  kommentarer (`coach_notes`) via textfärg. Kör känsloanalysen **bara på
  `notes`** — `session_log` är faktatext och `coach_notes` är någon annans röst.
- **Validera mot verkligheten.** Ta 20 slumpade dagar, poängsätt för hand, och
  jämför. Ett känsloindex som inte stämmer är värre än inget, eftersom det
  sedan korreleras vidare.
- Regelbaserat räcker och kostar inget. Använd inte en språkmodell här — se
  P3.2.

---

## P2.3 — Tävlings- och formtoppningsanalys

**Insikt:** den fråga en tävlingsidrottare faktiskt vill ha svar på är *"vad
gjorde jag inför mina bästa lopp?"* — precis den nytta svensk löpcoachning
lyfter fram med dagbok (se 2.8).

**Lösning:** för varje `category = 'race'`, bygg en profil över de föregående
21 dagarna: belastning per vecka, intensitetsfördelning, sömnsnitt,
HRV-trend, antal vilodagar, senaste hårda passet före loppet.

**UI:** tävlingar listade med resultat (från `notes`/`session_log` eller
manuellt inmatat). Välj två lopp → jämför upptrappningen sida vid sida.

**Nödvändigt tillägg:** tävlingsresultat finns i dag bara som text i dagboken
("2000m hinder: 7.31 sb"). Lägg till en enkel `race_results`-tabell (distans,
tid, placering, bana/terräng, `activity_id`) — annars går resultat inte att
sortera eller jämföra.

**Fallgrop:** med ~10 lopp per säsong är detta beskrivande, inte statistiskt.
Presentera som "så här såg det ut" — aldrig som "detta gör att du presterar".

---

## P2.4 — Skade- och sjukdomstidslinje

**Insikt:** `day_type` innehåller redan `sick` och `injured`. Den kombinerade
grafen (P1.1) visar dem — den här vyn vänder på frågan: *vad hände 7–14 dagar
före varje avbrott?*

**UI:** lista över alla sjuk-/skadeperioder med, för varje: belastning veckorna
innan, ACWR vid insjuknandet, sömn de föregående 10 dagarna, HRV-trend,
dagbokens egna ord dagarna innan.

**Kontinuitetsmätare (rekommenderad huvudsiffra):** längsta sammanhängande
period utan sjuk/skadad-dag, och nuvarande svit. Det ligger närmast det Lovisa
Lindh pekar ut som avgörande (2.1) och är begripligare än ACWR.

**Upprepbarhet — den siffra båda svenska källorna pekar mot.** Lindh säger
kontinuitet, Almgren säger att målet inte är att köra hårt en gång utan att
kunna upprepa kvalitet vecka efter vecka (2.1, 2.3). Gör det mätbart:
*antal veckor i rad med minst X kvalitetspass genomförda*, där ett
kvalitetspass är `category IN ('threshold','interval','repetition')`. En svit
som bryts säger mer om vad som gick fel än någon enskild belastningssiffra.

Almgrens egen historik är själva argumentet: 2016–2019 upprepade
stressrelaterade skador, därefter dubbelt så hög volym vid lägre intensitet —
och både skadefrihet och bättre resultat. Det är volymens *fördelning*, inte
dess storlek, som avgjorde.

**Om ACWR:** implementera med EWMA, visa 0,8–1,3-bandet, men **märk grafen med
osäkerheten** (2.6). Aldrig ensam grund för en varning.

---

## P3.1 — Menscykel & energitillgänglighet

**Detta är, för en ung kvinnlig medeldistanslöpare, sannolikt den största
enskilda hälso- och prestationsfaktorn i hela dokumentet.** Det är också det
känsligaste och ska byggas sist, med störst omsorg.

**Vad som är värt att logga:** cykelstart (en knapptryckning), och som frivilligt
tillägg symtom. Kombinerat med befintlig data ger det: cykelfas mot känsla,
mot sömn, mot HRV, mot passkvalitet — mönster som annars framstår som slumpvis
dåliga veckor.

**Varningssignaler att kunna se samlat** (aldrig som automatisk diagnos):
uteblivna eller glesnande blödningar, stigande vilopuls kombinerat med fallande
HRV över veckor, försämrad sömn, sjunkande passkvalitet trots bibehållen
träning, upprepade benhinne-/stressrelaterade besvär i dagbokstexten.

**Absoluta krav:**

- **Opt-in.** Funktionen ska inte finnas i UI:t förrän den slås på.
- **Striktare RLS än övriga tabeller** — egen tabell, endast användaren själv,
  aldrig delad med tränarvy om sådan byggs.
- **Aldrig grön bock.** Regelbunden mens utesluter inte energibrist (se 2.9) —
  en "allt ser bra ut"-signal vore direkt skadlig här.
- Formuleringar som stödjer samtal med tränare/läkare, inte ersätter dem.
- Tydlig text om att appen inte gör medicinska bedömningar.

**Rekommendation:** bygg första versionen som ren loggning + visning i
tidslinjen, helt utan tolkning eller flaggor. Låt mönstren vara synliga för
Alice och hennes tränare att tolka själva.

---

## P3.2 — AI-insikter (sist, och med kostnadsförbehåll)

`reference_documents` och `document_chunks` (pgvector) finns redan i schemat
men är oanvända — tanken var RAG mot referensmaterial.

**Kostnadsförbehållet är styrande:** PDF-importen togs bort just för att slippa
löpande Anthropic-kostnad för något som görs sällan. Samma logik gäller här.

**Om det byggs:** gör det som en **manuell backend-körning**, inte en
app-funktion — t.ex. en säsongssammanfattning som kombinerar siffror och
dagbokstext, körd några gånger per år på samma sätt som dagboksimporten gjordes.
Inte en knapp i appen som kan tryckas i en loop.

**Bygg inte detta förrän P0–P2 är på plats.** En språkmodell som sammanfattar
tunn data producerar självsäkra påståenden om brus. Med backfillad sömnhistorik,
lap-data och ett validerat känsloindex finns det däremot något verkligt att
sammanfatta.

---

## 4. Sammanfattande rekommendation

Fyra saker avgör om det här lyfter eller inte:

0. **Almgrens fyra mätvärden är kravspecifikationen.** *Fart, laktat, puls,
   känsla* (2.3). Appen har fart och puls. Bygger man inte känsla (P0.4, P2.2)
   och laktat (P0.3b) blir det en klockdashboard till — inte ett verktyg som
   säger något eliten inte redan ser i Garmin Connect.


1. **P0.1 är blockeraren.** Utan överlappande sömn-/HRV-historik är varje
   kombinerad graf tom. Gör den tidigt och acceptera att den kan misslyckas
   delvis — `garth` är ett övergivet bibliotek.

2. **P2.2 är den underskattade vinsten.** 253 dagar av Alices egna ord ligger
   redan i databasen. Textparsning är det enda sättet att få subjektiv
   historik bakåt, och det kostar ingenting i drift.

3. **Insikterna ska vara jämförande, inte absoluta.** Genomgående i
   forskningen (2.4) är det avvikelsen från idrottarens egen baslinje som
   betyder något — inte nivån. En app som säger "HRV 76" är en klockskärm.
   En app som säger "din HRV har legat under ditt normala i fem dagar samtidigt
   som sömnen kortats" är en tränare.

---

## Källor

- [Marathon.se — Lovisa Lindh om sin träning](https://www.marathon.se/lopningen/traning/lovisa-lindh-kanner-medvind-igen-efter-segern-i-inomhus-sm-sa-tranar-hon-just-nu)
- [Marathon.se — Skriv träningsdagbok och bli en bättre löpare](https://www.marathon.se/lopningen/traning/skriv-traningsdagbok-och-bli-en-battre-lopare)
- [COROS — Behind the training of Andreas Almgren](https://corosnordic.com/blogs/coros-stories/behind-the-training-of-andreas-almgren) *(de fyra mätvärdena, tröskelband 167–178, sexveckorsblock)*
- [Sweat Elite — Inside the mind and training regimen of Andreas Almgren](https://articles.sweatelite.co/inside-the-mind-and-training-regimen-of-swedish-distance-runner-andreas-almgren/) *(skadeperioden 2016–2019, dubbeltröskel från 2019)*
- [SVT — Hemligheten bakom Andreas Almgrens succélopp](https://www.svt.se/nyheter/vetenskap/hemligheten-bakom-andreas-almgrens-succelopp) *(forskarkommentarer + varningen att metoden inte är för alla)*
- [löpning.se — Hur tränar Andreas Almgren](https://xn--lpning-wxa.se/hur-tr%C3%A4nar-andreas-almgren) *(volymökning 110–120 → 190–200 km/vecka)*
- [Maratonlabbet #151 — Almgren om grundperioden med dubbeltröskel och cykelträning](https://maratonlabbet.podbean.com/e/151-andreas-almgren-om-grundperioden-med-dubbeltroskel-och-cykeltraning/)
- [Marius Bakken — The Norwegian model of lactate threshold training](https://www.mariusbakken.com/the-norwegian-model.html)
- [Norwegian double-threshold method — systematisk översikt](https://www.researchgate.net/publication/376465773_Norwegian_double-threshold_method_in_distance_running_Systematic_literature_review)
- [Load management in elite German distance runners (PMC4926021)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC4926021/)
- [Elite HRV — Coefficient of Variation](https://elitehrv.com/improving-hrv-data-interpretation-coefficient-variation)
- [Runner's World SE — Sömn, mer än bara återhämtning](https://test.runnersworld.se/blogg/somn-mer-an-bara-aterhamtning/)
- [Training loads and sleep in elite female players (PMC11209026)](https://www.ncbi.nlm.nih.gov/pmc/articles/PMC11209026/)
- [Science for Sport — Acute:Chronic Workload Ratio](https://www.scienceforsport.com/acutechronic-workload-ratio/)
- [Sports Injury Bulletin — ACWR: science or religion?](https://www.sportsinjurybulletin.com/improve/the-acutechronic-workload-ratio--science-or-religion)
- [TrainingPeaks — Efficiency Factor and Decoupling](https://www.trainingpeaks.com/blog/efficiency-factor-and-decoupling/)
- [RED-S och ägglossningsstatus hos uthållighetslöpare (ScienceDirect)](https://www.sciencedirect.com/science/article/pii/S2667268524001281)
- [Frontiers — Low energy availability, Female Athlete Triad och RED-S](https://www.frontiersin.org/journals/sports-and-active-living/articles/10.3389/fspor.2026.1776533/full)
