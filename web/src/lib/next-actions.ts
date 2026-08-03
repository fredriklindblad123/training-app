/* ---------------------------------------------------------------------------
 * L2 i docs/tranarloopen.md: "vad är nästa steg?" — den fråga ingen av de
 * gamla artefakt-sidorna svarade på (avsnitt 1). Ren logik, ingen React och
 * inga egna databasanrop: anroparen (i dag `/idag`, senare `/veckan` och
 * `/blocket`) har redan hämtat allt som behövs för sin egen sida i sitt
 * befintliga Promise.all-block, den här filen bara väger och formulerar det.
 *
 * Språkkravet i avsnitt 6 är styrande för varje `why`-text: appen säger
 * "kolla här", aldrig "du missade". Ingen regel nedan får formuleras som en
 * försummelse, ingen färgas efter brådska (det gör komponenten, inte datan),
 * och en tom lista är ett gott tillstånd — se `nextActions` returnera `[]`
 * som ett fullt giltigt, väntat svar.
 * ------------------------------------------------------------------------ */

export type LoopPhase = "dag" | "vecka" | "block" | "sasong";

export type NextAction = {
  id: string;
  phase: LoopPhase;
  /** Imperativ: "Checka in för idag". */
  title: string;
  /** En mening om varför just nu. Aldrig tillrättavisande. */
  why: string;
  href: string;
  /** Lägre = viktigare. Anroparen visar bara de tre lägsta. */
  priority: number;
};

export type NextActionInput = {
  /** Dagens datum, YYYY-MM-DD. Ankaret för alla datumjämförelser nedan. */
  todayKey: string;

  /** Regel 1. */
  hasCheckedInToday: boolean;

  /** Regel 2 — samma två villkor som K3-kortet (`buildReadinessAlert`) redan
   * räknar ur; se den filens kommentar för varför de är konjunktiva. Kortet
   * bär förklaringen (vilka markörer, hur många dagar i rad) — den här raden
   * ska bara peka dit, inte upprepa den. */
  shouldEaseOff: boolean;
  hasQualityWorkoutTomorrow: boolean;
  tomorrowHref: string;

  /** Regel 3. Gäller bara om gårdagen faktiskt hade ett genomfört pass — en
   * vilodag utan anteckning är inget att påpeka, och `hadSessionYesterday`
   * är precis den spärren. */
  hadSessionYesterday: boolean;
  yesterdayHasDiaryNote: boolean;
  yesterdayHref: string;

  /** Regel 4. Se kommentaren i `nextActions` för hur "veckan tog slut och är
   * oplanerad" avgörs utan ett sparat "granskad"-tillstånd. */
  lastWeekHadSession: boolean;
  currentWeekHasPlannedWorkout: boolean;

  /** Regel 5. `null` när inget block täcker idag. */
  activeBlockEndDate: string | null;

  /** Regel 6. */
  hasLt2Hr: boolean;
  hasEnoughTrainingHistoryForTest: boolean;
};

/** Hur nära blockslutet som räknas som "dags att utvärdera". */
const BLOCK_EVALUATION_WINDOW_DAYS = 14;

function daysBetween(fromKey: string, toKey: string): number {
  const from = new Date(`${fromKey}T00:00:00`).getTime();
  const to = new Date(`${toKey}T00:00:00`).getTime();
  return Math.round((to - from) / 86_400_000);
}

/** Måndag–onsdag: fönstret där förra veckan är hunnen bli historik men
 * fortfarande färsk. Torsdag och senare är man redan djupt i den nya veckan
 * — då är "blev förra veckan gjord?" en fråga som kommer för sent för att
 * vara till nytta, bara ett eko av något som redan passerat. */
function isWeekReviewWindow(todayKey: string): boolean {
  const day = new Date(`${todayKey}T00:00:00`).getDay(); // 0 = söndag .. 6 = lördag
  return day >= 1 && day <= 3;
}

export function nextActions(input: NextActionInput): NextAction[] {
  const actions: NextAction[] = [];

  if (!input.hasCheckedInToday) {
    actions.push({
      id: "checkin",
      phase: "dag",
      title: "Checka in för idag",
      why: "Ger dagens status och morgondagens beredskap rätt underlag.",
      href: "/idag",
      priority: 1,
    });
  }

  if (input.shouldEaseOff && input.hasQualityWorkoutTomorrow) {
    actions.push({
      id: "ease-off-tomorrow",
      phase: "dag",
      title: "Titta på morgondagens pass",
      why: "Kroppen visar några tecken på att vilja ta det lite lugnare, och imorgon är ett tyngre pass.",
      href: input.tomorrowHref,
      priority: 2,
    });
  }

  if (input.hadSessionYesterday && !input.yesterdayHasDiaryNote) {
    actions.push({
      id: "yesterday-note",
      phase: "dag",
      title: "Skriv om gårdagens pass",
      why: "Några rader om hur det kändes gör mönster lättare att se längre fram.",
      href: input.yesterdayHref,
      priority: 3,
    });
  }

  // Regel 4: "veckan tog slut" tolkas som måndag–onsdag med minst ett pass
  // förra veckan — en helt träningsfri vecka (sjukdom, resa, planerad vila)
  // ska inte trigga "gå igenom veckan", det vore fel signal att lägga ovanpå
  // en redan avvikande vecka. "Oplanerad" är medvetet bara "inga
  // planned_workouts alls" och inte "för få" — det finns inget facit för hur
  // många pass en vecka ska innehålla, bara om någon faktiskt satt sig ner
  // och lagt ett upplägg. Att räkna om båda villkoren varje gång utifrån data
  // som redan finns (i stället för att spara ett "granskad"-flagg) undviker
  // en ny tabell och en ny plats där tillståndet kan bli inaktuellt.
  if (
    isWeekReviewWindow(input.todayKey) &&
    input.lastWeekHadSession &&
    !input.currentWeekHasPlannedWorkout
  ) {
    actions.push({
      id: "review-week",
      phase: "vecka",
      title: "Gå igenom veckan",
      why: "Förra veckan är i hamn, och nästa väntar på ett upplägg.",
      href: "/veckan",
      priority: 4,
    });
  }

  if (input.activeBlockEndDate != null) {
    const daysLeft = daysBetween(input.todayKey, input.activeBlockEndDate);
    if (daysLeft >= 0 && daysLeft <= BLOCK_EVALUATION_WINDOW_DAYS) {
      actions.push({
        id: "evaluate-block",
        phase: "block",
        title: "Utvärdera blocket",
        why: "Blocket närmar sig sitt slut — bra läge att forma nästa innan det gör det.",
        href: "/blocket",
        priority: 5,
      });
    }
  }

  if (!input.hasLt2Hr && input.hasEnoughTrainingHistoryForTest) {
    actions.push({
      id: "prescribe-threshold-test",
      phase: "sasong",
      title: "Ordinera ett tröskeltest",
      why: "Med en dryg månads träningsdata går det att sätta en riktig tröskel att lägga passen mot.",
      href: "/sasongen",
      priority: 6,
    });
  }

  return actions.sort((a, b) => a.priority - b.priority);
}
