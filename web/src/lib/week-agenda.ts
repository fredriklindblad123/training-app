/* K4 (docs/tranarperspektiv.md): "genomgångsläget" i veckovyn — en rad per
 * pass i kronologisk ordning i stället för rutnätet. Den här modulen bygger
 * bara textraderna (planrad, utfallsrad, fotrad); vilka dagar/pass som ska
 * visas bestäms i sidan, som redan har all gruppering (K2:s matchPlanToSessions,
 * lib/sessions.ts) liggande.
 *
 * Rent presentationslogik, ingen datahämtning — samma uppdelning som resten
 * av appen (lib/ = ren logik, komponenten = presentation).
 */

import { formatDuration, formatHoursMinutes, formatKm, formatPace } from "@/lib/format";
import {
  buildSessionSignature,
  plannedSignatureLabel,
  type PlannedRepGroup,
  type SignatureLap,
} from "@/lib/session-signature";
import { WORKOUT_LABELS, type WorkoutType } from "@/lib/planning";
import type { TrainingSession } from "@/lib/sessions";
import type { PlannedWorkout } from "@/lib/plan-matching";

/** En repgrupp så som den kommer ur `planned_rep_groups` (samma form som
 * RepGroupEditor.tsx RepGroupRow, minus id/note som planraden inte behöver). */
export type AgendaRepGroup = {
  sort_order: number;
  reps: number;
  distance_meters: number | null;
  duration_seconds: number | null;
  target_pace_seconds_per_km: number | null;
  recovery_seconds: number | null;
  recovery_kind: string | null;
};

/** Huvudtext + eventuellt måldata, redo att slås ihop till en rad av
 * komponenten (" · " mellan de två delarna). */
export type PlanLine = {
  title: string;
  target: string | null;
};

/** Den repgrupp som står för mest av passets arbete (reps × distans) — samma
 * "dominant"-princip som buildSessionSignature/groupBySignature använder för
 * utfallet. Ett pass med flera olika repgrupper ska visa pace/vila för den
 * tyngsta, inte lista alla och göra en agenda-rad svår att skumma. */
function dominantRepGroup(groups: AgendaRepGroup[]): AgendaRepGroup | null {
  const withDistance = groups.filter((g) => g.distance_meters != null);
  if (withDistance.length === 0) return null;
  return [...withDistance].sort(
    (a, b) => b.reps * (b.distance_meters ?? 0) - a.reps * (a.distance_meters ?? 0),
  )[0];
}

/**
 * Planraden: "5×1000 m" + "@ 3:15 /km, 2 min jogg".
 *
 * Titeln följer K1-prioriteten (docs/tranarperspektiv.md): repgruppernas
 * signatur om passet har en, annars fritextrubriken, annars typetiketten.
 * Måldata (pace/vila) hämtas ur den dominerande repgruppen när den finns,
 * annars ur passets egna distans-/tidsmål — och visas bara när den faktiskt
 * finns, aldrig som ett tomt "–".
 */
export function formatPlanLine(planned: PlannedWorkout, repGroups: AgendaRepGroup[]): PlanLine {
  const sigLabel = plannedSignatureLabel(
    repGroups.map(
      (g): PlannedRepGroup => ({
        reps: g.reps,
        distanceMeters: g.distance_meters,
        durationSeconds: g.duration_seconds,
        sortOrder: g.sort_order,
      }),
    ),
  );
  const title =
    sigLabel ?? planned.title ?? WORKOUT_LABELS[planned.workout_type as WorkoutType] ?? planned.workout_type;

  const dominant = dominantRepGroup(repGroups);
  const paceText = dominant?.target_pace_seconds_per_km
    ? `@ ${formatPace(dominant.target_pace_seconds_per_km)}`
    : null;
  const restText = dominant?.recovery_seconds
    ? `${Math.round(dominant.recovery_seconds / 60)} min ${dominant.recovery_kind ?? "vila"}`
    : null;
  const repTarget = [paceText, restText].filter(Boolean).join(", ") || null;

  // Bara distans-/tidsmålet på själva passraden (inte repgruppens) om
  // repgruppen inte redan gav ett måldata — annars dubblar vi information
  // ("5×1000 m" följt av passets totala 5 km är samma sak sagt två gånger).
  const wholeTarget = [
    planned.target_distance_meters ? formatKm(planned.target_distance_meters) : null,
    planned.target_duration_seconds ? formatDuration(planned.target_duration_seconds) : null,
  ]
    .filter(Boolean)
    .join(" · ");

  return { title, target: repTarget ?? (wholeTarget || null) };
}

/**
 * Utfallsraden: varvtiderna när passet har en igenkänd intervallstruktur
 * (`buildSessionSignature`, K1), annars distans/tid. Snittpuls läggs sist när
 * den finns.
 *
 * `laps` kommer från det pass-fragment som avgjorde kategorin
 * (`TrainingSession.dominantActivity`) — samma fragment som bär "kärnan" av
 * passet, se lib/sessions.ts. Saknas `activity_splits` helt (synkat innan
 * splits fanns, eller ett manuellt pass) blir `laps` en tom lista,
 * `buildSessionSignature` returnerar null, och raden faller tillbaka på
 * distans/tid — exakt samma fallback som när passet är en rak löprunda.
 */
export function formatOutcomeLine(session: TrainingSession, laps: SignatureLap[]): string {
  const signature = buildSessionSignature(laps);
  const main = signature
    ? signature.groups
        .map((g) => `${g.count}×${g.distanceMeters}: ${g.times.map(formatDuration).join(" · ")}`)
        .join(" + ")
    : [
        session.distanceMeters ? formatKm(session.distanceMeters) : null,
        session.durationSeconds ? formatDuration(session.durationSeconds) : null,
      ]
        .filter(Boolean)
        .join(" · ");

  return session.avgHr != null ? `${main} · snittpuls ${session.avgHr}` : main;
}

/**
 * Fotraden: incheckning (känsla/ansträngning) och sömn/HRV för dagen.
 * Saknade fält utelämnas tyst — en rad med fem tomma fält vore precis den
 * falska precisionen appens språkkrav (P1.2) varnar för.
 *
 * `rpe` lagras 1–10 (se checkin-actions.ts: `rpe = effort * 2`) men visas
 * 1–5 som "ansträngning", samma skala och samma ord som /dashboard använder
 * för samma mått — annars ser det ut som två olika mätningar.
 */
export function formatFootParts(input: {
  feeling: number | null;
  rpe: number | null;
  sleepSeconds: number | null;
  hrv: number | null;
}): string[] {
  const parts: string[] = [];
  if (input.feeling != null) parts.push(`känsla ${input.feeling}/5`);
  if (input.rpe != null) parts.push(`ansträngning ${Math.round(input.rpe / 2)}/5`);
  if (input.sleepSeconds != null) parts.push(`sömn ${formatHoursMinutes(input.sleepSeconds)}`);
  if (input.hrv != null) parts.push(`HRV ${Math.round(input.hrv)} ms`);
  return parts;
}
