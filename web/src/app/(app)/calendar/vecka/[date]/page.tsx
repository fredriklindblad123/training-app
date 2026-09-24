import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { CalendarNav } from "@/components/CalendarHorizon";
import { SLOT_LABELS } from "@/lib/planning";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import { matchPlanToSessions, summarizeCompliance, type PlannedWorkout } from "@/lib/plan-matching";
import { AvailabilityBand } from "@/components/AvailabilityBand";
import type { AvailabilityPeriod } from "@/lib/planning";
import { PeriodStatTiles } from "@/components/PeriodStatTiles";
import { PassMarker } from "@/components/PassMarker";
import { formatKm } from "@/lib/format";
import {
  SV_WEEKDAYS_SHORT,
  STATUS_COLOR,
  STATUS_COLOR_VAR,
  STATUS_LABEL,
  type DayStatus,
} from "@/lib/calendar-utils";
import { weekLabel } from "@/lib/stats-utils";
import { athleteBlocks, blockHrefFor } from "@/lib/calendar-block";
import { DiaryMarkers } from "@/components/DiaryMarkers";
import {
  typeLabel,
  unmatchedCompetitions,
  COMPETED_BADGE_COLOR,
  COMPETED_COLOR,
  COMPETED_LABEL,
} from "@/lib/day-outcome";
import { BlockBand, type BandBlock } from "@/components/BlockBand";
import { getViewMode } from "@/lib/view-mode";

/* Veckokalendern: rutnätet, sju dagar i taget — uppslagsverket för att slå
 * upp en specifik dag (vad var planerat, vad blev det, tävling, dagbokstext).
 *
 * Ägde tidigare bara rutnätet — genomgången (efterlevnad, nyckeltal) låg på
 * en egen sida, /veckan. Den togs bort 2026-08-13: två sidor för samma
 * vecka var förvirrande och dubblerade varandra. Nyckeltalen (statTile
 * nedan) flyttade hit i stället. */

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

