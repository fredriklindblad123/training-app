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
  coefficientOfVariation,
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
import { SessionQuality, type SignatureGroup } from "@/components/SessionQuality";
import { groupBySignature, toOccurrence, type SignatureLap } from "@/lib/session-signature";
import { addZoneSeconds, bandsFromZones, zoneTotal, BAND_LABELS, type BandKey } from "@/lib/intensity";
import { addDays as planAddDays, BLOCK_LABELS, type BlockType } from "@/lib/planning";
import { CATEGORY_LABELS, isActivityCategory, type ActivityCategory } from "@/lib/categories";
import { buildWeekSeries, buildWeekSeriesForRange, toDateKey, weekRangeLabel } from "@/lib/week-series";

const WEEK_OPTIONS = [12, 26, 52] as const;
type WeekOption = (typeof WEEK_OPTIONS)[number];

type SeasonBlockRow = {
  id: string;
  name: string;
  block_type: BlockType;
  start_date: string;
  end_date: string;
  focus: string | null;
};

/** EF-filtret enligt P1.4: bara jämförbara pass, aldrig intervaller. */
const EF_MIN_SECONDS = 20 * 60;
const EF_CATEGORIES = ["easy", "long_run"] as const;

/** Sammandrag för ett enskilt block, till P1.5-jämförelseläget. Räknat helt
 * fristående från sidans huvudfönster — jämförelsen ska kunna ställa två
 * block mot varandra oavsett vilket (om något) som är valt som huvudvy. */
type BlockAggregate = {
  block: SeasonBlockRow;
  sessionCount: number;
  totalDistanceKm: number;
  totalSeconds: number;
  totalLoad: number;
  avgWeeklyLoad: number | null;
  loadCv: number | null;
  categoryPct: Partial<Record<ActivityCategory, number>>;
  bandPct: Record<BandKey, number>;
  avgSleepHours: number | null;
  avgHrv: number | null;
  avgRestingHr: number | null;
  sickDays: number;
  injuredDays: number;
  raceLabels: string[];
};

