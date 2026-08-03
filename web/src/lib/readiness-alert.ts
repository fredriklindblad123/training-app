/* ---------------------------------------------------------------------------
 * K3 i docs/tranarperspektiv.md: beredskap kopplad till morgondagens pass.
 *
 * computeDailyStatus (P1.2) vet redan att 2+ markörer avviker. Det den inte
 * vet är att det ligger dubbeltröskel imorgon — den kopplingen görs här, och
 * bara här, så att dashboarden inte kan råka trigga kortet på annan logik.
 *
 * Villkoret är medvetet konjunktivt (fallgrop 1): avvikelse OCH minst ett
 * kvalitetspass imorgon. Ett lugnt distanspass ska aldrig trigga något — då
 * blir kortet en daglig notis och slutar läsas. Baslinjekravet (fallgrop 3,
 * MIN_BASELINE_DAYS) kräver ingen egen kontroll här: computeDailyStatus kan
 * bara sätta `shouldEaseOff` när markörerna redan har en mogen baslinje, så
 * gaten ärvs gratis av att vi återanvänder `status.shouldEaseOff` rakt av.
 * ------------------------------------------------------------------------ */

import { WORKOUT_LABELS, type WorkoutType } from "@/lib/planning";
import { plannedSignatureLabel, type PlannedRepGroup } from "@/lib/session-signature";
import type { DailyStatus } from "@/lib/daily-status";

/** Ett planerat pass, med fältnamn som i planned_workouts + nästlade
 * planned_rep_groups (K1). Saknas repgrupper (migrationen inte körd, eller
 * passet har inga) tolkas det som "inga" — samma försiktiga `?? []`-princip
 * som PlannedSessions.tsx. */
export type ReadinessWorkout = {
  workout_type: string;
  title: string | null;
  planned_rep_groups?:
    | {
        reps: number;
        distance_meters: number | null;
        duration_seconds: number | null;
        sort_order: number;
      }[]
    | null;
};

export type ReadinessAlert = {
  /** "Imorgon: 5×1000 m tröskel" — namnger passet (eller båda, vid
   * dubbeltröskel). */
  heading: string;
  /** "HRV och sömn ligger utanför det normala andra dagen i rad." */
  markerSentence: string;
};

function repGroupsToPlanned(rows: ReadinessWorkout["planned_rep_groups"]): PlannedRepGroup[] {
  return (rows ?? []).map((g) => ({
    reps: g.reps,
    distanceMeters: g.distance_meters,
    durationSeconds: g.duration_seconds,
    sortOrder: g.sort_order,
  }));
}

/** Passets namn i kortet. Signaturen (K1) ensam säger inte vilken sorts pass
 * det är — "5×1000 m" kan vara både tröskel och intervall — så typordet
 * hängs på. Har passet ingen repgrupp används tränarens egen titel rakt av,
 * och i sista hand bara typnamnet (som redan är passets enda beskrivning). */
function workoutName(w: ReadinessWorkout): string {
  const sigLabel = plannedSignatureLabel(repGroupsToPlanned(w.planned_rep_groups));
  const typeLabel = WORKOUT_LABELS[w.workout_type as WorkoutType] ?? w.workout_type;
  if (sigLabel) return `${sigLabel} ${typeLabel.toLowerCase()}`;
  if (w.title?.trim()) return w.title.trim();
  return typeLabel;
}

/** Mitt i en mening ska bara "riktiga" ord bli gemener — HRV är en
 * förkortning och ska behålla sina versaler oavsett position. */
function lowerMarkerWord(label: string): string {
  if (label === label.toUpperCase()) return label;
  return label.charAt(0).toLowerCase() + label.slice(1);
}

/** "a", "a och b", "a, b och c" — vanlig svensk uppräkning. */
function joinSwedish(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} och ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} och ${items[items.length - 1]}`;
}

function capitalize(s: string): string {
  return s.length ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/**
 * Bygger K3-kortets text, eller null om det inte finns något att säga.
 *
 * `tomorrowWorkouts` ska redan vara filtrerad till QUALITY_WORKOUT_TYPES av
 * anroparen (frågan filtrerar på databasnivå — se dashboard/page.tsx) så att
 * den här funktionen aldrig behöver importera passtypslistan för att
 * kontrollera den igen.
 *
 * `wasEasingOffYesterday` styr "andra dagen i rad" — sant när
 * `computeDailyStatus` för gårdagen (samma markördata, en dag tidigare) också
 * gav `shouldEaseOff`. Går det inte att räkna fram (t.ex. ingen historik för
 * gårdagen) ska anroparen skicka `false` — texten utelämnar då tillägget
 * hellre än att gissa (fallgrop i K3-avsnittet).
 */
export function buildReadinessAlert(
  status: DailyStatus,
  tomorrowWorkouts: ReadinessWorkout[],
  wasEasingOffYesterday: boolean,
): ReadinessAlert | null {
  if (!status.shouldEaseOff || tomorrowWorkouts.length === 0) return null;

  const heading = `Imorgon: ${tomorrowWorkouts.map(workoutName).join(" och ")}`;

  const markers = joinSwedish(status.concerning.map((m) => lowerMarkerWord(m.spec.label)));
  const streak = wasEasingOffYesterday ? " andra dagen i rad" : "";
  const markerSentence = `${capitalize(markers)} ligger utanför det normala${streak}.`;

  return { heading, markerSentence };
}
