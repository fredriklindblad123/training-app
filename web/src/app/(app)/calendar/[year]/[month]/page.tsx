import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
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
import { CalendarNav } from "@/components/CalendarHorizon";
import { AvailabilityBand } from "@/components/AvailabilityBand";
import type { AvailabilityPeriod } from "@/lib/planning";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import {
  matchPlanToSessions,
  summarizeCompliance,
  type PlannedWorkout,
} from "@/lib/plan-matching";
import { PeriodStatTiles } from "@/components/PeriodStatTiles";
import { PassMarker } from "@/components/PassMarker";
import { typeLabel, unmatchedCompetitions, COMPETED_BADGE_COLOR } from "@/lib/day-outcome";

export default async function MonthPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; month: string }>;
  searchParams: Promise<{ athlete?: string }>;
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
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const { athlete: athleteParam } = await searchParams;
  const scopedUserId = resolveScopedUserId(scoped, athleteParam);
  const athleteQuery = scoped.role === "coach" ? `?athlete=${scopedUserId}` : "";

  const [
    { data: activities },
    { data: diaryEntries },
    { data: plannedWorkouts },
    { data: availabilityRows },
    { data: competitionRows },
  ] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", scopedUserId)
      .gte("start_time", monthStart)
      .lt("start_time", monthEndExclusive)
      .order("start_time"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type")
      .eq("user_id", scopedUserId)
      .gte("entry_date", monthStart)
      .lt("entry_date", monthEndExclusive)
      .not("day_type", "is", null),
    supabase
      .from("planned_workouts")
      .select("id, scheduled_date, workout_type, slot, title, target_distance_meters, target_duration_seconds")
      .eq("user_id", scopedUserId)
      .order("slot")
      .gte("scheduled_date", monthStart)
      .lt("scheduled_date", monthEndExclusive),
    // K7: perioder som överlappar månaden. Visas som ett band ovanför
    // rutnätet i stället för som etiketter i varje täckt dagcell —
    // månadscellerna bär redan planerat pass, utfall och statusbadge, och en
    // fjärde markering per dag hade gjort rutnätet oläsbart för den
    // information man faktiskt kommer dit för.
    supabase
      .from("availability_periods")
      .select("start_date, end_date, kind, label")
      .eq("user_id", scopedUserId)
      .lt("start_date", monthEndExclusive)
      .gte("end_date", monthStart),
    // Samma källa som veckovyn för tävlingsdagar — se lib/day-outcome.ts.
    // Garmins "race"-kategori missar tävlingar utan matchande mönster.
    supabase
      .from("competitions")
      .select("id, name, competition_date, priority")
      .eq("user_id", scopedUserId)
      .gte("competition_date", monthStart)
      .lt("competition_date", monthEndExclusive),
  ]);

  // SESSION_ACTIVITY_COLUMNS är en runtime-sträng, så Supabase-klienten kan
  // inte härleda radtypen — se samma omväg i lib/sessions.ts-användarna på
  // /dashboard och /trends.
  const activityRows = (activities ?? []) as unknown as SessionActivity[];
  const monthSessions = groupActivitiesIntoSessions(activityRows);

  // Samma nyckeltalsrad som kalenderns övriga vyer (components/PeriodStatTiles.tsx).
  const monthPlanMatches = matchPlanToSessions(
    (plannedWorkouts ?? []) as unknown as PlannedWorkout[],
    monthSessions,
  );
  const monthCompliance = summarizeCompliance(monthPlanMatches);

  const sessionsByDay = new Map<string, TrainingSession[]>();
  for (const s of monthSessions) {
    sessionsByDay.set(s.date, [...(sessionsByDay.get(s.date) ?? []), s]);
  }

  const plannedByDay = new Map<string, PlannedWorkout[]>();
  for (const pw of (plannedWorkouts ?? []) as unknown as PlannedWorkout[]) {
    plannedByDay.set(pw.scheduled_date, [...(plannedByDay.get(pw.scheduled_date) ?? []), pw]);
  }

  const diaryByDay = new Map<string, DayStatus>();
  for (const entry of diaryEntries ?? []) {
    // "Ledig" visas inte som egen status — se lib/day-status.ts.
    if (entry.day_type && entry.day_type !== "rest") {
      diaryByDay.set(entry.entry_date, entry.day_type as DayStatus);
    }
  }

  const competitionsByDay = new Map<string, { name: string; priority: string }[]>();
  for (const c of competitionRows ?? []) {
    competitionsByDay.set(c.competition_date, [
      ...(competitionsByDay.get(c.competition_date) ?? []),
      { name: c.name, priority: c.priority },
    ]);
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
      {scoped.role === "coach" && (
        <AthleteSwitcher
          linkedAthletes={scoped.linkedAthletes}
          activeId={scopedUserId}
          buildHref={(id) => `/calendar/${year}/${month}?athlete=${id}`}
        />
      )}

      <CalendarNav
        current="month"
        title={`${SV_MONTHS[month - 1]} ${year}`}
        prevHref={`/calendar/${prevMonth.year}/${prevMonth.month}${athleteQuery}`}
        nextHref={`/calendar/${nextMonth.year}/${nextMonth.month}${athleteQuery}`}
        jumpDate={todayKey}
        dayHref={`/calendar/${year}/${month}/1${athleteQuery}`}
        weekHref={`/calendar/vecka/${monthStart}${athleteQuery}`}
        monthHref={`/calendar/${year}/${month}${athleteQuery}`}
        yearHref={`/calendar/${year}${athleteQuery}`}
        athleteId={scoped.role === "coach" ? scopedUserId : undefined}
      />

      <PeriodStatTiles sessions={monthSessions} compliance={monthCompliance} />

      <AvailabilityBand
        periods={(availabilityRows ?? []) as AvailabilityPeriod[]}
        className="-mb-2"
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
          const done = sessionsByDay.get(key) ?? [];
          const planned = plannedByDay.get(key) ?? [];
          const diaryStatus = diaryByDay.get(key) ?? null;
          const comps = unmatchedCompetitions(done, competitionsByDay.get(key) ?? []);
          // "Tränade" ovanpå ett synligt pass är ren upprepning — badgen visas
          // bara när den säger något passlistan inte redan gör.
          const showStatus = diaryStatus != null && (diaryStatus !== "training" || done.length === 0);
          // Historik visar bara vad som faktiskt gjordes; framåt i tiden
          // (fram till och med idag, om inget redan är genomfört) visas i
          // stället vad som är planerat. Samma gräns som årsvyn (YearGrid).
          const showPlanned = done.length === 0 && key >= todayKey && planned.length > 0;

          return (
            <Link
              key={key}
              href={`/calendar/${year}/${month}/${day}${athleteQuery}`}
              className="flex min-h-24 flex-col gap-1 bg-white p-2 hover:bg-zinc-50 dark:bg-zinc-900 dark:hover:bg-zinc-800"
            >
              <span className="text-zinc-500 dark:text-zinc-400">{day}</span>

              {comps.map((c, ci) => (
                <span
                  key={`comp-${ci}`}
                  className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${COMPETED_BADGE_COLOR}`}
                >
                  {c.priority} · {c.name}
                </span>
              ))}

              {showStatus && diaryStatus && (
                <span
                  className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${STATUS_COLOR[diaryStatus]}`}
                >
                  {STATUS_LABEL[diaryStatus]}
                </span>
              )}

              {done.map((s) => (
                <span
                  key={s.id}
                  className="flex items-center gap-1.5 text-[11px] text-zinc-900 dark:text-zinc-100"
                >
                  <PassMarker type={s.category} planned={false} />
                  {typeLabel(s.category)}
                </span>
              ))}

              {showPlanned &&
                planned.map((p) => (
                  <span
                    key={p.id}
                    className="flex items-center gap-1.5 text-[11px] text-zinc-500 dark:text-zinc-400"
                  >
                    <PassMarker type={p.workout_type} planned />
                    {typeLabel(p.workout_type)}
                  </span>
                ))}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
