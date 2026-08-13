import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getDayStatuses } from "@/lib/day-status";
import { CalendarNav, type BandBlock } from "@/components/CalendarHorizon";
import { dateKey, isValidYear } from "@/lib/calendar-utils";
import { CATEGORY_LABELS, isActivityCategory } from "@/lib/categories";
import {
  QUALITY_WORKOUT_TYPES,
  WORKOUT_LABELS,
  toDateKey,
  workoutTypeColorVar,
  type WorkoutType,
} from "@/lib/planning";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import {
  matchPlanToSessions,
  summarizeCompliance,
  type PlannedWorkout,
} from "@/lib/plan-matching";
import { PeriodStatTiles } from "@/components/PeriodStatTiles";
import { YearGrid, type YearOutcome, type PlannedDay, type BlockDay } from "@/components/YearGrid";

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
    { data: yearCompetitions },
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
    // Alla årets tävlingar, för Tävlade-utfallet i årsvyn — se raceDates
    // nedan. Skild från nextCompetition-frågan ovan (som bara vill ha den
    // första/nästa), så samma tabell frågas två gånger med olika räckvidd.
    supabase
      .from("competitions")
      .select("id, name, competition_date")
      .gte("competition_date", `${year}-01-01`)
      .lt("competition_date", `${year + 1}-01-01`),
    supabase
      .from("planned_workouts")
      .select(
        "id, scheduled_date, workout_type, slot, title, target_distance_meters, target_duration_seconds",
      )
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

  // Samma nyckeltalsrad som kalenderns övriga vyer (components/PeriodStatTiles.tsx).
  const yearPlanMatches = matchPlanToSessions(
    (plannedWorkouts ?? []) as unknown as PlannedWorkout[],
    yearSessions,
  );
  const yearCompliance = summarizeCompliance(yearPlanMatches);

  const now = new Date();
  const todayKey = toDateKey(now);

  // Tävlade är ett eget utfall, skilt från "tränade" — se YearGrid.tsx för
  // varför. En dag kan i teorin ha flera pass; ett tävlingspass vinner alltid
  // över ett vanligt träningspass samma dag.
  //
  // Källan är unionen av två saker, inte bara Garmin-kategorin: dels
  // sessioner Garmin själv taggat "race" (namnmönster/training_effect_label,
  // se categorizeSession i lib/sessions.ts), dels den manuellt inlagda
  // competitions-tabellen — samma tabell veckovyn redan använder för sina
  // tävlingsmarkeringar. Garmin-kategorin missar tävlingar där passet inte
  // matchade dess mönster (vanligt för medeldistanslopp med kortare
  // delmoment), så att bara lita på den missade flera av Alices tävlingar i
  // juni/juli.
  const raceDatesFromSessions = new Set(
    yearSessions.filter((s) => s.category === "race").map((s) => s.date),
  );
  const competitionNamesByDate = new Map<string, string[]>();
  for (const c of yearCompetitions ?? []) {
    competitionNamesByDate.set(c.competition_date, [
      ...(competitionNamesByDate.get(c.competition_date) ?? []),
      c.name,
    ]);
  }
  const raceDates = new Set([
    ...raceDatesFromSessions,
    ...competitionNamesByDate.keys(),
  ]);

  const outcomeByDate: Record<string, YearOutcome> = {};
  for (const [key, status] of statuses) {
    if (raceDates.has(key)) {
      outcomeByDate[key] = "competed";
    } else if (status === "training") {
      outcomeByDate[key] = "trained";
    } else if (status === "sick" || status === "injured") {
      outcomeByDate[key] = status;
    }
  }
  for (const key of raceDates) {
    outcomeByDate[key] = "competed";
  }

  // Ett dubbelpass en dag ska hellre visa kvalitetspasset (tröskel/intervall)
  // än ett samtidigt lugnt distanspass — det är kvalitetspasset man vill se
  // ligga var i årshjulet.
  const plannedByDate: Record<string, PlannedDay & { isQuality: boolean }> = {};
  for (const pw of plannedWorkouts ?? []) {
    const isQuality = (QUALITY_WORKOUT_TYPES as readonly string[]).includes(pw.workout_type);
    const existing = plannedByDate[pw.scheduled_date];
    if (existing?.isQuality && !isQuality) continue;
    const label = isActivityCategory(pw.workout_type)
      ? CATEGORY_LABELS[pw.workout_type]
      : (WORKOUT_LABELS[pw.workout_type as WorkoutType] ?? pw.workout_type);
    plannedByDate[pw.scheduled_date] = {
      colorVar: workoutTypeColorVar(pw.workout_type),
      label,
      isQuality,
    };
  }

  const blockByDate: Record<string, BlockDay> = {};
  const yearStartKey = `${year}-01-01`;
  const yearEndKey = `${year}-12-31`;
  for (const b of blocks) {
    const from = b.start_date > yearStartKey ? b.start_date : yearStartKey;
    const to = b.end_date < yearEndKey ? b.end_date : yearEndKey;
    for (
      let d = new Date(`${from}T00:00:00`);
      toDateKey(d) <= to;
      d.setDate(d.getDate() + 1)
    ) {
      blockByDate[toDateKey(d)] = { blockType: b.block_type, name: b.name };
    }
  }

  let daysUntilGoal: number | null = null;
  if (nextCompetition) {
    const todayMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const eventDate = new Date(`${nextCompetition.competition_date}T00:00:00`);
    daysUntilGoal = Math.round(
      (eventDate.getTime() - todayMidnight.getTime()) / 86_400_000,
    );
  }

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

      <PeriodStatTiles sessions={yearSessions} compliance={yearCompliance} />

      {nextCompetition && (
        <Link
          href={`/sasongen`}
          className="rounded border border-amber-300 bg-amber-50 px-4 py-3 text-sm hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950 dark:hover:bg-amber-900"
        >
          🎯 <strong>{nextCompetition.name}</strong> — {nextCompetition.competition_date}
          {daysUntilGoal !== null &&
            (daysUntilGoal >= 0
              ? ` (om ${daysUntilGoal} dagar)`
              : ` (${Math.abs(daysUntilGoal)} dagar sedan)`)}
        </Link>
      )}

      <YearGrid
        year={year}
        todayKey={todayKey}
        goalDateKey={goalDateKey}
        outcomeByDate={outcomeByDate}
        plannedByDate={plannedByDate}
        blockByDate={blockByDate}
        competitionNamesByDate={Object.fromEntries(competitionNamesByDate)}
      />
    </div>
  );
}
