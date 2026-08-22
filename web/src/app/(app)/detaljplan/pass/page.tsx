import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getScopedProfile,
  resolveScopedUserId,
  viewableAthletes,
  type AthleteOption,
} from "@/lib/auth-scope";
import {
  SLOT_LABELS,
  WEEKDAY_LABELS,
  WORKOUT_LABELS,
  workoutTypeColorVar,
  type WorkoutType,
} from "@/lib/planning";
import { TRAINING_FACTORS } from "@/lib/training-factors";
import { CATEGORY_LABELS, categoryColorVar } from "@/lib/categories";
import { formatDuration, formatKm, formatPace } from "@/lib/format";
import {
  groupActivitiesIntoSessions,
  SESSION_ACTIVITY_COLUMNS,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import {
  matchPlanToSessions,
  type PlanOutcome,
  type PlannedWorkout,
} from "@/lib/plan-matching";

/* Ett pass, alla löpare på det, sida vid sida (uttrycklig begäran
 * 2026-08-22). Chipsens namn i veckovyn länkar till kalenderns dagvy för EN
 * löpare i taget — den här sidan svarar på den andra frågan: "hur gick det
 * här passet för dem som körde det, jämfört med varandra?"
 *
 * Ingen ny sanning om vad "genomfört" betyder: samma väg som veckovyn,
 * /arsplan och kalendern använder — activities → groupActivitiesIntoSessions
 * → matchPlanToSessions, körd per löpare (matchningen parar plan mot utfall
 * inom en dag, så två löpares dagar får aldrig blandas i samma anrop). */

type PlannedRow = PlannedWorkout & {
  user_id: string;
  description: string | null;
  training_factor: string | null;
};

const OUTCOME_STYLE: Record<PlanOutcome, string> = {
  "genomfört": "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
  "avvikande typ": "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
  "ej genomfört": "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  "oplanerat": "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
};

function dayHref(dateKey: string, athleteId: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `/calendar/${y}/${m}/${d}?athlete=${athleteId}`;
}

function weekdayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return WEEKDAY_LABELS[(d.getUTCDay() + 6) % 7];
}

function factorLabel(key: string | null): string | null {
  if (!key) return null;
  return TRAINING_FACTORS.find((f) => f.key === key)?.label ?? key;
}

/** En löpares kolumn: plan till vänster om utfall, samma ordning för alla så
 * kolumnerna går att läsa vågrätt mot varandra. */
