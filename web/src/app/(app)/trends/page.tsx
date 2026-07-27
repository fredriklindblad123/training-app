import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ScatterChart } from "@/components/charts/ScatterChart";
import {
  ComboChart,
  type ComboEvent,
  type ComboLoadStack,
  type ComboPeriod,
  type ComboSeries,
} from "@/components/charts/ComboChart";
import {
  IntensityChart,
  type IntensityWeek,
} from "@/components/charts/IntensityChart";
import {
  EfficiencyChart,
  type EfficiencyPoint,
  type EfficiencyRace,
} from "@/components/charts/EfficiencyChart";
import {
  EMPTY_THRESHOLD_PROFILE,
  emptyZoneSeconds,
  type ThresholdProfile,
  type ZoneSeconds,
} from "@/lib/intensity";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import {
  correlationStrengthLabel,
  isoWeekStart,
  mean,
  median,
  pearsonCorrelation,
  weekLabel,
} from "@/lib/stats-utils";
import { formatHoursMinutes } from "@/lib/format";
import { analyzeDiaryNote } from "@/lib/diary-text";
import { BASELINE_WINDOW_DAYS, computeDailyStatus } from "@/lib/daily-status";
import { DailyStatus } from "@/components/DailyStatus";

const WEEK_OPTIONS = [12, 26, 52] as const;
type WeekOption = (typeof WEEK_OPTIONS)[number];

/** EF-filtret enligt P1.4: bara jämförbara pass, aldrig intervaller. */
const EF_MIN_SECONDS = 20 * 60;
const EF_CATEGORIES = ["easy", "long_run"] as const;

const MONTHS_SHORT = [
  "jan", "feb", "mar", "apr", "maj", "jun",
  "jul", "aug", "sep", "okt", "nov", "dec",
];

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

