import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import {
  SV_WEEKDAYS_SHORT,
  STATUS_COLOR,
  STATUS_LABEL,
  STATUS_COLOR_VAR,
  type DayStatus,
} from "@/lib/calendar-utils";
import { CalendarNav } from "@/components/CalendarHorizon";
import { AvailabilityBand } from "@/components/AvailabilityBand";
import {
  PHASE_LABELS,
  PHASE_COLOR_VARS,
  addDays,
  toDateKey,
  type AvailabilityPeriod,
  type PhaseType,
} from "@/lib/planning";
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
import { athleteBlocks, blockHrefFor } from "@/lib/calendar-block";
import { isoWeekStart, weekLabel } from "@/lib/stats-utils";
import { getViewMode } from "@/lib/view-mode";

/* Blocket som kalenderhorisont (begäran 2026-09-21).
 *
 * De andra horisonterna svarar på "vad hände den här tiden". Den här svarar
 * på "hur går blocket" — och den frågan ställs vecka för vecka, inte dag för
 * dag. Rutnätet har därför en veckokolumn längst till vänster som länkar in
 * i veckovyn: man ser hela blockets båge på en skärm och kan gå ner i den
 * vecka som sticker ut.
 *
 * Månadsvyn kan inte svara på det. Ett block följer sällan en månad — höstens
 * "Allmän förberedelse" löper 28 sep–20 dec — så blockets början och slut
 * hamnar mitt i två olika månadsvyer och bågen syns aldrig hel.
 *
 * Dagcellerna är medvetet identiska med månadsvyns: samma ordning
 * (tävling, status, genomfört, planerat), samma PassMarker, samma färger.
 * En dag ska inte se olika ut beroende på vilken horisont man råkar stå i.
 */

