/* ---------------------------------------------------------------------------
 * P1.2 i docs/insikter-roadmap.md: avvikelse mot egen baslinje, inte råvärden.
 *
 * Ett HRV-tal på 76 ms betyder ingenting utan atletens egen historik. Det
 * genomgående mönstret i researchen (avsnitt 2.4) är att det är *avvikelsen*
 * från den egna normalnivån som bär information — inte nivån i sig.
 *
 * ── Regeln, direkt ur forskningen ─────────────────────────────────────────
 * Studien på elittyska distanslöpare på höghöjdsläger sänkte belastningen
 * först när **två eller fler** stressmarkörer låg utanför idrottarens eget
 * normalintervall. En markör är information, inte en varning. Den tröskeln
 * är hela poängen: ett system som larmar på enskilda dagsvärden blir brus
 * som man slutar lyssna på.
 *
 * ── Vad som medvetet INTE görs ────────────────────────────────────────────
 * Ingen diagnos, inget "du är övertränad", ingen sammanvägd hälsopoäng. En
 * enda siffra som påstår sig sammanfatta måendet döljer just det som är
 * intressant — vilken markör som rör sig. Appen säger vad som avviker och
 * överlåter slutsatsen till atleten och tränaren.
 * ------------------------------------------------------------------------ */

import { median, percentile, standardDeviation } from "@/lib/stats-utils";

/** Så lång historik som krävs innan en baslinje visas alls. Att flagga
 * avvikelser mot en baslinje byggd på några dagar är rent brus. */
export const MIN_BASELINE_DAYS = 30;

/** Baslinjen beskriver "det normala" och ska inte ryckas med av en enskild
 * sjukvecka — därav median och ett långt fönster. */
export const BASELINE_WINDOW_DAYS = 60;

/** Dagsvärden hoppar för mycket för att jämföras rakt av. Aktuellt läge är
 * ett snitt över den senaste veckan. */
export const CURRENT_WINDOW_DAYS = 7;

/* Normalintervallet uttrycks i percentiler av löparens egen historik, inte i
 * standardavvikelser (ändrat 2026-09-15).
 *
 * SD antar en symmetrisk fördelning, och det gjorde bandet fel åt två håll
 * samtidigt — uppmätt på produktionsdata:
 *
 *   Sömnpoäng är vänsterskev (median 86,5, p75 90, men p10 68,9 och tre
 *   nätter under 60). De dåliga nätterna blåste upp SD till 11,1, vilket
 *   gjorde normalbandet så brett att en vecka på 79,5 — löparens 25:e
 *   percentil — räknades som helt normal.
 *
 *   Vilopuls är tvärtom extremt stabil (SD 1,74 på en baslinje av 49,5).
 *   Den gamla färgregeln jämförde i stället kvoten mot en fast
 *   tioprocentsgräns, vilket krävde att vilopulsen steg till 55 — mer än tre
 *   standardavvikelser — innan kortet ens blev gult.
 *
 * Percentiler beskriver fördelningen som den faktiskt ser ut och anpassar sig
 * till varje markörs egen spridning. */
const WATCH_PERCENTILE = 0.25;
const CONCERN_PERCENTILE = 0.10;

/** Banden en markör kan hamna i. Riktningen är redan inbakad: "watch" betyder
 * alltid åt det sämre hållet, oavsett om markören vill vara hög eller låg. */
export type MarkerBand = "good" | "watch" | "concern";

export type StatusDirection = "higher_is_better" | "lower_is_better";

export type StatusMarkerSpec = {
  key: string;
  label: string;
  unit: string;
  direction: StatusDirection;
  /** Kort förklaring av vad markören säger, för den som inte kan förkortningen. */
  hint: string;
};

export const STATUS_MARKERS: StatusMarkerSpec[] = [
  {
    key: "hrv",
    label: "HRV",
    unit: "ms",
    direction: "higher_is_better",
    hint: "Hjärtats variation över natten. Faller ofta när belastning eller stress ackumuleras.",
  },
  {
    key: "restingHr",
    label: "Vilopuls",
    unit: "slag/min",
    direction: "lower_is_better",
    hint: "Stiger vid otillräcklig återhämtning, begynnande sjukdom eller stress.",
  },
  {
    key: "sleepHours",
    label: "Sömn",
    unit: "h",
    direction: "higher_is_better",
    hint: "Kort sömn är den enskilt starkaste kända skadefaktorn för löpare.",
  },
  {
    key: "sleepScore",
    label: "Sömnpoäng",
    unit: "",
    direction: "higher_is_better",
    hint: "Garmins sammanvägning av sömnens längd och kvalitet.",
  },
];

