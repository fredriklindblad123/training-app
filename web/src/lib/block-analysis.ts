/* ---------------------------------------------------------------------------
 * Analys av ett block mot motsvarande block förra året (/analys, 2026-11-13).
 *
 * Jämförelsen görs dag för dag i blocket, inte datum för datum: dag 47 i
 * årets block mot dag 47 i förra årets. Förra årets block återskapades
 * 2026-11-13 med samma veckodagar (start 364 dagar tidigare), så veckorna
 * ligger kant i kant.
 *
 * Mitt i ett pågående block jämförs bara fram till idag — "hittills" i år mot
 * samma antal dagar förra året. Annars hade förra årets hela block ställts
 * mot halva årets och sett ut som en stor skillnad som inte finns.
 *
 * Planerad TID jämförs inte: målminuter är ifyllda på 8 av ~650 planerade
 * pass. Planen jämförs i antal pass per slag, samma regel som Uppföljning
 * (lib/range-stats.ts).
 * ------------------------------------------------------------------------ */

import type { TrainingSession } from "@/lib/sessions";
import { QUALITY_WORKOUT_TYPES } from "@/lib/planning";

export type AnalysisBlock = {
  id: string;
  name: string;
  phase: string;
  start_date: string;
  end_date: string;
};

const DAY_MS = 86_400_000;

export function dayIndex(dateKey: string, startKey: string): number {
  return Math.round((Date.parse(`${dateKey}T00:00:00Z`) - Date.parse(`${startKey}T00:00:00Z`)) / DAY_MS);
}

export function shiftKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function blockLength(b: AnalysisBlock): number {
  return dayIndex(b.end_date, b.start_date) + 1;
}

/** Motsvarande block förra året: samma fas, start 300–430 dagar tidigare,
 * närmast 364. null när inget sådant finns. */
export function findComparisonBlock(
  blocks: AnalysisBlock[],
  block: AnalysisBlock,
): AnalysisBlock | null {
  let best: AnalysisBlock | null = null;
  let bestDiff = Infinity;
  for (const b of blocks) {
    if (b.id === block.id || b.phase !== block.phase) continue;
    const lag = dayIndex(block.start_date, b.start_date);
    if (lag < 300 || lag > 430) continue;
    if (Math.abs(lag - 364) < bestDiff) {
      best = b;
      bestDiff = Math.abs(lag - 364);
    }
  }
  return best;
}

/** Aktiva minuter per dag i blocket (index 0 = första dagen). */
export function dailyMinutes(sessions: TrainingSession[], block: AnalysisBlock): number[] {
  const out = new Array(blockLength(block)).fill(0);
  for (const s of sessions) {
    const i = dayIndex(s.date, block.start_date);
    if (i >= 0 && i < out.length) out[i] += s.durationSeconds / 60;
  }
  return out;
}

export function cumulative(values: number[]): number[] {
  let sum = 0;
  return values.map((v) => (sum += v));
}

/** Summa per blockvecka (7 dagar från blockets start). */
export function weeklySums(daily: number[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < daily.length; i += 7) {
    out.push(daily.slice(i, i + 7).reduce((a, b) => a + b, 0));
  }
  return out;
}

const RUN = /run/i;

export type BlockTotals = {
  trainingDays: number;
  minutes: number;
  runKm: number;
  qualitySessions: number;
  strengthSessions: number;
};

/** Summor för de första `days` dagarna av blocket. */
export function totalsUpToDay(
  sessions: TrainingSession[],
  block: AnalysisBlock,
  days: number,
): BlockTotals {
  const inside = sessions.filter((s) => {
    const i = dayIndex(s.date, block.start_date);
    return i >= 0 && i < days;
  });
  return {
    trainingDays: new Set(inside.map((s) => s.date)).size,
    minutes: inside.reduce((a, s) => a + s.durationSeconds / 60, 0),
    runKm:
      inside.reduce(
        (a, s) =>
          a +
          s.activities
            .filter((f) => RUN.test(f.activity_type ?? ""))
            .reduce((b, f) => b + (f.distance_meters ?? 0), 0),
        0,
      ) / 1000,
    qualitySessions: inside.filter((s) =>
      (QUALITY_WORKOUT_TYPES as readonly string[]).includes(s.category),
    ).length,
    strengthSessions: inside.filter((s) => s.category === "strength").length,
  };
}
