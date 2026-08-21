import { buildWeekSeriesForRange } from "@/lib/week-series";
import { isoWeekNumber } from "@/lib/arsplan-grid";

/* Detaljplanens veckovy (uttrycklig begäran 2026-08-21): riktiga
 * kalenderveckor inom blocket, inte den abstrakta "standardveckan".
 *
 * Den viktiga modell-insikten: vilka löpare som är taggade till ett enskilt
 * PASS behöver ingen ny tabell. `planned_workouts` har redan en rad per
 * löpare och datum, så "Alice kör måndagens tröskel men inte Nike" är
 * representerbart i dag — och förekommer redan i datan (de två löparna på
 * blocket har olika många utrullade pass). Ett pass i veckovyn är därför
 * helt enkelt alla löpares rader för samma (datum, slot); att tagga på/av en
 * löpare är att skapa/ta bort hennes rad.
 *
 * Ren datamodul: inga Supabase- eller JSX-beroenden, samma princip som
 * lib/arsplan-grid.ts och lib/detaljplan-grid.ts. */

export type PlannedPassRow = {
  id: string;
  user_id: string;
  scheduled_date: string;
  slot: number;
  workout_type: string;
  title: string | null;
  description: string | null;
  target_duration_seconds: number | null;
  training_factor: string | null;
  status: string;
};

/** Ett pass i veckovyn = alla löpares rader för samma (datum, slot). */
export type PassGroup = {
  key: string;
  scheduledDate: string;
  slot: number;
  rows: PlannedPassRow[];
  athleteIds: string[];
  /** Representativt innehåll — första radens. Se `diverges`. */
  workoutType: string;
  title: string | null;
  trainingFactor: string | null;
  targetDurationSeconds: number | null;
  /** Löparna har olika innehåll för samma pass, typiskt efter en ändring
   * med scope "bara en löpare". UI:t måste säga det, annars ser kortet ut
   * att gälla alla när det inte gör det. */
  diverges: boolean;
  /** Någon rad är inte längre `planned` (genomförd/ändrad) — sådana rör vi
   * aldrig, så UI:t ska inte låtsas att de går att redigera bort. */
  hasCompleted: boolean;
};

export type DetaljplanDay = { date: string; passes: PassGroup[] };

export type DetaljplanWeek = {
  weekStart: string;
  isoWeekNumber: number;
  /** Alltid 7 poster, måndag → söndag. Dagar utanför blockets datumspann
   * finns med som tomma celler så veckoraden behåller sin form. */
  days: DetaljplanDay[];
  /** Ligger dagen utanför [blockStart, blockEnd]? Samma index som `days`. */
  outside: boolean[];
};

function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function sameContent(a: PlannedPassRow, b: PlannedPassRow): boolean {
  return (
    a.workout_type === b.workout_type &&
    (a.title ?? "") === (b.title ?? "") &&
    (a.training_factor ?? "") === (b.training_factor ?? "") &&
    (a.target_duration_seconds ?? null) === (b.target_duration_seconds ?? null)
  );
}

function groupPasses(rows: PlannedPassRow[]): Map<string, PassGroup> {
  const byKey = new Map<string, PlannedPassRow[]>();
  for (const r of rows) {
    const key = `${r.scheduled_date}|${r.slot}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }

  const groups = new Map<string, PassGroup>();
  for (const [key, group] of byKey) {
    const first = group[0];
    groups.set(key, {
      key,
      scheduledDate: first.scheduled_date,
      slot: first.slot,
      rows: group,
      athleteIds: group.map((r) => r.user_id),
      workoutType: first.workout_type,
      title: first.title,
      trainingFactor: first.training_factor,
      targetDurationSeconds: first.target_duration_seconds,
      diverges: group.some((r) => !sameContent(r, first)),
      hasCompleted: group.some((r) => r.status !== "planned"),
    });
  }
  return groups;
}

/** Veckoraderna för ett block, tidigaste veckan först. */
export function buildDetaljplanWeeks(
  blockStart: string,
  blockEnd: string,
  rows: PlannedPassRow[],
): DetaljplanWeek[] {
  const groups = groupPasses(rows);
  const passesByDate = new Map<string, PassGroup[]>();
  for (const g of groups.values()) {
    passesByDate.set(g.scheduledDate, [...(passesByDate.get(g.scheduledDate) ?? []), g]);
  }
  for (const list of passesByDate.values()) list.sort((a, b) => a.slot - b.slot);

  return buildWeekSeriesForRange(blockStart, blockEnd).map((weekStart) => {
    const days: DetaljplanDay[] = [];
    const outside: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDaysKey(weekStart, i);
      days.push({ date, passes: passesByDate.get(date) ?? [] });
      outside.push(date < blockStart || date > blockEnd);
    }
    return { weekStart, isoWeekNumber: isoWeekNumber(weekStart), days, outside };
  });
}
