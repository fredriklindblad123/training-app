import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId, viewableAthletes } from "@/lib/auth-scope";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
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
import { SV_WEEKDAYS_SHORT, STATUS_COLOR, STATUS_LABEL, type DayStatus } from "@/lib/calendar-utils";
import { weekLabel } from "@/lib/stats-utils";
import { mentionsStrength } from "@/lib/diary-text";
import { typeLabel, unmatchedCompetitions, COMPETED_BADGE_COLOR, COMPETED_LABEL } from "@/lib/day-outcome";

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
  const scopedUserId = resolveScopedUserId(scoped, athleteParam);
  const athleteQuery = scoped.role === "coach" ? `?athlete=${scopedUserId}` : "";

  const [
    { data: activityRows },
    { data: plannedRows },
    { data: diaryRows },
    { data: competitionRows },
    { data: availabilityRows },
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

  const monthHref = `/calendar/${monday.getFullYear()}/${monday.getMonth() + 1}${athleteQuery}`;
  const yearHref = `/calendar/${monday.getFullYear()}${athleteQuery}`;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      {scoped.role === "coach" && (
        <AthleteSwitcher
          athletes={viewableAthletes(scoped)}
          viewerUserId={scoped.userId}
          activeId={scopedUserId}
          buildHref={(id) => `/calendar/vecka/${date}?athlete=${id}`}
        />
      )}

      <CalendarNav
        current="week"
        title={
          <>
            {weekLabel(from)}{" "}
            <span className="text-sm font-normal text-zinc-500 dark:text-zinc-400">
              {from} – {to}
            </span>
          </>
        }
        prevHref={`/calendar/vecka/${toKey(addDays(monday, -7))}${athleteQuery}`}
        nextHref={`/calendar/vecka/${toKey(addDays(monday, 7))}${athleteQuery}`}
        jumpDate={todayKey}
        dayHref={`/calendar/${monday.getFullYear()}/${monday.getMonth() + 1}/${monday.getDate()}${athleteQuery}`}
        weekHref={`/calendar/vecka/${todayKey}${athleteQuery}`}
        monthHref={monthHref}
        yearHref={yearHref}
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
          const planned =
            done.length === 0 && key >= todayKey ? (plannedByDay.get(key) ?? []) : [];
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
              className={`flex min-h-28 flex-col gap-1.5 rounded border p-2 transition-colors hover:bg-zinc-50 dark:hover:bg-zinc-900 ${
                isToday
                  ? "border-zinc-900 dark:border-zinc-100"
                  : isEmpty
                    ? "border-zinc-100 dark:border-zinc-800/60"
                    : "border-zinc-200 dark:border-zinc-800"
              }`}
            >
              <div className="flex items-baseline justify-between gap-1">
                <span
                  className={`text-xs font-semibold ${
                    isEmpty
                      ? "text-zinc-400 dark:text-zinc-600"
                      : "text-zinc-900 dark:text-zinc-100"
                  }`}
                >
                  {SV_WEEKDAYS_SHORT[i]} {d.getDate()}
                </span>
                {showStatus && diaryStatus && (
                  <span
                    className={`rounded px-1 py-0.5 text-[10px] text-white ${STATUS_COLOR[diaryStatus]}`}
                    title={
                      diaryStatus === "training"
                        ? "Dagboken säger träning, men inget pass är loggat"
                        : STATUS_LABEL[diaryStatus]
                    }
                  >
                    {diaryStatus === "training" ? "Ej loggat" : STATUS_LABEL[diaryStatus]}
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
                  className="flex items-start gap-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
                  title="Planerat"
                >
                  <PassMarker type={p.workout_type} planned />
                  <span>
                    {(p.slot ?? 1) > 1 && (
                      <span className="text-zinc-400 dark:text-zinc-500">
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
                  className="flex items-start gap-1.5 text-[11px] leading-snug text-zinc-900 dark:text-zinc-100"
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

              {/* Styrka enligt dagbokstexten. Ingen aktivitet finns — därav
                  den nedtonade stilen och parentesen. */}
              {mentionsStrength(diary?.session_log) && (
                <div
                  className="flex items-start gap-1.5 text-[11px] leading-snug text-zinc-500 dark:text-zinc-400"
                  title="Styrka nämnd i träningsloggen — inget pass loggat med volym"
                >
                  <span
                    className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full opacity-60"
                    style={{ backgroundColor: "var(--cat-strength)" }}
                    aria-hidden="true"
                  />
                  <span>Styrka (ur loggen)</span>
                </div>
              )}

              {/* Avvikelse: bara när båda finns och typerna skiljer sig */}
              {mismatch && (
                <div className="text-[10px] text-amber-700 dark:text-amber-400">
                  Annan typ än planerat
                </div>
              )}

              {diary?.notes && (
                <p className="mt-auto line-clamp-3 text-[10px] leading-snug text-zinc-500 dark:text-zinc-400">
                  {diary.notes}
                </p>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-zinc-500 dark:text-zinc-400">
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
          <span className="h-2.5 w-2.5 rounded-full bg-violet-600" aria-hidden="true" />
          {COMPETED_LABEL} (tävling utan matchande pass)
        </span>
        <span className="text-amber-700 dark:text-amber-400">
          Gul text = utfallet blev en annan passtyp än planerat
        </span>
      </div>


      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Utfallet visas per pass, inte per Garmin-aktivitet: uppvärmning, huvudpass och
        nerjogg slås ihop till ett pass. Två pass samma dag hålls isär när det skiljer mer
        än ett par timmar mellan dem.
      </p>
    </div>
  );
}

