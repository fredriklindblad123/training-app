import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getScopedProfile,
  resolveScopedUserId,
  viewableAthletes,
  type AthleteOption,
} from "@/lib/auth-scope";
import { WEEKDAY_LABELS } from "@/lib/planning";
import { CATEGORY_LABELS, categoryColorVar } from "@/lib/categories";
import { formatDuration, formatKm, formatPace } from "@/lib/format";
import {
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import { matchPlanToSessions, type PlanOutcome, type PlannedWorkout } from "@/lib/plan-matching";
import { PlannedSessions, type PlannedRow } from "@/components/PlannedSessions";
import {
  addPlannedRepGroup,
  deletePlannedRepGroup,
  deletePlannedWorkout,
  updatePlannedRepGroup,
  updatePlannedWorkout,
} from "@/app/(app)/calendar/[year]/[month]/[day]/actions";

/* Dagsvy för flera löpare samtidigt (uttrycklig begäran 2026-08-22): klick
 * på ett pass i Detaljplans veckovy landar här, med en kolumn per löpare i
 * det urval man stod på. Kalenderns dagvy visar samma sak för EN löpare —
 * den här sidan finns för att kunna läsa flera mot varandra utan att klicka
 * fram och tillbaka.
 *
 * Hela dagen visas, inte bara det pass som klickades: det var det som
 * efterfrågades ("dagsvyn, med all information"), och matchPlanToSessions
 * parar ändå ihop plan och utfall över hela dagen (en dubbeltröskeldag har
 * två av varje).
 *
 * Redigering av planerade pass sker med kalenderdagvyns egna actions —
 * ingen kopia av den logiken här, så ett pass beter sig likadant oavsett
 * vilken av de två vyerna man råkar redigera det i. */

type DiaryRow = {
  notes: string | null;
  session_log: string | null;
  coach_notes: string | null;
  day_type: string | null;
  rpe: number | null;
  feeling: number | null;
  motivation: number | null;
  soreness_level: number | null;
};

type MetricsRow = {
  sleep_seconds: number | null;
  sleep_score: number | null;
  resting_hr: number | null;
  hrv_overnight_avg: number | null;
};

const OUTCOME_STYLE: Record<PlanOutcome, string> = {
  "genomfört": "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100",
  "avvikande typ": "bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100",
  "ej genomfört": "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200",
  "oplanerat": "bg-sky-100 text-sky-900 dark:bg-sky-900/50 dark:text-sky-100",
};

function weekdayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return WEEKDAY_LABELS[(d.getUTCDay() + 6) % 7];
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-t border-zinc-100 pt-2 dark:border-zinc-900">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">{title}</div>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function SessionCard({ session, outcome }: { session: TrainingSession; outcome: PlanOutcome | null }) {
  const pace =
    session.distanceMeters > 0 ? (session.durationSeconds / session.distanceMeters) * 1000 : null;
  return (
    <div className="rounded border border-zinc-200 p-2 text-sm dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-1.5">
        <span
          className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ backgroundColor: categoryColorVar(session.category) }}
          aria-hidden="true"
        />
        <span className="text-zinc-900 dark:text-zinc-100">{CATEGORY_LABELS[session.category]}</span>
        {outcome && (
          <span className={`rounded-full px-1.5 py-0.5 text-[10px] ${OUTCOME_STYLE[outcome]}`}>
            {outcome}
          </span>
        )}
      </div>
      <div className="mt-0.5 text-xs text-zinc-600 dark:text-zinc-400">
        {formatDuration(session.durationSeconds)}
        {session.distanceMeters > 0 ? ` · ${formatKm(session.distanceMeters)}` : ""}
        {pace ? ` · ${formatPace(pace)}` : ""}
      </div>
      <div className="text-xs text-zinc-600 dark:text-zinc-400">
        {session.avgHr != null ? `snittpuls ${session.avgHr}` : "ingen puls"}
        {session.maxHr != null ? ` · max ${session.maxHr}` : ""}
      </div>
      {/* Ett pass är ofta flera Garmin-aktiviteter (uppvärmning, huvudpass,
          nerjogg) — se lib/sessions.ts. Att visa fragmenten gör det
          begripligt varför tid och distans ser ut som de gör. */}
      {session.activities.length > 1 && (
        <ul className="mt-1 flex flex-col gap-0.5 text-xs text-zinc-500 dark:text-zinc-500">
          {session.activities.map((a) => (
            <li key={a.id}>
              {a.name ?? "Aktivitet"} · {formatDuration(a.duration_seconds)}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AthleteColumn({
  athlete,
  dateKey,
  planned,
  sessions,
  outcomeBySessionId,
  unplannedCount,
  diary,
  metrics,
  canEdit,
}: {
  athlete: AthleteOption;
  dateKey: string;
  planned: PlannedRow[];
  sessions: TrainingSession[];
  outcomeBySessionId: Map<string, PlanOutcome>;
  unplannedCount: number;
  diary: DiaryRow | null;
  metrics: MetricsRow | null;
  canEdit: boolean;
}) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const hasDiary =
    diary != null &&
    (diary.notes || diary.session_log || diary.coach_notes || diary.rpe != null ||
      diary.feeling != null || diary.motivation != null || diary.soreness_level != null);

  return (
    <div className="flex min-w-[19rem] flex-1 flex-col gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          {athlete.fullName ?? "Namnlös löpare"}
        </span>
        <Link
          href={`/calendar/${y}/${m}/${d}?athlete=${athlete.id}`}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Hennes kalenderdag →
        </Link>
      </div>

      <Block title="Planerat">
        {/* Samma komponent och samma actions som kalenderns dagvy, så ett
            planerat pass redigeras likadant i båda. */}
        {canEdit ? (
          <PlannedSessions
            planned={planned}
            updateAction={updatePlannedWorkout}
            deleteAction={deletePlannedWorkout}
            addRepGroupAction={addPlannedRepGroup}
            updateRepGroupAction={updatePlannedRepGroup}
            deleteRepGroupAction={deletePlannedRepGroup}
          />
        ) : planned.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">Inget planerat pass.</p>
        ) : (
          <ul className="flex flex-col gap-1 text-sm text-zinc-800 dark:text-zinc-200">
            {planned.map((p) => (
              <li key={p.id}>{p.title || p.workout_type}</li>
            ))}
          </ul>
        )}
      </Block>

      <Block title="Genomfört">
        {sessions.length === 0 ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">Inget genomfört pass.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {sessions.map((s) => (
              <SessionCard key={s.id} session={s} outcome={outcomeBySessionId.get(s.id) ?? null} />
            ))}
            {unplannedCount > 0 && (
              <p className="text-xs text-zinc-500 dark:text-zinc-500">
                {unplannedCount} av passen fanns inte i planen.
              </p>
            )}
          </div>
        )}
      </Block>

      <Block title="Dagbok">
        {!hasDiary ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">Inget ifyllt.</p>
        ) : (
          <div className="flex flex-col gap-1 text-sm">
            {diary?.day_type && diary.day_type !== "training" && (
              <div className="text-xs font-medium text-amber-700 dark:text-amber-500">
                {diary.day_type}
              </div>
            )}
            {diary?.session_log && (
              <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                {diary.session_log}
              </p>
            )}
            {diary?.notes && (
              <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{diary.notes}</p>
            )}
            {diary?.coach_notes && (
              <p className="whitespace-pre-wrap text-xs italic text-zinc-500 dark:text-zinc-500">
                Tränare: {diary.coach_notes}
              </p>
            )}
            {(diary?.feeling != null ||
              diary?.rpe != null ||
              diary?.motivation != null ||
              diary?.soreness_level != null) && (
              <div className="text-xs text-zinc-500 dark:text-zinc-400">
                {diary?.feeling != null ? `känsla ${diary.feeling}/5` : ""}
                {diary?.rpe != null ? ` · RPE ${diary.rpe}` : ""}
                {diary?.motivation != null ? ` · motivation ${diary.motivation}/5` : ""}
                {diary?.soreness_level != null ? ` · ömhet ${diary.soreness_level}/5` : ""}
              </div>
            )}
          </div>
        )}
      </Block>

      <Block title="Dygnet">
        {metrics == null ? (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">Ingen data.</p>
        ) : (
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            {metrics.sleep_seconds != null ? `sömn ${formatDuration(metrics.sleep_seconds)}` : "ingen sömndata"}
            {metrics.sleep_score != null ? ` (${metrics.sleep_score})` : ""}
            {metrics.resting_hr != null ? ` · vilopuls ${metrics.resting_hr}` : ""}
            {metrics.hrv_overnight_avg != null ? ` · HRV ${Math.round(metrics.hrv_overnight_avg)}` : ""}
          </div>
        )}
      </Block>
    </div>
  );
}