export default async function BlockPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ athlete?: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const { athlete: athleteParam } = await searchParams;
  const runnerMode = scoped.role === "coach" && (await getViewMode()) === "runner";
  const scopedUserId = resolveScopedUserId(scoped, athleteParam, runnerMode);
  const athleteQuery = scoped.role === "coach" ? `?athlete=${scopedUserId}` : "";

  const now = new Date();
  const todayKey = toDateKey(now);

  /* Hela blocklistan, inte bara det begärda blocket: pilarna föregående/nästa
     behöver grannarna, och fliken behöver veta att det finns block alls.
     Listan är kort — en säsong är ett tiotal block. */
  const blocks = await athleteBlocks(supabase, scopedUserId);
  const index = blocks.findIndex((b) => b.id === id);
  // Ett block som inte tillhör löparen ska inte gå att nå via URL:en, inte
  // ens som tom sida. RLS skyddar raderna; det här skyddar rutten.
  if (index === -1) notFound();
  const block = blocks[index];

  const start = block.start_date;
  const end = block.end_date;
  const endExclusive = toDateKey(addDays(new Date(`${end}T00:00:00`), 1));

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
      .gte("start_time", start)
      .lt("start_time", endExclusive)
      .order("start_time"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type")
      .eq("user_id", scopedUserId)
      .gte("entry_date", start)
      .lte("entry_date", end)
      .not("day_type", "is", null),
    supabase
      .from("planned_workouts")
      .select(
        "id, scheduled_date, workout_type, slot, title, target_distance_meters, target_duration_seconds",
      )
      .eq("user_id", scopedUserId)
      .order("slot")
      .gte("scheduled_date", start)
      .lte("scheduled_date", end),
    supabase
      .from("availability_periods")
      .select("start_date, end_date, kind, label")
      .eq("user_id", scopedUserId)
      .lte("start_date", end)
      .gte("end_date", start),
    supabase
      .from("competitions")
      .select("id, name, competition_date, priority")
      .eq("user_id", scopedUserId)
      .gte("competition_date", start)
      .lte("competition_date", end),
  ]);

  // SESSION_ACTIVITY_COLUMNS är en runtime-sträng, så klienten kan inte
  // härleda radtypen — samma omväg som månads- och årsvyn.
  const blockSessions = groupActivitiesIntoSessions(
    (activities ?? []) as unknown as SessionActivity[],
  );
  const planMatches = matchPlanToSessions(
    (plannedWorkouts ?? []) as unknown as PlannedWorkout[],
    blockSessions,
  );
  const compliance = summarizeCompliance(planMatches);

  const sessionsByDay = new Map<string, TrainingSession[]>();
  for (const s of blockSessions) {
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

  /* Rutnätet går från måndagen i blockets FÖRSTA vecka till söndagen i dess
     sista, inte från startdatum till slutdatum. Ett block som börjar en
     onsdag ska ändå ha sina veckor på rad under rätt veckodag — annars
     hoppar kolumnerna och "tisdagar är kvalitet" går inte att se. Dagar
     utanför blocket ritas tonade i stället för att utelämnas, så att veckan
     alltid är hel. */
  const gridStart = isoWeekStart(start);
  const gridEndMonday = isoWeekStart(end);
  const weeks: string[] = [];
  for (
    let d = new Date(`${gridStart}T00:00:00`);
    toDateKey(d) <= gridEndMonday;
    d.setDate(d.getDate() + 7)
  ) {
    weeks.push(toDateKey(d));
  }

  const prevBlock = index > 0 ? blocks[index - 1] : null;
  const nextBlock = index < blocks.length - 1 ? blocks[index + 1] : null;

  // Innevarande dag/vecka/månad/år — horisontväxlaren pekar alltid på
  // innevarande period, aldrig på den man råkar titta på (se månadsvyn).
  const hY = now.getFullYear();
  const hM = now.getMonth() + 1;
  const hD = now.getDate();

  const phaseColor = PHASE_COLOR_VARS[block.phase as PhaseType] ?? "var(--line)";

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <CalendarNav
        current="block"
        title={
          <span className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
            {block.name}
            <span className="text-sm font-normal text-[var(--ink-3)]">
              {PHASE_LABELS[block.phase as PhaseType] ?? block.phase}
            </span>
          </span>
        }
        /* Pilarna bläddrar mellan BLOCK här, inte mellan datum. Det är vad
           horisonten handlar om — nästa steg från "Allmän förberedelse" är
           "Tävlingsförberedande", inte "samma block fast en vecka senare".
           Saknas grannen pekar pilen på blocket självt hellre än att länka
           till ingenting; kanten på säsongen är inget fel. */
        prevHref={`/calendar/block/${prevBlock?.id ?? block.id}${athleteQuery}`}
        nextHref={`/calendar/block/${nextBlock?.id ?? block.id}${athleteQuery}`}
        jumpDate={todayKey}
        dayHref={`/calendar/${hY}/${hM}/${hD}${athleteQuery}`}
        weekHref={`/calendar/vecka/${todayKey}${athleteQuery}`}
        monthHref={`/calendar/${hY}/${hM}${athleteQuery}`}
        blockHref={blockHrefFor(blocks, todayKey, athleteQuery)}
        yearHref={`/calendar/${hY}${athleteQuery}`}
        athleteId={scoped.role === "coach" ? scopedUserId : undefined}
      />

      {/* Blockets egen rad: fasfärg, datum, längd och fokus. Fasbandet till
          vänster är samma färg som blocket har i årsvyn och på
          Säsongsöversikt, så man känner igen vilket block man står i. */}
      <div
        className="flex flex-wrap items-baseline gap-x-4 gap-y-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-4 py-3 text-sm"
        style={{ borderLeft: `4px solid ${phaseColor}` }}
      >
        <span className="tabular text-[var(--ink-2)]">
          {start} – {end}
        </span>
        <span className="text-[var(--ink-3)]">
          {weeks.length} {weeks.length === 1 ? "vecka" : "veckor"}
        </span>
        {block.focus && <span className="text-[var(--ink-2)]">{block.focus}</span>}
      </div>

      <PeriodStatTiles sessions={blockSessions} compliance={compliance} />

      <AvailabilityBand
        periods={(availabilityRows ?? []) as AvailabilityPeriod[]}
        className="-mb-2"
      />

      {/* Veckokolumn + sju dagar. Skrollar i egen behållare: åtta kolumner
          får inte plats på en telefon, och sidan i sig ska aldrig skrolla i
          sidled. */}
      <div className="overflow-x-auto">
        <div className="grid min-w-3xl grid-cols-[3.5rem_repeat(7,minmax(0,1fr))] gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] text-xs">
          <div className="bg-[var(--surface-raised)] px-2 py-1 text-center font-medium text-[var(--ink-3)]">
            Vecka
          </div>
          {SV_WEEKDAYS_SHORT.map((wd) => (
            <div
              key={wd}
              className="bg-[var(--surface-raised)] px-2 py-1 text-center font-medium text-[var(--ink-3)]"
            >
              {wd}
            </div>
          ))}

          {weeks.map((monday) => (
            <BlockWeekRow
              key={monday}
              monday={monday}
              blockStart={start}
              blockEnd={end}
              todayKey={todayKey}
              athleteQuery={athleteQuery}
              sessionsByDay={sessionsByDay}
              plannedByDay={plannedByDay}
              diaryByDay={diaryByDay}
              competitionsByDay={competitionsByDay}
            />
          ))}
        </div>
      </div>

      <p className="text-sm text-[var(--ink-3)]">
        Blocket planeras på{" "}
        <Link href="/detaljplan" className="underline">
          Detaljplan
        </Link>
        {" "}och följs upp per löpare på{" "}
        <Link href={`/uppfoljning?period=block&block=${block.id}`} className="underline">
          Uppföljning
        </Link>
        .
      </p>
    </div>
  );
}

