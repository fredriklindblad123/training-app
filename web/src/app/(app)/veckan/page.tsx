import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import {
  matchPlanToSessions,
  summarizeCompliance,
  type PlanMatch,
  type PlannedWorkout,
} from "@/lib/plan-matching";
import { ComplianceCard } from "@/components/ComplianceCard";
import { AvailabilityBand } from "@/components/AvailabilityBand";
import {
  WeekAgenda,
  type AgendaDiaryDay,
  type AgendaMetricDay,
} from "@/components/WeekAgenda";
import type { AvailabilityPeriod } from "@/lib/planning";
import { formatDuration } from "@/lib/format";
import { weekLabel } from "@/lib/stats-utils";

/* Veckan — loopens hjärtslag (docs/tranarloopen.md).
 *
 * Veckan är den kadens träning faktiskt planeras i: en veckomall *är* en
 * vecka, och ett block mäts i veckor. Ändå fanns ingen yta som ägde den —
 * datan låg utspridd (efterlevnad i kalendern, volym på trends) och inget
 * markerade att en vecka tagit slut.
 *
 * Sidan äger en tidshorisont och svarar på båda frågorna för den: vad hände,
 * och vad händer härnäst. Därför slutar den med "planera nästa vecka" — det
 * är skillnaden mellan en rapport och en ritual. */

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

