import { CATEGORY_LABELS } from "@/lib/categories";
import { SV_WEEKDAYS_SHORT } from "@/lib/calendar-utils";
import { WORKOUT_LABELS, type WorkoutType } from "@/lib/planning";
import type { Compliance, PlanMatch, PlannedWorkout } from "@/lib/plan-matching";

/* Efterlevnadskortet (K2, docs/tranarperspektiv.md). Presentation ovanpå
 * `summarizeCompliance` — ingen egen räkning här, bara formattering.
 *
 * Språkkravet är detsamma som för DailyStatus.tsx (P1.2): appen beskriver,
 * den dömer inte. Ingen procentsats i rött, ingen "bra jobbat". "5 av 6
 * genomförda" säger vad som hände utan att sätta betyg — 100 % kan lika
 * gärna betyda att ett pass kördes för tidigt som att allt gick perfekt
 * (fallgrop 1 i K2).
 *
 * Kortet visas bara när perioden faktiskt hade en plan (fallgrop 2): merparten
 * av historiken saknar planerade pass, och "0 av 0" i rött vore precis det
 * som fick planned_workouts att sluta användas första gången. Kontrollen
 * ligger här (inte hos varje anropare) så att veckovyn och blockvyn inte kan
 * råka implementera den olika. */

function weekdayShort(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return SV_WEEKDAYS_SHORT[(d.getDay() + 6) % 7];
}

function plannedLabel(p: PlannedWorkout): string {
  return p.title?.trim() || WORKOUT_LABELS[p.workout_type as WorkoutType] || p.workout_type;
}

/** "6 km · Tröskel" för en genomförd session — samma "distans · kategori"-form
 * som resten av kalendern använder. */
function sessionLabel(session: PlanMatch["session"]): string {
  if (!session) return "";
  const km = session.distanceMeters > 0 ? `${(session.distanceMeters / 1000).toFixed(1)} km · ` : "";
  return `${km}${CATEGORY_LABELS[session.category]}`;
}

/** Ej genomfört-raden: sjukdom och skada är inte samma sak som skippat
 * (fallgrop 3). `dayTypeByDate` är dagbokens `day_type` per datum — bara
 * `sick`/`injured` byter formulering, allt annat visas som det planerade
 * passet utan förklaring (appen vet inte varför, och ska inte gissa). */
function NotCompletedItem({
  match,
  dayTypeByDate,
}: {
  match: PlanMatch;
  dayTypeByDate: Map<string, string | null>;
}) {
  const planned = match.planned;
  if (!planned) return null;
  const dayType = dayTypeByDate.get(planned.scheduled_date);
  const cancelled = dayType === "sick" || dayType === "injured";
  return (
    <li className="text-zinc-700 dark:text-zinc-300">
      <span className="text-zinc-500 dark:text-zinc-400">
        {weekdayShort(planned.scheduled_date)}:{" "}
      </span>
      {plannedLabel(planned)}
      {cancelled && (
        <span className="text-zinc-500 dark:text-zinc-400">
          {" — inställt (dagboken: "}
          {dayType === "sick" ? "sjuk" : "skadad"})
        </span>
      )}
    </li>
  );
}

function UnplannedItem({ match }: { match: PlanMatch }) {
  const session = match.session;
  if (!session) return null;
  return (
    <li className="text-zinc-700 dark:text-zinc-300">
      <span className="text-zinc-500 dark:text-zinc-400">{weekdayShort(session.date)}: </span>
      {sessionLabel(session)}
    </li>
  );
}

export function ComplianceCard({
  title,
  compliance,
  dayTypeByDate = new Map(),
}: {
  /** "Vecka 31" eller blockets namn — kortet återanvänds i både veckovyn och
   * blockvyn på /trends. */
  title: string;
  compliance: Compliance;
  /** Dagbokens `day_type` per datum (YYYY-MM-DD), för att skilja sjukdom/
   * skada från ett pass som bara uteblev. Saknas den (blockvyn kan välja att
   * inte hämta dagboken) visas alla ej genomförda pass utan förklaring. */
  dayTypeByDate?: Map<string, string | null>;
}) {
  // Fallgrop 2: ingen plan, inget kort. Se filkommentaren.
  if (compliance.plannedCount === 0) return null;

  const {
    plannedCount,
    completedCount,
    qualityPlanned,
    qualityCompleted,
    plannedKm,
    actualKm,
    notCompleted,
    unplanned,
  } = compliance;

  const volumeDiffPct =
    plannedKm != null && plannedKm > 0
      ? Math.round(((actualKm - plannedKm) / plannedKm) * 100)
      : null;

  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">{title}</h2>
        <span className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">
          {completedCount} av {plannedCount} planerade pass genomförda
        </span>
      </div>

      {(qualityPlanned > 0 || plannedKm != null) && (
        <dl className="grid grid-cols-1 gap-x-6 gap-y-2 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800/60 sm:grid-cols-2">
          {qualityPlanned > 0 && (
            <div className="flex items-baseline justify-between gap-2 sm:justify-start">
              <dt className="text-zinc-500 dark:text-zinc-400">Kvalitetspass</dt>
              <dd className="text-zinc-900 dark:text-zinc-100 sm:ml-2">
                {qualityCompleted} av {qualityPlanned}
              </dd>
            </div>
          )}
          {plannedKm != null && (
            <div className="flex items-baseline justify-between gap-2 sm:justify-start">
              <dt className="text-zinc-500 dark:text-zinc-400">Volym</dt>
              <dd className="text-zinc-900 dark:text-zinc-100 sm:ml-2">
                {Math.round(actualKm)} km av planerade {Math.round(plannedKm)} km
                {volumeDiffPct != null && (
                  <span className="text-zinc-500 dark:text-zinc-400">
                    {" "}
                    ({volumeDiffPct > 0 ? "+" : ""}
                    {volumeDiffPct} %)
                  </span>
                )}
              </dd>
            </div>
          )}
        </dl>
      )}

      {notCompleted.length > 0 && (
        <div className="border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800/60">
          <span className="text-zinc-500 dark:text-zinc-400">Ej genomfört</span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {notCompleted.map((m) => (
              <NotCompletedItem key={m.planned!.id} match={m} dayTypeByDate={dayTypeByDate} />
            ))}
          </ul>
        </div>
      )}

      {unplanned.length > 0 && (
        <div className="border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800/60">
          <span className="text-zinc-500 dark:text-zinc-400">Oplanerat</span>
          <ul className="mt-1 flex flex-col gap-0.5">
            {unplanned.map((m) => (
              <UnplannedItem key={m.session!.id} match={m} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