async function loadBlockAggregate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  block: SeasonBlockRow,
): Promise<BlockAggregate> {
  const endExclusive = toDateKey(planAddDays(new Date(`${block.end_date}T00:00:00`), 1));

  const [{ data: activityRows }, { data: dailyMetrics }, { data: diaryEntries }] =
    await Promise.all([
      supabase
        .from("activities")
        .select(SESSION_ACTIVITY_COLUMNS)
        .gte("start_time", block.start_date)
        .lt("start_time", endExclusive)
        .order("start_time"),
      supabase
        .from("daily_metrics")
        .select("metric_date, sleep_seconds, resting_hr, hrv_overnight_avg")
        .gte("metric_date", block.start_date)
        .lt("metric_date", endExclusive),
      supabase
        .from("diary_entries")
        .select("entry_date, day_type")
        .gte("entry_date", block.start_date)
        .lt("entry_date", endExclusive),
    ]);

  const sessions = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );
  const blockWeeks = buildWeekSeriesForRange(block.start_date, block.end_date);

  const loadByWeek = new Map<string, number>();
  const loadByCategory = new Map<string, number>();
  const zones = emptyZoneSeconds();
  const raceLabels: string[] = [];
  for (const s of sessions) {
    const wk = isoWeekStart(s.date);
    loadByWeek.set(wk, (loadByWeek.get(wk) ?? 0) + s.trainingLoad);
    loadByCategory.set(s.category, (loadByCategory.get(s.category) ?? 0) + s.trainingLoad);
    addZoneSeconds(zones, [
      s.hrZone1Seconds,
      s.hrZone2Seconds,
      s.hrZone3Seconds,
      s.hrZone4Seconds,
      s.hrZone5Seconds,
    ]);
    if (s.category === "race") raceLabels.push(s.dominantActivity.name?.trim() || "Tävling");
  }

  const totalLoad = sessions.reduce((sum, s) => sum + s.trainingLoad, 0);
  const weeklyLoadTotals = blockWeeks.map((wk) => loadByWeek.get(wk) ?? 0);
  const loadCv =
    weeklyLoadTotals.filter((v) => v > 0).length >= 2
      ? coefficientOfVariation(weeklyLoadTotals)
      : null;

  const categoryPct: Partial<Record<ActivityCategory, number>> = {};
  if (totalLoad > 0) {
    for (const [cat, catLoad] of loadByCategory) {
      if (isActivityCategory(cat)) categoryPct[cat] = catLoad / totalLoad;
    }
  }

  const bands = bandsFromZones(zones);
  const bandTotal = zoneTotal(zones);
  const bandPct: Record<BandKey, number> = {
    easy: bandTotal > 0 ? bands.easy / bandTotal : 0,
    middle: bandTotal > 0 ? bands.middle / bandTotal : 0,
    threshold: bandTotal > 0 ? bands.threshold / bandTotal : 0,
  };

  const sleepHours = (dailyMetrics ?? [])
    .map((m) => m.sleep_seconds)
    .filter((v): v is number => v != null)
    .map((v) => v / 3600);
  const hrvValues = (dailyMetrics ?? [])
    .map((m) => m.hrv_overnight_avg)
    .filter((v): v is number => v != null);
  const rhrValues = (dailyMetrics ?? [])
    .map((m) => m.resting_hr)
    .filter((v): v is number => v != null);

  return {
    block,
    sessionCount: sessions.length,
    totalDistanceKm: sessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000,
    totalSeconds: sessions.reduce((sum, s) => sum + s.durationSeconds, 0),
    totalLoad,
    avgWeeklyLoad: blockWeeks.length > 0 ? totalLoad / blockWeeks.length : null,
    loadCv,
    categoryPct,
    bandPct,
    avgSleepHours: mean(sleepHours),
    avgHrv: mean(hrvValues),
    avgRestingHr: mean(rhrValues),
    sickDays: (diaryEntries ?? []).filter((e) => e.day_type === "sick").length,
    injuredDays: (diaryEntries ?? []).filter((e) => e.day_type === "injured").length,
    raceLabels,
  };
}

const primaryButtonClass =
  "w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Kategorifördelningen som en kort läsbar rad, t.ex. "Lugn distans 52 %,
 * Tröskel 24 %, Intervaller 18 %" — bara kategorier med belastning i
 * blocket, störst först. */
function categoryBreakdownLabel(pct: Partial<Record<ActivityCategory, number>>): string {
  const entries = Object.entries(pct) as [ActivityCategory, number][];
  if (entries.length === 0) return "–";
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([cat, v]) => `${CATEGORY_LABELS[cat]} ${formatPct(v)}`)
    .join(", ");
}

/** Radlista för blockjämförelsetabellen (P1.5) — volym, intensitetsfördelning,
 * sömn, sjuk-/skadedagar och tävlingsresultat, precis den listan
 * insikter-roadmapen efterfrågar för "vad gav det i tävling efteråt". */
