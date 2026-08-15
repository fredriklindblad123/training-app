import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile } from "@/lib/auth-scope";
import {
  computeDailyStatus,
  BASELINE_WINDOW_DAYS,
  type DailyStatus,
  type DailyStatusInput,
} from "@/lib/daily-status";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import { CATEGORY_LABELS, isActivityCategory } from "@/lib/categories";
import { STATUS_LABEL, type DayStatus } from "@/lib/calendar-utils";
import { WORKOUT_LABELS, type WorkoutType } from "@/lib/planning";
import { formatKm, formatDuration } from "@/lib/format";
import { toDateKey } from "@/lib/week-series";

/* Översikt (2026-08-16, uttrycklig begäran): en coach med flera löpare
 * (Daniel/Fredrik: Alice, Nike, Signe, Emma) tyckte det blev jobbigt att
 * scrolla mellan varje löpares fulla dashboard en och en bara för att se
 * hur läget är. Den här sidan visar alla på en gång — men bara det som
 * går att skumma på några sekunder per löpare, inte hela dashboarden i
 * miniatyr (ringar, kontinuitet, formkurva). Klicka på en löpare för att gå
 * till hens fulla dashboard för en djupdykning.
 *
 * Bara meningsfull för en coach — en löpare har ingen adept att se en
 * översikt av, se redirect nedan. */

type WorkoutTypeLite = { workout_type: string; title: string | null };

function typeLabel(type: string): string {
  if (isActivityCategory(type)) return CATEGORY_LABELS[type];
  return WORKOUT_LABELS[type as WorkoutType] ?? type;
}

function statusBadge(status: DailyStatus): {
  label: string;
  className: string;
} {
  if (status.evaluated === 0) {
    return {
      label: "Otillräcklig baslinje",
      className: "border border-zinc-300 text-zinc-500 dark:border-zinc-700 dark:text-zinc-400",
    };
  }
  if (status.shouldEaseOff) {
    return {
      label: `Avvikelse: ${status.concerning.map((m) => m.spec.label).join(", ")}`,
      className: "bg-amber-500 text-white",
    };
  }
  return {
    label: "Normalt",
    className: "border border-emerald-400 text-emerald-700 dark:border-emerald-700 dark:text-emerald-400",
  };
}

export default async function OversiktPage() {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null; // Layouten redirectar redan utan inloggning.
  if (scoped.role !== "coach") {
    redirect("/dashboard");
  }

  const now = new Date();
  const todayKey = toDateKey(now);
  // Samma baslinjefönster som /dashboard, plus lite marginal — se
  // computeDailyStatus/BASELINE_WINDOW_DAYS i lib/daily-status.ts.
  const baselineFrom = toDateKey(new Date(now.getTime() - (BASELINE_WINDOW_DAYS + 5) * 86_400_000));

  const overviews = await Promise.all(
    scoped.linkedAthletes.map(async (athlete) => {
      const [
        { data: todayActivities },
        { data: todayPlanned },
        { data: statusMetrics },
        { data: todayDiary },
      ] = await Promise.all([
        supabase
          .from("activities")
          .select(SESSION_ACTIVITY_COLUMNS)
          .eq("user_id", athlete.id)
          .gte("start_time", todayKey)
          .order("start_time"),
        supabase
          .from("planned_workouts")
          .select("workout_type, title")
          .eq("user_id", athlete.id)
          .eq("scheduled_date", todayKey)
          .order("slot", { ascending: true }),
        supabase
          .from("daily_metrics")
          .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
          .eq("user_id", athlete.id)
          .gte("metric_date", baselineFrom),
        supabase
          .from("diary_entries")
          .select("day_type")
          .eq("user_id", athlete.id)
          .eq("entry_date", todayKey)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle(),
      ]);

      const sessions = groupActivitiesIntoSessions(
        (todayActivities ?? []) as unknown as SessionActivity[],
      );
      const statusRows: DailyStatusInput[] = (statusMetrics ?? []).map((m) => ({
        date: m.metric_date as string,
        hrv: m.hrv_overnight_avg,
        restingHr: m.resting_hr,
        sleepHours: m.sleep_seconds != null ? m.sleep_seconds / 3600 : null,
        sleepScore: m.sleep_score,
      }));
      const status = computeDailyStatus(statusRows, todayKey, 7);

      return {
        id: athlete.id,
        fullName: athlete.fullName,
        sessions,
        planned: (todayPlanned ?? []) as WorkoutTypeLite[],
        status,
        // "Ledig" visas inte som egen status — se lib/day-status.ts.
        dayType:
          todayDiary?.day_type && todayDiary.day_type !== "rest"
            ? (todayDiary.day_type as DayStatus)
            : null,
      };
    }),
  );

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Översikt</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Alla dina löpare på en gång — dagens status, dagens pass och det som avviker. Klicka på
          en löpare för hens fulla dashboard.
        </p>
      </div>

      {overviews.length === 0 ? (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">
          Inga löpare kopplade än — lägg till en under Inställningar.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {overviews.map((o) => {
            const badge = statusBadge(o.status);
            const dayKm = o.sessions.reduce((sum, s) => sum + (s.distanceMeters ?? 0), 0) / 1000;
            const daySeconds = o.sessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);
            return (
              <Link
                key={o.id}
                href={`/dashboard?athlete=${o.id}`}
                className="flex flex-col gap-3 rounded border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
                    {o.fullName ?? "Namnlös löpare"}
                  </span>
                  {o.dayType && (
                    <span className="inline-flex items-center rounded bg-rose-500 px-2 py-0.5 text-xs font-medium text-white">
                      {STATUS_LABEL[o.dayType]}
                    </span>
                  )}
                </div>

                <span
                  className={`inline-flex w-fit items-center rounded px-2 py-0.5 text-xs font-medium ${badge.className}`}
                >
                  {badge.label}
                </span>

                <div className="flex flex-col gap-1 text-sm">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Dagens pass
                  </div>
                  {o.planned.length === 0 ? (
                    <span className="text-zinc-400 dark:text-zinc-600">Inget planerat</span>
                  ) : (
                    <span className="text-zinc-600 dark:text-zinc-400">
                      {o.planned.map((p) => p.title || typeLabel(p.workout_type)).join(", ")}
                    </span>
                  )}
                </div>

                <div className="flex flex-col gap-1 text-sm">
                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Genomfört idag
                  </div>
                  {o.sessions.length === 0 ? (
                    <span className="text-zinc-400 dark:text-zinc-600">Inget pass loggat</span>
                  ) : (
                    <span className="text-zinc-900 dark:text-zinc-100">
                      {o.sessions.length} {o.sessions.length === 1 ? "pass" : "pass"} ·{" "}
                      {formatKm(dayKm * 1000)} · {formatDuration(daySeconds)}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