export default async function WeekPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<{ athlete?: string }>;
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
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const { athlete: athleteParam } = await searchParams;
  const runnerMode = scoped.role === "coach" && (await getViewMode()) === "runner";
  const scopedUserId = resolveScopedUserId(scoped, athleteParam, runnerMode);
  const athleteQuery = scoped.role === "coach" ? `?athlete=${scopedUserId}` : "";

  const [
    { data: activityRows },
    { data: plannedRows },
    { data: diaryRows },
    { data: competitionRows },
    { data: availabilityRows },
    { data: blockRows },
    allBlocks,
  ] = await Promise.all([
    // Rutnätet visar inga varvtider och ingen fotrad — varvdata, repgrupper,
    // incheckning och sömn/HRV hämtas därför inte här längre. Allt det hör
    // till genomgången på /veckan (docs/tranarloopen.md L1).
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", scopedUserId)
      .gte("start_time", from)
      .lt("start_time", nextExclusive)
      .order("start_time"),
    supabase
      .from("planned_workouts")
      .select(
        "id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds",
      )
      .eq("user_id", scopedUserId)
      .gte("scheduled_date", from)
      .lte("scheduled_date", to)
      .order("slot"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type, notes, session_log")
      .eq("user_id", scopedUserId)
      .gte("entry_date", from)
      .lte("entry_date", to),
    supabase
      .from("competitions")
      .select("id, name, competition_date, priority")
      .eq("user_id", scopedUserId)
      .gte("competition_date", from)
      .lte("competition_date", to),
    // K7: tillgänglighetsperioder som överlappar veckan. Överlapp, inte
    // "börjar inom veckan" — en tvåveckors läger­period ska synas även den
    // vecka den bara sträcker sig in i.
    supabase
      .from("availability_periods")
      .select("start_date, end_date, kind, label")
      .eq("user_id", scopedUserId)
      .lte("start_date", to)
      .gte("end_date", from),
    /* Blocken som överlappar perioden — se BlockBand. Samma !inner-mönster som
       planeringssidorna, alltså en fråga i stället för två. */
    supabase
      .from("season_blocks")
      .select("id, name, period, phase, start_date, end_date, season_block_athletes!inner(athlete_id)")
      .eq("season_block_athletes.athlete_id", scopedUserId)
      .lte("start_date", nextExclusive)
      .gte("end_date", from)
      .order("start_date"),
    // Hela listan, till Block-fliken: blockRows ovan täcker bara veckan,
    // men fliken ska peka på det block som pågår nu.
    athleteBlocks(supabase, scopedUserId),
  ]);

  const sessions = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );

  const sessionsByDay = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    sessionsByDay.set(s.date, [...(sessionsByDay.get(s.date) ?? []), s]);
  }

  // Kolumnerna som hämtas ovan matchar PlannedWorkout (lib/plan-matching.ts)
  // fält för fält, så samma rader återanvänds direkt i matchningen nedan i
  // stället för att mappas om.
  const plannedWorkouts = (plannedRows ?? []) as PlannedWorkout[];
  const plannedByDay = new Map<string, PlannedWorkout[]>();
  for (const p of plannedWorkouts) {
    plannedByDay.set(p.scheduled_date, [...(plannedByDay.get(p.scheduled_date) ?? []), p]);
  }

  const diaryByDay = new Map(
    (diaryRows ?? []).map((d) => [
      d.entry_date as string,
      d as {
        day_type: string | null;
        notes: string | null;
        session_log: string | null;
      },
    ]),
  );

  // K2: plan mot utfall. Både rutnätets "annan typ än planerat"-markering
  // och nyckeltalens jämförelse mot plan (statTiles nedan) bygger på samma
  // matchning.
  const planMatches = matchPlanToSessions(plannedWorkouts, sessions);
  const matchesByDay = new Map<string, typeof planMatches>();
  for (const m of planMatches) {
    const day = m.planned?.scheduled_date ?? m.session!.date;
    matchesByDay.set(day, [...(matchesByDay.get(day) ?? []), m]);
  }
  const competitionsByDay = new Map<string, { name: string; priority: string }[]>();
  for (const c of competitionRows ?? []) {
    const day = c.competition_date as string;
    competitionsByDay.set(day, [
      ...(competitionsByDay.get(day) ?? []),
      { name: c.name as string, priority: c.priority as string },
    ]);
  }
  const compliance = summarizeCompliance(planMatches);

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

      <BlockBand
        blocks={(blockRows ?? []) as unknown as BandBlock[]}
        from={from}
        to={nextExclusive}
      />

      <CalendarNav
        current="week"
        title={
          <>
            {weekLabel(from)}{" "}
            <span className="text-sm font-normal text-[var(--ink-3)]">
              {from} – {to}
            </span>
          </>
        }
        prevHref={`/calendar/vecka/${toKey(addDays(monday, -7))}${athleteQuery}`}
        nextHref={`/calendar/vecka/${toKey(addDays(monday, 7))}${athleteQuery}`}
        jumpDate={todayKey}
        dayHref={todayDayHref}
        weekHref={todayWeekHref}
        monthHref={todayMonthHref}
        blockHref={blockHrefFor(allBlocks, todayKey, athleteQuery)}
        yearHref={todayYearHref}
        athleteId={scoped.role === "coach" ? scopedUserId : undefined}
      />

      <PeriodStatTiles sessions={sessions} compliance={compliance} />

      <AvailabilityBand
        periods={(availabilityRows ?? []) as AvailabilityPeriod[]}
        className="-mb-2"
      />

      <div className="grid grid-cols-1 gap-1.5 lg:grid-cols-7">
        {Array.from({ length: 7 }, (_, i) => {
          const d = addDays(monday, i);
          const key = toKey(d);
          const done = sessionsByDay.get(key) ?? [];
          const diary = diaryByDay.get(key);
          const comps = unmatchedCompetitions(done, competitionsByDay.get(key) ?? []);
          // Historik visar bara vad som faktiskt gjordes; framåt i tiden
          // (fram till och med idag, om inget redan är genomfört) visas i
          // stället vad som är planerat — samma gräns som månads-/årsvyn.
          const planned = done.length === 0 && key >= todayKey ? (plannedByDay.get(key) ?? []) : [];
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
          const isEmpty =
            planned.length === 0 && done.length === 0 && !diaryStatus && comps.length === 0;
          // Bara den första parningen för dagen driver markören — en cell på
          // 150 pixlar har inte plats för en fullständig parning när flera
          // pass ligger samma dag, och dagvyn (inte rutnätet) är platsen för
          // det. matchPlanToSessions gör själva parningen (lib/plan-matching.ts);
          // "rest" undantas här medvetet trots att biblioteket klassar en
          // tränad planerad vilodag som "avvikande typ" — rutnätet ska inte
          // nagga en extra löprunda på en vilodag, det hör hemma i
          // efterlevnadskortet (som inte räknar en sådan dag som "genomförd
          // vila" heller) snarare än som en visuell varning i varje ruta.
          const firstMatch = (matchesByDay.get(key) ?? []).find((m) => m.planned != null);
          const mismatch =
            firstMatch != null &&
            firstMatch.outcome === "avvikande typ" &&
            firstMatch.planned!.workout_type !== "rest";
          const isToday = key === todayKey;

          return (
            <Link
              key={key}
              href={`/calendar/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}${athleteQuery}`}
              className={`flex min-h-28 flex-col gap-1.5 rounded border p-2 transition-colors hover:bg-[var(--surface-raised)] ${
                isToday
                  ? "border-[var(--foreground)]"
                  : isEmpty
                    ? "border-[var(--line)]/60"
                    : "border-[var(--line)]"
              }`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className={`text-xs font-semibold ${
                    isEmpty ? "text-[var(--ink-3)]" : "text-[var(--foreground)]"
                  }`}
                >
                  {SV_WEEKDAYS_SHORT[i]} {d.getDate()}
                </span>
                {/* Samma språk som månadsvyn: en tränad dag utan loggat pass
                    ritas som ett pass, inte som en bricka. Se motiveringen
                    där. */}
                {showStatus && diaryStatus === "training" && (
                  <span
                    className="flex items-center gap-1.5 text-[11px] text-[var(--foreground)]"
                    title="Dagboken säger träning, men inget pass är loggat"
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: STATUS_COLOR_VAR.training }}
                      aria-hidden="true"
                    />
                    Träning
                  </span>
                )}

                {showStatus && diaryStatus && diaryStatus !== "training" && (
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] text-white ${STATUS_COLOR[diaryStatus]}`}
                    title={STATUS_LABEL[diaryStatus]}
                  >
                    {STATUS_LABEL[diaryStatus]}
                  </span>
                )}
              </div>

              {comps.map((c, ci) => (
                <div
                  key={ci}
                  className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${COMPETED_BADGE_COLOR}`}
                >
                  {c.priority} · {c.name}
                </div>
              ))}

              {/* Planerat: ihåliga ringar, dämpad text */}
              {planned.map((p) => (
                <div
                  key={p.id}
                  className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--ink-3)]"
                  title="Planerat"
                >
                  <PassMarker type={p.workout_type} planned />
                  <span>
                    {(p.slot ?? 1) > 1 && (
                      <span className="text-[var(--ink-3)]">
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
                  className="flex items-start gap-1.5 text-[11px] leading-snug text-[var(--foreground)]"
                  title="Genomfört"
                >
                  <PassMarker type={sess.category} planned={false} />
                  <span>
                    <span className="font-medium">
                      {sess.category ? typeLabel(sess.category) : "Pass"}
                    </span>
                    {sess.distanceMeters ? ` · ${formatKm(sess.distanceMeters)}` : ""}
                    {sess.durationSeconds ? ` · ${Math.round(sess.durationSeconds / 60)}′` : ""}
                  </span>
                </div>
              ))}

              {/* Delad med månads-, block- och dagvyn, se DiaryMarkers.
                  Veckovyn var länge den ENDA yta som visade styrkan ur
                  loggen; nu ritar alla fyra samma sak. */}
              <DiaryMarkers
                dayType={diaryStatus}
                sessionLog={diary?.session_log ?? null}
                hasSessions={sessions.length > 0}
              />

              {/* Avvikelse: bara när båda finns och typerna skiljer sig.
                  Hör till plan mot utfall, inte till dagboken, och ligger
                  därför utanför DiaryMarkers. */}
              {mismatch && (
                <div className="text-[10px] text-[var(--ink-note)]">
                  Annan typ än planerat
                </div>
              )}

              {diary?.notes && (
                <p className="mt-auto line-clamp-3 text-[10px] leading-snug text-[var(--ink-3)]">
                  {diary.notes}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--ink-3)]">
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
        <span className="flex items-center gap-1.5">
          <span className={`h-2.5 w-2.5 rounded-full ${COMPETED_COLOR}`} aria-hidden="true" />
          {COMPETED_LABEL} (tävling utan matchande pass)
        </span>
        <span>
          <span className="text-[var(--ink-note)]">Annan typ än planerat</span> = passet blev av,
          men som en annan typ
        </span>
      </div>

      <p className="text-xs text-[var(--ink-3)]">
        Utfallet visas per pass, inte per Garmin-aktivitet: uppvärmning, huvudpass och nerjogg slås
        ihop till ett pass. Två pass samma dag hålls isär när det skiljer mer än ett par timmar
        mellan dem.
      </p>
    </div>
  );
}
