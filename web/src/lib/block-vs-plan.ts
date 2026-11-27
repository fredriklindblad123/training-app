import { sessionKm } from "@/lib/block-analysis";
import { trainingSeconds, type TrainingSession } from "@/lib/sessions";

/* Blocket mot planen (2026-11-21) — på Idag: hur ligger löparen till mot
 * planerad distans och träningstid i blocket hittills?
 *
 * BARA DÄR PLANEN HAR SIFFROR. Planen bär distans och tid först från det
 * datum tränaren började skriva in dem — för Alices höstblock 2026 från 16/11
 * (vecka 8 av 12); veckorna före har bara passnamn. Att jämföra hela blocket
 * hade fått henne att se ut att ha tränat dubbelt så mycket som planerat.
 * Jämförelsen börjar därför vid första planerade passet med siffror, och det
 * står ut på sidan.
 *
 * SAMMA REGLER SOM ANNARS I APPEN.
 *   Distans: löpning, utan alternativträning (sessionKm-regeln).
 *   Tid: hela passet, styrka inte med (trainingSeconds).
 *   Planerad tid: target_duration_seconds utan styrkepass.
 * Bara dagar som passerat räknas, och idag bara om dagens pass är gjort —
 * annars ligger dagens planerade pass med i "planerat" men inte i "gjort". */

export type PlanRow = {
  scheduled_date: string;
  workout_type: string;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
};

export type BlockVsPlan = {
  /** Första dagen jämförelsen gäller (första planerade passet med siffror). */
  from: string;
  /** Sista dagen som räknas (idag om dagens pass är gjort, annars igår). */
  to: string;
  plannedKm: number;
  doneKm: number;
  plannedMin: number;
  doneMin: number;
  /** Hela blockets planerade distans och tid från `from`, för sammanhang. */
  blockPlannedKm: number;
  blockPlannedMin: number;
};

export function blockVsPlan(
  plans: PlanRow[],
  sessions: TrainingSession[],
  blockEnd: string,
  today: string,
): BlockVsPlan | null {
  const withNumbers = plans.filter(
    (p) => (p.target_distance_meters ?? 0) > 0 || (p.target_duration_seconds ?? 0) > 0,
  );
  if (withNumbers.length === 0) return null;
  const from = withNumbers.map((p) => p.scheduled_date).sort()[0];
  const trainedToday = sessions.some((s) => s.date === today);
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const to = trainedToday ? today : yesterday;
  if (to < from) return null;

  const km = (ps: PlanRow[]) =>
    ps.filter((p) => p.workout_type !== "cross_training").reduce((s, p) => s + (p.target_distance_meters ?? 0), 0) / 1000;
  const min = (ps: PlanRow[]) =>
    ps.filter((p) => p.workout_type !== "strength").reduce((s, p) => s + (p.target_duration_seconds ?? 0), 0) / 60;

  const due = plans.filter((p) => p.scheduled_date >= from && p.scheduled_date <= to);
  const block = plans.filter((p) => p.scheduled_date >= from && p.scheduled_date <= blockEnd);
  const done = sessions.filter((s) => s.date >= from && s.date <= to);

  return {
    from,
    to,
    plannedKm: km(due),
    doneKm: done.reduce((sum, s) => sum + sessionKm(s), 0),
    plannedMin: min(due),
    doneMin: done.reduce((sum, s) => sum + trainingSeconds(s), 0) / 60,
    blockPlannedKm: km(block),
    blockPlannedMin: min(block),
  };
}
