import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  SV_MONTHS,
  SV_WEEKDAYS_SHORT,
  STATUS_COLOR,
  STATUS_LABEL,
  type DayStatus,
  dateKey,
  daysInMonth,
  firstWeekdayOfMonth,
  isValidYear,
  isValidMonth,
} from "@/lib/calendar-utils";
import { CATEGORY_LABELS, isActivityCategory } from "@/lib/categories";
import { WORKOUT_LABELS, workoutTypeColorVar, type WorkoutType } from "@/lib/planning";
import { CalendarNav } from "@/components/CalendarHorizon";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import { formatDuration } from "@/lib/format";

type DayInfo = {
  status?: DayStatus;
  activities: { id: string; name: string | null; distanceMeters: number | null }[];
  /** Alla dagens planerade passtyper, i slot-ordning. Flera vid dubbelpass. */
  planned?: string[];
};

function formatKm(meters: number | null): string {
  if (meters == null) return "";
  return `${(meters / 1000).toFixed(1)} km`;
}

export default async function MonthPage({
  params,
}: {
  params: Promise<{ year: string; month: string }>;
}) {
  const { year: yearParam, month: monthParam } = await params;
  const year = Number(yearParam);
  const month = Number(monthParam);
  if (!isValidYear(year) || !isValidMonth(month)) {
    notFound();
  }

  const monthStart = dateKey(year, month, 1);
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  const prevMonth = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const monthEndExclusive = dateKey(nextMonth.year, nextMonth.month, 1);
  const now = new Date();
  const todayKey = dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());

  const supabase = await createClient();

  const [{ data: activities }, { data: diaryEntries }, { data: plannedWorkouts }] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", monthStart)
      .lt("start_time", monthEndExclusive)
      .order("start_time"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type")
      .gte("entry_date", monthStart)
      .lt("entry_date", monthEndExclusive)
      .not("day_type", "is", null),
    supabase
      .from("planned_workouts")
      .select("scheduled_date, workout_type, slot")
      .order("slot")
      .gte("scheduled_date", monthStart)
      .lt("scheduled_date", monthEndExclusive),
  ]);

  // SESSION_ACTIVITY_COLUMNS är en runtime-sträng, så Supabase-klienten kan
  // inte härleda radtypen — se samma omväg i lib/sessions.ts-användarna på
  // /dashboard och /trends.
  const activityRows = (activities ?? []) as unknown as SessionActivity[];
  const monthSessions = groupActivitiesIntoSessions(activityRows);
  const monthKm = monthSessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;
  const monthSeconds = monthSessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const monthLoad = monthSessions.reduce((sum, s) => sum + s.trainingLoad, 0);

  const days = new Map<string, DayInfo>();
  for (const entry of diaryEntries ?? []) {
    // "Ledig" visas inte som egen status — se lib/day-status.ts.
    if (entry.day_type && entry.day_type !== "rest") {
      days.set(entry.entry_date, {
        status: entry.day_type as DayStatus,
        activities: [],
      });
    }
  }
  for (const activity of activityRows) {
    const key = activity.start_time.slice(0, 10);
    const existing = days.get(key) ?? { activities: [] };
    existing.status = "training";
    existing.activities.push({
      id: activity.id,
      name: activity.name,
      distanceMeters: activity.distance_meters,
    });
    days.set(key, existing);
  }
  for (const pw of plannedWorkouts ?? []) {
    const existing = days.get(pw.scheduled_date) ?? { activities: [] };
    // Planerad vila har ingen motsvarighet bland genomförda pass och därför
    // ingen kategorifärg — men den är meningsfull att se i kalendern, så den
    // filtreras inte bort som tidigare.
    existing.planned = [...(existing.planned ?? []), pw.workout_type];
    days.set(pw.scheduled_date, existing);
  }

  const numDays = daysInMonth(year, month);
  const offset = firstWeekdayOfMonth(year, month);
  const cells: Array<number | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <CalendarNav
        current="month"
        title={`${SV_MONTHS[month - 1]} ${year}`}
        prevHref={`/calendar/${prevMonth.year}/${prevMonth.month}`}
        nextHref={`/calendar/${nextMonth.year}/${nextMonth.month}`}
        jumpDate={todayKey}
        dayHref={`/calendar/${year}/${month}/1`}
        weekHref={`/calendar/vecka/${monthStart}`}
        monthHref={`/calendar/${year}/${month}`}
        yearHref={`/calendar/${year}`}
      />

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Pass", value: String(monthSessions.length) },
          { label: "Distans", value: monthKm > 0 ? `${monthKm.toFixed(1)} km` : "—" },
          { label: "Tid", value: monthSeconds > 0 ? formatDuration(monthSeconds) : "—" },
          { label: "Belastning", value: monthLoad > 0 ? String(Math.round(monthLoad)) : "—" },
        ].map((tile) => (
          <div key={tile.label} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</dt>
            <dd className="mt-0.5 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="grid grid-cols-7 gap-px overflow-hidden rounded border border-zinc-200 bg-zinc-200 text-xs dark:border-zinc-800 dark:bg-zinc-800">
        {SV_WEEKDAYS_SHORT.map((wd) => (
          <div
            key={wd}
            className="bg-zinc-50 px-2 py-1 text-center font-medium text-zinc-500 dark:bg-zinc-900 dark:text-zinc-400"
          >
            {wd}
          </div>
        ))}
        {cells.map((day, i) => {
          if (day === null) {
            return (
              <div
                key={`empty-${i}`}
                className="min-h-24 bg-zinc-50 dark:bg-zinc-950"
              />
            );
          }
          const key = dateKey(year, month, day);
          const info = days.get(key);
          return (
            <Link
              key={key}
              href={`/calendar/${year}/${month}/${day}`}
              className="flex min-h-24 flex-col gap-1 bg-white p-2 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <span className="text-zinc-500 dark:text-zinc-400">{day}</span>
              {info?.planned?.map((type, i) => {
                const color = workoutTypeColorVar(type);
                const label = isActivityCategory(type)
                  ? CATEGORY_LABELS[type]
                  : (WORKOUT_LABELS[type as WorkoutType] ?? type);
                const done = info.activities.length > 0;
                return (
                  <span
                    key={`${type}-${i}`}
                    className="inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={
                      // Alltid genomskinlig bakgrund — planerat är planerat,
                      // oavsett om dagen råkar ha ett utfall också. Genomförda
                      // pass syns redan som egna rader nedanför.
                      color
                        ? { border: `1.5px solid ${color}`, color }
                        : { border: "1.5px dashed var(--color-zinc-400, #a1a1aa)" }
                    }
                    title={`Planerat: ${label}${done ? " (dagen har utfall)" : ""}`}
                  >
                    {label}
                  </span>
                );
              })}
              {info?.status && (
                <span
                  className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${STATUS_COLOR[info.status]}`}
                >
                  {STATUS_LABEL[info.status]}
                </span>
              )}
              {info?.activities.map((a) => (
                <span
                  key={a.id}
                  className="truncate text-[11px] text-zinc-700 dark:text-zinc-300"
                >
                  {a.name ?? "Pass"}
                  {a.distanceMeters ? ` · ${formatKm(a.distanceMeters)}` : ""}
                </span>
              ))}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
