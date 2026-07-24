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

type DayInfo = {
  status?: DayStatus;
  activities: { id: string; name: string | null; distanceMeters: number | null }[];
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

  const [{ data: activities }, { data: diaryEntries }] = await Promise.all([
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
  ]);

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

  const numDays = daysInMonth(year, month);
  const offset = firstWeekdayOfMonth(year, month);
  const cells: Array<number | null> = [
    ...Array.from({ length: offset }, () => null),
    ...Array.from({ length: numDays }, (_, i) => i + 1),
  ];
  while (cells.length % 7 !== 0) cells.push(null);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
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
        <Link
          href={`/calendar/${year}`}
          className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
        >
          Till årsvyn
        </Link>
      </div>

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