/** En veckorad: veckonumret som länk in i veckovyn, sedan sju dagceller. */
function BlockWeekRow({
  monday,
  blockStart,
  blockEnd,
  todayKey,
  athleteQuery,
  sessionsByDay,
  plannedByDay,
  diaryByDay,
  competitionsByDay,
}: {
  monday: string;
  blockStart: string;
  blockEnd: string;
  todayKey: string;
  athleteQuery: string;
  sessionsByDay: Map<string, TrainingSession[]>;
  plannedByDay: Map<string, PlannedWorkout[]>;
  diaryByDay: Map<string, DayStatus>;
  competitionsByDay: Map<string, { name: string; priority: string }[]>;
}) {
  const days = Array.from({ length: 7 }, (_, i) =>
    toDateKey(addDays(new Date(`${monday}T00:00:00`), i)),
  );

  return (
    <>
      <Link
        href={`/calendar/vecka/${monday}${athleteQuery}`}
        className="flex items-center justify-center bg-[var(--surface-raised)] px-1 py-2 text-center text-[var(--ink-3)] hover:text-[var(--foreground)]"
      >
        {weekLabel(monday)}
      </Link>

      {days.map((key) => {
        // Dagar före blockets start eller efter dess slut hålls kvar för att
        // veckan ska vara hel, men tonas ner och är inte klickbara — de hör
        // till ett annat block.
        const outside = key < blockStart || key > blockEnd;
        if (outside) {
          return <div key={key} className="min-h-24 bg-[var(--surface)] opacity-40" />;
        }

        const done = sessionsByDay.get(key) ?? [];
        const planned = plannedByDay.get(key) ?? [];
        const diaryStatus = diaryByDay.get(key) ?? null;
        const comps = unmatchedCompetitions(done, competitionsByDay.get(key) ?? []);
        const showStatus =
          diaryStatus != null && (diaryStatus !== "training" || done.length === 0);
        const showPlanned = done.length === 0 && key >= todayKey && planned.length > 0;
        const [y, m, d] = key.split("-").map(Number);

        return (
          <Link
            key={key}
            href={`/calendar/${y}/${m}/${d}${athleteQuery}`}
            className={`flex min-h-24 flex-col gap-1 p-2 hover:bg-[var(--surface-raised)] ${
              key === todayKey ? "bg-[var(--surface-raised)]" : "bg-[var(--surface)]"
            }`}
          >
            <span
              className={
                key === todayKey
                  ? "font-semibold text-[var(--foreground)]"
                  : "text-[var(--ink-3)]"
              }
            >
              {d}
            </span>

            {comps.map((c, ci) => (
              <span
                key={`comp-${ci}`}
                className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium ${COMPETED_BADGE_COLOR}`}
              >
                {c.priority} · {c.name}
              </span>
            ))}

            {showStatus && diaryStatus === "training" && (
              <span className="flex items-center gap-1.5 text-[11px] text-[var(--foreground)]">
                <span
                  className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: STATUS_COLOR_VAR.training }}
                  aria-hidden="true"
                />
                Träning
              </span>
            )}

            {showStatus && diaryStatus && diaryStatus !== "training" && (
              <span
                className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${STATUS_COLOR[diaryStatus]}`}
              >
                {STATUS_LABEL[diaryStatus]}
              </span>
            )}

            {done.map((s) => (
              <span
                key={s.id}
                className="flex items-center gap-1.5 text-[11px] text-[var(--foreground)]"
              >
                <PassMarker type={s.category} planned={false} />
                {typeLabel(s.category)}
              </span>
            ))}

            {showPlanned &&
              planned.map((p) => (
                <span
                  key={p.id}
                  className="flex items-center gap-1.5 text-[11px] text-[var(--ink-3)]"
                >
                  <PassMarker type={p.workout_type} planned />
                  {typeLabel(p.workout_type)}
                </span>
              ))}
          </Link>
        );
      })}
    </>
  );
}
