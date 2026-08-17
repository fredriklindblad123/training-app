import { blockForDate, type PeriodType, type PhaseType } from "@/lib/planning";
import { buildWeekSeriesForRange } from "@/lib/week-series";
import { isoWeekStart } from "@/lib/stats-utils";

/* Ren datamodul (inga Supabase/ExcelJS/JSX-beroenden) för Årsplanens
 * veckorutnät — en kolumn per vecka, delad mellan /arsplan (in-app-vyn) och
 * Excel-exporten (flerarsplan/export/route.ts) så de aldrig kan visa olika
 * siffror för samma data. Flyttad hit 2026-08-17 ur exportens tidigare
 * ExcelJS-kopplade buildArsplanSheet. */

const MONTHS_SHORT = [
  "jan", "feb", "mar", "apr", "maj", "jun",
  "jul", "aug", "sep", "okt", "nov", "dec",
];

export type ArsplanBlockInput = {
  id: string;
  start_date: string;
  end_date: string;
  period: PeriodType;
  phase: PhaseType;
  sessions_count: number | null;
  days_count: number | null;
  starts_count: number | null;
  hours_count: number | null;
  has_test: boolean;
};

export type ArsplanPlannedWorkoutInput = {
  scheduled_date: string;
  training_factor: string | null;
  target_duration_seconds: number | null;
};

export type ArsplanCompetitionInput = {
  competition_date: string;
  name: string;
  competition_events: { event: string }[];
};

export type ArsplanWeekColumn = {
  weekStart: string;
  isoWeekNumber: number;
  monthLabel: string;
  block: ArsplanBlockInput | null;
  sessionsCount: number;
  daysCount: number;
  hoursCount: number;
  /** Antal tävlingsstarter (en per gren) den veckan — alltid räknat live ur
   * `competitions`, aldrig från blockets manuella fält: en vecka utan lopp är
   * ett sant noll, inte "inte inlagt ännu" på samma sätt som pass/dagar/
   * timmar kan vara innan Detaljplan är ifylld. */
  startsCount: number;
  /** true = veckan hade inga utrullade pass ännu, siffrorna ovan kommer då
   * från blockets manuellt ifyllda standardvecka-fält i stället för att
   * räknas fram live. Renderas nedtonat — "det här är bara planen, inget
   * utrullat än". */
  usedFallback: boolean;
  /** training_factor-nyckel → antal taggade pass den veckan. */
  factorCounts: Partial<Record<string, number>>;
  competitionLabels: string[];
};

export function isoWeekNumber(dateKey: string): number {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

export function monthLabel(dateKey: string): string {
  return MONTHS_SHORT[Number(dateKey.slice(5, 7)) - 1];
}

function competitionLabel(c: ArsplanCompetitionInput): string {
  const events = c.competition_events.map((e) => e.event);
  return events.length > 0 ? `${c.name} (${events.join(", ")})` : c.name;
}

/** Bygger ett veckorutnät för spannet [tidigaste blockets start, senaste
 * blockets slut] — inte ett kalenderår, precis som exporten gjorde innan.
 * Tomt om `blocks` är tomt. */
export function buildArsplanWeeks(
  blocks: ArsplanBlockInput[],
  plannedWorkouts: ArsplanPlannedWorkoutInput[],
  competitions: ArsplanCompetitionInput[],
): ArsplanWeekColumn[] {
  if (blocks.length === 0) return [];

  const sortedBlocks = [...blocks].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));
  const minDate = sortedBlocks.reduce((m, b) => (b.start_date < m ? b.start_date : m), sortedBlocks[0].start_date);
  const maxDate = sortedBlocks.reduce((m, b) => (b.end_date > m ? b.end_date : m), sortedBlocks[0].end_date);
  const weeks = buildWeekSeriesForRange(minDate, maxDate);

  const workoutsByWeek = new Map<string, ArsplanPlannedWorkoutInput[]>();
  for (const w of plannedWorkouts) {
    const wk = isoWeekStart(w.scheduled_date);
    workoutsByWeek.set(wk, [...(workoutsByWeek.get(wk) ?? []), w]);
  }

  const competitionsByWeek = new Map<string, string[]>();
  const startsByWeek = new Map<string, number>();
  for (const c of competitions) {
    const wk = isoWeekStart(c.competition_date);
    competitionsByWeek.set(wk, [...(competitionsByWeek.get(wk) ?? []), competitionLabel(c)]);
    startsByWeek.set(wk, (startsByWeek.get(wk) ?? 0) + Math.max(c.competition_events.length, 1));
  }

  return weeks.map((weekStart) => {
    const block = blockForDate(sortedBlocks, weekStart);
    const weekWorkouts = workoutsByWeek.get(weekStart) ?? [];

    const usedFallback = weekWorkouts.length === 0;
    const sessionsCount = usedFallback ? (block?.sessions_count ?? 0) : weekWorkouts.length;
    const daysCount = usedFallback
      ? (block?.days_count ?? 0)
      : new Set(weekWorkouts.map((w) => w.scheduled_date)).size;
    const hoursCount = usedFallback
      ? (block?.hours_count ?? 0)
      : weekWorkouts.reduce((sum, w) => sum + (w.target_duration_seconds ?? 0), 0) / 3600;

    const factorCounts: Partial<Record<string, number>> = {};
    for (const w of weekWorkouts) {
      if (!w.training_factor) continue;
      factorCounts[w.training_factor] = (factorCounts[w.training_factor] ?? 0) + 1;
    }

    return {
      weekStart,
      isoWeekNumber: isoWeekNumber(weekStart),
      monthLabel: monthLabel(weekStart),
      block,
      sessionsCount,
      daysCount,
      hoursCount,
      startsCount: startsByWeek.get(weekStart) ?? 0,
      usedFallback,
      factorCounts,
      competitionLabels: competitionsByWeek.get(weekStart) ?? [],
    };
  });
}

/** Slår ihop sammanhängande veckor som tillhör samma block (jämfört på
 * block-id) till en körd — precis som originalmallens Period-rad är en
 * sammanslagen cell per period, inte samma text upprepad i varje
 * veckokolumn. `startIndex`/`length` är 0-baserade index in i `weeks`. */
export function computeMergeRuns(
  weeks: { block: ArsplanBlockInput | null }[],
): { startIndex: number; length: number; block: ArsplanBlockInput }[] {
  const runs: { startIndex: number; length: number; block: ArsplanBlockInput }[] = [];
  let runStart = 0;
  for (let i = 1; i <= weeks.length; i++) {
    const continuesRun = i < weeks.length && weeks[i].block?.id === weeks[runStart].block?.id;
    if (!continuesRun) {
      const block = weeks[runStart].block;
      if (block) runs.push({ startIndex: runStart, length: i - runStart, block });
      runStart = i;
    }
  }
  return runs;
}
