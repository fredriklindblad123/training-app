import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PlanVsActual, type PlannedWorkout } from "@/components/PlanVsActual";
import { ManualSessions, type ManualActivity } from "@/components/ManualSessions";
import { PlannedSessions, type PlannedRow } from "@/components/PlannedSessions";
import { groupActivitiesIntoSessions, type SessionActivity } from "@/lib/sessions";
import {
  SV_MONTHS,
  dateKey,
  nextDateKey,
  isValidYear,
  isValidMonth,
  isValidDay,
} from "@/lib/calendar-utils";
import {
  addPlannedWorkout,
  saveManualActivity,
  deleteManualActivity,
  saveDiaryEntry,
  updateActivityCategory,
  resetActivityCategory,
  deletePlannedWorkout,
} from "./actions";
import {
  formatDuration,
  formatPace,
  formatKm,
  formatHoursMinutes,
} from "@/lib/format";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  isActivityCategory,
} from "@/lib/categories";

export default async function DayPage({
  params,
}: {
  params: Promise<{ year: string; month: string; day: string }>;
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

  const [
    { data: activities },
    { data: diaryEntry },
    { data: plannedWorkouts },
    { data: activeBlocks },
    { data: dailyMetrics },
  ] = await Promise.all([
      supabase
        .from("activities")
        .select("*, activity_splits(*)")
        .gte("start_time", dateStr)
        .lt("start_time", nextDateStr)
        .order("start_time"),
      supabase
        .from("diary_entries")
        .select("*")
        .eq("entry_date", dateStr)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      // Alla dagens planerade pass, inte bara ett: dubbeltröskel innebär två
      // riktiga pass samma dag och båda ska kunna jämföras mot sitt utfall.
      supabase
        .from("planned_workouts")
        .select("*")
        .eq("scheduled_date", dateStr)
        .order("slot", { ascending: true }),
      supabase
        .from("season_blocks")
        .select("id, name, start_date, end_date")
        .lte("start_date", dateStr)
        .gte("end_date", dateStr),
      supabase
        .from("daily_metrics")
        .select("*")
        .eq("metric_date", dateStr)
        .maybeSingle(),
    ]);

  // Formuläret nedan redigerar dagens första planerade pass; jämförelsen
  // ovanför visar alla.
  const plannedWorkout = (plannedWorkouts ?? [])[0] ?? null;

  // Jämförelsen görs mot passet, inte mot enskilda aktiviteter: uppvärmning,
  // huvudpass och nerjogg loggas separat i Garmin och bara det sammanslagna
  // passet är jämförbart med en plan (se 1.3 i docs/insikter-roadmap.md).
  const hasPlan = (plannedWorkouts ?? []).length > 0;

  const daySessions = groupActivitiesIntoSessions(
    (activities ?? []) as unknown as SessionActivity[],
  );

  // Egna pass (source='manual') redigeras i sin egen sektion, separat från
  // Garmin-listan. Flera per dag stöds, även när dagen redan har Garmin-pass
  // — ett styrkepass på kvällen efter morgonens löpning är normalfallet.
  const garminActivities = (activities ?? []).filter((a) => a.source !== "manual");
  const manualActivities = (activities ?? []).filter((a) => a.source === "manual");
  const hasOutcome = garminActivities.length > 0 || manualActivities.length > 0;

  const todayStr = dateKey(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate(),
  );
  const planStatus: "done" | "today" | "missed" | "upcoming" | null = !plannedWorkout
    ? null
    : hasOutcome
      ? "done"
      : dateStr === todayStr
        ? "today"
        : dateStr < todayStr
          ? "missed"
          : "upcoming";

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href={`/calendar/${prevDate.getFullYear()}/${prevDate.getMonth() + 1}/${prevDate.getDate()}`}
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            ←
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
            {day} {SV_MONTHS[month - 1]} {year}
          </h1>
          <Link
            href={`/calendar/${nextDate.getFullYear()}/${nextDate.getMonth() + 1}/${nextDate.getDate()}`}
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            →
          </Link>
        </div>
        <Link
          href={`/calendar/${year}/${month}`}
          className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
        >
          Till månadsvyn
        </Link>
      </div>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {hasPlan ? "Plan mot utfall" : "Planerat pass"}
          </h2>
          <PlanStatusBadge status={planStatus} />
        </div>

        {/* Jämförelsen visas bara när det finns en plan att jämföra mot. Utan
            plan blir den en upprepning av passlistan nedanför, plus en tom
            vänsterkolumn — sämre än att inte visa något alls. */}
        {hasPlan && (
          <PlanVsActual
            planned={(plannedWorkouts ?? []) as PlannedWorkout[]}
            sessions={daySessions}
          />
        )}

        <PlannedSessions
          dateStr={dateStr}
          planned={(plannedWorkouts ?? []) as PlannedRow[]}
          blocks={activeBlocks ?? []}
          addAction={addPlannedWorkout}
          deleteAction={deletePlannedWorkout}
        />
      </section>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Genomförda pass
        </h2>
        {garminActivities.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inget synkat pass den här dagen.
          </p>
        )}
        {garminActivities.map((a) => (
          <div
            key={a.id}
            className="grid grid-cols-2 gap-x-6 gap-y-2 rounded border border-zinc-200 p-4 text-sm sm:grid-cols-4 dark:border-zinc-800"
          >
            <div className="col-span-2 flex flex-wrap items-center gap-3 text-base font-medium text-zinc-900 sm:col-span-4 dark:text-zinc-100">
              <span>
                {a.name ?? "Pass"}{" "}
                <span className="text-zinc-400">({a.activity_type})</span>
              </span>
              <CategoryBadge category={a.category} />
            </div>
            <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-4">
              <form action={updateActivityCategory} className="flex items-center gap-2">
                <input type="hidden" name="activity_id" value={a.id} />
                <select
                  name="category"
                  defaultValue={isActivityCategory(a.category ?? "") ? a.category! : ""}
                  className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {CATEGORY_VALUES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-950 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-50 dark:hover:text-zinc-50"
                >
                  Spara kategori
                </button>
              </form>
              {a.category_source === "manual" ? (
                <form action={resetActivityCategory}>
                  <input type="hidden" name="activity_id" value={a.id} />
                  <button
                    type="submit"
                    className="text-xs text-zinc-400 underline hover:text-zinc-950 dark:hover:text-zinc-50"
                  >
                    återställ till auto
                  </button>
                </form>
              ) : (
                <span className="text-xs text-zinc-400">auto</span>
              )}
            </div>
            <Stat label="Distans" value={formatKm(a.distance_meters)} />
            <Stat label="Tid" value={formatDuration(a.duration_seconds)} />
            <Stat label="Snittpace" value={formatPace(a.avg_pace_seconds_per_km)} />
            <Stat
              label="Puls"
              value={
                a.avg_hr ? `${Math.round(a.avg_hr)} (max ${Math.round(a.max_hr ?? 0)})` : "–"
              }
            />
            <Stat
              label="Träningseffekt"
              value={
                a.aerobic_training_effect
                  ? `${a.aerobic_training_effect.toFixed(1)} (${a.training_effect_label ?? ""})`
                  : "–"
              }
            />
            <Stat
              label="Kadens"
              value={a.avg_cadence ? `${Math.round(a.avg_cadence)} spm` : "–"}
            />
            <Stat
              label="Höjdmeter"
              value={a.elevation_gain != null ? `${Math.round(a.elevation_gain)} m` : "–"}
            />
            <Stat label="Kalorier" value={a.calories ? `${Math.round(a.calories)}` : "–"} />

            {a.activity_splits?.length > 0 && (
              <div className="col-span-2 mt-2 sm:col-span-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500 dark:text-zinc-400">
                      <th className="pr-3 font-normal">#</th>
                      <th className="pr-3 font-normal">Distans</th>
                      <th className="pr-3 font-normal">Tid</th>
                      <th className="pr-3 font-normal">Pace</th>
                      <th className="font-normal">Puls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.activity_splits
                      .sort(
                        (x: { split_index: number }, y: { split_index: number }) =>
                          x.split_index - y.split_index,
                      )
                      .map(
                        (s: {
                          split_index: number;
                          distance_meters: number | null;
                          duration_seconds: number | null;
                          avg_pace_seconds_per_km: number | null;
                          avg_hr: number | null;
                        }) => (
                          <tr key={s.split_index} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-1 pr-3">{s.split_index}</td>
                            <td className="pr-3">{formatKm(s.distance_meters)}</td>
                            <td className="pr-3">{formatDuration(s.duration_seconds)}</td>
                            <td className="pr-3">{formatPace(s.avg_pace_seconds_per_km)}</td>
                            <td>{s.avg_hr ? Math.round(s.avg_hr) : "–"}</td>
                          </tr>
                        ),
                      )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Egna pass (utanför klockan)
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Träning som inte kommer från klockan — styrka, cykel, simning eller ett löppass du
          glömt starta klockan på. Flera per dag går bra.
        </p>
        <ManualSessions
          dateStr={dateStr}
          activities={manualActivities as ManualActivity[]}
          saveAction={saveManualActivity}
          deleteAction={deleteManualActivity}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Träningsdagbok
        </h2>

        {(diaryEntry?.session_log || diaryEntry?.coach_notes) && (
          <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            {diaryEntry?.session_log && (
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Träningslogg (importerad)
                </div>
                <div className="whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                  {diaryEntry.session_log}
                </div>
              </div>
            )}
            {diaryEntry?.coach_notes && (
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">
                  Tränarens kommentar
                </div>
                <div className="whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
                  {diaryEntry.coach_notes}
                </div>
              </div>
            )}
          </div>
        )}

        <form
          action={saveDiaryEntry}
          className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <input type="hidden" name="entry_date" value={dateStr} />
          <input type="hidden" name="entry_id" value={diaryEntry?.id ?? ""} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <label className="flex flex-col gap-1 text-sm">
                Dagtyp
                <select
                  name="day_type"
                  defaultValue={diaryEntry?.day_type ?? ""}
                  className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                >
                  <option value="">Ej satt</option>
                  <option value="training">Träning</option>
                  <option value="rest">Vila</option>
                  <option value="sick">Sjuk</option>
                  <option value="injured">Skadad</option>
                </select>
              </label>

            <label className="flex flex-col gap-1 text-sm">
              RPE (1–10)
              <input
                type="number"
                name="rpe"
                min={1}
                max={10}
                defaultValue={diaryEntry?.rpe ?? ""}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Humör
              <input
                type="text"
                name="mood"
                defaultValue={diaryEntry?.mood ?? ""}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            {/* Sömn kommer automatiskt från Garmin (se sektionen ovan). Fältet
                behövs bara för dagar då klockan inte användes. Dolt fält när
                Garmin-data finns, så ett tidigare manuellt värde inte nollas. */}
            {dailyMetrics && (
              <input
                type="hidden"
                name="sleep_hours"
                value={diaryEntry?.sleep_hours ?? ""}
              />
            )}
            {!dailyMetrics && (
              <label className="flex flex-col gap-1 text-sm">
                Sömn (timmar)
                <input
                  type="number"
                  step="0.5"
                  name="sleep_hours"
                  defaultValue={diaryEntry?.sleep_hours ?? ""}
                  className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                />
              </label>
            )}
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Anteckningar
            <textarea
              name="notes"
              rows={4}
              defaultValue={diaryEntry?.notes ?? ""}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <button
            type="submit"
            className="w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Spara
          </button>
        </form>
      </section>

      {dailyMetrics && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Sömn &amp; återhämtning
          </h2>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded border border-zinc-200 p-4 text-sm sm:grid-cols-4 dark:border-zinc-800">
            <Stat label="Sömn" value={formatHoursMinutes(dailyMetrics.sleep_seconds)} />
            <Stat
              label="Sömnpoäng"
              value={dailyMetrics.sleep_score ? `${dailyMetrics.sleep_score} / 100` : "–"}
            />
            <Stat
              label="Vilopuls"
              value={dailyMetrics.resting_hr ? `${dailyMetrics.resting_hr} slag/min` : "–"}
            />
            <Stat
              label="HRV (natt)"
              value={
                dailyMetrics.hrv_overnight_avg
                  ? `${Math.round(dailyMetrics.hrv_overnight_avg)} ms`
                  : "–"
              }
            />
            <Stat label="Djupsömn" value={formatHoursMinutes(dailyMetrics.deep_sleep_seconds)} />
            <Stat label="REM" value={formatHoursMinutes(dailyMetrics.rem_sleep_seconds)} />
            <Stat label="Lätt sömn" value={formatHoursMinutes(dailyMetrics.light_sleep_seconds)} />
            <Stat label="Vaken" value={formatHoursMinutes(dailyMetrics.awake_seconds)} />
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}

function PlanStatusBadge({
  status,
}: {
  status: "done" | "today" | "missed" | "upcoming" | null;
}) {
  if (!status) return null;
  const label = {
    done: "Genomfört",
    today: "Idag",
    missed: "Missat",
    upcoming: "Planerat",
  }[status];
  const className = {
    done: "bg-emerald-500 text-white",
    today: "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300",
    missed: "bg-amber-500 text-white",
    upcoming: "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300",
  }[status];
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category || !isActivityCategory(category)) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-xs font-normal text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: `var(--cat-${category})` }}
      />
      {CATEGORY_LABELS[category]}
    </span>
  );
}
