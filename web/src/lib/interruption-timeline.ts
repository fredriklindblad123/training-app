/* ---------------------------------------------------------------------------
 * K6 i docs/tranarperspektiv.md: avbrottstidslinjen på /trends.
 *
 * Slår ihop sammanhängande sjuk-/skadedagar (diary_entries.day_type) till
 * perioder, och sätter varje period i relation till veckan innan: belastning,
 * kvalitetspass, sömn, HRV och atletens egna dagboksord.
 *
 * Sömn- och HRV-avvikelsen är INTE omräknad här — de återanvänder
 * `computeDailyStatus` (lib/daily-status.ts, P1.2) rakt av, bara med "idag"
 * flyttat till periodens startdag. Det ger exakt samma baslinjefönster,
 * median/SD och "minst 30 dagars historik"-spärr som /dashboard använder för
 * samma markörer, i stället för en parallell uträkning som kan glida isär.
 *
 * VIKTIGT — fallgrop 2, K6: det här beskriver vad som FÖREGICK ett avbrott,
 * aldrig vad som ORSAKADE det. Med i storleksordningen tre perioder per år är
 * underlaget alldeles för litet för att påstå ett samband (se 2.6 i
 * insikter-roadmap.md om samma fälla för ACWR). Håll språket i UI:t beskrivande
 * — "veckan före" och "samtidigt", aldrig "ledde till" eller "orsakade".
 * ------------------------------------------------------------------------ */

import { addDays, mondayOf, QUALITY_WORKOUT_TYPES, toDateKey } from "@/lib/planning";
import { median } from "@/lib/stats-utils";
import {
  BASELINE_WINDOW_DAYS,
  CURRENT_WINDOW_DAYS,
  computeDailyStatus,
  type DailyStatusInput,
} from "@/lib/daily-status";

export type InterruptionDayType = "sick" | "injured";

export type InterruptionPeriod = {
  dayType: InterruptionDayType;
  startDate: string;
  endDate: string;
  days: number;
};

/**
 * Slår ihop sammanhängande dagar med samma `day_type` till perioder.
 * `entries` behöver inte vara sorterade.
 *
 * En dags lucka mellan två sjuk-/skaddagar (frisk en dag, sjuk igen nästa)
 * räknas medvetet som två separata perioder — appen vet bara vad som
 * faktiskt skrivits in, och att anta att den mellanliggande dagen också var
 * sjuk vore att gissa åt atleten.
 */
export function groupInterruptionPeriods(
  entries: { date: string; dayType: InterruptionDayType }[],
): InterruptionPeriod[] {
  const sorted = [...entries].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const periods: InterruptionPeriod[] = [];

  for (const entry of sorted) {
    const last = periods[periods.length - 1];
    const isContinuation =
      last != null &&
      last.dayType === entry.dayType &&
      toDateKey(addDays(new Date(`${last.endDate}T00:00:00`), 1)) === entry.date;

    if (isContinuation && last) {
      last.endDate = entry.date;
      last.days += 1;
    } else {
      periods.push({ dayType: entry.dayType, startDate: entry.date, endDate: entry.date, days: 1 });
    }
  }

  return periods;
}

export type DiaryNote = { date: string; note: string };

export type InterruptionPrecursor = {
  period: InterruptionPeriod;
  /** Summerad träningsbelastning de 7 dagarna omedelbart före periodens start. */
  loadWeekBefore: number;
  /** Medianbelastning per vecka i ett längre fönster före det, för jämförelse.
   * Null om det inte finns tillräckligt många hela veckor att räkna på. */
  loadBaselinePerWeek: number | null;
  /** Antal kvalitetspass (QUALITY_WORKOUT_TYPES) samma 7 dagar. */
  qualitySessionsWeekBefore: number;
  /** Snittsömn samma 7 dagar, i timmar. Se lib/daily-status.ts. */
  sleepHoursWeekBefore: number | null;
  /** Atletens egna sömnbaslinje (median, 60 dagar). */
  sleepBaselineHours: number | null;
  /** HRV-avvikelse mot egen baslinje, i SD-enheter. Positiv = över baslinjen. */
  hrvDeviationSd: number | null;
  /** Dagbokens egna ord de sista dagarna före periodens start (inte under den). */
  notesBefore: DiaryNote[];
};

