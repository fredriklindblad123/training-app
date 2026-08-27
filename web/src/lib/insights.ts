import type { LoopPhase } from "./next-actions";
import type { InsightTone } from "@/components/InsightCard";

/* L3 i docs/tranarloopen.md: insiktsflödet.
 *
 * Problemet: appen visar 74 % tröskelandel. Den säger aldrig "det här har
 * stigit tre veckor i rad". Råa siffror kräver att man själv upptäcker
 * mönstret; en tränare pekar ut det.
 *
 * Reglerna nedan är alla jämförelser mot atletens **egen historik** — aldrig
 * mot ett externt riktvärde. Det är precis vad avsnitt 2.4 i
 * docs/insikter-roadmap.md säger att en insikt ska vara: "en app som säger
 * HRV 76 är en klockskärm; en app som säger att din HRV legat under ditt
 * normala i fem dagar är en tränare".
 *
 * **Ingen språkmodell.** P3.2 i samma roadmap slår fast att AI-insikter ska
 * vara manuella backend-körningar av kostnadsskäl, inte en funktion i appen.
 * Regelbaserat räcker gott för allt nedan.
 *
 * Två krav genomsyrar formuleringarna:
 *   - Aldrig kausalt. "Tröskelandelen har stigit" — aldrig "därför blev du
 *     trött". Samma krav som avbrottstidslinjen (K6) redan följer.
 *   - Ingen insikt enbart negativ. "Sömnen har legat under din baslinje fem
 *     dagar" är en observation; "din sömn är dålig" är en dom. Tonen
 *     "att-bevaka" betyder värt att hålla ögonen på, inte fel. */

export type Insight = {
  id: string;
  phase: LoopPhase;
  /** Påståendet, en mening. */
  headline: string;
  /** Siffran bakom, för den som fäller ut kortet. */
  detail: string;
  href: string;
  tone: InsightTone;
  /** Lägre = visas först. Bara MAX_INSIGHTS överlever klippet. */
  priority: number;
};

/**
 * Kortaste svit som får kallas en trend.
 *
 * Tre är golvet därför att två punkter är en linje, inte en trend — med två
 * veckor räcker en enda avvikande vecka för att skapa ett mönster som inte
 * finns. Samma resonemang som EfficiencyChartens `TREND_MIN_POINTS` och som
 * baslinjekravet i P1.2: hellre ingenting än ett självsäkert påstående om
 * brus.
 */
const MIN_STREAK_WEEKS = 3;

/** Motsvarande golv för dagsbaserade sviter (sömn). Fem dagar är kortare i
 * kalendertid men bygger på fem mätningar, alltså mer underlag än tre veckor
 * av veckoaggregat. */
const MIN_STREAK_DAYS = 5;

/** Över den här ökningen mot föregående vecka är volymsprånget värt att
 * nämna. 30 % är ingen vetenskaplig gräns — se kommentaren vid regeln. */
const VOLUME_JUMP_RATIO = 1.3;

/** Fler än så blir sidan en vägg igen, bara med ord i stället för diagram. */
export const MAX_INSIGHTS = 5;

export type InsightInput = {
  /** Alla fält är valfria: en sida skickar bara det den råkar ha hämtat, och
   * regler utan underlag hoppas tyst över i stället för att kräva att varje
   * sida hämtar allt. */
  /** Veckovisa EF-medianer i m/slag, kronologiskt. `null` = vecka utan pass
   * som klarar filtret — bryter en svit, fyller inte i den. */
  efWeekly?: (number | null)[];
  /** Andel av veckans pulstid på/över tröskel, 0–1, kronologiskt. */
  thresholdShareWeekly?: (number | null)[];
  /** Veckovis distans i km, kronologiskt. Sista värdet = senaste veckan. */
  distanceKmWeekly?: number[];
  /** Antal genomförda kvalitetspass per vecka, kronologiskt. */
  qualitySessionsWeekly?: number[];
  /** Kontinuitet (lib/continuity.ts). */
  continuity?: {
    currentWeeksWithoutInterruption: number;
    bestWeeksWithoutInterruption: number;
  };
  /** Antal dagar i rad sömnen legat under baslinjen, från P1.2. */
  sleepBelowBaselineDays?: number;
  /** Personbästa satta den senaste månaden. */
  recentPersonalBests?: { event: string; result: string; date: string }[];
};