/** "V.31, 28 juli–3 aug" — kort etikett på axeln, lång i panelen. */
function weekRangeLabel(monday: string): string {
  const from = new Date(`${monday}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  const fromPart = `${from.getDate()} ${MONTHS_SHORT[from.getMonth()]}`;
  const toPart = `${to.getDate()} ${MONTHS_SHORT[to.getMonth()]}`;
  return `${weekLabel(monday)}, ${fromPart}–${toPart}`;
}

function formatDateRange(from: string | null, to: string | null): string {
  if (!from || !to) return "ingen data";
  return from === to ? from : `${from} – ${to}`;
}

/** Min/max-datum i en samling dagnycklar. */
function dateRange(days: Iterable<string>): { from: string | null; to: string | null } {
  let from: string | null = null;
  let to: string | null = null;
  for (const day of days) {
    if (from == null || day < from) from = day;
    if (to == null || day > to) to = day;
  }
  return { from, to };
}

/** Veckovisa medelvärden ur dagsvärden. `null` där veckan saknar mätning —
 * aldrig 0, aldrig interpolerat. */
function weeklyMeans(
  weekSeries: string[],
  byDay: Map<string, number[]>,
): (number | null)[] {
  const byWeek = new Map<string, number[]>();
  for (const [day, values] of byDay) {
    const wk = isoWeekStart(day);
    byWeek.set(wk, [...(byWeek.get(wk) ?? []), ...values]);
  }
  return weekSeries.map((wk) => mean(byWeek.get(wk) ?? []));
}

function countWeeksWithData(values: (number | null)[]): number {
  return values.filter((v) => v != null).length;
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
  const todayKey = toDateKey(new Date());

  const supabase = await createClient();

  // Tröskelkolumnerna (P0.3b) kan saknas i databasen när migrationen ännu inte
  // är körd. Den frågan får därför gå separat och felet sväljas: sidan ska
  // fungera utan dem, bara med en tydligare brasklapp om zongränserna.
  const [
    { data: activityRows },
    { data: dailyMetrics },
    { data: diaryEntries },
    profileResult,
  ] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", startDate)
      .order("start_time"),
    supabase
      .from("daily_metrics")
      .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
      .gte("metric_date", startDate)
      .order("metric_date"),
    supabase
      .from("diary_entries")
      .select("entry_date, rpe, feeling, day_type, notes")
      .gte("entry_date", startDate)
      .order("entry_date"),
    supabase
      .from("profiles")
      .select("threshold_hr_low, threshold_hr_high, max_hr, lt1_hr, lt2_hr")
      .limit(1)
      .maybeSingle(),
  ]);

  const profileRow = profileResult.error ? null : profileResult.data;
  const thresholdProfile: ThresholdProfile = profileRow
    ? {
        thresholdHrLow: profileRow.threshold_hr_low ?? null,
        thresholdHrHigh: profileRow.threshold_hr_high ?? null,
        maxHr: profileRow.max_hr ?? null,
        lt1Hr: profileRow.lt1_hr ?? null,
        lt2Hr: profileRow.lt2_hr ?? null,
      }
    : EMPTY_THRESHOLD_PROFILE;

  // --- Pass, inte aktiviteter (P0.5/1.3) -------------------------------------
  // SESSION_ACTIVITY_COLUMNS är en runtime-sträng, så Supabase-klienten kan
  // inte härleda radtypen och faller tillbaka på GenericStringError[]. Kolumn-
  // listan och SessionActivity definieras bredvid varandra i lib/sessions.ts
  // och hålls i synk där — därför är omvägen via unknown säker här.
  const sessions: TrainingSession[] = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );

  const sessionsByWeek = new Map<string, TrainingSession[]>();
  for (const session of sessions) {
    const wk = isoWeekStart(session.date);
    sessionsByWeek.set(wk, [...(sessionsByWeek.get(wk) ?? []), session]);
  }

  // --- A. Huvudgrafen: belastning vs återhämtning (P1.1) ---------------------

  const notesByWeek = new Map<string, string[]>();
  const sickDaysByWeek = new Map<string, string[]>();
  const injuredDaysByWeek = new Map<string, string[]>();
  const rpeByDay = new Map<string, number>();
  const feelingByDay = new Map<string, number>();
  // P2.2: känsla härledd ur dagbokstexten. Hålls medvetet åtskild från
  // feelingByDay (atletens egen incheckning) — en maskinellt tolkad siffra
  // får aldrig se ut som något hon själv svarat. Den finns för att det är
  // enda sättet att få subjektiv historik *bakåt*: de självrapporterade
  // fälten är tomma i hela den befintliga dagboken.
  const derivedFeelingByDay = new Map<string, number>();

  for (const entry of diaryEntries ?? []) {
    const day: string = entry.entry_date;
    const wk = isoWeekStart(day);
    if (entry.notes) {
      const label = `${day.slice(8, 10)}/${day.slice(5, 7)}`;
      notesByWeek.set(wk, [...(notesByWeek.get(wk) ?? []), `${label}: ${entry.notes}`]);
      const analysis = analyzeDiaryNote(entry.notes);
      if (analysis.score != null) derivedFeelingByDay.set(day, analysis.score);
    }
    if (entry.day_type === "sick") {
      sickDaysByWeek.set(wk, [...(sickDaysByWeek.get(wk) ?? []), day]);
    }
    if (entry.day_type === "injured") {
      injuredDaysByWeek.set(wk, [...(injuredDaysByWeek.get(wk) ?? []), day]);
    }
    if (entry.rpe != null) rpeByDay.set(day, entry.rpe);
    if (entry.feeling != null) feelingByDay.set(day, entry.feeling);
  }

  const periods: ComboPeriod[] = weekSeries.map((wk) => ({
    key: wk,
    label: weekLabel(wk),
    fullLabel: weekRangeLabel(wk),
    // Dagbokens egna ord för veckan. Kopplingen siffra ↔ text är hela poängen
    // med panelen, så texten kortas inte ner — den kapas bara i antal inlägg.
    note: (notesByWeek.get(wk) ?? []).slice(0, 4).join("\n") || null,
  }));

  const load: ComboLoadStack[] = weekSeries.map((wk) => {
    const stack: ComboLoadStack = {};
    for (const session of sessionsByWeek.get(wk) ?? []) {
      if (session.trainingLoad <= 0) continue;
      stack[session.category] = (stack[session.category] ?? 0) + session.trainingLoad;
    }
    return stack;
  });

  // Dagsvärden → veckovisa medelvärden för återhämtningsserierna.
  const hrvByDay = new Map<string, number[]>();
  const rhrByDay = new Map<string, number[]>();
  const sleepByDay = new Map<string, number[]>();
  const sleepScoreByDay = new Map<string, number>();
  const sleepHoursByDay = new Map<string, number>();
  const hrvValueByDay = new Map<string, number>();
  const rhrValueByDay = new Map<string, number>();

  for (const metric of dailyMetrics ?? []) {
    const day: string = metric.metric_date;
    if (metric.hrv_overnight_avg != null) {
      hrvByDay.set(day, [metric.hrv_overnight_avg]);
      hrvValueByDay.set(day, metric.hrv_overnight_avg);
    }
    if (metric.resting_hr != null) {
      rhrByDay.set(day, [metric.resting_hr]);
      rhrValueByDay.set(day, metric.resting_hr);
    }
    if (metric.sleep_seconds != null) {
      sleepByDay.set(day, [metric.sleep_seconds / 3600]);
      sleepHoursByDay.set(day, metric.sleep_seconds / 3600);
    }
    if (metric.sleep_score != null) sleepScoreByDay.set(day, metric.sleep_score);
  }

  // --- P1.2: dagsstatus mot personlig baslinje -------------------------------
  // Baslinjen behöver 60 dagar bakåt, alltså längre historik än det valda
  // diagramfönstret. Egen fråga hellre än att låta veckoväljaren styra hur
  // baslinjen ser ut — den ska vara densamma oavsett vad man tittar på.
  const statusFrom = (() => {
    const d = new Date();
    d.setDate(d.getDate() - (BASELINE_WINDOW_DAYS + 5));
    return d.toISOString().slice(0, 10);
  })();

  const [{ data: statusMetrics }, { data: statusDiary }] = await Promise.all([
    supabase
      .from("daily_metrics")
      .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
      .gte("metric_date", statusFrom),
    supabase
      .from("diary_entries")
      .select("entry_date, notes")
      .gte("entry_date", statusFrom),
  ]);

  const derivedByDayForStatus = new Map<string, number>();
  for (const e of statusDiary ?? []) {
    if (!e.notes) continue;
    const a = analyzeDiaryNote(e.notes);
    // Skalas till 1–5 så markören blir läsbar bredvid de andra.
    if (a.feeling != null) derivedByDayForStatus.set(e.entry_date, a.feeling);
  }

  const dailyStatus = computeDailyStatus(
    (statusMetrics ?? []).map((m) => ({
      date: m.metric_date as string,
      hrv: m.hrv_overnight_avg,
      restingHr: m.resting_hr,
      sleepHours: m.sleep_seconds != null ? m.sleep_seconds / 3600 : null,
      sleepScore: m.sleep_score,
      feeling: derivedByDayForStatus.get(m.metric_date as string) ?? null,
    })),
    todayKey,
  );

  const hrvWeekly = weeklyMeans(weekSeries, hrvByDay);
  const rhrWeekly = weeklyMeans(weekSeries, rhrByDay);
  const sleepWeekly = weeklyMeans(weekSeries, sleepByDay);
  const rpeWeekly = weeklyMeans(
    weekSeries,
    new Map([...rpeByDay].map(([day, value]) => [day, [value]])),
  );
  const feelingWeekly = weeklyMeans(
    weekSeries,
    new Map([...feelingByDay].map(([day, value]) => [day, [value]])),
  );

  // --- C. Formkurva (P1.4) — beräknad på passnivå, aldrig per aktivitet -----
  const efPoints: EfficiencyPoint[] = sessions
    .filter(
      (s) =>
        (EF_CATEGORIES as readonly string[]).includes(s.category) &&
        s.durationSeconds >= EF_MIN_SECONDS &&
        s.avgHr != null &&
        s.avgHr > 0 &&
        s.distanceMeters > 0,
    )
    .map((s) => ({
      id: s.id,
      date: s.date,
      ef: s.distanceMeters / s.durationSeconds / (s.avgHr as number),
      label: s.dominantActivity.name ?? "Pass",
      category: s.category as EfficiencyPoint["category"],
      durationSeconds: s.durationSeconds,
      distanceMeters: s.distanceMeters,
      avgHr: s.avgHr as number,
    }));

  // Veckans EF som eget lager i huvudgrafen — "fart" i Almgrens fyra axlar.
  const efByWeek = new Map<string, number[]>();
  for (const point of efPoints) {
    const wk = isoWeekStart(point.date);
    // Meter per hjärtslag, samma enhet som formkurvan visar.
    efByWeek.set(wk, [...(efByWeek.get(wk) ?? []), point.ef * 60]);
  }
  const efWeekly = weekSeries.map((wk) => median(efByWeek.get(wk) ?? []));

  const candidateSeries: ComboSeries[] = [
    {
      id: "hrv",
      label: "HRV",
      values: hrvWeekly,
      formatKind: "ms",
      higherIsBetter: true,
      defaultVisible: true,
    },
    {
      id: "rhr",
      label: "Vilopuls",
      values: rhrWeekly,
      formatKind: "bpm",
      higherIsBetter: false,
      defaultVisible: true,
    },
    {
      id: "sleep",
      label: "Sömn",
      values: sleepWeekly,
      formatKind: "hours",
      higherIsBetter: true,
      defaultVisible: true,
    },
    {
      id: "ef",
      label: "Formkurva (m/slag)",
      values: efWeekly,
      formatKind: "decimal2",
      higherIsBetter: true,
    },
    {
      id: "rpe",
      label: "RPE",
      values: rpeWeekly,
      formatKind: "decimal1",
      higherIsBetter: false,
    },
    {
      id: "feeling",
      label: "Känsla",
      values: feelingWeekly,
      formatKind: "decimal1",
      higherIsBetter: true,
    },
  ];

  // Ett lager som aldrig har ett enda värde är en knapp som inte gör något.
  // Serier utan data lyfts ur diagrammet och redovisas i täckningspanelen.
  const series = candidateSeries.filter((s) => s.values.some((v) => v != null));
  const missingSeries = candidateSeries.filter((s) => s.values.every((v) => v == null));

  const raceSessions = sessions.filter((s) => s.category === "race");

  const events: ComboEvent[] = [
    ...[...sickDaysByWeek].map(([wk, days]) => ({
      periodKey: wk,
      kind: "sick" as const,
      label: `Sjuk ${days.length} ${days.length === 1 ? "dag" : "dagar"}`,
    })),
    ...[...injuredDaysByWeek].map(([wk, days]) => ({
      periodKey: wk,
      kind: "injured" as const,
      label: `Skadad ${days.length} ${days.length === 1 ? "dag" : "dagar"}`,
    })),
    ...raceSessions.map((s) => ({
      periodKey: isoWeekStart(s.date),
      kind: "race" as const,
      label: s.dominantActivity.name?.trim() || "Tävling",
    })),
  ];

  const efRaces: EfficiencyRace[] = raceSessions.map((s) => ({
    date: s.date,
    label: s.dominantActivity.name?.trim() || "Tävling",
  }));

  // --- B. Intensitetsfördelning (P1.3) --------------------------------------
  const intensityWeeks: IntensityWeek[] = weekSeries.map((wk) => {
    const zoneSeconds: ZoneSeconds = emptyZoneSeconds();
    for (const session of sessionsByWeek.get(wk) ?? []) {
      zoneSeconds[0] += session.hrZone1Seconds;
      zoneSeconds[1] += session.hrZone2Seconds;
      zoneSeconds[2] += session.hrZone3Seconds;
      zoneSeconds[3] += session.hrZone4Seconds;
      zoneSeconds[4] += session.hrZone5Seconds;
    }
    return { key: wk, label: weekLabel(wk), fullLabel: weekRangeLabel(wk), zoneSeconds };
  });

  const sessionsWithZoneData = sessions.filter((s) => s.hrZoneTotalSeconds > 0).length;

  // --- Sammanfattande siffror för perioden ----------------------------------
  const totalDistanceKm = sessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;
  const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const totalLoad = sessions.reduce((sum, s) => sum + s.trainingLoad, 0);

  // --- D. Korrelationer, på pass i stället för aktiviteter -------------------
  const loadByDay = new Map<string, number>();
  for (const session of sessions) {
    loadByDay.set(session.date, (loadByDay.get(session.date) ?? 0) + session.trainingLoad);
  }

  const metricDays = new Set([
    ...hrvValueByDay.keys(),
    ...rhrValueByDay.keys(),
    ...sleepHoursByDay.keys(),
    ...sleepScoreByDay.keys(),
  ]);
  const rpeDays = new Set(rpeByDay.keys());
  const metricRange = dateRange(metricDays);
  const rpeRange = dateRange(rpeDays);
  const overlapDays = [...metricDays].filter((day) => rpeDays.has(day)).length;

  function pairsFrom(
    x: Map<string, number>,
    y: Map<string, number>,
  ): [number, number][] {
    const out: [number, number][] = [];
    for (const [day, xv] of x) {
      const yv = y.get(day);
      if (yv != null) out.push([xv, yv]);
    }
    return out;
  }

  const correlations = [
    {
      title: "Sömnpoäng ↔ RPE",
      description: "Hur väl sov du natten innan, jämfört med hur ansträngande passet kändes.",
      pairs: pairsFrom(sleepScoreByDay, rpeByDay),
      needsRpe: true,
    },
    {
      title: "HRV ↔ RPE",
      description: "Din morgon-HRV jämfört med upplevd ansträngning samma dag.",
      pairs: pairsFrom(hrvValueByDay, rpeByDay),
      needsRpe: true,
    },
    {
      title: "Vilopuls ↔ RPE",
      description: "Förhöjd vilopuls (ofta tecken på otillräcklig återhämtning) mot RPE.",
      pairs: pairsFrom(rhrValueByDay, rpeByDay),
      needsRpe: true,
    },
    {
      title: "Sömntid ↔ RPE",
      description: "Antal timmars sömn mot upplevd ansträngning.",
      pairs: pairsFrom(sleepHoursByDay, rpeByDay),
      needsRpe: true,
    },
    {
      title: "Sömnpoäng ↔ dagens belastning",
      description: "Sömnkvalitet mot summerad träningsbelastning för dagens pass.",
      pairs: pairsFrom(sleepScoreByDay, loadByDay),
      needsRpe: false,
    },
    {
      title: "HRV ↔ dagens belastning",
      description: "Morgon-HRV mot hur tung träningen samma dag blev.",
      pairs: pairsFrom(hrvValueByDay, loadByDay),
      needsRpe: false,
    },
    // P2.2: de här tre är de enda som har underlag längre bakåt än den
    // dagliga incheckningen, eftersom känslan läses ur dagbokstexten.
    {
      title: "HRV ↔ känsla (ur dagbokstext)",
      description:
        "Morgon-HRV mot hur dagen beskrivs i dina egna dagboksord. Tolkad text, inte en siffra du själv satt.",
      pairs: pairsFrom(hrvValueByDay, derivedFeelingByDay),
      needsRpe: false,
    },
    {
      title: "Sömnpoäng ↔ känsla (ur dagbokstext)",
      description: "Nattens sömnpoäng mot hur dagen beskrivs i dagboken.",
      pairs: pairsFrom(sleepScoreByDay, derivedFeelingByDay),
      needsRpe: false,
    },
    {
      title: "Vilopuls ↔ känsla (ur dagbokstext)",
      description: "Förhöjd vilopuls mot hur dagen beskrivs i dagboken.",
      pairs: pairsFrom(rhrValueByDay, derivedFeelingByDay),
      needsRpe: false,
    },
  ].map((c) => {
    const r = pearsonCorrelation(c.pairs);
    let reason: string | null = null;
    if (r == null) {
      if (metricDays.size === 0) {
        reason =
          "Ingen sömn-, HRV- eller vilopulsdata i perioden. Synka Garmin på /settings.";
      } else if (c.needsRpe && rpeDays.size === 0) {
        reason =
          "Ingen RPE är ifylld i perioden. RPE fylls i på kalendersidan — utan den finns inget att korrelera mot.";
      } else if (c.needsRpe && overlapDays === 0) {
        reason =
          `Måtten täcker olika perioder: återhämtningsdata finns ${formatDateRange(metricRange.from, metricRange.to)}, ` +
          `RPE finns ${formatDateRange(rpeRange.from, rpeRange.to)}. Det finns alltså ingen dag där båda är mätta.`;
      } else {
        reason = `Bara ${c.pairs.length} ${c.pairs.length === 1 ? "dag" : "dagar"} med båda måtten (minst 5 krävs).`;
      }
    }
    return { ...c, r, reason };
  });

  const sleepScoreVsRpe = correlations[0].pairs;

  const coverage = [
    {
      label: "HRV",
      weeksWithData: countWeeksWithData(hrvWeekly),
      range: dateRange(hrvValueByDay.keys()),
    },
    {
      label: "Vilopuls",
      weeksWithData: countWeeksWithData(rhrWeekly),
      range: dateRange(rhrValueByDay.keys()),
    },
    {
      label: "Sömn",
      weeksWithData: countWeeksWithData(sleepWeekly),
      range: dateRange(sleepHoursByDay.keys()),
    },
    {
      label: "Formkurva",
      weeksWithData: countWeeksWithData(efWeekly),
      range: dateRange(efPoints.map((p) => p.date)),
    },
    {
      label: "RPE",
      weeksWithData: countWeeksWithData(rpeWeekly),
      range: dateRange(rpeDays),
    },
    {
      label: "Känsla",
      weeksWithData: countWeeksWithData(feelingWeekly),
      range: dateRange(feelingByDay.keys()),
    },
  ];

  return (
    <div className="flex flex-1 flex-col gap-10 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Trender</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Allt på den här sidan räknas per <strong className="font-medium">pass</strong>, inte
            per Garmin-aktivitet: uppvärmning, huvudpass och nerjogg slås ihop till ett pass
            innan något summeras.
          </p>
        </div>
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

      {/* --- Periodens siffror i klartext, innan något diagram -------------- */}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Pass", value: String(sessions.length) },
          { label: "Distans", value: `${totalDistanceKm.toFixed(0)} km` },
          { label: "Träningstid", value: formatHoursMinutes(totalSeconds) },
          { label: "Träningsbelastning", value: totalLoad.toFixed(0) },
        ].map((tile) => (
          <div
            key={tile.label}
            className="flex flex-col gap-1 rounded border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <dt className="text-sm text-zinc-500 dark:text-zinc-400">{tile.label}</dt>
            <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      {/* ================= P1.2: dagsstatus mot baslinje ================== */}
      <DailyStatus status={dailyStatus} />

      {/* ================= A. Belastning vs återhämtning (P1.1) ============= */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Belastning och återhämtning
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Staplarna är veckans summerade träningsbelastning, stackad på passkategori.
            Linjerna nedanför visar avvikelse mot din egen baslinje i SD-enheter — 0 är ditt
            normala, ±1 kanten på ditt normalintervall. Håll pekaren över en vecka för
            siffrorna och dina egna dagboksord.
          </p>
        </div>

        <ComboChart
          periods={periods}
          load={load}
          series={series}
          events={events}
          loadLabel="Träningsbelastning"
          height={380}
          emptyLabel="Inga pass i perioden."
          ariaLabel="Veckans träningsbelastning per passkategori, med återhämtningsmarkörer"
        />

        {/* Datatäckning: en serie som saknas ska förklaras, inte tigas ihjäl. */}
        <details className="rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <summary className="cursor-pointer text-zinc-600 dark:text-zinc-400">
            Datatäckning för lagren ({series.length} av {candidateSeries.length} har data i
            perioden)
          </summary>
          <div className="mt-3 w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Lager
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Veckor med data
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Period med mätvärden
                  </th>
                </tr>
              </thead>
              <tbody>
                {coverage.map((row) => (
                  <tr key={row.label} className="border-t border-zinc-100 dark:border-zinc-800">
                    <th scope="row" className="py-1 pr-4 font-normal">
                      {row.label}
                    </th>
                    <td className="py-1 pr-4 tabular-nums">
                      {row.weeksWithData} av {weeks}
                    </td>
                    <td className="py-1 tabular-nums">
                      {formatDateRange(row.range.from, row.range.to)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-3 text-zinc-600 dark:text-zinc-400">
            Sömn-, HRV- och vilopulsserierna börjar den dag Garmin-synken började hämta
            dagsdata — allt före det är tomt, inte noll. Luckor ritas som brutna linjer och
            fylls aldrig i genom interpolation. Baslinjen kräver dessutom minst fyra
            mätvärden i ett åtta veckor långt fönster, så de första veckorna med data får
            ingen punkt alls: en baslinje byggd på ett par mätningar är brus.
            {missingSeries.length > 0 && (
              <>
                {" "}
                Lager utan ett enda värde i perioden är helt bortlyfta ur diagrammet:{" "}
                {missingSeries.map((s) => s.label).join(", ")}.
              </>
            )}
          </p>
        </details>
      </section>

      {/* ================= B. Intensitetsfördelning (P1.3) ================== */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Intensitetsfördelning
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Andel av veckans pulstid per zon, summerad över passets alla fragment.{" "}
            {sessionsWithZoneData} av {sessions.length} pass i perioden har zondata.
            Medeldistansträning handlar mindre om hur mycket och mer om fördelningen.
          </p>
        </div>

        <IntensityChart
          weeks={intensityWeeks}
          profile={thresholdProfile}
          emptyLabel="Ingen pulszondata i perioden."
        />
      </section>

      {/* ================= C. Formkurva (P1.4) ============================= */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Formkurva (Efficiency Factor)
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Hur långt du kommer per hjärtslag. Stiger kurvan vid samma puls går formen åt
            rätt håll. Bara lugna pass och långpass på minst 20 minuter med registrerad
            snittpuls räknas — intervaller går inte att jämföra med distanslöpning.{" "}
            {efPoints.length} pass i perioden klarar filtret.
          </p>
        </div>

        <EfficiencyChart
          points={efPoints}
          races={efRaces}
          fromDate={startDate}
          toDate={todayKey}
          emptyLabel="Inga pass i perioden klarar filtret (lugnt/långpass, ≥ 20 min, med snittpuls)."
        />

        <p className="rounded border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
          <strong className="font-medium text-zinc-900 dark:text-zinc-100">
            Läs kurvan försiktigt.
          </strong>{" "}
          Efficiency Factor påverkas kraftigt av värme, uttorkning, stress, höjd och
          underlag. En dipp i juli är sannolikt vädret, inte formen. Kurvan är dessutom
          räknad på rå fart — ett kuperat pass ser sämre ut än ett platt även när
          ansträngningen är densamma. Använd den för att se riktningen över månader, aldrig
          för att bedöma ett enskilt pass.
        </p>
      </section>

      {/* ================= D. Korrelationer ================================ */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Korrelationer</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Pearson-korrelation mellan -1 och 1, räknad på dagar där båda måtten finns. Kräver
            minst 5 sådana dagar. Ett samband är inte samma sak som orsak.
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
                <div className="text-xs text-zinc-500 dark:text-zinc-400">{c.reason}</div>
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
