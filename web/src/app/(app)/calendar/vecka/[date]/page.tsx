import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CalendarNav } from "@/components/CalendarHorizon";
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
import { mentionsStrength } from "@/lib/diary-text";

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

/**
 * Ihålig ring = planerat (en avsikt), fylld prick = genomfört (något som
 * hänt). Skillnaden bär hela informationen i veckovyn, så den ska gå att
 * uppfatta utan att läsa någon etikett.
 */
function Marker({ type, planned }: { type: string | null; planned: boolean }) {
  const color = type ? workoutTypeColorVar(type) : null;
  return (
    <span
      className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={
        planned
          ? {
              // Ring i passets färg, ihålig mitt. Vila saknar färg och blir
              // streckad i stället.
              border: color ? `2px solid ${color}` : "1.5px dashed currentColor",
              backgroundColor: "transparent",
            }
          : { backgroundColor: color ?? "currentColor" }
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
      .select("entry_date, day_type, notes, session_log")
      .gte("entry_date", from)
      .lte("entry_date", to),
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
    (diaryRows ?? []).map((d) => [d.entry_date as string, d as { day_type: string | null; notes: string | null; session_log: string | null }]),
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
      <CalendarNav
        current="week"
        title={
          <>
            {weekLabel(from)}{" "}
            <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
              {from} – {to}
            </span>
          </>
        }
        prevHref={`/calendar/vecka/${toKey(addDays(monday, -7))}`}
        nextHref={`/calendar/vecka/${toKey(addDays(monday, 7))}`}
        jumpDate={from}
        dayHref={`/calendar/${monday.getFullYear()}/${monday.getMonth() + 1}/${monday.getDate()}`}
        weekHref={`/calendar/vecka/${todayKey}`}
        monthHref={monthHref}
        yearHref={yearHref}
      />

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
          // "Ledig" visas inte som egen status — se lib/day-status.ts.
          const diaryStatus = (
            diary?.day_type === "rest" ? null : (diary?.day_type ?? null)
          ) as DayStatus | null;
          // "Tränade" ovanpå ett synligt pass är ren upprepning. Badgen visas
          // bara när den säger något listan inte redan gör: en avvikande
          // dagtyp, eller att dagen är märkt som träning utan att något pass
          // finns loggat.
          const showStatus =
            diaryStatus != null && (diaryStatus !== "training" || done.length === 0);
          const isEmpty = planned.length === 0 && done.length === 0 && !diaryStatus;
          // Jämför bara första planerade mot första genomförda: ordningen är
          // den koppling som finns, och en fullständig parning hör hemma i
          // dagvyn snarare än i en cell på 150 pixlar.
          const mismatch =
            planned.length > 0 &&
            done.length > 0 &&
            planned[0].workout_type !== "rest" &&
            done[0].category != null &&
            planned[0].workout_type !== done[0].category;
          const isToday = key === todayKey;

          return (
            <Link
              key={key}
              href={`/calendar/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`}
              className={`flex min-h-36 flex-col gap-2 rounded border p-2.5 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                isToday
                  ? "border-zinc-900 dark:border-zinc-100"
                  : isEmpty
                    ? "border-zinc-100 dark:border-zinc-800/60"
                    : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className={`text-xs font-semibold ${
                    isEmpty
                      ? "text-zinc-400 dark:text-zinc-600"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {SV_WEEKDAYS_SHORT[i]} {d.getDate()}
                </span>
                {showStatus && diaryStatus && (
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] text-white ${STATUS_COLOR[diaryStatus]}`}
                    title={
                      diaryStatus === "training"
                        ? "Dagboken säger träning, men inget pass är loggat"
                        : STATUS_LABEL[diaryStatus]
                    }
                  >
                    {diaryStatus === "training" ? "Ej loggat" : STATUS_LABEL[diaryStatus]}
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

              {/* Planerat: ihåliga ringar, dämpad text */}
              {planned.map((p) => (
                <div
                  key={p.id}
                  className="flex items-start gap-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
                  title="Planerat"
                >
                  <Marker type={p.workout_type} planned />
                  <span>
                    {(p.slot ?? 1) > 1 && (
                      <span className="text-zinc-400 dark:text-zinc-500">
                        {(SLOT_LABELS[p.slot as number] ?? "").slice(0, 2).toLowerCase()}{" "}
                      </span>
                    )}
                    {p.title ?? typeLabel(p.workout_type)}
                    {p.target_duration_seconds
                      ? ` · ${Math.round(p.target_duration_seconds / 60)}′`
                      : ""}
                  </span>
                </div>
              ))}

              {/* Genomfört: fyllda prickar, full kontrast */}
              {done.map((sess) => (
                <div
                  key={sess.id}
                  className="flex items-start gap-1.5 text-[11px] leading-snug text-zinc-900 dark:text-zinc-100"
                  title="Genomfört"
                >
                  <Marker type={sess.category} planned={false} />
                  <span>
                    <span className="font-medium">
                      {sess.category ? typeLabel(sess.category) : "Pass"}
                    </span>
                    {sess.distanceMeters ? ` · ${formatKm(sess.distanceMeters)}` : ""}
                    {sess.durationSeconds ? ` · ${Math.round(sess.durationSeconds / 60)}′` : ""}
                  </span>
                </div>
              ))}

              {/* Styrka enligt dagbokstexten. Ingen aktivitet finns — därav
                  den nedtonade stilen och parentesen. */}
              {mentionsStrength(diary?.session_log) && (
                <div
                  className="flex items-start gap-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
                  title="Styrka nämnd i träningsloggen — inget pass loggat med volym"
                >
                  <span
                    className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full opacity-60"
                    style={{ backgroundColor: "var(--cat-strength)" }}
                    aria-hidden="true"
                  />
                  <span>Styrka (ur loggen)</span>
                </div>
              )}

              {/* Avvikelse: bara när båda finns och typerna skiljer sig */}
              {mismatch && (
                <div className="text-[10px] text-amber-700 dark:text-amber-400">
                  Annan typ än planerat
                </div>
              )}

              {diary?.notes && (
                <p className="mt-auto line-clamp-3 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                  {diary.notes}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ border: "2px solid var(--cat-easy)" }}
            aria-hidden="true"
          />
          Planerat
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: "var(--cat-easy)" }}
            aria-hidden="true"
          />
          Genomfört
        </span>
        <span className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-full opacity-60"
            style={{ backgroundColor: "var(--cat-strength)" }}
            aria-hidden="true"
          />
          Styrka nämnd i loggen (inget pass med volym)
        </span>
        <span className="text-amber-700 dark:text-amber-400">
          Gul text = utfallet blev en annan passtyp än planerat
        </span>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Utfallet visas per pass, inte per Garmin-aktivitet: uppvärmning, huvudpass och
        nerjogg slås ihop till ett pass. Två pass samma dag hålls isär när det skiljer mer
        än ett par timmar mellan dem.
      </p>
    </div>
  );
}
