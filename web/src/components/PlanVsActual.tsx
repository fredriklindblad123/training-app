import { CATEGORY_LABELS, isActivityCategory } from "@/lib/categories";
import { SLOT_LABELS, WORKOUT_LABELS, workoutTypeColorVar, type WorkoutType } from "@/lib/planning";
import { formatDuration, formatKm } from "@/lib/format";
import type { TrainingSession } from "@/lib/sessions";

/* Plan mot utfall för en dag.
 *
 * Jämförelsen görs mot *passet*, inte mot en enskild Garmin-aktivitet. Den
 * tidigare versionen jämförde mot dagens första aktivitet, vilket nästan
 * alltid är uppvärmningen — ett planerat 40-minuterspass såg då ut att ha
 * blivit 15 minuter. Uppvärmning, huvudpass och nerjogg loggas som separata
 * aktiviteter (se avsnitt 1.3 i docs/insikter-roadmap.md), så bara det
 * sammanslagna passet är jämförbart med en plan. */

export type PlannedWorkout = {
  id: string;
  slot: number | null;
  workout_type: string;
  title: string | null;
  description: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  status: string;
};

function typeLabel(type: string): string {
  if (type === "rest") return WORKOUT_LABELS.rest;
  if (isActivityCategory(type)) return CATEGORY_LABELS[type];
  return WORKOUT_LABELS[type as WorkoutType] ?? type;
}

function Dot({ type }: { type: string | null }) {
  const color = type ? workoutTypeColorVar(type) : null;
  if (!color) {
    return (
      <span className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border border-zinc-300 dark:border-zinc-600" />
    );
  }
  return (
    <span
      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: color }}
    />
  );
}

/** Skillnad mot mål, formulerad i klartext. Null när målet saknas — då finns
 * inget att avvika från och en siffra hade varit påhittad. */
function deviation(
  actual: number | null,
  target: number | null,
  format: (v: number) => string,
): { text: string; off: boolean } | null {
  if (actual == null || target == null || target <= 0) return null;
  const diff = actual - target;
  // Under fem procents avvikelse är skillnaden mindre än osäkerheten i en
  // GPS-mätning och i hur ett pass råkar bli — inte värt att flagga.
  if (Math.abs(diff) / target < 0.05) return { text: "enligt plan", off: false };
  return {
    text: `${diff > 0 ? "+" : "−"}${format(Math.abs(diff))} mot plan`,
    off: true,
  };
}

function Pair({
  planned,
  session,
}: {
  planned: PlannedWorkout | null;
  session: TrainingSession | null;
}) {
  const plannedType = planned?.workout_type ?? null;
  const actualType = session?.category ?? null;
  const typesMatch = plannedType != null && actualType != null && plannedType === actualType;

  const distDev = deviation(
    session?.distanceMeters ?? null,
    planned?.target_distance_meters ?? null,
    (v) => formatKm(v),
  );
  const timeDev = deviation(
    session?.durationSeconds ?? null,
    planned?.target_duration_seconds ?? null,
    (v) => formatDuration(v),
  );

  return (
    <div className="rounded border border-zinc-200 dark:border-zinc-800">
      {planned?.slot && planned.slot > 1 && (
        <div className="border-b border-zinc-100 px-3 py-1 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
          {SLOT_LABELS[planned.slot] ?? `Pass ${planned.slot}`}
        </div>
      )}
      <div className="grid grid-cols-1 divide-y divide-zinc-100 sm:grid-cols-2 sm:divide-x sm:divide-y-0 dark:divide-zinc-800">
        {/* Planerat */}
        <div className="p-3">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Planerat</div>
          {planned ? (
            <>
              <div className="mt-1 flex items-center gap-2">
                <Dot type={plannedType} />
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {typeLabel(planned.workout_type)}
                </span>
              </div>
              {planned.title && (
                <div className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
                  {planned.title}
                </div>
              )}
              <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {[
                  planned.target_distance_meters
                    ? formatKm(planned.target_distance_meters)
                    : null,
                  planned.target_duration_seconds
                    ? formatDuration(planned.target_duration_seconds)
                    : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "inget mål satt"}
              </div>
              {planned.description && (
                <div className="mt-1 text-xs whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">
                  {planned.description}
                </div>
              )}
            </>
          ) : (
            <div className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
              Inget planerat pass — träningen var alltså inte inplanerad.
            </div>
          )}
        </div>

        {/* Genomfört */}
        <div className="p-3">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Genomfört</div>
          {session ? (
            <>
              <div className="mt-1 flex items-center gap-2">
                <Dot type={actualType} />
                <span
                  className={`font-medium ${
                    plannedType && !typesMatch
                      ? "text-amber-700 dark:text-amber-400"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {actualType ? typeLabel(actualType) : "Okategoriserat"}
                </span>
              </div>
              <div className="mt-0.5 text-sm text-zinc-700 dark:text-zinc-300">
                {session.activities.length > 1
                  ? `${session.activities.length} aktiviteter sammanslagna`
                  : (session.activities[0]?.name ?? "").trim() || "Pass"}
              </div>
              <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                {[
                  session.distanceMeters ? formatKm(session.distanceMeters) : null,
                  session.durationSeconds ? formatDuration(session.durationSeconds) : null,
                  session.avgHr ? `${Math.round(session.avgHr)} slag/min` : null,
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </div>
            </>
          ) : (
            <div className="mt-1 text-sm text-zinc-400 dark:text-zinc-500">
              Inget genomfört pass registrerat.
            </div>
          )}
        </div>
      </div>

      {/* Sammanfattning av avvikelsen */}
      {planned && session && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-zinc-100 px-3 py-2 text-xs dark:border-zinc-800">
          <span
            className={
              typesMatch
                ? "text-emerald-700 dark:text-emerald-400"
                : "text-amber-700 dark:text-amber-400"
            }
          >
            {typesMatch ? "Passtypen stämmer" : "Annan passtyp än planerat"}
          </span>
          {distDev && (
            <span
              className={
                distDev.off
                  ? "text-zinc-600 dark:text-zinc-400"
                  : "text-emerald-700 dark:text-emerald-400"
              }
            >
              Distans: {distDev.text}
            </span>
          )}
          {timeDev && (
            <span
              className={
                timeDev.off
                  ? "text-zinc-600 dark:text-zinc-400"
                  : "text-emerald-700 dark:text-emerald-400"
              }
            >
              Tid: {timeDev.text}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Parar ihop dagens planerade pass med dagens genomförda pass.
 *
 * Paras i ordning: första planerade mot första genomförda. Vid dubbelpass
 * blir det förmiddag mot förmiddag. Om antalen skiljer sig visas det
 * överskjutande ensamt — ett planerat pass utan utfall är lika intressant
 * som ett genomfört pass som inte var planerat.
 */
export function PlanVsActual({
  planned,
  sessions,
}: {
  planned: PlannedWorkout[];
  sessions: TrainingSession[];
}) {
  const sortedPlanned = [...planned].sort((a, b) => (a.slot ?? 1) - (b.slot ?? 1));
  const sortedSessions = [...sessions].sort((a, b) => a.startTime.localeCompare(b.startTime));
  const rows = Math.max(sortedPlanned.length, sortedSessions.length);

  if (rows === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Varken planerat eller genomfört pass den här dagen.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Pair
          key={sortedPlanned[i]?.id ?? sortedSessions[i]?.id ?? i}
          planned={sortedPlanned[i] ?? null}
          session={sortedSessions[i] ?? null}
        />
      ))}
    </div>
  );
}
