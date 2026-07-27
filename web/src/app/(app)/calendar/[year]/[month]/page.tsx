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
import { computeCheckInStats } from "@/lib/checkin";
import { BlockBand, HorizonToggle, type BandBlock } from "@/components/CalendarHorizon";
import { DailyCheckIn } from "@/components/DailyCheckIn";

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

  const supabase = await createClient();

  const now = new Date();
  const todayStr = dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
  // Dagens incheckning (P0.4) hör hemma på landningssidan (/calendar redirect-
  // ar hit till innevarande månad) — inte på en godtycklig månad man bläddrat
  // till, då skulle "dagens check-in" sakna sammanhang.
  const isCurrentMonth = year === now.getFullYear() && month === now.getMonth() + 1;

  const [
    { data: activities },
    { data: diaryEntries },
    { data: seasonBlocks },
    { data: plannedWorkouts },
    userResult,
  ] = await Promise.all([
      supabase
        .from("activities")
        .select("id, start_time, name, distance_meters")
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
        .from("season_blocks")
        .select("id, name, block_type, start_date, end_date, focus")
        .lte("start_date", monthEndExclusive)
        .gte("end_date", monthStart),
      supabase
        .from("planned_workouts")
        .select("scheduled_date, workout_type, slot")
        .order("slot")
        .gte("scheduled_date", monthStart)
        .lt("scheduled_date", monthEndExclusive),
      isCurrentMonth ? supabase.auth.getUser() : Promise.resolve(null),
    ]);

  let checkIn: {
    initialDone: boolean;
    initialScores: {
      feeling: number | null;
      effort: number | null;
      soreness: number | null;
      motivation: number | null;
    };
    initialStats: { streakDays: number; weeklyAvgFeeling: number | null };
  } | null = null;

  const user = userResult?.data.user ?? null;
  if (isCurrentMonth && user) {
    const { data: todayEntry } = await supabase
      .from("diary_entries")
      .select("feeling, motivation, soreness_level, rpe")
      .eq("user_id", user.id)
      .eq("entry_date", todayStr)
      .maybeSingle();

    const initialStats = await computeCheckInStats(supabase, user.id, todayStr);

    checkIn = {
      initialDone: todayEntry?.feeling != null,
      initialScores: {
        feeling: todayEntry?.feeling ?? null,
        effort: todayEntry?.rpe != null ? Math.round(todayEntry.rpe / 2) : null,
        soreness: todayEntry?.soreness_level ?? null,
        motivation: todayEntry?.motivation ?? null,
      },
      initialStats,
    };
  }

  const days = new Map<string, DayInfo>();
  for (const entry of diaryEntries ?? []) {
    if (entry.day_type) {
      days.set(entry.entry_date, {
        status: entry.day_type as DayStatus,
        activities: [],
      });
    }
  }
  for (const activity of activities ?? []) {
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
      {checkIn && (
        <DailyCheckIn
          entryDate={todayStr}
          initialDone={checkIn.initialDone}
          initialScores={checkIn.initialScores}
          initialStats={checkIn.initialStats}
        />
      )}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href={`/calendar/${prevMonth.year}/${prevMonth.month}`}
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            ←
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
            {SV_MONTHS[month - 1]} {year}
          </h1>
          <Link
            href={`/calendar/${nextMonth.year}/${nextMonth.month}`}
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            →
          </Link>
        </div>
        <HorizonToggle
          current="month"
          weekHref={`/calendar/vecka/${monthStart}`}
          monthHref={`/calendar/${year}/${month}`}
          yearHref={`/calendar/${year}`}
        />
      </div>

      <BlockBand
        blocks={(seasonBlocks ?? []) as BandBlock[]}
        from={monthStart}
        to={monthEndExclusive}
      />

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
                      // Fylld ruta = planerat men ännu inte genomfört. Ihålig =
                      // dagen har ett utfall, så planen är avklarad eller
                      // åtminstone besvarad.
                      color
                        ? done
                          ? { border: `1.5px solid ${color}`, color }
                          : { backgroundColor: color, color: "white" }
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
