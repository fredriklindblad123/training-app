import {
  matchPlanToSessions,
  summarizeCompliance,
  type PlannedWorkout,
} from "@/lib/plan-matching";
import { QUALITY_WORKOUT_TYPES, type WorkoutType } from "@/lib/planning";
import type { TrainingSession } from "@/lib/sessions";

/* Statistik för ett datumspann — planerat, utfall och fördelning per passtyp.
 *
 * Hette lib/block-stats.ts fram till 2026-08-27 och räknade bara per
 * träningsblock (/arsplan, uttrycklig begäran 2026-08-22). Funktionen var
 * dock aldrig blockspecifik: den filtrerar på [startDate, endDate] och bryr
 * sig inte om var spannet kommer ifrån. /uppfoljning behövde exakt samma
 * siffror per månad, vecka och dag, så namnet fick följa vad koden gör i
 * stället för vad den först användes till. Ingen räknelogik ändrades.
 *
 * Ren datamodul utan Supabase- eller JSX-beroenden, samma princip som
 * lib/arsplan-grid.ts och lib/detaljplan-weeks.ts. Räknas ur data sidan
 * redan hämtar — inga nya frågor.
 *
 * Efterlevnaden (planerat mot genomfört) kommer från summarizeCompliance,
 * samma funktion som kalendern, /trender och veckorutnätet använder. Den här
 * modulen definierar alltså inte "genomfört" på nytt; den avgränsar bara
 * materialet till blockets datumspann.
 *
 * Vilodagar räknas inte som pass i "antal pass" — en ordinerad vilodag är en
 * avsikt (och ingår därför i efterlevnaden, se Compliance.plannedCount) men
 * det vore missvisande att svara "12 pass" när tre av dem är vila. */

export type RangeStatsInput = {
  startDate: string;
  endDate: string;
};

export type RangeStats = {
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

export function computeRangeStats({
  range,
  planned,
  sessions,
  competitionDates,
}: {
  range: RangeStatsInput;
  planned: (PlannedWorkout & { training_factor?: string | null })[];
  sessions: TrainingSession[];
  competitionDates: string[];
}): RangeStats {
  const rangePlanned = planned.filter((p) =>
    withinRange(p.scheduled_date, range.startDate, range.endDate),
  );
  const rangeSessions = sessions.filter((s) =>
    withinRange(s.date, range.startDate, range.endDate),
  );

  const counts = new Map<string, number>();
  for (const p of rangePlanned) {
    counts.set(p.workout_type, (counts.get(p.workout_type) ?? 0) + 1);
  }
  const plannedByType = [...counts.entries()]
    .map(([type, count]) => ({ type, count }))
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type, "sv"));

  const plannedRestDays = counts.get("rest") ?? 0;
  const plannedCount = rangePlanned.length - plannedRestDays;

  const plannedSeconds = rangePlanned.reduce((sum, p) => sum + (p.target_duration_seconds ?? 0), 0);
  const plannedMeters = rangePlanned.reduce((sum, p) => sum + (p.target_distance_meters ?? 0), 0);

  const qualityPlannedCount = rangePlanned.filter((p) =>
    (QUALITY_WORKOUT_TYPES as readonly string[]).includes(p.workout_type as WorkoutType),
  ).length;

  const matches = matchPlanToSessions(rangePlanned, rangeSessions);
  const compliance = summarizeCompliance(matches);
  const weeks = weeksBetweenDates(range.startDate, range.endDate);

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
    sessionCount: rangeSessions.length,
    actualKm: rangeSessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000,
    actualHours: rangeSessions.reduce((sum, s) => sum + s.durationSeconds, 0) / 3600,
    trainingLoad: rangeSessions.reduce((sum, s) => sum + s.trainingLoad, 0),
    completedCount: compliance.completedCount,
    qualityPlanned: compliance.qualityPlanned,
    qualityCompleted: compliance.qualityCompleted,
    unplannedCount: compliance.unplanned.length,
    competitionCount: competitionDates.filter((d) =>
      withinRange(d, range.startDate, range.endDate),
    ).length,
  };
}
