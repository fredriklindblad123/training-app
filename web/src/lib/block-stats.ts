import {
  matchPlanToSessions,
  summarizeCompliance,
  type PlannedWorkout,
} from "@/lib/plan-matching";
import { QUALITY_WORKOUT_TYPES, type WorkoutType } from "@/lib/planning";
import type { TrainingSession } from "@/lib/sessions";

/* Statistik per träningsblock för /arsplan (uttrycklig begäran 2026-08-22).
 *
 * Ren datamodul utan Supabase- eller JSX-beroenden, samma princip som
 * lib/arsplan-grid.ts och lib/detaljplan-weeks.ts. Räknas ur data sidan
 * redan hämtar för Årsplans veckorutnät — inga nya frågor.
 *
 * Efterlevnaden (planerat mot genomfört) kommer från summarizeCompliance,
 * samma funktion som kalendern, /trender och veckorutnätet använder. Den här
 * modulen definierar alltså inte "genomfört" på nytt; den avgränsar bara
 * materialet till blockets datumspann.
 *
 * Vilodagar räknas inte som pass i "antal pass" — en ordinerad vilodag är en
 * avsikt (och ingår därför i efterlevnaden, se Compliance.plannedCount) men
 * det vore missvisande att svara "12 pass" när tre av dem är vila. */

export type BlockStatsInput = {
  startDate: string;
  endDate: string;
};

export type BlockStats = {
  weeks: number;
  /** Planerade pass exklusive vilodagar. */
  plannedCount: number;
  /** workout_type → antal planerade pass. Vila ingår här, som egen rad, så
   * summan kan överstiga plannedCount. */
  plannedByType: { type: string; count: number }[];
  plannedRestDays: number;
  plannedHours: number | null;
  plannedKm: number | null;
  /** Planerade pass per vecka, avrundat till en decimal. */
  passesPerWeek: number;
  /** Andel av de planerade passen som är kvalitet (tröskel/intervall/
   * tävling/test) — det måttet periodiseringen faktiskt styrs på. */
  qualityShare: number | null;
  sessionCount: number;
  actualKm: number;
  actualHours: number;
  trainingLoad: number;
  completedCount: number;
  qualityPlanned: number;
  qualityCompleted: number;
  /** Genomförda pass som inte fanns i planen. */
  unplannedCount: number;
  competitionCount: number;
};

function withinRange(dateKey: string, start: string, end: string): boolean {
  return dateKey >= start && dateKey <= end;
}

function weeksBetweenDates(start: string, end: string): number {
  const ms = new Date(`${end}T00:00:00Z`).getTime() - new Date(`${start}T00:00:00Z`).getTime();
  return Math.max(1, Math.round(ms / (7 * 86_400_000)) || 1);
}

export function computeBlockStats({
  block,
  planned,
  sessions,
  competitionDates,
}: {
  block: BlockStatsInput;
  planned: (PlannedWorkout & { training_factor?: string | null })[];
  sessions: TrainingSession[];
  competitionDates: string[];
}): BlockStats {
  const blockPlanned = planned.filter((p) =>
    withinRange(p.scheduled_date, block.startDate, block.endDate),
  );
  const blockSessions = sessions.filter((s) =>
    withinRange(s.date, block.startDate, block.endDate),
  );

  const counts = new Map<string, number>();
  for (const p of blockPlanned) {
    counts.set(p.workout_type, (counts.get(p.workout_type) ?? 0) + 1);
  }
  const plannedByType = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, "sv"));

  const plannedRestDays = counts.get("rest") ?? 0;
  const plannedCount = blockPlanned.length - plannedRestDays;

  const plannedSeconds = blockPlanned.reduce((sum, p) => sum + (p.target_duration_seconds ?? 0), 0);
  const plannedMeters = blockPlanned.reduce((sum, p) => sum + (p.target_distance_meters ?? 0), 0);

  const qualityPlannedCount = blockPlanned.filter((p) =>
    (QUALITY_WORKOUT_TYPES as readonly string[]).includes(p.workout_type as WorkoutType),
  ).length;

  const matches = matchPlanToSessions(blockPlanned, blockSessions);
  const compliance = summarizeCompliance(matches);
  const weeks = weeksBetweenDates(block.startDate, block.endDate);

  return {
    weeks,
    plannedCount,
    plannedByType,
    plannedRestDays,
    // Mål-tid och mål-distans är valfria fält; är de aldrig ifyllda ska
    // raden döljas i stället för att påstå "0 h".
    plannedHours: plannedSeconds > 0 ? plannedSeconds / 3600 : null,
    plannedKm: plannedMeters > 0 ? plannedMeters / 1000 : null,
    passesPerWeek: Math.round((plannedCount / weeks) * 10) / 10,
    qualityShare: plannedCount > 0 ? qualityPlannedCount / plannedCount : null,
    sessionCount: blockSessions.length,
    actualKm: blockSessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000,
    actualHours: blockSessions.reduce((sum, s) => sum + s.durationSeconds, 0) / 3600,
    trainingLoad: blockSessions.reduce((sum, s) => sum + s.trainingLoad, 0),
    completedCount: compliance.completedCount,
    qualityPlanned: compliance.qualityPlanned,
    qualityCompleted: compliance.qualityCompleted,
    unplannedCount: compliance.unplanned.length,
    competitionCount: competitionDates.filter((d) =>
      withinRange(d, block.startDate, block.endDate),
    ).length,
  };
}