export type MarkerStatus = {
  spec: StatusMarkerSpec;
  /** Snitt över den senaste veckan. null när veckan saknar mätningar. */
  current: number | null;
  /** Medianen över baslinjefönstret. */
  baseline: number | null;
  /** Spridningen i baslinjefönstret. */
  sd: number | null;
  /* Avvikelse i SD-enheter. Positiv = över baslinjen, oavsett om det är bra.
   *
   * Driver INTE längre kortens färger — de går på percentilband sedan
   * 2026-09-15 (se WATCH_PERCENTILE). Fältet är kvar för att det fortfarande
   * är rätt mått på ANNAT håll: /arsoversikt visar HRV-läget veckan före ett
   * avbrott och /tavlingsresultat före ett lopp, och där är ett SD-tal ett
   * rimligt jämförbart mått mellan löpare och tillfällen. */
  deviation: number | null;
  /** Antal mätdagar bakom baslinjen — driver "bygger baslinje"-texten. */
  baselineDays: number;
  /** Vilket band nuläget hamnar i. null när baslinjen inte räcker. */
  band: MarkerBand | null;
  /** Värdet där gula bandet börjar — p25 för markörer där högre är bättre,
   * p75 för vilopuls. Visas i kortets detaljrader. */
  watchThreshold: number | null;
  /** Värdet där röda bandet börjar (p10 respektive p90). */
  concernThreshold: number | null;
  /** I röda bandet. Det är den här som räknas i 2.4-regeln. */
  isConcerning: boolean;
  /** Bättre än tre av fyra vanliga veckor. */
  isFavourable: boolean;
};

export type DailyStatus = {
  markers: MarkerStatus[];
  /** Markörer som avviker åt det sämre hållet. */
  concerning: MarkerStatus[];
  /** Sant när 2+ markörer avviker negativt — regeln ur 2.4. */
  shouldEaseOff: boolean;
  /** Antal markörer som har tillräckligt underlag för en bedömning alls. */
  evaluated: number;
};

/** En dags mätvärden. Alla fält valfria: luckor är normalfallet.
 *
 * `feeling` (känsla tolkad ur dagbokstexten, P2.2) fanns tidigare som en
 * femte markör här men togs bort 2026-07-28 — den var ofta tom (kräver en
 * dagbokstext att tolka) och dubblerade den då mycket tydligare manuella
 * incheckningen (P0.4). Incheckningen är i sin tur borttagen 2026-08-12 (för
 * sällan ifylld för att ge meningsfull data) och ersatt av Garmins egen
 * Känsla/Ansträngning-skattning per pass (activities.garmin_feel/garmin_rpe).
 * Den textbaserade tolkningen (P2.2) användes tidigare även i Trenders
 * korrelationskort, borttagna 2026-08-13 (visade inget relevant). */
export type DailyStatusInput = {
  date: string;
  hrv?: number | null;
  restingHr?: number | null;
  sleepHours?: number | null;
  sleepScore?: number | null;
};

function valuesInWindow(
  rows: DailyStatusInput[],
  key: keyof Omit<DailyStatusInput, "date">,
  fromDate: string,
): number[] {
  return rows
    .filter((r) => r.date >= fromDate)
    .map((r) => r[key])
    .filter((v): v is number => v != null);
}

/* Datumnyckeln byggs av de LOKALA fälten, inte via toISOString().
 *
 * Den gamla varianten tolkade "2026-09-15T00:00:00" som lokal midnatt och
 * serialiserade sedan i UTC. Öster om Greenwich ligger lokal midnatt före
 * UTC-midnatt, så svensk sommartid gav 2026-09-07 där 2026-09-08 avsågs —
 * varje fönster blev en dag för långt. Nuläget mätte 8 dagar i stället för 7
 * och baslinjen 61 i stället för 60, vilket räckte för att medianen skulle
 * skilja sig från samma beräkning gjord i SQL. */
function shiftDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/**
 * Beräknar dagsstatus för varje markör.
 *
 * `rows` behöver inte vara sorterade eller kompletta — luckor hoppas över,
 * aldrig interpoleras.
 *
 * `currentWindowDays` (default `CURRENT_WINDOW_DAYS`, dvs. senaste veckan)
 * låter anroparen byta ut "nu"-fönstret — /dashboard använder det för att
 * "nuläget" ska matcha den valda perioden (idag/7 dagar/månad/år) i stället
 * för att alltid vara låst till senaste veckan. Baslinjefönstret ändras
 * aldrig — det är referensen, inte det som visas.
 */
export function computeDailyStatus(
  rows: DailyStatusInput[],
  today: string,
  currentWindowDays: number = CURRENT_WINDOW_DAYS,
): DailyStatus {
  const baselineFrom = shiftDays(today, -BASELINE_WINDOW_DAYS);
  const currentFrom = shiftDays(today, -currentWindowDays);

  const markers: MarkerStatus[] = STATUS_MARKERS.map((spec) => {
    const key = spec.key as keyof Omit<DailyStatusInput, "date">;
    const baselineValues = valuesInWindow(rows, key, baselineFrom);
    const currentValues = valuesInWindow(rows, key, currentFrom);

    const baseline = median(baselineValues);
    const sd = standardDeviation(baselineValues);
    const current = currentValues.length ? median(currentValues) : null;

    // Utan tillräcklig historik går det inte att säga något meningsfullt om
    // avvikelse. Spridningen behöver däremot inte längre vara skild från noll:
    // med percentiler faller en helt konstant markör ut som "good" i stället
    // för att dividera med noll.
    const hasBaseline = baselineValues.length >= MIN_BASELINE_DAYS;

    // SD behövs inte längre för färgerna, men väl för de två analyser som
    // uttrycker HRV-läget i standardavvikelser. Noll spridning ger null i
    // stället för en division med noll.
    const deviation =
      hasBaseline && sd != null && sd > 0 && current != null && baseline != null
        ? (current - baseline) / sd
        : null;

    /* Gränserna vänds efter markörens riktning. För HRV och sömnpoäng ligger
     * det dåliga i vänstersvansen (p25/p10); för vilopuls i högersvansen, och
     * då är det p75/p90 som är gul respektive röd gräns. */
    const higher = spec.direction === "higher_is_better";
    const watchThreshold = hasBaseline
      ? percentile(baselineValues, higher ? WATCH_PERCENTILE : 1 - WATCH_PERCENTILE)
      : null;
    const concernThreshold = hasBaseline
      ? percentile(baselineValues, higher ? CONCERN_PERCENTILE : 1 - CONCERN_PERCENTILE)
      : null;

    let band: MarkerBand | null = null;
    if (current != null && watchThreshold != null && concernThreshold != null) {
      const beyond = (limit: number) => (higher ? current < limit : current > limit);
      band = beyond(concernThreshold) ? "concern" : beyond(watchThreshold) ? "watch" : "good";
    }

    /* Gynnsamt läge speglar gula bandet åt andra hållet — bättre än tre av
     * fyra vanliga veckor. */
    const favourableThreshold = hasBaseline
      ? percentile(baselineValues, higher ? 1 - WATCH_PERCENTILE : WATCH_PERCENTILE)
      : null;

    return {
      spec,
      current,
      baseline: hasBaseline ? baseline : null,
      sd: hasBaseline ? sd : null,
      deviation,
      baselineDays: baselineValues.length,
      band,
      watchThreshold,
      concernThreshold,
      /* "Utanför det normala" i 2.4-regeln är RÖDA bandet, inte gula. Gult
       * betyder "håll koll" och är information; skulle det räknas in skulle
       * varningen gå på var fjärde vecka per markör av ren slump, och ett
       * larm man får hela tiden slutar man lyssna på — vilket är precis det
       * modulens eget filhuvud varnar för. Röda bandet är den tiondel som
       * faktiskt sticker ut, alltså strängare än den gamla 1 SD-gränsen. */
      isConcerning: band === "concern",
      isFavourable:
        current != null && favourableThreshold != null
          ? (higher ? current >= favourableThreshold : current <= favourableThreshold)
          : false,
    };
  });

  const concerning = markers.filter((m) => m.isConcerning);

  return {
    markers,
    concerning,
    // Regeln ur 2.4: två eller fler markörer utanför normalintervallet.
    shouldEaseOff: concerning.length >= 2,
    evaluated: markers.filter((m) => m.band != null).length,
  };
}