export default async function PassDayPage({
  searchParams,
}: {
  searchParams: Promise<{ block?: string; date?: string; slot?: string; athlete?: string }>;
}) {
  const { block: blockId, date: dateKey, athlete: athleteParam } = await searchParams;
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) notFound();

  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;

  const athletesById = new Map(viewableAthletes(scoped).map((a) => [a.id, a]));
  const showAll = athleteParam === "alla" || (athleteParam == null && scoped.role === "coach");
  const focusId = showAll ? null : resolveScopedUserId(scoped, athleteParam ?? undefined);

  // Vilka löpare kolumnerna gäller: blockets taggade löpare (det är därifrån
  // man klickade), begränsat till urvalet vyn stod på. Utan block faller vi
  // tillbaka på den enskilda löparen — sidan ska aldrig visa fler än man
  // valt.
  let candidateIds: string[] = [];
  let blockName: string | null = null;
  if (blockId) {
    const { data: block } = await supabase
      .from("season_blocks")
      .select("id, name, season_block_athletes(athlete_id)")
      .eq("id", blockId)
      .maybeSingle();
    if (block) {
      blockName = block.name as string;
      candidateIds = ((block.season_block_athletes ?? []) as { athlete_id: string }[]).map(
        (r) => r.athlete_id,
      );
    }
  }
  if (candidateIds.length === 0 && focusId) candidateIds = [focusId];
  const athleteIds = candidateIds.filter((id) => (focusId ? id === focusId : true));
  if (athleteIds.length === 0) notFound();

  const nextDate = new Date(`${dateKey}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateKey = nextDate.toISOString().slice(0, 10);

  const [
    { data: plannedRows },
    { data: activityRows },
    { data: diaryRows },
    { data: metricRows },
  ] = await Promise.all([
    supabase
      .from("planned_workouts")
      .select("*, season_blocks(name), planned_rep_groups(*)")
      .in("user_id", athleteIds)
      .eq("scheduled_date", dateKey)
      .order("slot", { ascending: true }),
    supabase
      .from("activities")
      .select("*, activity_splits(*)")
      .in("user_id", athleteIds)
      .gte("start_time", dateKey)
      .lt("start_time", nextDateKey)
      .order("start_time"),
    supabase.from("diary_entries").select("*").in("user_id", athleteIds).eq("entry_date", dateKey),
    supabase.from("daily_metrics").select("*").in("user_id", athleteIds).eq("metric_date", dateKey),
  ]);

  const byAthlete = <T extends { user_id: string }>(rows: T[] | null) => {
    const m = new Map<string, T[]>();
    for (const r of rows ?? []) m.set(r.user_id, [...(m.get(r.user_id) ?? []), r]);
    return m;
  };
  const plannedBy = byAthlete((plannedRows ?? []) as (PlannedRow & { user_id: string })[]);
  const activitiesBy = byAthlete((activityRows ?? []) as unknown as (SessionActivity & { user_id: string })[]);
  const diaryBy = new Map(((diaryRows ?? []) as (DiaryRow & { user_id: string })[]).map((r) => [r.user_id, r]));
  const metricsBy = new Map(
    ((metricRows ?? []) as (MetricsRow & { user_id: string })[]).map((r) => [r.user_id, r]),
  );

  const columns = athleteIds
    .map((id) => athletesById.get(id))
    .filter((a): a is AthleteOption => a != null)
    .map((athlete) => {
      const planned = plannedBy.get(athlete.id) ?? [];
      const sessions = groupActivitiesIntoSessions(activitiesBy.get(athlete.id) ?? []);
      // Utfallet räknas per löpare — matchningen parar plan mot session inom
      // en dag, så två löpares dagar får aldrig blandas i samma anrop.
      const matches = matchPlanToSessions(planned as unknown as PlannedWorkout[], sessions);
      const outcomeBySessionId = new Map<string, PlanOutcome>();
      for (const m of matches) {
        if (m.session) outcomeBySessionId.set(m.session.id, m.outcome);
      }
      return {
        athlete,
        planned,
        sessions,
        outcomeBySessionId,
        unplannedCount: matches.filter((m) => m.outcome === "oplanerat").length,
        diary: diaryBy.get(athlete.id) ?? null,
        metrics: metricsBy.get(athlete.id) ?? null,
      };
    });

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
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          {weekdayLabel(dateKey)} {dateKey}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {columns.length === 1
            ? columns[0].athlete.fullName ?? "Namnlös löpare"
            : `${columns.length} löpare sida vid sida`}
          {blockName ? ` · ${blockName}` : ""}
        </p>
      </div>

      {columns.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Inga löpare att visa.</p>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          {columns.map((c) => (
            <AthleteColumn
              key={c.athlete.id}
              athlete={c.athlete}
              dateKey={dateKey}
              planned={c.planned}
              sessions={c.sessions}
              outcomeBySessionId={c.outcomeBySessionId}
              unplannedCount={c.unplannedCount}
              diary={c.diary}
              metrics={c.metrics}
              canEdit={scoped.role === "coach" || scoped.coachId == null}
            />
          ))}
        </div>
      )}
    </div>
  );
}