function blockComparisonRows(
  a: BlockAggregate,
  b: BlockAggregate,
): { label: string; a: string; b: string }[] {
  return [
    { label: "Period", a: `${a.block.start_date} – ${a.block.end_date}`, b: `${b.block.start_date} – ${b.block.end_date}` },
    { label: "Blocktyp", a: BLOCK_LABELS[a.block.block_type], b: BLOCK_LABELS[b.block.block_type] },
    { label: "Pass", a: String(a.sessionCount), b: String(b.sessionCount) },
    { label: "Distans", a: `${a.totalDistanceKm.toFixed(0)} km`, b: `${b.totalDistanceKm.toFixed(0)} km` },
    { label: "Träningstid", a: formatHoursMinutes(a.totalSeconds), b: formatHoursMinutes(b.totalSeconds) },
    { label: "Träningsbelastning", a: a.totalLoad.toFixed(0), b: b.totalLoad.toFixed(0) },
    {
      label: "Snitt/vecka",
      a: a.avgWeeklyLoad != null ? a.avgWeeklyLoad.toFixed(0) : "–",
      b: b.avgWeeklyLoad != null ? b.avgWeeklyLoad.toFixed(0) : "–",
    },
    {
      label: "Konsekvens (CV)",
      a: a.loadCv != null ? a.loadCv.toFixed(2) : "för kort period",
      b: b.loadCv != null ? b.loadCv.toFixed(2) : "för kort period",
    },
    { label: "Passkategorier", a: categoryBreakdownLabel(a.categoryPct), b: categoryBreakdownLabel(b.categoryPct) },
    {
      label: `${BAND_LABELS.easy} / ${BAND_LABELS.threshold}`,
      a: `${formatPct(a.bandPct.easy)} / ${formatPct(a.bandPct.threshold)}`,
      b: `${formatPct(b.bandPct.easy)} / ${formatPct(b.bandPct.threshold)}`,
    },
    {
      label: "Snittsömn",
      a: a.avgSleepHours != null ? formatHoursMinutes(a.avgSleepHours * 3600) : "ingen data",
      b: b.avgSleepHours != null ? formatHoursMinutes(b.avgSleepHours * 3600) : "ingen data",
    },
    {
      label: "Snitt-HRV",
      a: a.avgHrv != null ? `${Math.round(a.avgHrv)} ms` : "ingen data",
      b: b.avgHrv != null ? `${Math.round(b.avgHrv)} ms` : "ingen data",
    },
    {
      label: "Snitt vilopuls",
      a: a.avgRestingHr != null ? `${Math.round(a.avgRestingHr)} slag/min` : "ingen data",
      b: b.avgRestingHr != null ? `${Math.round(b.avgRestingHr)} slag/min` : "ingen data",
    },
    { label: "Sjukdagar", a: String(a.sickDays), b: String(b.sickDays) },
    { label: "Skadedagar", a: String(a.injuredDays), b: String(b.injuredDays) },
    {
      label: "Tävlingar",
      a: a.raceLabels.length > 0 ? a.raceLabels.join(", ") : "inga",
      b: b.raceLabels.length > 0 ? b.raceLabels.join(", ") : "inga",
    },
  ];
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
  searchParams: Promise<{ weeks?: string; block?: string; compareA?: string; compareB?: string }>;
}) {
  const {
    weeks: weeksParam,
    block: blockParam,
    compareA: compareAParam,
    compareB: compareBParam,
  } = await searchParams;
  const weeksNum = Number(weeksParam);
  const weeks: WeekOption = (WEEK_OPTIONS as readonly number[]).includes(weeksNum)
    ? (weeksNum as WeekOption)
    : 12;

  const supabase = await createClient();
  const todayKey = toDateKey(new Date());

  // P1.5: träningsblock som tidsenhet. Blocken hämtas alltid (billigt, en
  // rad per block) så att både väljaren och jämförelseläget kan använda dem,
  // oavsett om ett block faktiskt är valt just nu. Bara påbörjade block visas
  // som väljare — ett framtida planerat block har per definition ingen data
  // att visa, och skulle bara se trasigt ut om man klickade på det.
  const { data: blockRows } = await supabase
    .from("season_blocks")
    .select("id, name, block_type, start_date, end_date, focus")
    .lte("start_date", todayKey)
    .order("start_date", { ascending: false });
  const blocks: SeasonBlockRow[] = blockRows ?? [];
  const activeBlock = blockParam ? (blocks.find((b) => b.id === blockParam) ?? null) : null;

  // Blockvyn byter ut det rullande fönstret mot blockets egna datum — allt
  // nedanför (ComboChart, IntensityChart, EfficiencyChart, korrelationerna)
  // är redan generiskt över "en serie perioder mellan startDate och nu", så
  // det enda som behöver bytas ut är själva fönstret.
  const weekSeries = activeBlock
    ? buildWeekSeriesForRange(activeBlock.start_date, activeBlock.end_date)
    : buildWeekSeries(weeks);
  const startDate = activeBlock ? activeBlock.start_date : weekSeries[0];
  // Exklusiv övre gräns — bara satt i blockvy. Utan block gäller "fram till
  // nu", precis som tidigare.
  const endDateExclusive = activeBlock
    ? toDateKey(planAddDays(new Date(`${activeBlock.end_date}T00:00:00`), 1))
    : null;

  // Tröskelkolumnerna (P0.3b) kan saknas i databasen när migrationen ännu inte
  // är körd. Den frågan får därför gå separat och felet sväljas: sidan ska
  // fungera utan dem, bara med en tydligare brasklapp om zongränserna.
  const [
    { data: activityRows },
    { data: dailyMetrics },
    { data: diaryEntries },
    profileResult,
  ] = await Promise.all([
    (() => {
      let q = supabase
        .from("activities")
        .select(SESSION_ACTIVITY_COLUMNS)
        .gte("start_time", startDate);
      if (endDateExclusive) q = q.lt("start_time", endDateExclusive);
      return q.order("start_time");
    })(),
    (() => {
      let q = supabase
        .from("daily_metrics")
        .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
        .gte("metric_date", startDate);
      if (endDateExclusive) q = q.lt("metric_date", endDateExclusive);
      return q.order("metric_date");
    })(),
    (() => {
      let q = supabase
        .from("diary_entries")
        .select("entry_date, rpe, feeling, day_type, notes")
        .gte("entry_date", startDate);
      if (endDateExclusive) q = q.lt("entry_date", endDateExclusive);
      return q.order("entry_date");
    })(),
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
  //
  // I blockvy (P1.5) är frågan "avviker något just nu" inte meningsfull för
  // ett historiskt block — statuskortet visas därför bara i rullande-fönster-
  // läge, och frågan hoppas helt över i blockvy.
  const dailyStatus = activeBlock
    ? null
    : await (async () => {
        const statusFrom = (() => {
          const d = new Date();
          d.setDate(d.getDate() - (BASELINE_WINDOW_DAYS + 5));
          return d.toISOString().slice(0, 10);
        })();

        const { data: statusMetrics } = await supabase
          .from("daily_metrics")
          .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
          .gte("metric_date", statusFrom);

        return computeDailyStatus(
          (statusMetrics ?? []).map((m) => ({
            date: m.metric_date as string,
            hrv: m.hrv_overnight_avg,
            restingHr: m.resting_hr,
            sleepHours: m.sleep_seconds != null ? m.sleep_seconds / 3600 : null,
            sleepScore: m.sleep_score,
          })),
          todayKey,
        );
      })();

  // --- P2.1: passkvalitet för återkommande nyckelpass ------------------------
  // Varven hämtas för periodens aktiviteter och grupperas på signatur, dvs
  // vad som faktiskt genomfördes (antal och längd på aktiva varv) — passnamnen
  // är för inkonsekventa för att gruppera på.
  const activityIds = sessions.flatMap((s) => s.activities.map((a) => a.id));
  const dateByActivityId = new Map<string, string>();
  // Passets kategori, inte fragmentets: uppvärmningen i ett intervallpass är
  // märkt easy men passet är ett intervallpass, och det är den nivån
  // grupperingen ska ske på.
  const categoryByActivityId = new Map<string, string | null>();
  for (const session of sessions) {
    for (const a of session.activities) {
      dateByActivityId.set(a.id, session.date);
      categoryByActivityId.set(a.id, session.category ?? null);
    }
  }

  let signatureGroups: SignatureGroup[] = [];
  if (activityIds.length > 0) {
    const { data: lapRows } = await supabase
      .from("activity_splits")
      .select("activity_id, split_index, split_type, distance_meters, duration_seconds, avg_hr, max_hr")
      .in("activity_id", activityIds)
      .order("split_index");

    const lapsByActivity = new Map<string, SignatureLap[]>();
    for (const lap of (lapRows ?? []) as SignatureLap[]) {
      lapsByActivity.set(lap.activity_id, [...(lapsByActivity.get(lap.activity_id) ?? []), lap]);
    }

    const occurrences = [...lapsByActivity.entries()]
      .map(([id, laps]) =>
        toOccurrence(id, dateByActivityId.get(id) ?? "", laps, categoryByActivityId.get(id) ?? null),
      )
      .filter((o): o is NonNullable<typeof o> => o != null && o.date !== "");

    signatureGroups = groupBySignature(occurrences);
  }

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

  // --- P1.5: konsekvens inom blocket ------------------------------------
  // Variationskoefficienten för veckobelastning — Almgrens "quite consistent
  // within that period" (2.3 i insikter-roadmapen). Bara meningsfull när
  // fönstret är ett faktiskt block: en rullande 12-veckorsvy blandar per
  // definition olika träningsfaser och en låg/hög CV där säger inget om
  // konsekvens, bara att fönstret råkar spänna över olika sorters veckor.
  const weeklyLoadTotals = load.map((stack) => Object.values(stack).reduce((a, b) => a + b, 0));
  const loadCv =
    activeBlock && weeklyLoadTotals.filter((v) => v > 0).length >= 2
      ? coefficientOfVariation(weeklyLoadTotals)
      : null;

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

  // --- P1.5: blockjämförelse -------------------------------------------
  // Fristående från fönstret/blocket ovan — man kan stå i en rullande
  // 12-veckorsvy och samtidigt jämföra två tidigare block, t.ex. samma
  // blocktyp mellan två säsonger.
  const compareBlockA = compareAParam ? (blocks.find((b) => b.id === compareAParam) ?? null) : null;
  const compareBlockB = compareBParam ? (blocks.find((b) => b.id === compareBParam) ?? null) : null;
  const [compareAggregateA, compareAggregateB] =
    compareBlockA && compareBlockB && compareBlockA.id !== compareBlockB.id
      ? await Promise.all([
          loadBlockAggregate(supabase, compareBlockA),
          loadBlockAggregate(supabase, compareBlockB),
        ])
      : [null, null];

  return (
    <div className="flex flex-1 flex-col gap-10 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Trender</h1>
          {activeBlock ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              <strong className="font-medium text-zinc-900 dark:text-zinc-100">
                {activeBlock.name}
              </strong>{" "}
              ({BLOCK_LABELS[activeBlock.block_type]}), {activeBlock.start_date} –{" "}
              {activeBlock.end_date}
              {activeBlock.focus ? ` — ${activeBlock.focus}` : ""}. Räknas per{" "}
              <strong className="font-medium">pass</strong>, inte per Garmin-aktivitet.
            </p>
          ) : (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Allt på den här sidan räknas per <strong className="font-medium">pass</strong>, inte
              per Garmin-aktivitet: uppvärmning, huvudpass och nerjogg slås ihop till ett pass
              innan något summeras.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <div className="flex gap-2">
            {WEEK_OPTIONS.map((w) => (
              <Link
                key={w}
                href={`/trends?weeks=${w}`}
                className={`rounded px-3 py-1 ${
                  !activeBlock && weeks === w
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "border border-zinc-300 dark:border-zinc-700"
                }`}
              >
                {w} veckor
              </Link>
            ))}
          </div>
          {blocks.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {blocks.map((b) => (
                <Link
                  key={b.id}
                  href={`/trends?block=${b.id}`}
                  title={`${BLOCK_LABELS[b.block_type]}, ${b.start_date} – ${b.end_date}`}
                  className={`rounded px-3 py-1 ${
                    activeBlock?.id === b.id
                      ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : "border border-zinc-300 dark:border-zinc-700"
                  }`}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* --- Periodens siffror i klartext, innan något diagram -------------- */}
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Pass", value: String(sessions.length) },
          { label: "Distans", value: `${totalDistanceKm.toFixed(0)} km` },
          { label: "Träningstid", value: formatHoursMinutes(totalSeconds) },
          { label: "Träningsbelastning", value: totalLoad.toFixed(0) },
          ...(loadCv != null
            ? [{ label: "Konsekvens (CV)", value: loadCv.toFixed(2), hint: "lägre = jämnare vecka för vecka" }]
            : []),
        ].map((tile) => (
          <div
            key={tile.label}
            className="flex flex-col gap-1 rounded border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <dt className="text-sm text-zinc-500 dark:text-zinc-400">{tile.label}</dt>
            <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {tile.value}
            </dd>
            {"hint" in tile && (
              <dd className="text-xs text-zinc-500 dark:text-zinc-400">{tile.hint}</dd>
            )}
          </div>
        ))}
      </dl>

      {/* ================= P1.2: dagsstatus mot baslinje ================== */}
      {/* Visas bara i rullande-fönster-läge — "avviker något just nu" är
          inte en meningsfull fråga när man tittar bakåt på ett avslutat
          block. */}
      {dailyStatus && <DailyStatus status={dailyStatus} />}

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
          toDate={activeBlock ? activeBlock.end_date : todayKey}
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
      {/* ============ P2.1: passkvalitet ============ */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Passkvalitet: återkommande nyckelpass
        </h2>
        <SessionQuality groups={signatureGroups} />
      </section>

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

      {/* ================= P1.5: blockjämförelse ============================ */}
      {blocks.length >= 2 && (
        <section className="flex flex-col gap-4">
          <div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              Jämför block
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Ställ två block mot varandra, t.ex. samma blocktyp mellan två säsonger — volym,
              intensitetsfördelning, sömn, sjuk-/skadedagar och tävlingsresultat.
            </p>
          </div>

          <form action="/trends" method="get" className="flex flex-wrap items-end gap-3 text-sm">
            <label className="flex flex-col gap-1">
              <span className="text-zinc-600 dark:text-zinc-400">Block A</span>
              <select
                name="compareA"
                defaultValue={compareAParam ?? ""}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="" disabled>
                  Välj block
                </option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({BLOCK_LABELS[b.block_type]}, {b.start_date} – {b.end_date})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-zinc-600 dark:text-zinc-400">Block B</span>
              <select
                name="compareB"
                defaultValue={compareBParam ?? ""}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              >
                <option value="" disabled>
                  Välj block
                </option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({BLOCK_LABELS[b.block_type]}, {b.start_date} – {b.end_date})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={primaryButtonClass}>
              Jämför
            </button>
          </form>

          {compareAParam && compareBParam && !(compareAggregateA && compareAggregateB) && (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Kunde inte jämföra — välj två olika block.
            </p>
          )}

          {compareAggregateA && compareAggregateB && (
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                    <th scope="col" className="py-1 pr-4 font-normal">
                      Mått
                    </th>
                    <th scope="col" className="py-1 pr-4 font-normal">
                      {compareAggregateA.block.name}
                    </th>
                    <th scope="col" className="py-1 font-normal">
                      {compareAggregateB.block.name}
                    </th>
                  </tr>
                </thead>
                <tbody className="[&_tr]:border-t [&_tr]:border-zinc-100 dark:[&_tr]:border-zinc-800">
                  {blockComparisonRows(compareAggregateA, compareAggregateB).map((row) => (
                    <tr key={row.label}>
                      <th scope="row" className="py-1.5 pr-4 font-normal text-zinc-600 dark:text-zinc-400">
                        {row.label}
                      </th>
                      <td className="py-1.5 pr-4 tabular-nums">{row.a}</td>
                      <td className="py-1.5 tabular-nums">{row.b}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
