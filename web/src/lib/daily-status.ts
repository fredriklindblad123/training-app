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

import { median, standardDeviation } from "@/lib/stats-utils";

/** Så lång historik som krävs innan en baslinje visas alls. Att flagga
 * avvikelser mot en baslinje byggd på några dagar är rent brus. */
export const MIN_BASELINE_DAYS = 30;

/** Baslinjen beskriver "det normala" och ska inte ryckas med av en enskild
 * sjukvecka — därav median och ett långt fönster. */
export const BASELINE_WINDOW_DAYS = 60;

/** Dagsvärden hoppar för mycket för att jämföras rakt av. Aktuellt läge är
 * ett snitt över den senaste veckan. */
export const CURRENT_WINDOW_DAYS = 7;

/** Hur många standardavvikelser som räknas som utanför det normala. */
export const DEVIATION_THRESHOLD = 1;

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
  /** Avvikelse i SD-enheter. Positiv = över baslinjen, oavsett om det är bra. */
  deviation: number | null;
  /** Antal mätdagar bakom baslinjen — driver "bygger baslinje"-texten. */
  baselineDays: number;
  /** Utanför normalintervallet *och* åt det sämre hållet. */
  isConcerning: boolean;
  /** Utanför normalintervallet åt det bättre hållet. */
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
 * dagbokstext att tolka) och dubblerade den mycket tydligare manuella
 * incheckningen (P0.4, se DailyCheckIn) som nu visas som egna KPI-ringar på
 * /dashboard. Den textbaserade tolkningen lever kvar för sitt eget syfte i
 * /trends korrelationskort ("HRV ↔ känsla ur dagbokstext"). */
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

function shiftDays(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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

    // Utan tillräcklig historik, eller när spridningen är noll (allt exakt
    // lika — inträffar för t.ex. en konstant sömnpoäng), går det inte att
    // säga något meningsfullt om avvikelse.
    const hasBaseline = baselineValues.length >= MIN_BASELINE_DAYS && sd != null && sd > 0;
    const deviation =
      hasBaseline && current != null && baseline != null ? (current - baseline) / sd : null;

    const outside = deviation != null && Math.abs(deviation) >= DEVIATION_THRESHOLD;
    const worseDirection =
      deviation != null &&
      (spec.direction === "higher_is_better" ? deviation < 0 : deviation > 0);

    return {
      spec,
      current,
      baseline: hasBaseline ? baseline : null,
      sd: hasBaseline ? sd : null,
      deviation,
      baselineDays: baselineValues.length,
      isConcerning: outside && worseDirection,
      isFavourable: outside && !worseDirection,
    };
  });

  const concerning = markers.filter((m) => m.isConcerning);

  return {
    markers,
    concerning,
    // Regeln ur 2.4: två eller fler markörer utanför normalintervallet.
    shouldEaseOff: concerning.length >= 2,
    evaluated: markers.filter((m) => m.deviation != null).length,
  };
}
