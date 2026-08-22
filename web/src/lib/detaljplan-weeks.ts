import { buildWeekSeriesForRange } from "@/lib/week-series";
import type { PlanOutcome } from "@/lib/plan-matching";
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
  /** Behövs av matchPlanToSessions (PlannedWorkout), inte av veckovyn
   * själv — hämtas därför alltid med i samma fråga. */
  target_distance_meters: number | null;
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
  /** Utfall per löpare: user_id → PlanOutcome. Tomt när inget utfall
   * beräknats. OBS att detta INTE kommer ur planned_workouts.status — den
   * kolumnen skrivs aldrig (verifierat 2026-08-22: samtliga rader är
   * `planned`, ingen har linked_activity_id). Utfallet räknas i läsvägen av
   * matchPlanToSessions, samma funktion som kalendern, /arsplan och
   * /trender använder, och matas in här utifrån. */
  outcomeByAthlete: Record<string, PlanOutcome>;
};

/** En tävlingsrad ur `competitions` — en rad per löpare, precis som passen.
 * Det finns ingen junction-tabell: att flera löpare kör samma tävling är
 * flera rader med samma namn och datum. */
export type CompetitionRow = {
  id: string;
  user_id: string;
  competition_date: string;
  name: string;
  priority: string;
};

/** En tävling i veckovyn = alla löpares rader för samma (datum, namn). */
export type CompetitionGroup = {
  key: string;
  date: string;
  name: string;
  /** Högsta prioritet bland löparnas rader — A väger tyngst. En tävling som
   * är A-lopp för en löpare men C för en annan ska synas som det viktigare
   * av de två i en vy som visar båda. */
  priority: string;
  athleteIds: string[];
};

export type DetaljplanDay = {
  date: string;
  passes: PassGroup[];
  competitions: CompetitionGroup[];
};

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

/** Nyckel för utfallskartan: en löpares pass ett visst datum och slot. */
export function outcomeKey(userId: string, date: string, slot: number): string {
  return `${userId}|${date}|${slot}`;
}

function groupPasses(
  rows: PlannedPassRow[],
  outcomes: Map<string, PlanOutcome>,
): Map<string, PassGroup> {
  const byKey = new Map<string, PlannedPassRow[]>();
  for (const r of rows) {
    const key = `${r.scheduled_date}|${r.slot}`;
    byKey.set(key, [...(byKey.get(key) ?? []), r]);
  }

  const groups = new Map<string, PassGroup>();
  for (const [key, group] of byKey) {
    const first = group[0];
    const outcomeByAthlete: Record<string, PlanOutcome> = {};
    for (const r of group) {
      const outcome = outcomes.get(outcomeKey(r.user_id, r.scheduled_date, r.slot));
      if (outcome) outcomeByAthlete[r.user_id] = outcome;
    }
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
      outcomeByAthlete,
    });
  }
  return groups;
}

const PRIORITY_RANK: Record<string, number> = { A: 3, B: 2, C: 1 };

function groupCompetitions(rows: CompetitionRow[]): Map<string, CompetitionGroup[]> {
  const byKey = new Map<string, CompetitionRow[]>();
  for (const c of rows) {
    const key = `${c.competition_date}|${c.name}`;
    byKey.set(key, [...(byKey.get(key) ?? []), c]);
  }

  const byDate = new Map<string, CompetitionGroup[]>();
  for (const [key, group] of byKey) {
    const first = group[0];
    const priority = group.reduce(
      (best, c) => ((PRIORITY_RANK[c.priority] ?? 0) > (PRIORITY_RANK[best] ?? 0) ? c.priority : best),
      first.priority,
    );
    const entry: CompetitionGroup = {
      key,
      date: first.competition_date,
      name: first.name,
      priority,
      athleteIds: group.map((c) => c.user_id),
    };
    byDate.set(entry.date, [...(byDate.get(entry.date) ?? []), entry]);
  }
  for (const list of byDate.values()) list.sort((a, b) => a.name.localeCompare(b.name, "sv"));
  return byDate;
}

/** Veckoraderna för ett block, tidigaste veckan först.
 *
 * Tävlingar visas även på dagar strax utanför blockets datumspann (de dagar
 * som fyller ut första och sista veckoraden) — ett A-lopp två dagar innan
 * blocket börjar är precis den kontext tränaren behöver se när han planerar
 * blockets första vecka, inte något som ska döljas för att datumet råkar
 * ligga utanför. */
export function buildDetaljplanWeeks(
  blockStart: string,
  blockEnd: string,
  rows: PlannedPassRow[],
  competitions: CompetitionRow[] = [],
  outcomes: Map<string, PlanOutcome> = new Map(),
): DetaljplanWeek[] {
  const groups = groupPasses(rows, outcomes);
  const passesByDate = new Map<string, PassGroup[]>();
  for (const g of groups.values()) {
    passesByDate.set(g.scheduledDate, [...(passesByDate.get(g.scheduledDate) ?? []), g]);
  }
  for (const list of passesByDate.values()) list.sort((a, b) => a.slot - b.slot);

  const competitionsByDate = groupCompetitions(competitions);

  return buildWeekSeriesForRange(blockStart, blockEnd).map((weekStart) => {
    const days: DetaljplanDay[] = [];
    const outside: boolean[] = [];
    for (let i = 0; i < 7; i++) {
      const date = addDaysKey(weekStart, i);
      days.push({
        date,
        passes: passesByDate.get(date) ?? [],
        competitions: competitionsByDate.get(date) ?? [],
      });
      outside.push(date < blockStart || date > blockEnd);
    }
    return { weekStart, isoWeekNumber: isoWeekNumber(weekStart), days, outside };
  });
}
