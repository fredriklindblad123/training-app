import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId, viewableAthletes } from "@/lib/auth-scope";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
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
  const scopedUserId = resolveScopedUserId(scoped, athleteParam);
  const athleteQuery = scoped.role === "coach" ? `?athlete=${scopedUserId}` : "";

  const todayStr = dateKey(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate(),
  );

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      {scoped.role === "coach" && (
        <AthleteSwitcher
          athletes={viewableAthletes(scoped)}
          viewerUserId={scoped.userId}
          activeId={scopedUserId}
          buildHref={(id) => `/calendar/${year}/${month}/${day}?athlete=${id}`}
        />
      )}

      <CalendarNav
        current="day"
        title={`${day} ${SV_MONTHS[month - 1]} ${year}`}
        prevHref={`/calendar/${prevDate.getFullYear()}/${prevDate.getMonth() + 1}/${prevDate.getDate()}${athleteQuery}`}
        nextHref={`/calendar/${nextDate.getFullYear()}/${nextDate.getMonth() + 1}/${nextDate.getDate()}${athleteQuery}`}
        jumpDate={todayStr}
        dayHref={`/calendar/${year}/${month}/${day}${athleteQuery}`}
        weekHref={`/calendar/vecka/${dateStr}${athleteQuery}`}
        monthHref={`/calendar/${year}/${month}${athleteQuery}`}
        yearHref={`/calendar/${year}${athleteQuery}`}
        athleteId={scoped.role === "coach" ? scopedUserId : undefined}
      />

      {/* Allt dagsinnehåll bor i DayContent, delat med Detaljplans dagsvy
          för flera löpare (/detaljplan/pass) — se motiveringen där. */}
      <DayContent userId={scopedUserId} dateStr={dateStr} nextDateStr={nextDateStr} />
    </div>
  );
}
