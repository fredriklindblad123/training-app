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
 *
 * AKTIV TID är tid i rörelse (Garmins movingDuration), så vila där man står
 * still i ett intervallpass inte räknas — uppmätt på Alices pass ger det 27
 * mot 36 min i snitt för intervall, 30 mot 33 för tröskel och ingen skillnad
 * för distans. Garmin mäter rörelse med GPS, så för styrka och pass inomhus
 * blir den nära noll (styrka 0 av 50 min, alternativ träning 2 av 46). Är
 * tiden i rörelse under halva passets tid används därför hela tiden.
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

/** Tid i rörelse per aktivitet (sekunder), ur raw_data.movingDuration. */
export type MovingById = Map<string, number>;

/** Passets aktiva tid i sekunder, se filhuvudet. */
export function activeSeconds(s: TrainingSession, moving: MovingById): number {
  return s.activities.reduce((sum, f) => {
    const total = f.duration_seconds ?? 0;
    const m = moving.get(f.id);
    return sum + (m != null && m >= total * 0.5 ? Math.min(m, total) : total);
  }, 0);
}

/** Passets distans i km, alla fragment. Vilka pass som räknas väljer
 * användaren med passtyperna — väljs alternativ träning räknas den sträckan. */
export function sessionKm(s: TrainingSession): number {
  return s.activities.reduce((b, f) => b + (f.distance_meters ?? 0), 0) / 1000;
}

/** Ett värde per dag i blocket (index 0 = första dagen). */
export function dailyValues(
  sessions: TrainingSession[],
  block: AnalysisBlock,
  valueOf: (s: TrainingSession) => number,
): number[] {
  const out = new Array(blockLength(block)).fill(0);
  for (const s of sessions) {
    const i = dayIndex(s.date, block.start_date);
    if (i >= 0 && i < out.length) out[i] += valueOf(s);
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

export type BlockTotals = {
  trainingDays: number;
  minutes: number;
  km: number;
  qualitySessions: number;
  strengthSessions: number;
};

/** Summor för de första `days` dagarna av blocket. */
export function totalsUpToDay(
  sessions: TrainingSession[],
  block: AnalysisBlock,
  days: number,
  moving: MovingById,
): BlockTotals {
  const inside = sessions.filter((s) => {
    const i = dayIndex(s.date, block.start_date);
    return i >= 0 && i < days;
  });
  return {
    trainingDays: new Set(inside.map((s) => s.date)).size,
    minutes: inside.reduce((a, s) => a + activeSeconds(s, moving) / 60, 0),
    km: inside.reduce((a, s) => a + sessionKm(s), 0),
    qualitySessions: inside.filter((s) =>
      (QUALITY_WORKOUT_TYPES as readonly string[]).includes(s.category),
    ).length,
    strengthSessions: inside.filter((s) => s.category === "strength").length,
  };
}
