import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDayStatuses } from "@/lib/day-status";
import { CalendarNav, type BandBlock } from "@/components/CalendarHorizon";
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
import { BLOCK_COLOR_VARS, blocksInRange } from "@/lib/planning";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import { formatDuration } from "@/lib/format";

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

  const [
    statuses,
    { data: nextCompetition },
    { data: plannedWorkouts },
    { data: seasonBlocks },
    { data: activities },
  ] = await Promise.all([
    getDayStatuses(supabase, `${year}-01-01`, `${year + 1}-01-01`),
    supabase
      .from("competitions")
      .select("id, name, competition_date, priority")
      .gte("competition_date", `${year}-01-01`)
      .order("competition_date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("planned_workouts")
      .select("scheduled_date, workout_type")
      .gte("scheduled_date", `${year}-01-01`)
      .lt("scheduled_date", `${year + 1}-01-01`),
    supabase
      .from("season_blocks")
      .select("id, name, block_type, start_date, end_date, focus")
      .lte("start_date", `${year}-12-31`)
      .gte("end_date", `${year}-01-01`),
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", `${year}-01-01`)
      .lt("start_time", `${year + 1}-01-01`),
  ]);

  const goalDateKey = nextCompetition?.competition_date ?? null;
  const blocks = (seasonBlocks ?? []) as BandBlock[];

  // SESSION_ACTIVITY_COLUMNS är en runtime-sträng, så Supabase-klienten kan
  // inte härleda radtypen — se samma omväg i lib/sessions.ts-användarna på
  // /dashboard, /trends och månadsvyn.
  const yearSessions = groupActivitiesIntoSessions(
    (activities ?? []) as unknown as SessionActivity[],
  );
  const yearKm = yearSessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;
  const yearSeconds = yearSessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const yearLoad = yearSessions.reduce((sum, s) => sum + s.trainingLoad, 0);

  const plannedMap = new Map<string, ActivityCategory>();
  for (const pw of plannedWorkouts ?? []) {
    if (isActivityCategory(pw.workout_type)) {
      plannedMap.set(pw.scheduled_date, pw.workout_type);
    }
  }

  let daysUntilGoal: number | null = null;
  if (nextCompetition) {
    const today = new Date();
    const todayMidnight = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate(),
    );
    const eventDate = new Date(`${nextCompetition.competition_date}T00:00:00`);
    daysUntilGoal = Math.round(
      (eventDate.getTime() - todayMidnight.getTime()) / 86_400_000,
    );
  }

  const now = new Date();
  const isCurrentYear = year === now.getFullYear();
  const dayHref = isCurrentYear
    ? `/calendar/${year}/${now.getMonth() + 1}/${now.getDate()}`
    : `/calendar/${year}/1/1`;
  const weekHref = `/calendar/vecka/${isCurrentYear ? now.toISOString().slice(0, 10) : `${year}-01-01`}`;
  const monthHref = `/calendar/${year}/${isCurrentYear ? now.getMonth() + 1 : 1}`;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <CalendarNav
        current="year"
        title={year}
        prevHref={`/calendar/${year - 1}`}
        nextHref={`/calendar/${year + 1}`}
        jumpDate={dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate())}
        dayHref={dayHref}
        weekHref={weekHref}
        monthHref={monthHref}
        yearHref={`/calendar/${year}`}
      />

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Pass", value: String(yearSessions.length) },
          { label: "Distans", value: yearKm > 0 ? `${yearKm.toFixed(0)} km` : "—" },
          { label: "Tid", value: yearSeconds > 0 ? formatDuration(yearSeconds) : "—" },
          { label: "Belastning", value: yearLoad > 0 ? String(Math.round(yearLoad)) : "—" },
        ].map((tile) => (
          <div key={tile.label} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</dt>
            <dd className="mt-0.5 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap gap-4 text-xs text-zinc-600 dark:text-zinc-400">
        {/* "Ledig" har ingen egen färg i kalendern — se lib/day-status.ts. */}
        {(Object.keys(STATUS_LABEL) as Array<keyof typeof STATUS_LABEL>)
          .filter((key) => key !== "rest")
          .map((key) => (
            <span key={key} className="flex items-center gap-1">
              <span className={`h-3 w-3 rounded-sm ${STATUS_COLOR[key]}`} />
              {STATUS_LABEL[key]}
            </span>
          ))}
      </div>

      {nextCompetition && (
        <Link
          href={`/planering`}
          className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900"
        >
          🎯 <strong>{nextCompetition.name}</strong> — {nextCompetition.competition_date}
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
          const monthStart = dateKey(year, month, 1);
          const monthEnd = dateKey(year, month, numDays);
          // Årsvyns dagar är för små (16px) för egna block-markeringar, så
          // blocken listas i stället som etiketter under månadsnamnet — det
          // ger samma information (vilket block täcker månaden) utan att
          // rutnätet behöver plats för en stapel per dag.
          const monthBlocks = blocksInRange(blocks, monthStart, monthEnd);

          return (
            <div key={month} className="flex flex-col gap-2">
              <div className="flex flex-col gap-0.5">
                <Link
                  href={`/calendar/${year}/${month}`}
                  className="text-sm font-medium text-zinc-800 hover:underline dark:text-zinc-200"
                >
                  {monthName}
                </Link>
                {monthBlocks.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {monthBlocks.map((b) => (
                      <span
                        key={b.id}
                        className="rounded px-1 py-0.5 text-[9px] font-medium text-white"
                        style={{ backgroundColor: BLOCK_COLOR_VARS[b.block_type] }}
                        title={`${b.name}, ${b.start_date} – ${b.end_date}${b.focus ? `. ${b.focus}` : ""}`}
                      >
                        {b.name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
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
                          ? { boxSizing: "border-box", border: `2px solid var(--cat-${plannedCategory})` }
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