/** Hur många dagar bakåt dagbokstexten hämtas ifrån — några dagar, inte hela
 * veckan, annars drunknar det relevanta ("kändes seg i halsen") i vanlig
 * passrapportering. */
const NOTES_LOOKBACK_DAYS = 3;

/** Minst så här många hela veckor krävs i baslinjefönstret för att
 * medianbelastningen ska räknas som något annat än en gissning. */
const MIN_BASELINE_WEEKS = 4;

export function computeInterruptionPrecursor(
  period: InterruptionPeriod,
  input: {
    sessions: { date: string; trainingLoad: number; category: string }[];
    dailyMetrics: DailyStatusInput[];
    diaryNotes: DiaryNote[];
  },
): InterruptionPrecursor {
  const periodStartDate = new Date(`${period.startDate}T00:00:00`);
  const weekBeforeFrom = toDateKey(addDays(periodStartDate, -7));
  const weekBeforeToExclusive = period.startDate;

  const sessionsWeekBefore = input.sessions.filter(
    (s) => s.date >= weekBeforeFrom && s.date < weekBeforeToExclusive,
  );
  const loadWeekBefore = sessionsWeekBefore.reduce((sum, s) => sum + s.trainingLoad, 0);
  const qualitySessionsWeekBefore = sessionsWeekBefore.filter((s) =>
    (QUALITY_WORKOUT_TYPES as readonly string[]).includes(s.category),
  ).length;

  // Medianbelastning: samma BASELINE_WINDOW_DAYS-fönster som P1.2 använder
  // för fysiologin (60 dagar), räknat som hela veckosummor och avslutat
  // precis där jämförelseveckan (ovan) börjar — de två fönstren ska inte
  // överlappa, annars jämförs veckan delvis mot sig själv.
  const baselineFrom = toDateKey(addDays(periodStartDate, -BASELINE_WINDOW_DAYS - 7));
  const weeklyLoads: number[] = [];
  for (
    let monday = mondayOf(baselineFrom);
    toDateKey(monday) < toDateKey(mondayOf(weekBeforeFrom));
    monday = addDays(monday, 7)
  ) {
    const weekFrom = toDateKey(monday);
    const weekToExclusive = toDateKey(addDays(monday, 7));
    weeklyLoads.push(
      input.sessions
        .filter((s) => s.date >= weekFrom && s.date < weekToExclusive)
        .reduce((sum, s) => sum + s.trainingLoad, 0),
    );
  }
  const loadBaselinePerWeek = weeklyLoads.length >= MIN_BASELINE_WEEKS ? median(weeklyLoads) : null;

  // Sömn/HRV: hela beräkningen är lib/daily-status.ts, med "idag" flyttat
  // till periodens startdag så att "senaste veckan" (default CURRENT_WINDOW_DAYS)
  // blir just veckan omedelbart före avbrottet.
  const status = computeDailyStatus(input.dailyMetrics, period.startDate, CURRENT_WINDOW_DAYS);
  const sleepMarker = status.markers.find((m) => m.spec.key === "sleepHours");
  const hrvMarker = status.markers.find((m) => m.spec.key === "hrv");

  const notesFrom = toDateKey(addDays(periodStartDate, -NOTES_LOOKBACK_DAYS));
  const notesBefore = input.diaryNotes
    .filter((n) => n.date >= notesFrom && n.date < period.startDate && n.note.trim())
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  return {
    period,
    loadWeekBefore,
    loadBaselinePerWeek,
    qualitySessionsWeekBefore,
    sleepHoursWeekBefore: sleepMarker?.current ?? null,
    sleepBaselineHours: sleepMarker?.baseline ?? null,
    hrvDeviationSd: hrvMarker?.deviation ?? null,
    notesBefore,
  };
}