function AthleteColumn({
  athlete,
  planned,
  session,
  outcome,
  dateKey,
}: {
  athlete: AthleteOption;
  planned: PlannedRow | null;
  session: TrainingSession | null;
  outcome: PlanOutcome | null;
  dateKey: string;
}) {
  const plannedMinutes =
    planned?.target_duration_seconds != null
      ? Math.round(planned.target_duration_seconds / 60)
      : null;
  const pace =
    session && session.distanceMeters > 0
      ? (session.durationSeconds / session.distanceMeters) * 1000
      : null;

  return (
    <div className="flex min-w-[15rem] flex-1 flex-col gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Link
          href={dayHref(dateKey, athlete.id)}
          className="font-medium text-zinc-900 underline-offset-2 hover:underline dark:text-zinc-100"
        >
          {athlete.fullName ?? "Namnlös löpare"}
        </Link>
        {outcome && (
          <span className={`rounded-full px-2 py-0.5 text-xs ${OUTCOME_STYLE[outcome]}`}>
            {outcome}
          </span>
        )}
      </div>

      <div>
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Plan</div>
        {planned ? (
          <div className="mt-1 text-sm text-zinc-800 dark:text-zinc-200">
            <div>
              {WORKOUT_LABELS[planned.workout_type as WorkoutType] ?? planned.workout_type}
              {planned.title ? ` · ${planned.title}` : ""}
            </div>
            {factorLabel(planned.training_factor) && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {factorLabel(planned.training_factor)}
              </div>
            )}
            {plannedMinutes != null && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{plannedMinutes} min</div>
            )}
            {planned.description && (
              <p className="mt-1 whitespace-pre-wrap text-xs text-zinc-600 dark:text-zinc-400">
                {planned.description}
              </p>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-600">Inget planerat pass.</p>
        )}
      </div>

      <div className="border-t border-zinc-100 pt-2 dark:border-zinc-900">
        <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Utfall</div>
        {session ? (
          <div className="mt-1 flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-200">
            <div className="flex items-center gap-1.5">
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: categoryColorVar(session.category) }}
                aria-hidden="true"
              />
              {CATEGORY_LABELS[session.category]}
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {formatDuration(session.durationSeconds)}
              {session.distanceMeters > 0 ? ` · ${formatKm(session.distanceMeters)}` : ""}
              {pace ? ` · ${formatPace(pace)}` : ""}
            </div>
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              {session.avgHr != null ? `snittpuls ${session.avgHr}` : "ingen puls"}
              {session.maxHr != null ? ` · max ${session.maxHr}` : ""}
            </div>
            {/* Ett pass är ofta flera Garmin-aktiviteter (uppvärmning,
                huvudpass, nerjogg) — se lib/sessions.ts. Att visa dem gör
                det begripligt varför tid och distans ser ut som de gör. */}
            {session.activities.length > 1 && (
              <ul className="mt-0.5 flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-500">
                {session.activities.map((a) => (
                  <li key={a.id}>
                    {a.name ?? "Aktivitet"} · {formatDuration(a.duration_seconds)}
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : (
          <p className="mt-1 text-sm text-zinc-400 dark:text-zinc-600">Inget genomfört pass.</p>
        )}
      </div>

      <Link
        href={dayHref(dateKey, athlete.id)}
        className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
      >
        Öppna dagvyn →
      </Link>
    </div>
  );
}

export default async function PassPage({
  searchParams,
}: {
  searchParams: Promise<{ block?: string; date?: string; slot?: string; athlete?: string }>;
}) {
  const { block: blockId, date: dateKey, slot: slotParam, athlete: athleteParam } = await searchParams;
  if (!blockId || !dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) notFound();
  const slot = Number(slotParam ?? 1);
  if (!Number.isInteger(slot) || slot < 1 || slot > 3) notFound();

  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;

  const { data: block } = await supabase
    .from("season_blocks")
    .select("id, name, start_date, end_date, season_block_athletes(athlete_id)")
    .eq("id", blockId)
    .maybeSingle();
  if (!block) notFound();

  const athletesById = new Map(viewableAthletes(scoped).map((a) => [a.id, a]));
  // Samma filtrering som veckovyn: står man på en enskild löpare visas bara
  // hon, väljer man Alla visas alla på passet. Sidan nås från veckovyn och
  // ska visa exakt det urval man klickade i.
  const showAll = athleteParam === "alla" || (athleteParam == null && scoped.role === "coach");
  const focusId = showAll ? null : resolveScopedUserId(scoped, athleteParam ?? undefined);

  const blockAthleteIds = ((block.season_block_athletes ?? []) as { athlete_id: string }[])
    .map((r) => r.athlete_id)
    .filter((id) => (focusId ? id === focusId : true));
  if (blockAthleteIds.length === 0) notFound();

  const [{ data: plannedRows }, { data: activityRows }] = await Promise.all([
    supabase
      .from("planned_workouts")
      .select(
        "id, user_id, scheduled_date, slot, workout_type, title, description, target_distance_meters, target_duration_seconds, training_factor",
      )
      .eq("block_id", blockId)
      .eq("scheduled_date", dateKey)
      .eq("slot", slot)
      .in("user_id", blockAthleteIds),
    // Hela dagen, inte bara passets slot: matchPlanToSessions behöver dagens
    // alla pass och aktiviteter för att para ihop dem rätt (en dag med
    // dubbeltröskel har två av varje).
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .in("user_id", blockAthleteIds)
      .gte("start_time", dateKey)
      .lt("start_time", `${dateKey}T23:59:59`)
      .order("start_time"),
  ]);

  // Dagens ÖVRIGA planerade pass behövs också, av samma skäl.
  const { data: dayPlannedRows } = await supabase
    .from("planned_workouts")
    .select(
      "id, user_id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds",
    )
    .eq("scheduled_date", dateKey)
    .in("user_id", blockAthleteIds);

  const planned = (plannedRows ?? []) as PlannedRow[];
  const plannedById = new Map(planned.map((p) => [p.user_id, p]));

  const activitiesByAthlete = new Map<string, SessionActivity[]>();
  for (const a of (activityRows ?? []) as unknown as (SessionActivity & { user_id: string })[]) {
    activitiesByAthlete.set(a.user_id, [...(activitiesByAthlete.get(a.user_id) ?? []), a]);
  }
  const dayPlannedByAthlete = new Map<string, (PlannedWorkout & { user_id: string })[]>();
  for (const p of (dayPlannedRows ?? []) as (PlannedWorkout & { user_id: string })[]) {
    dayPlannedByAthlete.set(p.user_id, [...(dayPlannedByAthlete.get(p.user_id) ?? []), p]);
  }

  const columns = blockAthleteIds
    .map((id) => athletesById.get(id))
    .filter((a): a is AthleteOption => a != null)
    .map((athlete) => {
      const sessions = groupActivitiesIntoSessions(activitiesByAthlete.get(athlete.id) ?? []);
      const matches = matchPlanToSessions(dayPlannedByAthlete.get(athlete.id) ?? [], sessions);
      const mine = matches.find((m) => m.planned?.slot === slot || (slot === 1 && m.planned?.slot == null));
      return {
        athlete,
        planned: plannedById.get(athlete.id) ?? null,
        session: mine?.session ?? null,
        outcome: mine?.outcome ?? null,
      };
    });

  // Rubrikens plan är den gemensamma; skiljer den sig mellan löparna står
  // det i respektive kolumn.
  const lead = planned[0] ?? null;
  const typeColor = lead ? workoutTypeColorVar(lead.workout_type) : null;
  const backHref = `/detaljplan${showAll ? "?athlete=alla" : focusId ? `?athlete=${focusId}` : ""}`;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <Link
          href={backHref}
          className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Detaljplan
        </Link>
        <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          <span
            className="inline-block h-4 w-1.5 shrink-0 rounded"
            style={
              typeColor
                ? { backgroundColor: typeColor }
                : { border: "1.5px dashed currentColor" }
            }
            aria-hidden="true"
          />
          {lead
            ? (WORKOUT_LABELS[lead.workout_type as WorkoutType] ?? lead.workout_type)
            : "Pass"}
          {lead?.title ? ` · ${lead.title}` : ""}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {weekdayLabel(dateKey)} {dateKey}
          {slot > 1 ? ` · ${SLOT_LABELS[slot]}` : ""} · {block.name}
        </p>
      </div>

      {columns.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Inga löpare på det här passet.</p>
      ) : (
        <div className="flex flex-wrap gap-4">
          {columns.map((c) => (
            <AthleteColumn
              key={c.athlete.id}
              athlete={c.athlete}
              planned={c.planned}
              session={c.session}
              outcome={c.outcome}
              dateKey={dateKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}
