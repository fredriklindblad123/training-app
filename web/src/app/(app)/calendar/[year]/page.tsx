import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDayStatuses } from "@/lib/day-status";
import {
  SV_MONTHS,
  STATUS_COLOR,
  STATUS_LABEL,
  dateKey,
  daysInMonth,
  firstWeekdayOfMonth,
  isValidYear,
} from "@/lib/calendar-utils";
import { CATEGORY_LABELS, isActivityCategory, type ActivityCategory } from "@/lib/categories";

export default async function YearPage({
  params,
}: {
  params: Promise<{ year: string }>;
}) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!isValidYear(year)) {
    notFound();
  }

  const supabase = await createClient();

  const [statuses, { data: activeGoal }, { data: plannedWorkouts }] = await Promise.all([
    getDayStatuses(supabase, `${year}-01-01`, `${year + 1}-01-01`),
    supabase
      .from("goals")
      .select("id, title, event_date")
      .eq("status", "active")
      .order("event_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("planned_workouts")
      .select("scheduled_date, workout_type")
      .gte("scheduled_date", `${year}-01-01`)
      .lt("scheduled_date", `${year + 1}-01-01`),
  ]);

  const goalDateKey = activeGoal?.event_date ?? null;

  const plannedMap = new Map<string, ActivityCategory>();
  for (const pw of plannedWorkouts ?? []) {
    if (isActivityCategory(pw.workout_type)) {
      plannedMap.set(pw.scheduled_date, pw.workout_type);
    }
  }

  let daysUntilGoal: number | null = null;
  if (activeGoal) {
    const today = new Date();
    const todayMidnight = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const eventDate = new Date(`${activeGoal.event_date}T00:00:00`);
    daysUntilGoal = Math.round(
      (eventDate.getTime() - todayMidnight.getTime()) / 86_400_000,
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href={`/calendar/${year - 1}`}
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            ←
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
            {year}
          </h1>
          <Link
            href={`/calendar/${year + 1}`}
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            →
          </Link>
        </div>
        <div className="flex gap-2 text-sm">
          <Link
            href={`/calendar/${year}/${year === new Date().getFullYear() ? new Date().getMonth() + 1 : 1}`}
            className="rounded border border-zinc-300 px-3 py-1 dark:border-zinc-700"
          >
            Månad
          </Link>
          <span className="rounded bg-zinc-950 px-3 py-1 text-white dark:bg-zinc-50 dark:text-zinc-950">
            År
          </span>
        </div>
        <div className="flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400">
          {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>).map(
            (key) => (
              <span key={key} className="flex items-center gap-1">
                <span className={`h-3 w-3 rounded-sm ${STATUS_COLOR[key]}`} />
                {STATUS_LABEL[key]}
              </span>
            ),
          )}
        </div>
      </div>

      {activeGoal && (
        <Link
          href={`/goals`}
          className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900"
        >
          🎯 <strong>{activeGoal.title}</strong> — {activeGoal.event_date}
          {daysUntilGoal !== null &&
            (daysUntilGoal >= 0
              ? ` (om ${daysUntilGoal} dagar)`
              : ` (${Math.abs(daysUntilGoal)} dagar sedan)`)}
        </Link>
      )}

      <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {SV_MONTHS.map((monthName, idx) => {
          const month = idx + 1;
          const numDays = daysInMonth(year, month);
          const offset = firstWeekdayOfMonth(year, month);
          const cells: Array<number | null> = [
            ...Array.from({ length: offset }, () => null),
            ...Array.from({ length: numDays }, (_, i) => i + 1),
          ];

          return (
            <div key={month} className="flex flex-col gap-2">
              <Link
                href={`/calendar/${year}/${month}`}
                className="text-sm font-medium text-zinc-800 hover:underline dark:text-zinc-200"
              >
                {monthName}
              </Link>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => {
                  if (day === null) {
                    return <span key={`empty-${i}`} />;
                  }
                  const key = dateKey(year, month, day);
                  const status = statuses.get(key);
                  const isGoalDay = goalDateKey === key;
                  const plannedCategory = plannedMap.get(key);
                  const isFulfilled = status === "training";
                  return (
                    <Link
                      key={key}
                      href={`/calendar/${year}/${month}/${day}`}
                      title={`${key}${status ? ` – ${STATUS_LABEL[status]}` : ""}${
                        plannedCategory
                          ? ` – Planerat: ${CATEGORY_LABELS[plannedCategory]}${
                              isFulfilled ? " (genomfört)" : ""
                            }`
                          : ""
                      }`}
                      className={`h-4 w-4 rounded-sm ${
                        status
                          ? STATUS_COLOR[status]
                          : "bg-zinc-100 dark:bg-zinc-800"
                      } ${isGoalDay ? "ring-2 ring-amber-500" : ""}`}
                      style={
                        plannedCategory
                          ? {
                              boxSizing: "border-box",
                              border: `2px solid var(--cat-${plannedCategory})`,
                            }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