export default async function VeckanPage({
  searchParams,
}: {
  searchParams: Promise<{ vecka?: string }>;
}) {
  const { vecka } = await searchParams;
  const todayKey = toKey(new Date());
  // Okänt eller felstavat datum ska inte krascha sidan — fall tillbaka på
  // innevarande vecka, som är det man vill se i nio fall av tio ändå.
  const anchor = vecka && /^\d{4}-\d{2}-\d{2}$/.test(vecka) ? vecka : todayKey;

  const monday = mondayOf(anchor);
  const sunday = addDays(monday, 6);
  const from = toKey(monday);
  const to = toKey(sunday);
  const nextExclusive = toKey(addDays(sunday, 1));
  const nextMonday = toKey(addDays(monday, 7));
  const prevMonday = toKey(addDays(monday, -7));

  const supabase = await createClient();
  const [
    { data: activityRows },
    { data: plannedRows },
    { data: diaryRows },
    { data: competitionRows },
    { data: availabilityRows },
    { data: dailyMetricRows },
    { data: nextWeekPlanned },
  ] = await Promise.all([
    // activity_splits(*) nästlat: genomgången visar varvtider per pass.
    supabase
      .from("activities")
      .select(`${SESSION_ACTIVITY_COLUMNS}, activity_splits(*)`)
      .gte("start_time", from)
      .lt("start_time", nextExclusive)
      .order("start_time"),
    // planned_rep_groups(*) nästlat: planraden visar pace och vila ur K1.
    supabase
      .from("planned_workouts")
      .select(
        "id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds, planned_rep_groups(*)",
      )
      .gte("scheduled_date", from)
      .lte("scheduled_date", to)
      .order("slot"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type, notes, session_log, feeling, rpe")
      .gte("entry_date", from)
      .lte("entry_date", to),
    supabase
      .from("competitions")
      .select("id, name, competition_date, priority")
      .gte("competition_date", from)
      .lte("competition_date", to),
    supabase
      .from("availability_periods")
      .select("start_date, end_date, kind, label")
      .lte("start_date", to)
      .gte("end_date", from),
    supabase
      .from("daily_metrics")
      .select("metric_date, sleep_seconds, hrv_overnight_avg")
      .gte("metric_date", from)
      .lte("metric_date", to),
    // Är nästa vecka redan planerad? Styr om utgången nedan lyder "planera"
    // eller "se över" — och är samma signal som next-actions använder för att
    // avgöra om veckan är genomgången (docs/tranarloopen.md L2).
    supabase
      .from("planned_workouts")
      .select("id")
      .gte("scheduled_date", nextMonday)
      .lte("scheduled_date", toKey(addDays(monday, 13)))
      .limit(1),
  ]);

  const sessions = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );
  const plannedWorkouts = (plannedRows ?? []) as PlannedWorkout[];

  const planMatches = matchPlanToSessions(plannedWorkouts, sessions);
  const matchesByDay = new Map<string, PlanMatch[]>();
  for (const m of planMatches) {
    const day = m.planned?.scheduled_date ?? m.session!.date;
    matchesByDay.set(day, [...(matchesByDay.get(day) ?? []), m]);
  }
  const compliance = summarizeCompliance(planMatches);

  const diaryByDay = new Map<string, AgendaDiaryDay>(
    (diaryRows ?? []).map((d) => [d.entry_date as string, d as AgendaDiaryDay]),
  );
  const dayTypeByDate = new Map<string, string | null>(
    [...diaryByDay].map(([day, entry]) => [day, entry.day_type]),
  );
  const dailyMetricsByDay = new Map<string, AgendaMetricDay>(
    (dailyMetricRows ?? []).map((m) => [m.metric_date as string, m as AgendaMetricDay]),
  );
  const competitionsByDay = new Map<string, { name: string; priority: string }[]>();
  for (const c of competitionRows ?? []) {
    const day = c.competition_date as string;
    competitionsByDay.set(day, [
      ...(competitionsByDay.get(day) ?? []),
      { name: c.name as string, priority: c.priority as string },
    ]);
  }

  // Summorna räknas på pass, inte aktiviteter — annars räknas uppvärmning och
  // nerjogg som egna pass i "antal pass" (P0.5).
  const totalKm = sessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;
  const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const totalLoad = sessions.reduce((sum, s) => sum + s.trainingLoad, 0);

  const isCurrentWeek = from === toKey(mondayOf(todayKey));
  const nextWeekIsPlanned = (nextWeekPlanned ?? []).length > 0;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/veckan?vecka=${prevMonday}`}
            className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              {weekLabel(from)}
              {isCurrentWeek && (
                <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                  pågår
                </span>
              )}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {from} – {to}
            </p>
          </div>
          <Link
            href={`/veckan?vecka=${nextMonday}`}
            className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            →
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {!isCurrentWeek && (
            <Link
              href="/veckan"
              className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Denna vecka
            </Link>
          )}
          <Link
            href={`/calendar/vecka/${from}`}
            className="text-zinc-500 underline hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Rutnätsvy
          </Link>
        </div>
      </div>

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

      <ComplianceCard
        title={`Vecka ${weekLabel(from).slice(2)}`}
        compliance={compliance}
        dayTypeByDate={dayTypeByDate}
      />

      <AvailabilityBand periods={(availabilityRows ?? []) as AvailabilityPeriod[]} />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Genomgång</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            En rad per pass med planen, utfallet och dina egna ord bredvid varandra.
            Varvtiderna förklarar ofta det siffrorna annars gör till en trend.
          </p>
        </div>
        <WeekAgenda
          monday={monday}
          todayKey={todayKey}
          diaryByDay={diaryByDay}
          dailyMetricsByDay={dailyMetricsByDay}
          competitionsByDay={competitionsByDay}
          matchesByDay={matchesByDay}
        />
      </section>

      {/* Loopens utgång: sidan slutar med nästa steg, inte med söndagen. Det
          är skillnaden mellan en rapport och en ritual. */}
      <div className="flex flex-wrap items-center gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex-1">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {nextWeekIsPlanned ? "Nästa vecka är planerad" : "Planera nästa vecka"}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {nextWeekIsPlanned
              ? "Se över den om något behöver justeras efter den här veckan."
              : "Veckomallarna rullas ut automatiskt i blocken — här justerar du det som ska avvika."}
          </p>
        </div>
        <Link
          href={`/sasongen?vecka=${nextMonday}`}
          className="rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {nextWeekIsPlanned ? "Se nästa vecka →" : "Planera nästa vecka →"}
        </Link>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Utfallet visas per pass, inte per Garmin-aktivitet: uppvärmning, huvudpass och
        nerjogg slås ihop till ett pass. Två pass samma dag hålls isär när det skiljer mer
        än ett par timmar mellan dem.
      </p>
    </div>
  );
}
