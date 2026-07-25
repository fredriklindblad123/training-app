import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { BarChart, type BarDatum } from "@/components/charts/BarChart";
import { LineChart, type LineDatum } from "@/components/charts/LineChart";
import { ScatterChart } from "@/components/charts/ScatterChart";
import {
  pearsonCorrelation,
  correlationStrengthLabel,
  isoWeekStart,
  weekLabel,
} from "@/lib/stats-utils";
const WEEK_OPTIONS = [12, 26, 52] as const;
type WeekOption = (typeof WEEK_OPTIONS)[number];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Alla måndagsdatum (YYYY-MM-DD) från `weeks` veckor bakåt fram till
 * innevarande vecka, så diagrammen visar kontinuitet även för veckor helt
 * utan data. */
function buildWeekSeries(weeks: number): string[] {
  const today = new Date();
  const currentMonday = new Date(today);
  const day = (currentMonday.getDay() + 6) % 7;
  currentMonday.setDate(currentMonday.getDate() - day);

  const series: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const monday = new Date(currentMonday);
    monday.setDate(monday.getDate() - i * 7);
    series.push(toDateKey(monday));
  }
  return series;
}

function avg(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{ weeks?: string }>;
}) {
  const { weeks: weeksParam } = await searchParams;
  const weeksNum = Number(weeksParam);
  const weeks: WeekOption = (WEEK_OPTIONS as readonly number[]).includes(weeksNum)
    ? (weeksNum as WeekOption)
    : 12;

  const weekSeries = buildWeekSeries(weeks);
  const startDate = weekSeries[0];

  const supabase = await createClient();
  const [{ data: activities }, { data: dailyMetrics }, { data: diaryEntries }] =
    await Promise.all([
      supabase
        .from("activities")
        .select("start_time, distance_meters, duration_seconds, activity_type, aerobic_training_effect")
        .gte("start_time", startDate)
        .order("start_time"),
      supabase
        .from("daily_metrics")
        .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
        .gte("metric_date", startDate)
        .order("metric_date"),
      supabase
        .from("diary_entries")
        .select("entry_date, rpe")
        .gte("entry_date", startDate)
        .not("rpe", "is", null),
    ]);

  const runningActivities = (activities ?? []).filter((a) =>
    (a.activity_type ?? "").includes("running"),
  );

  // --- Veckoaggregering -----------------------------------------------------
  const weeklyKm = new Map<string, number>();
  for (const a of runningActivities) {
    const wk = isoWeekStart(a.start_time.slice(0, 10));
    weeklyKm.set(wk, (weeklyKm.get(wk) ?? 0) + (a.distance_meters ?? 0) / 1000);
  }

  const weeklySleepByWeek = new Map<string, number[]>();
  const weeklyRhrByWeek = new Map<string, number[]>();
  const weeklyHrvByWeek = new Map<string, number[]>();
  for (const m of dailyMetrics ?? []) {
    const wk = isoWeekStart(m.metric_date);
    if (m.sleep_seconds != null) {
      weeklySleepByWeek.set(wk, [...(weeklySleepByWeek.get(wk) ?? []), m.sleep_seconds / 3600]);
    }
    if (m.resting_hr != null) {
      weeklyRhrByWeek.set(wk, [...(weeklyRhrByWeek.get(wk) ?? []), m.resting_hr]);
    }
    if (m.hrv_overnight_avg != null) {
      weeklyHrvByWeek.set(wk, [...(weeklyHrvByWeek.get(wk) ?? []), m.hrv_overnight_avg]);
    }
  }

  const weeklyRpeByWeek = new Map<string, number[]>();
  for (const e of diaryEntries ?? []) {
    const wk = isoWeekStart(e.entry_date);
    weeklyRpeByWeek.set(wk, [...(weeklyRpeByWeek.get(wk) ?? []), e.rpe as number]);
  }

  const volumeData: BarDatum[] = weekSeries.map((wk) => ({
    label: weekLabel(wk),
    value: weeklyKm.get(wk) ?? 0,
  }));
  const sleepData: LineDatum[] = weekSeries.map((wk) => ({
    label: weekLabel(wk),
    value: avg(weeklySleepByWeek.get(wk) ?? []),
  }));
  const rhrData: LineDatum[] = weekSeries.map((wk) => ({
    label: weekLabel(wk),
    value: avg(weeklyRhrByWeek.get(wk) ?? []),
  }));
  const hrvData: LineDatum[] = weekSeries.map((wk) => ({
    label: weekLabel(wk),
    value: avg(weeklyHrvByWeek.get(wk) ?? []),
  }));
  const rpeData: LineDatum[] = weekSeries.map((wk) => ({
    label: weekLabel(wk),
    value: avg(weeklyRpeByWeek.get(wk) ?? []),
  }));

  // --- Dagsnivå för korrelationer --------------------------------------------
  const metricsByDay = new Map<
    string,
    { sleepScore?: number; sleepHours?: number; restingHr?: number; hrv?: number }
  >();
  for (const m of dailyMetrics ?? []) {
    metricsByDay.set(m.metric_date, {
      sleepScore: m.sleep_score ?? undefined,
      sleepHours: m.sleep_seconds != null ? m.sleep_seconds / 3600 : undefined,
      restingHr: m.resting_hr ?? undefined,
      hrv: m.hrv_overnight_avg ?? undefined,
    });
  }

  const rpeByDay = new Map<string, number>();
  for (const e of diaryEntries ?? []) {
    rpeByDay.set(e.entry_date, e.rpe as number);
  }

  const trainingEffectByDay = new Map<string, number[]>();
  for (const a of runningActivities) {
    if (a.aerobic_training_effect == null) continue;
    const day = a.start_time.slice(0, 10);
    trainingEffectByDay.set(day, [
      ...(trainingEffectByDay.get(day) ?? []),
      a.aerobic_training_effect,
    ]);
  }

  const sleepScoreVsRpe: [number, number][] = [];
  const hrvVsRpe: [number, number][] = [];
  const rhrVsRpe: [number, number][] = [];
  const sleepHoursVsRpe: [number, number][] = [];
  const sleepScoreVsEffect: [number, number][] = [];

  for (const [day, m] of metricsByDay) {
    const rpe = rpeByDay.get(day);
    if (rpe != null) {
      if (m.sleepScore != null) sleepScoreVsRpe.push([m.sleepScore, rpe]);
      if (m.hrv != null) hrvVsRpe.push([m.hrv, rpe]);
      if (m.restingHr != null) rhrVsRpe.push([m.restingHr, rpe]);
      if (m.sleepHours != null) sleepHoursVsRpe.push([m.sleepHours, rpe]);
    }
    const effect = avg(trainingEffectByDay.get(day) ?? []);
    if (m.sleepScore != null && effect != null) {
      sleepScoreVsEffect.push([m.sleepScore, effect]);
    }
  }

  const correlations = [
    {
      title: "Sömnpoäng ↔ RPE",
      description: "Hur väl sov du natten innan, jämfört med hur ansträngande passet kändes.",
      pairs: sleepScoreVsRpe,
    },
    {
      title: "HRV ↔ RPE",
      description: "Din morgon-HRV jämfört med upplevd ansträngning samma dag.",
      pairs: hrvVsRpe,
    },
    {
      title: "Vilopuls ↔ RPE",
      description: "Förhöjd vilopuls (ofta tecken på otillräcklig återhämtning) mot RPE.",
      pairs: rhrVsRpe,
    },
    {
      title: "Sömntid ↔ RPE",
      description: "Antal timmars sömn mot upplevd ansträngning.",
      pairs: sleepHoursVsRpe,
    },
    {
      title: "Sömnpoäng ↔ Träningseffekt",
      description: "Garmins egen träningseffekt-siffra mot sömnkvalitet.",
      pairs: sleepScoreVsEffect,
    },
  ].map((c) => ({ ...c, r: pearsonCorrelation(c.pairs) }));

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          Trender
        </h1>
        <div className="flex gap-2 text-sm">
          {WEEK_OPTIONS.map((w) => (
            <Link
              key={w}
              href={`/trends?weeks=${w}`}
              className={`rounded px-3 py-1 ${
                weeks === w
                  ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                  : "border border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {w} veckor
            </Link>
          ))}
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Veckovolym (löpning)
        </h2>
        <BarChart data={volumeData} formatKind="km" />
      </section>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Sömn (snitt/vecka)
          </h2>
          <LineChart
            data={sleepData}
            formatKind="hours"
            emptyLabel="Ingen sömndata ännu — anslut Garmin på /settings."
          />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            RPE (snitt/vecka)
          </h2>
          <LineChart
            data={rpeData}
            formatKind="decimal1"
            emptyLabel="Ingen RPE loggad ännu — fylls i på dagvyn."
          />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Vilopuls (snitt/vecka)
          </h2>
          <LineChart
            data={rhrData}
            formatKind="bpm"
            emptyLabel="Ingen vilopulsdata ännu."
          />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            HRV (snitt/vecka)
          </h2>
          <LineChart data={hrvData} formatKind="ms" emptyLabel="Ingen HRV-data ännu." />
        </section>
      </div>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Korrelationer
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Pearson-korrelation mellan -1 och 1. Kräver minst 5 dagar med båda
            måtten för att räknas ut. Ett samband är inte samma sak som orsak.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {correlations.map((c) => (
            <div
              key={c.title}
              className="flex flex-col gap-2 rounded border border-zinc-200 p-4 dark:border-zinc-800"
            >
              <div className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                {c.title}
              </div>
              <div className="text-xs text-zinc-500 dark:text-zinc-400">{c.description}</div>
              {c.r != null ? (
                <>
                  <div className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
                    {c.r.toFixed(2)}
                  </div>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {correlationStrengthLabel(c.r)} ({c.pairs.length} dagar)
                  </div>
                </>
              ) : (
                <div className="text-xs text-zinc-400">
                  För lite data ännu ({c.pairs.length} dagar, minst 5 krävs)
                </div>
              )}
            </div>
          ))}
        </div>

        {sleepScoreVsRpe.length >= 5 && (
          <div className="flex flex-col gap-2 sm:max-w-xs">
            <h3 className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Sömnpoäng vs RPE
            </h3>
            <ScatterChart
              data={sleepScoreVsRpe.map(([x, y], i) => ({ x, y, label: `Dag ${i + 1}` }))}
              xLabel="Sömnpoäng"
              yLabel="RPE"
              xFormatKind="decimal0"
              yFormatKind="decimal1"
            />
          </div>
        )}
      </section>
    </div>
  );
}
