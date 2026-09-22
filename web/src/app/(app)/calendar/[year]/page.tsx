import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { getDayStatuses } from "@/lib/day-status";
import { CalendarNav, type BandBlock } from "@/components/CalendarHorizon";
import { dateKey, isValidYear } from "@/lib/calendar-utils";
import { QUALITY_WORKOUT_TYPES, toDateKey, workoutTypeColorVar } from "@/lib/planning";
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
import { typeLabel } from "@/lib/day-outcome";
import { getViewMode } from "@/lib/view-mode";
import { athleteBlocks, blockHrefFor } from "@/lib/calendar-block";

export default async function YearPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string }>;
  searchParams: Promise<{ athlete?: string }>;
}) {
  const { year: yearParam } = await params;
  const year = Number(yearParam);
  if (!isValidYear(year)) {
    notFound();
  }

  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const { athlete: athleteParam } = await searchParams;
  const runnerMode = scoped.role === "coach" && (await getViewMode()) === "runner";
  const scopedUserId = resolveScopedUserId(scoped, athleteParam, runnerMode);
  const athleteQuery = scoped.role === "coach" ? `?athlete=${scopedUserId}` : "";

  // Block är kopplade till löpare via season_block_athletes (samma block
  // kan gälla flera löpare), inte user_id — se migration 20260816100000.
  const { data: blockAthleteRows } = await supabase
    .from("season_block_athletes")
    .select("block_id")
    .eq("athlete_id", scopedUserId);
  const blockIds = [...new Set((blockAthleteRows ?? []).map((r) => r.block_id as string))];

  const [
    statuses,
    { data: yearCompetitions },
    { data: plannedWorkouts },
    { data: seasonBlocks },
    { data: activities },
    allBlocks,
  ] = await Promise.all([
    getDayStatuses(supabase, scopedUserId, `${year}-01-01`, `${year + 1}-01-01`),
    // Årets tävlingar, för Tävlade-utfallet i årsvyn — se raceDates nedan.
    supabase
      .from("competitions")
      .select("id, name, competition_date")
      .eq("user_id", scopedUserId)
      .gte("competition_date", `${year}-01-01`)
      .lt("competition_date", `${year + 1}-01-01`),
    supabase
      .from("planned_workouts")
      .select(
        "id, scheduled_date, workout_type, slot, title, target_distance_meters, target_duration_seconds",
      )
      .eq("user_id", scopedUserId)
      .gte("scheduled_date", `${year}-01-01`)
      .lt("scheduled_date", `${year + 1}-01-01`),
    blockIds.length > 0
      ? supabase
          .from("season_blocks")
          .select("id, name, phase, start_date, end_date, focus")
          .in("id", blockIds)
          .lte("start_date", `${year}-12-31`)
          .gte("end_date", `${year}-01-01`)
      : Promise.resolve({ data: [] as never[] }),
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", scopedUserId)
      .gte("start_time", `${year}-01-01`)
      .lt("start_time", `${year + 1}-01-01`),
    // Se månadsvyn: seasonBlocks ovan är årets block, men Block-fliken ska
    // peka på det som pågår nu.
    athleteBlocks(supabase, scopedUserId),
  ]);

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
    plannedByDate[pw.scheduled_date] = {
      colorVar: workoutTypeColorVar(pw.workout_type),
      label: typeLabel(pw.workout_type),
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
      blockByDate[toDateKey(d)] = { phase: b.phase, name: b.name };
    }
  }

  /* Horisontväxlarna pekar alltid på INNEVARANDE period (uttrycklig begäran
     2026-09-14). Tidigare följde de den period man råkade titta på: från mars
     2027 landade "Dag" på 1 mars 2027 och "Vecka" på veckan däromkring — ett
     datum man varken valt eller hade någon anledning att stå på.
     Växlaren byter tidshorisont, inte tidpunkt; vill man bläddra bakåt finns
     pilarna och "hoppa till datum". */

  // Innevarande dag/vecka/månad/år — se kommentaren vid horisontväxlaren.
  const nowForHorizon = new Date();
  const hY = nowForHorizon.getFullYear();
  const hM = nowForHorizon.getMonth() + 1;
  const hD = nowForHorizon.getDate();
  const hKey = `${hY}-${String(hM).padStart(2, "0")}-${String(hD).padStart(2, "0")}`;
  const todayDayHref = `/calendar/${hY}/${hM}/${hD}${athleteQuery}`;
  const todayWeekHref = `/calendar/vecka/${hKey}${athleteQuery}`;
  const todayMonthHref = `/calendar/${hY}/${hM}${athleteQuery}`;
  const todayYearHref = `/calendar/${hY}${athleteQuery}`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">

      <CalendarNav
        current="year"
        title={year}
        prevHref={`/calendar/${year - 1}${athleteQuery}`}
        nextHref={`/calendar/${year + 1}${athleteQuery}`}
        jumpDate={dateKey(now.getFullYear(), now.getMonth() + 1, now.getDate())}
        dayHref={todayDayHref}
        weekHref={todayWeekHref}
        monthHref={todayMonthHref}
        blockHref={blockHrefFor(allBlocks, todayKey, athleteQuery)}
        yearHref={todayYearHref}
        athleteId={scoped.role === "coach" ? scopedUserId : undefined}
      />

      <PeriodStatTiles sessions={yearSessions} compliance={yearCompliance} />

      <YearGrid
        year={year}
        todayKey={todayKey}
        outcomeByDate={outcomeByDate}
        plannedByDate={plannedByDate}
        blockByDate={blockByDate}
        competitionNamesByDate={Object.fromEntries(competitionNamesByDate)}
        athleteQuery={athleteQuery}
      />
    </div>
  );
}