/** Längden på den avslutande sviten av strikt stigande (eller strikt
 * fallande) värden. Luckor (`null`) bryter sviten — de fylls aldrig i, samma
 * princip som graferna följer för saknade mätningar. */
function trailingRun(values: (number | null)[], direction: "up" | "down"): number {
  const clean = values.slice();
  let run = 1;
  for (let i = clean.length - 1; i > 0; i--) {
    const a = clean[i];
    const b = clean[i - 1];
    if (a == null || b == null) break;
    const rising = a > b;
    if ((direction === "up" && rising) || (direction === "down" && !rising && a < b)) run++;
    else break;
  }
  return values.length === 0 ? 0 : run;
}

/** Antal avslutande veckor där villkoret håller. */
function trailingCount(values: number[], predicate: (v: number) => boolean): number {
  let n = 0;
  for (let i = values.length - 1; i >= 0 && predicate(values[i]); i--) n++;
  return n;
}

export function buildInsights(input: InsightInput): Insight[] {
  const out: Insight[] = [];

  // --- Formkurvan ---------------------------------------------------------
  // Den enda regeln som får peka åt två håll. En fallande formkurva är värd
  // att veta om, men formuleras som en observation — EF påverkas kraftigt av
  // värme, stress och underlag (P1.4), så en dipp är ofta vädret och inte
  // formen. Därför "att-bevaka", aldrig ett larm.
  if (input.efWeekly && input.efWeekly.length >= MIN_STREAK_WEEKS) {
    const up = trailingRun(input.efWeekly, "up");
    const down = trailingRun(input.efWeekly, "down");
    const last = input.efWeekly[input.efWeekly.length - 1];
    if (up >= MIN_STREAK_WEEKS && last != null) {
      out.push({
        id: "ef-up",
        phase: "block",
        headline: `Formkurvan har stigit ${up} veckor i rad.`,
        detail: `Senaste veckan ${last.toFixed(2)} m/slag. Stigande värde vid samma puls betyder att du kommer längre per hjärtslag.`,
        href: "/trender",
        tone: "positiv",
        priority: 2,
      });
    } else if (down >= MIN_STREAK_WEEKS && last != null) {
      out.push({
        id: "ef-down",
        phase: "block",
        headline: `Formkurvan har fallit ${down} veckor i rad.`,
        detail: `Senaste veckan ${last.toFixed(2)} m/slag. Värt att lägga märke till — men kurvan påverkas också av värme, stress och underlag, så en enskild period säger inte allt.`,
        href: "/trender",
        tone: "att-bevaka",
        priority: 2,
      });
    }
  }

  // --- Tröskelandelen -----------------------------------------------------
  // Det vanligaste felet hos ambitiösa juniorer är att de lugna passen blir
  // för snabba (P1.3). En stigande tröskelandel är den tidigaste synliga
  // signalen på det. Notera att siffran mäter Garmins autozoner tills ett
  // eget tröskelband är satt (K8) — därför den brasklappen i detaljtexten.
  if (input.thresholdShareWeekly && input.thresholdShareWeekly.length >= MIN_STREAK_WEEKS) {
    const up = trailingRun(input.thresholdShareWeekly, "up");
    const last = input.thresholdShareWeekly[input.thresholdShareWeekly.length - 1];
    if (up >= MIN_STREAK_WEEKS && last != null) {
      out.push({
        id: "threshold-up",
        phase: "block",
        headline: `Andelen tid på eller över tröskel har stigit ${up} veckor i rad.`,
        detail: `Senaste veckan ${Math.round(last * 100)} %. Räknat på klockans zoner — siffran blir jämförbar mot din egen fysiologi först när ett tröskeltest är gjort.`,
        href: "/trender",
        tone: "att-bevaka",
        priority: 1,
      });
    }
  }

  // --- Kvalitetspass i rad ------------------------------------------------
  // Upprepbarhet är den starkaste signalen i hela researchen (2.1 och 2.3 i
  // insikter-roadmapen): Lindh och Almgren säger samma sak oberoende av
  // varandra. Därför hög prioritet trots att den ser blygsam ut.
  if (input.qualitySessionsWeekly) {
    const weeks = trailingCount(input.qualitySessionsWeekly, (v) => v >= 2);
    if (weeks >= MIN_STREAK_WEEKS) {
      out.push({
        id: "quality-streak",
        phase: "vecka",
        headline: `Minst två kvalitetspass ${weeks} veckor i rad.`,
        detail:
          "Upprepbarhet vecka efter vecka är det både Lovisa Lindh och Andreas Almgren pekar ut som avgörande — inte enskilda hårda pass.",
        href: "/veckan",
        tone: "positiv",
        priority: 1,
      });
    }
  }

  // --- Kontinuitet --------------------------------------------------------
  if (
    input.continuity &&
    input.continuity.currentWeeksWithoutInterruption >= MIN_STREAK_WEEKS &&
    input.continuity.currentWeeksWithoutInterruption >=
      input.continuity.bestWeeksWithoutInterruption
  ) {
    out.push({
      id: "continuity-best",
      phase: "sasong",
      headline: `Din längsta period utan avbrott hittills — ${input.continuity.currentWeeksWithoutInterruption} veckor.`,
      detail:
        "Sammanhängande veckor utan sjuk- eller skadedag. Det är den siffra som ligger närmast det uthållig träning faktiskt kräver.",
      href: "/blockplan",
      tone: "positiv",
      priority: 1,
    });
  }

  // --- Sömn ---------------------------------------------------------------
  // Sömn är den starkaste enskilda skadefaktorn i materialet (2.5). Men
  // formuleringen är medvetet en observation: appen ställer aldrig diagnos
  // och säger aldrig vad det beror på.
  if (input.sleepBelowBaselineDays != null && input.sleepBelowBaselineDays >= MIN_STREAK_DAYS) {
    out.push({
      id: "sleep-below",
      phase: "dag",
      headline: `Sömnen har legat under din baslinje ${input.sleepBelowBaselineDays} dagar.`,
      detail:
        "Jämfört med ditt eget snitt, inte med en rekommendation. Värt att väga in tillsammans med hur du faktiskt känner dig.",
      href: "/dashboard",
      tone: "att-bevaka",
      priority: 1,
    });
  }

  // --- Volymsprång --------------------------------------------------------
  // 30 % är ingen vetenskaplig gräns — ACWR-litteraturen är omdiskuterad
  // (2.6) och tumregeln om 10 %/vecka är svagt underbyggd. Den finns här som
  // en *observation värd att se*, inte som en varning, och därför neutral ton.
  if (input.distanceKmWeekly && input.distanceKmWeekly.length >= 2) {
    const n = input.distanceKmWeekly.length;
    const last = input.distanceKmWeekly[n - 1];
    const prev = input.distanceKmWeekly[n - 2];
    if (prev > 0 && last / prev >= VOLUME_JUMP_RATIO) {
      out.push({
        id: "volume-jump",
        phase: "vecka",
        headline: `Veckovolymen ökade ${Math.round((last / prev - 1) * 100)} % mot förra veckan.`,
        detail: `${last.toFixed(1)} km mot ${prev.toFixed(1)} km. Ett hopp är inte fel i sig — det är upprepade hopp utan återhämtning som brukar märkas.`,
        href: "/veckan",
        tone: "neutral",
        priority: 3,
      });
    }
  }

  // --- Personbästa --------------------------------------------------------
  for (const pb of input.recentPersonalBests ?? []) {
    out.push({
      id: `pb-${pb.event}-${pb.date}`,
      phase: "sasong",
      headline: `Nytt personbästa på ${pb.event}: ${pb.result}.`,
      detail: `Satt ${pb.date}.`,
      href: "/tavlingsresultat",
      tone: "positiv",
      priority: 0,
    });
  }

  return out.sort((a, b) => a.priority - b.priority || a.id.localeCompare(b.id));
}

/** Insikterna för en given kadens, klippta till MAX_INSIGHTS. Sorteringen
 * sker redan i buildInsights, så klippet tar de mest relevanta. */
export function insightsForPhase(insights: Insight[], phase: LoopPhase): Insight[] {
  return insights.filter((i) => i.phase === phase).slice(0, MAX_INSIGHTS);
}
