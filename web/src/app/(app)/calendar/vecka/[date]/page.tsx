import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { BlockBand, HorizonToggle, type BandBlock } from "@/components/CalendarHorizon";
import {
  CATEGORY_LABELS,
  isActivityCategory,
} from "@/lib/categories";
import { WORKOUT_LABELS, SLOT_LABELS, workoutTypeColorVar, type WorkoutType } from "@/lib/planning";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import { formatDuration, formatKm } from "@/lib/format";
import { SV_WEEKDAYS_SHORT, STATUS_COLOR, STATUS_LABEL, type DayStatus } from "@/lib/calendar-utils";
import { weekLabel } from "@/lib/stats-utils";

/* Veckovyn. Den saknades helt tidigare, trots att veckan är den enhet
 * träningen faktiskt planeras i — en veckomall är en vecka, och ett
 * träningsblock mäts i veckor. Månadsvyn är för grov för att se plan mot
 * utfall per dag, och dagvyn för smal för att se helheten. */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function mondayOf(dateKey: string): Date {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function typeLabel(type: string): string {
  if (isActivityCategory(type)) return CATEGORY_LABELS[type];
  return WORKOUT_LABELS[type as WorkoutType] ?? type;
}

function Dot({ type, dashed = false }: { type: string | null; dashed?: boolean }) {
  const color = type ? workoutTypeColorVar(type) : null;
  return (
    <span
      className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
      style={
        color
          ? { backgroundColor: color }
          : { border: dashed ? "1.5px dashed currentColor" : "1.5px solid currentColor" }
      }
      aria-hidden="true"
    />
  );
}

export default async function WeekPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const monday = mondayOf(date);
  const sunday = addDays(monday, 6);
  const from = toKey(monday);
  const to = toKey(sunday);
  const nextExclusive = toKey(addDays(sunday, 1));
  const todayKey = toKey(new Date());

  const supabase = await createClient();
  const [
    { data: activityRows },
    { data: plannedRows },
    { data: diaryRows },
    { data: blockRows },
    { data: competitionRows },
  ] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", from)
      .lt("start_time", nextExclusive)
      .order("start_time"),
    supabase
      .from("planned_workouts")
      .select("id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds")
      .gte("scheduled_date", from)
      .lte("scheduled_date", to)
      .order("slot"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type, notes")
      .gte("entry_date", from)
      .lte("entry_date", to),
    supabase
      .from("season_blocks")
      .select("id, name, block_type, start_date, end_date, focus")
      .lte("start_date", to)
      .gte("end_date", from),
    supabase
      .from("competitions")
      .select("id, name, competition_date, priority")
      .gte("competition_date", from)
      .lte("competition_date", to),
  ]);

  const sessions = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );

  const sessionsByDay = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    sessionsByDay.set(s.date, [...(sessionsByDay.get(s.date) ?? []), s]);
  }

  type PlannedRow = {
    id: string;
    scheduled_date: string;
    slot: number | null;
    workout_type: string;
    title: string | null;
    target_distance_meters: number | null;
    target_duration_seconds: number | null;
  };
  const plannedByDay = new Map<string, PlannedRow[]>();
  for (const p of (plannedRows ?? []) as PlannedRow[]) {
    plannedByDay.set(p.scheduled_date, [...(plannedByDay.get(p.scheduled_date) ?? []), p]);
  }

  const diaryByDay = new Map(
    (diaryRows ?? []).map((d) => [d.entry_date as string, d as { day_type: string | null; notes: string | null }]),
  );
  const competitionsByDay = new Map<string, { name: string; priority: string }[]>();
  for (const c of competitionRows ?? []) {
    const day = c.competition_date as string;
    competitionsByDay.set(day, [
      ...(competitionsByDay.get(day) ?? []),
      { name: c.name as string, priority: c.priority as string },
    ]);
  }

  // Veckosummor räknas på pass, inte på aktiviteter — annars räknas
  // uppvärmning och nerjogg som egna pass i "antal pass".
  const totalKm = sessions.reduce((sum, s) => sum + (s.distanceMeters ?? 0), 0) / 1000;
  const totalSeconds = sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
  const totalLoad = sessions.reduce((sum, s) => sum + (s.trainingLoad ?? 0), 0);
  const plannedCount = (plannedRows ?? []).length;

  const monthHref = `/calendar/${monday.getFullYear()}/${monday.getMonth() + 1}`;
  const yearHref = `/calendar/${monday.getFullYear()}`;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/calendar/vecka/${toKey(addDays(monday, -7))}`}
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            ←
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
            {weekLabel(from)}
          </h1>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {from} – {to}
          </span>
          <Link
            href={`/calendar/vecka/${toKey(addDays(monday, 7))}`}
            className="rounded border border-zinc-300 px-2 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            →
          </Link>
        </div>
        <HorizonToggle
          current="week"
          weekHref={`/calendar/vecka/${todayKey}`}
          monthHref={monthHref}
          yearHref={yearHref}
        />
      </div>

      <BlockBand blocks={(blockRows ?? []) as BandBlock[]} from={from} to={to} />

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Pass", value: String(sessions.length) },
          { label: "Distans", value: totalKm > 0 ? `${totalKm.toFixed(1)} km` : "—" },
          { label: "Tid", value: totalSeconds > 0 ? formatDuration(totalSeconds) : "—" },
          { label: "Belastning", value: totalLoad > 0 ? String(Math.round(totalLoad)) : "—" },
        ].map((tile) => (
          <div key={tile.label} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</dt>
            <dd className="mt-0.5 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>
      {plannedCount > 0 && (
        <p className="-mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {plannedCount} planerade pass den här veckan.
        </p>
      )}

      <div className="grid grid-cols-1 gap-2 lg:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => {
          const d = addDays(monday, i);
          const key = toKey(d);
          const planned = plannedByDay.get(key) ?? [];
          const done = sessionsByDay.get(key) ?? [];
          const diary = diaryByDay.get(key);
          const comps = competitionsByDay.get(key) ?? [];
          const status = (diary?.day_type ?? (done.length > 0 ? "training" : null)) as
            | DayStatus
            | null;
          const isToday = key === todayKey;

          return (
            <Link
              key={key}
              href={`/calendar/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`}
              className={`flex min-h-40 flex-col gap-1.5 rounded border p-2 hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                isToday
                  ? "border-zinc-900 dark:border-zinc-100"
                  : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-medium text-zinc-900 dark:text-zinc-100">
                  {SV_WEEKDAYS_SHORT[i]} {d.getDate()}
                </span>
                {status && (
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] text-white ${STATUS_COLOR[status]}`}
                  >
                    {STATUS_LABEL[status]}
                  </span>
                )}
              </div>

              {comps.map((c, ci) => (
                <div
                  key={ci}
                  className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-950/40 dark:text-red-300"
                >
                  {c.priority} · {c.name}
                </div>
              ))}

              {/* Planerat */}
              {planned.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <div className="text-[10px] tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
                    Plan
                  </div>
                  {planned.map((p) => (
                    <div key={p.id} className="flex items-start gap-1.5 text-[11px]">
                      <Dot type={p.workout_type} dashed={p.workout_type === "rest"} />
                      <span className="text-zinc-700 dark:text-zinc-300">
                        {(p.slot ?? 1) > 1 && (
                          <span className="text-zinc-400">
                            {(SLOT_LABELS[p.slot as number] ?? "").slice(0, 2)}{" "}
                          </span>
                        )}
                        {p.title ?? typeLabel(p.workout_type)}
                        {p.target_duration_seconds
                          ? ` · ${Math.round(p.target_duration_seconds / 60)}′`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {/* Utfall */}
              {done.length > 0 && (
                <div className="flex flex-col gap-0.5">
                  <div className="text-[10px] tracking-wide text-zinc-400 uppercase dark:text-zinc-500">
                    Utfall
                  </div>
                  {done.map((s) => (
                    <div key={s.id} className="flex items-start gap-1.5 text-[11px]">
                      <Dot type={s.category} />
                      <span className="text-zinc-900 dark:text-zinc-100">
                        {s.category ? typeLabel(s.category) : "Pass"}
                        {s.distanceMeters ? ` · ${formatKm(s.distanceMeters)}` : ""}
                        {s.durationSeconds
                          ? ` · ${Math.round(s.durationSeconds / 60)}′`
                          : ""}
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {planned.length === 0 && done.length === 0 && !status && (
                <span className="text-[11px] text-zinc-300 dark:text-zinc-700">—</span>
              )}

              {diary?.notes && (
                <p className="mt-auto line-clamp-3 text-[10px] text-zinc-500 dark:text-zinc-400">
                  {diary.notes}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Utfallet visas per pass, inte per Garmin-aktivitet: uppvärmning, huvudpass och
        nerjogg slås ihop till ett pass. Två pass samma dag hålls isär när det skiljer mer
        än ett par timmar mellan dem.
      </p>
    </div>
  );
}
