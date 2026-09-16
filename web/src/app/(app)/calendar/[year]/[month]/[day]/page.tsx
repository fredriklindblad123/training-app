import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { CalendarNav } from "@/components/CalendarHorizon";
import { DayContent } from "@/components/DayContent";
import {
  SV_MONTHS,
  dateKey,
  nextDateKey,
  isValidYear,
  isValidMonth,
  isValidDay,
} from "@/lib/calendar-utils";
import { BlockBand, type BandBlock } from "@/components/BlockBand";
import { getViewMode } from "@/lib/view-mode";

export default async function DayPage({
  params,
  searchParams,
}: {
  params: Promise<{ year: string; month: string; day: string }>;
  searchParams: Promise<{ athlete?: string }>;
}) {
  const { year: yearParam, month: monthParam, day: dayParam } = await params;
  const year = Number(yearParam);
  const month = Number(monthParam);
  const day = Number(dayParam);
  if (
    !isValidYear(year) ||
    !isValidMonth(month) ||
    !isValidDay(year, month, day)
  ) {
    notFound();
  }

  const dateStr = dateKey(year, month, day);
  const nextDateStr = nextDateKey(year, month, day);
  const prevDate = new Date(year, month - 1, day - 1);
  const nextDate = new Date(year, month - 1, day + 1);

  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const { athlete: athleteParam } = await searchParams;
  const runnerMode = scoped.role === "coach" && (await getViewMode()) === "runner";
  const scopedUserId = resolveScopedUserId(scoped, athleteParam, runnerMode);
  const athleteQuery = scoped.role === "coach" ? `?athlete=${scopedUserId}` : "";

  /* Dagens block. Dagvyn hämtar annars ingenting själv — allt innehåll bor i
     DayContent — men vilken PERIOD dagen ligger i är en sidnivå-uppgift, inte
     en egenskap hos ett enskilt pass. Se BlockBand. */
  const { data: blockRows } = await supabase
    .from("season_blocks")
    .select("id, name, period, phase, start_date, end_date, season_block_athletes!inner(athlete_id)")
    .eq("season_block_athletes.athlete_id", scopedUserId)
    .lte("start_date", dateStr)
    .gte("end_date", dateStr)
    .order("start_date");

  /* Dagens tävling. Dagvyn var den ENDA kalendervyn som inte visade
     tävlingar — år, månad och vecka gjorde det redan. En löpare som öppnade
     tävlingsdagen såg alltså sina pass men inte att det var tävling, vilket
     är det enda som egentligen står på schemat den dagen. */
  const { data: raceRows } = await supabase
    .from("competitions")
    .select("id, name, priority, location")
    .eq("user_id", scopedUserId)
    .eq("competition_date", dateStr);

  const todayStr = dateKey(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate(),
  );

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
        from={dateStr}
        to={dateStr}
      />

      <CalendarNav
        current="day"
        title={`${day} ${SV_MONTHS[month - 1]} ${year}`}
        prevHref={`/calendar/${prevDate.getFullYear()}/${prevDate.getMonth() + 1}/${prevDate.getDate()}${athleteQuery}`}
        nextHref={`/calendar/${nextDate.getFullYear()}/${nextDate.getMonth() + 1}/${nextDate.getDate()}${athleteQuery}`}
        jumpDate={todayStr}
        dayHref={todayDayHref}
        weekHref={todayWeekHref}
        monthHref={todayMonthHref}
        yearHref={todayYearHref}
        athleteId={scoped.role === "coach" ? scopedUserId : undefined}
      />

      {/* Tävlingen först, före passen: är det tävlingsdag är det DET som
          gäller, och passen runt omkring är uppvärmning och nedjogg. Egen
          färg (--cat-race) och inte kortens vanliga yta, så den inte läses
          som ännu ett pass. */}
      {((raceRows ?? []) as { id: string; name: string; priority: string; location: string | null }[]).map(
        (r) => (
          <div
            key={r.id}
            className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border p-4"
            style={{
              borderColor: "color-mix(in oklab, var(--cat-race) 55%, var(--line))",
              backgroundImage:
                "radial-gradient(125% 135% at 0% 0%, color-mix(in oklab, var(--cat-race) 20%, transparent), transparent 62%)",
            }}
          >
            <span className="display text-xl leading-tight font-bold text-[var(--foreground)]">
              {r.name}
            </span>
            <span className="display text-sm font-semibold text-[var(--cat-race)]">
              {r.priority === "C" ? "Träningstävling" : `${r.priority}-lopp`}
            </span>
            {r.location && <span className="text-sm text-[var(--ink-3)]">{r.location}</span>}
          </div>
        ),
      )}

      {/* Allt dagsinnehåll bor i DayContent, delat med Blockplans dagsvy
          för flera löpare (/blockplan/pass) — se motiveringen där. */}
      <DayContent userId={scopedUserId} dateStr={dateStr} nextDateStr={nextDateStr} />
    </div>
  );
}
