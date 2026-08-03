import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { ScatterChart } from "@/components/charts/ScatterChart";
import { BarChart, type BarDatum } from "@/components/charts/BarChart";
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
import { SessionQuality, type SignatureGroup } from "@/components/SessionQuality";
import { groupBySignature, toOccurrence, type SignatureLap } from "@/lib/session-signature";
import { addZoneSeconds, bandsFromZones, zoneTotal, BAND_LABELS, type BandKey } from "@/lib/intensity";
import {
  addDays as planAddDays,
  AVAILABILITY_KINDS,
  AVAILABILITY_LABELS,
  BLOCK_LABELS,
  PRIORITY_LABELS,
  SEASON_LABELS,
  type AvailabilityKind,
  type BlockType,
  type Priority,
  type SeasonKind,
} from "@/lib/planning";
import {
  computeRaceBuildup,
  BUILDUP_WINDOW_DAYS,
  type RaceBuildup,
} from "@/lib/race-buildup";
import {
  RaceProgressionChart,
  type RaceProgressionPoint,
} from "@/components/charts/RaceProgressionChart";
import { matchPlanToSessions, summarizeCompliance, type PlannedWorkout } from "@/lib/plan-matching";
import { ComplianceCard } from "@/components/ComplianceCard";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  categoryColorVar,
  isActivityCategory,
  type ActivityCategory,
} from "@/lib/categories";
import {
  buildWeekSeries,
  buildWeekSeriesForRange,
  shortDateLabel,
  toDateKey,
  weekRangeLabel,
} from "@/lib/week-series";
import { STATUS_LABEL } from "@/lib/calendar-utils";
import { BASELINE_WINDOW_DAYS, type DailyStatusInput } from "@/lib/daily-status";
import {
  computeInterruptionPrecursor,
  groupInterruptionPeriods,
  type InterruptionPeriod,
  type InterruptionPrecursor,
} from "@/lib/interruption-timeline";

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
  /** K7: tillgänglighetsperioder som överlappar blocket, sammanfattade per
   * sort ("2 skola/prov, 1 läger"). Ren kontext — påverkar inga beräkningar. */
  availabilitySummary: string;
};

/** "2 skola/prov, 1 läger" — perioderna räknade per sort, i AVAILABILITY_KINDS
 * fasta ordning så att två block bredvid varandra listar dem likadant. */
function summarizeAvailability(periods: { kind: AvailabilityKind }[]): string {
  if (periods.length === 0) return "inga";
  const counts = new Map<AvailabilityKind, number>();
  for (const p of periods) counts.set(p.kind, (counts.get(p.kind) ?? 0) + 1);
  return AVAILABILITY_KINDS.filter((k) => counts.has(k))
    .map((k) => `${counts.get(k)} ${AVAILABILITY_LABELS[k].toLowerCase()}`)
    .join(", ");
}

async function loadBlockAggregate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  block: SeasonBlockRow,
): Promise<BlockAggregate> {
  const endExclusive = toDateKey(planAddDays(new Date(`${block.end_date}T00:00:00`), 1));

  const [
    { data: activityRows },
    { data: dailyMetrics },
    { data: diaryEntries },
    { data: availabilityRows },
  ] = await Promise.all([
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
    // K7: överlappande tillgänglighetsperioder. Det är hela poängen med
    // förslaget — att kunna se att grundperioden 25/26 innehöll två
    // tentaveckor och 26/27 ingen, i stället för att bara konstatera att
    // volymen skilde sig.
    supabase
      .from("availability_periods")
      .select("start_date, end_date, kind, label")
      .lte("start_date", block.end_date)
      .gte("end_date", block.start_date),
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
    availabilitySummary: summarizeAvailability(
      (availabilityRows ?? []) as { kind: AvailabilityKind }[],
    ),
  };
}

// --- K5: tävlingsanalys och upptrappning -----------------------------------

type CompetitionEventRow = {
  id: string;
  event: string;
  target_result: string | null;
  actual_result: string | null;
  placement: number | null;
  /** Tolkad löptid i sekunder (K9-importen, se migration
   * 20260803100000_competition_result_seconds.sql). Null för hopp/kast och
   * för grenar utan resultat — `actual_result` är fortfarande källan för
   * visning, det här är bara det sorterbara talet. */
  result_seconds: number | null;
};

type CompetitionRow = {
  id: string;
  name: string;
  competition_date: string;
  priority: Priority;
  venue: SeasonKind | null;
  competition_events: CompetitionEventRow[];
};

/** Sammandrag för ett enskilt lopp i jämförelseläget — speglar `BlockAggregate`
 * ovan, bara med tävlingsdatum i stället för blockgränser (K5). */
type RaceAggregate = {
  competition: CompetitionRow;
  buildup: RaceBuildup;
};

/** "1500m, 800m" — grenarna för en tävling, tomt streck om inga är inlagda. */
function raceEventsLabel(events: CompetitionEventRow[]): string {
  return events.length > 0 ? events.map((e) => e.event).join(", ") : "–";
}

/** Resultaten precis som atleten skrev dem — ingen tolkning eller sortering
 * av fritexten (se fallgropen i docs/tranarperspektiv.md K5). */
function raceResultsLabel(events: CompetitionEventRow[]): string {
  return events.length > 0
    ? events.map((e) => e.actual_result ?? "inget resultat").join(", ")
    : "–";
}

function racePlacementsLabel(events: CompetitionEventRow[]): string {
  return events.length > 0
    ? events.map((e) => (e.placement != null ? String(e.placement) : "–")).join(", ")
    : "–";
}

/** Laddar upptrappningsprofilen (lib/race-buildup.ts) för ett enskilt lopp.
 * Hämtar bara det loppets eget fönster — anropas parvis, aldrig för alla
 * tävlingar på en gång (se kommentaren vid `compareRaceA`/`compareRaceB`
 * nedan). */
async function loadRaceAggregate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  competition: CompetitionRow,
): Promise<RaceAggregate> {
  const raceDate = competition.competition_date;
  const windowStart = toDateKey(
    planAddDays(new Date(`${raceDate}T00:00:00`), -BUILDUP_WINDOW_DAYS),
  );
  // Baslinjefönstret (P1.2) sträcker sig längre bak än upptrappningens 21
  // dagar — computeDailyStatus behöver hela det för att räkna hrvTrend.
  const baselineStart = toDateKey(
    planAddDays(new Date(`${raceDate}T00:00:00`), -BASELINE_WINDOW_DAYS),
  );

  const [{ data: activityRows }, { data: metricRows }] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", windowStart)
      .lt("start_time", raceDate)
      .order("start_time"),
    supabase
      .from("daily_metrics")
      .select("metric_date, hrv_overnight_avg, resting_hr, sleep_seconds, sleep_score")
      .gte("metric_date", baselineStart)
      .lte("metric_date", raceDate),
  ]);

  const dailyStatusRows: DailyStatusInput[] = (metricRows ?? []).map((m) => ({
    date: m.metric_date as string,
    hrv: m.hrv_overnight_avg,
    restingHr: m.resting_hr,
    sleepHours: m.sleep_seconds != null ? m.sleep_seconds / 3600 : null,
    sleepScore: m.sleep_score,
  }));

  const buildup = computeRaceBuildup(
    raceDate,
    (activityRows ?? []) as unknown as SessionActivity[],
    dailyStatusRows,
  );

  return { competition, buildup };
}

/** Radlista för tävlingsjämförelsen (K5) — speglar `blockComparisonRows` i
 * form och stil, se docs/tranarperspektiv.md K5 punkt 2. */
function raceComparisonRows(
  a: RaceAggregate,
  b: RaceAggregate,
): { label: string; a: string; b: string }[] {
  const weeklyLoadLabel = (w: RaceBuildup["weeklyLoad"]) =>
    w.map((v) => Math.round(v)).join(" → ");
  const hrvTrendLabel = (v: number | null) =>
    v != null ? `${v > 0 ? "+" : ""}${v.toFixed(1)} SD` : "otillräcklig historik för en baslinje";
  const lastHardLabel = (v: number | null) =>
    v != null ? `${v} ${v === 1 ? "dag" : "dagar"} före loppet` : "inget kvalitetspass i fönstret";

  return [
    { label: "Datum", a: a.competition.competition_date, b: b.competition.competition_date },
    {
      label: "Gren",
      a: raceEventsLabel(a.competition.competition_events),
      b: raceEventsLabel(b.competition.competition_events),
    },
    {
      label: "Resultat",
      a: raceResultsLabel(a.competition.competition_events),
      b: raceResultsLabel(b.competition.competition_events),
    },
    {
      label: "Placering",
      a: racePlacementsLabel(a.competition.competition_events),
      b: racePlacementsLabel(b.competition.competition_events),
    },
    {
      label: "Veckobelastning (3 v.)",
      a: weeklyLoadLabel(a.buildup.weeklyLoad),
      b: weeklyLoadLabel(b.buildup.weeklyLoad),
    },
    {
      label: "Distans",
      a: `${a.buildup.totalKm.toFixed(0)} km`,
      b: `${b.buildup.totalKm.toFixed(0)} km`,
    },
    {
      label: "Kvalitetspass",
      a: String(a.buildup.qualitySessions),
      b: String(b.buildup.qualitySessions),
    },
    {
      label: "Vilodagar",
      a: `${a.buildup.restDays} av ${BUILDUP_WINDOW_DAYS}`,
      b: `${b.buildup.restDays} av ${BUILDUP_WINDOW_DAYS}`,
    },
    {
      label: "Senaste hårda passet",
      a: lastHardLabel(a.buildup.lastHardSessionDaysBefore),
      b: lastHardLabel(b.buildup.lastHardSessionDaysBefore),
    },
    {
      label: "Snittsömn",
      a: a.buildup.avgSleepHours != null ? formatHoursMinutes(a.buildup.avgSleepHours * 3600) : "ingen data",
      b: b.buildup.avgSleepHours != null ? formatHoursMinutes(b.buildup.avgSleepHours * 3600) : "ingen data",
    },
    {
      label: "HRV-trend",
      a: hrvTrendLabel(a.buildup.hrvTrend),
      b: hrvTrendLabel(b.buildup.hrvTrend),
    },
    {
      label: `${BAND_LABELS.easy} / ${BAND_LABELS.threshold}`,
      a: `${formatPct(a.buildup.bandPct.easy)} / ${formatPct(a.buildup.bandPct.threshold)}`,
      b: `${formatPct(b.buildup.bandPct.easy)} / ${formatPct(b.buildup.bandPct.threshold)}`,
    },
  ];
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

/** En liggande stapel per period, fördelad på kategori efter distans-andel —
 * samma idé som ComboChartens veckovisa staplar (stackad belastning per
 * kategori), bara konsoliderad till en enda stapel för en hel period i
 * stället för en stapel per vecka. Bara färgade divs, ingen SVG — därför
 * ingen risk för samma <title>-hydreringsbugg som drabbat de riktiga
 * diagrammen (se ComboChart/CategoryPieChart-historiken). */
function CategoryDistributionBar({
  rows,
}: {
  rows: { category: ActivityCategory; km: number; seconds: number; count: number }[];
}) {
  const total = rows.reduce((sum, d) => sum + d.km, 0);
  if (rows.length === 0 || total <= 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Inga pass i perioden.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {rows.map((d) => {
          const share = d.km / total;
          return (
            <div
              key={d.category}
              className="h-full"
              style={{ width: `${share * 100}%`, backgroundColor: categoryColorVar(d.category) }}
              title={`${CATEGORY_LABELS[d.category]}: ${d.km.toFixed(1)} km (${Math.round(share * 100)}%)`}
            />
          );
        })}
      </div>
      <ul className="flex flex-col gap-0.5">
        {rows.map((d) => {
          const share = d.km / total;
          return (
            <li key={d.category} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: categoryColorVar(d.category) }}
              />
              <span className="text-zinc-600 dark:text-zinc-400">{CATEGORY_LABELS[d.category]}</span>
              <span className="ml-auto tabular-nums text-zinc-900 dark:text-zinc-100">
                {d.km.toFixed(1)} km · {formatHoursMinutes(d.seconds)} · {Math.round(share * 100)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
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
    // K7: sist i tabellen, som kontext till allt ovanför — en grundperiod med
    // två tentaveckor är inte jämförbar rakt av med en utan.
    { label: "Tillgänglighet", a: a.availabilitySummary, b: b.availabilitySummary },
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
  searchParams: Promise<{
    weeks?: string;
    block?: string;
    compareA?: string;
    compareB?: string;
    raceA?: string;
    raceB?: string;
    gren?: string;
    bana?: string;
    volumeCategories?: string | string[];
    volumeFiltered?: string;
    volumeMetric?: string;
  }>;
}) {
  const {
    weeks: weeksParam,
    block: blockParam,
    compareA: compareAParam,
    compareB: compareBParam,
    raceA: raceAParam,
    raceB: raceBParam,
    gren: grenParam,
    bana: banaParam,
    volumeCategories: volumeCategoriesParam,
    volumeFiltered: volumeFilteredParam,
    volumeMetric: volumeMetricParam,
  } = await searchParams;
  const volumeMetric: "distance" | "time" = volumeMetricParam === "time" ? "time" : "distance";

  // Distans-/tid-diagrammen (nedan) ska kunna avgränsas till valda
  // passkategorier — annars räknas t ex cykel och styrka in i "tränade km"
  // som om det vore löpning. Ett dolt fält (`volumeFiltered`) skiljer "inget
  // filter valt än" (formuläret aldrig skickat → visa default-urvalet) från
  // "användaren bockade ur allt" (formuläret skickat, men tomt) — annars kan
  // HTML-formulär inte skilja de fallen åt när alla kryssrutor är avbockade.
  // Default-urvalet exkluderar alternativ träning/styrka: "tränade km/tid"
  // ska i första hand betyda löpning, inte blandas ut av cykelpass eller ett
  // gympass utan volymmått.
  const selectedVolumeCategories: Set<ActivityCategory> = volumeFilteredParam
    ? new Set(
        (Array.isArray(volumeCategoriesParam)
          ? volumeCategoriesParam
          : volumeCategoriesParam
            ? [volumeCategoriesParam]
            : []
        ).filter(isActivityCategory),
      )
    : new Set(
        CATEGORY_VALUES.filter((c) => c !== "cross_training" && c !== "strength"),
      );
  const weeksNum = Number(weeksParam);
  const weeks: WeekOption = (WEEK_OPTIONS as readonly number[]).includes(weeksNum)
    ? (weeksNum as WeekOption)
    : 12;

  /** Bygger en /trends-länk som behåller vecko-/blockvalet, kategorifiltret
   * och metricvalet — bara det som skickas in i `overrides` ändras. Utan den
   * skulle t.ex. Distans/Tid-växlaren nollställa kategorifiltret varje gång
   * man klickade. */
  function volumeHref(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    if (weeksParam) params.set("weeks", weeksParam);
    if (blockParam) params.set("block", blockParam);
    params.set("volumeMetric", volumeMetric);
    // Kategorifiltret följer bara med om användaren faktiskt satt ett — utan
    // volumeFiltered=1 används ändå default-urvalet på nästa sidladdning,
    // oavsett vilka volumeCategories-parametrar som råkar stå i URL:en.
    if (volumeFilteredParam) {
      params.set("volumeFiltered", volumeFilteredParam);
      const cats = Array.isArray(volumeCategoriesParam)
        ? volumeCategoriesParam
        : volumeCategoriesParam
          ? [volumeCategoriesParam]
          : [];
      for (const c of cats) params.append("volumeCategories", c);
    }
    for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    return `/trends?${params.toString()}`;
  }

  /** Samma mönster som `volumeHref` ovan, för K5-sektionens gren-/bana-
   * växlare: behåller alla parametrar på sidan (inklusive den andra av
   * gren/bana) och byter bara det som skickas in i `overrides`. Utan den
   * skulle t.ex. bana-knapparna nollställa grenvalet och tvärtom. `raceA`/
   * `raceB` följer med oförändrade — väljer man en gren de inte tillhör
   * tystnar jämförelsen själv längre ner (se `racesInSelectedEvent`), det
   * behöver inte städas bort ur URL:en här. */
  function raceHref(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    if (weeksParam) params.set("weeks", weeksParam);
    if (blockParam) params.set("block", blockParam);
    if (grenParam) params.set("gren", grenParam);
    if (banaParam) params.set("bana", banaParam);
    if (raceAParam) params.set("raceA", raceAParam);
    if (raceBParam) params.set("raceB", raceBParam);
    for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    return `/trends?${params.toString()}#tavlingar`;
  }

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
    { data: plannedRows },
    { data: competitionRows },
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
    // K2: bara hämtad i blockvy — efterlevnad hör bara hemma där (se
    // ComplianceCard och tranarperspektiv.md K2 punkt 5), så ett rullande
    // fönster utan block slipper en fråga den inte använder.
    activeBlock
      ? supabase
          .from("planned_workouts")
          .select(
            "id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds",
          )
          .gte("scheduled_date", startDate)
          .lt("scheduled_date", endDateExclusive as string)
      : Promise.resolve({ data: [] as PlannedWorkout[] | null }),
    // K5: tävlingslistan hämtas alltid (billigt, en handfull rader) — det är
    // bara upptrappningsprofilerna för de två valda loppen som hämtas separat
    // nedan, se compareRaceA/compareRaceB.
    supabase
      .from("competitions")
      .select(
        "id, name, competition_date, priority, venue, competition_events(id, event, target_result, actual_result, placement, result_seconds)",
      )
      .order("competition_date"),
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

  // --- K6: avbrottstidslinjen (docs/tranarperspektiv.md) ---------------------
  // Helt fristående från vecko-/blockväljaren högst upp — perioderna som
  // visas är alltid "senaste året" oavsett vilket fönster resten av sidan
  // råkar stå på. Lookback-bufferten (utöver de 365 dagarna) täcker det
  // längsta en enskild period kan behöva bakåt: BASELINE_WINDOW_DAYS för
  // sömn-/HRV-baslinjen (lib/daily-status.ts) plus ytterligare en vecka för
  // jämförelseveckan precis före den.
  const TIMELINE_WINDOW_DAYS = 365;
  const timelineLookbackFrom = toDateKey(
    planAddDays(new Date(`${todayKey}T00:00:00`), -(TIMELINE_WINDOW_DAYS + BASELINE_WINDOW_DAYS + 14)),
  );
  const timelineEarliestPeriodStart = toDateKey(
    planAddDays(new Date(`${todayKey}T00:00:00`), -TIMELINE_WINDOW_DAYS),
  );

  const [
    { data: timelineDiaryRows },
    { data: timelineActivityRows },
    { data: timelineMetricRows },
  ] = await Promise.all([
    supabase
      .from("diary_entries")
      .select("entry_date, day_type, notes")
      .gte("entry_date", timelineLookbackFrom)
      .order("entry_date"),
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", timelineLookbackFrom)
      .order("start_time"),
    supabase
      .from("daily_metrics")
      .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
      .gte("metric_date", timelineLookbackFrom)
      .order("metric_date"),
  ]);

  const timelineSessions = groupActivitiesIntoSessions(
    (timelineActivityRows ?? []) as unknown as SessionActivity[],
  ).map((s) => ({ date: s.date, trainingLoad: s.trainingLoad, category: s.category }));

  const timelineDailyMetrics = (timelineMetricRows ?? []).map((m) => ({
    date: m.metric_date as string,
    hrv: m.hrv_overnight_avg,
    restingHr: m.resting_hr,
    sleepHours: m.sleep_seconds != null ? m.sleep_seconds / 3600 : null,
    sleepScore: m.sleep_score,
  }));

  const timelineDiaryNotes = (timelineDiaryRows ?? [])
    .filter((e) => e.notes)
    .map((e) => ({ date: e.entry_date as string, note: e.notes as string }));

  const allInterruptionPeriods: InterruptionPeriod[] = groupInterruptionPeriods(
    (timelineDiaryRows ?? [])
      .filter((e) => e.day_type === "sick" || e.day_type === "injured")
      .map((e) => ({ date: e.entry_date as string, dayType: e.day_type as "sick" | "injured" })),
  );
  // "Senaste året" filtrerar på periodens START — en period som pågick in i
  // fönstret men började dessförinnan hör hemma i föregående års tidslinje.
  const interruptionPeriods = allInterruptionPeriods.filter(
    (p) => p.startDate >= timelineEarliestPeriodStart,
  );
  const interruptionPrecursors: InterruptionPrecursor[] = interruptionPeriods
    .map((period) =>
      computeInterruptionPrecursor(period, {
        sessions: timelineSessions,
        dailyMetrics: timelineDailyMetrics,
        diaryNotes: timelineDiaryNotes,
      }),
    )
    // Senaste avbrottet överst — en tidslinje man läser uppifrån och ned.
    .sort((a, b) => (a.period.startDate < b.period.startDate ? 1 : -1));

  /** "12–15 mar" resp. "12 mar – 3 apr" om perioden spänner över en
   * månadsgräns. Återanvänder `shortDateLabel` (lib/week-series.ts) i
   * stället för en egen datumformatering. */
  function formatPeriodRange(period: InterruptionPeriod): string {
    const fromLabel = shortDateLabel(period.startDate);
    if (period.startDate === period.endDate) return fromLabel;
    const toLabel = shortDateLabel(period.endDate);
    const fromMonth = fromLabel.split(" ")[1];
    const toMonth = toLabel.split(" ")[1];
    return fromMonth === toMonth ? `${fromLabel.split(" ")[0]}–${toLabel}` : `${fromLabel} – ${toLabel}`;
  }

  // --- Pass, inte aktiviteter (P0.5/1.3) -------------------------------------
  // SESSION_ACTIVITY_COLUMNS är en runtime-sträng, så Supabase-klienten kan
  // inte härleda radtypen och faller tillbaka på GenericStringError[]. Kolumn-
  // listan och SessionActivity definieras bredvid varandra i lib/sessions.ts
  // och hålls i synk där — därför är omvägen via unknown säker här.
  const sessions: TrainingSession[] = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );

  // --- Fördelning per kategori: samma fönster som resten av sidan (veckor
  // eller block) — inte egna fasta perioder. Beräknad på samma pass-enhet
  // (P0.5) som resten av sidan, till skillnad från gamla /stats-sidan som
  // grupperade på råa Garmin-aktiviteter. ------------------------------------
  const categoryDistributionRows: { category: ActivityCategory; km: number; seconds: number; count: number }[] =
    (() => {
      const byCategory = new Map<ActivityCategory, { km: number; seconds: number; count: number }>();
      for (const s of sessions) {
        const cur = byCategory.get(s.category) ?? { km: 0, seconds: 0, count: 0 };
        cur.km += s.distanceMeters / 1000;
        cur.seconds += s.durationSeconds;
        cur.count += 1;
        byCategory.set(s.category, cur);
      }
      return CATEGORY_VALUES.map((category) => ({
        category,
        ...(byCategory.get(category) ?? { km: 0, seconds: 0, count: 0 }),
      })).filter((d) => d.km > 0);
    })();

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

  // Veckans distans och tid som egna lager. Till skillnad från HRV/sömn (en
  // mätning man antingen har eller saknar) är en vecka utan träning ett
  // riktigt värde, inte en lucka — därför summeras dessa till 0 snarare än
  // null, samma princip som träningsbelastningens staplar.
  const distanceByWeek = new Map<string, number>();
  const durationByWeek = new Map<string, number>();
  for (const session of sessions) {
    if (!selectedVolumeCategories.has(session.category)) continue;
    const wk = isoWeekStart(session.date);
    distanceByWeek.set(wk, (distanceByWeek.get(wk) ?? 0) + session.distanceMeters / 1000);
    durationByWeek.set(wk, (durationByWeek.get(wk) ?? 0) + session.durationSeconds / 3600);
  }
  const distanceWeekly = weekSeries.map((wk) => distanceByWeek.get(wk) ?? 0);
  const durationWeekly = weekSeries.map((wk) => durationByWeek.get(wk) ?? 0);
  // Egna diagram med råa värden, inte avvikelse mot baslinje — "hur många km
  // och minuter" är en fråga om nivå, inte om det gått upp eller ner mot det
  // egna normala (till skillnad från HRV/vilopuls/sömn ovan).
  const distanceBarData: BarDatum[] = weekSeries.map((wk, i) => ({
    label: weekLabel(wk),
    value: distanceWeekly[i],
  }));
  const durationBarData: BarDatum[] = weekSeries.map((wk, i) => ({
    label: weekLabel(wk),
    value: durationWeekly[i],
  }));

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
      // "Fart" i Almgrens fyra axlar (2.3) — ska gå att skilja från
      // puls-/sömnlagren i en blick, därför en egen färg i stället för bläck
      // som de övriga, och aktiv från start. Bokstavlig hex snarare än en
      // CSS-variabel: linjens `stroke` via `var(--...)` visade sig inte slå
      // igenom i alla webbläsare (staplarnas `fill` gör det, men den här
      // linjen gjorde det inte) — en ren hexfärg är mer robust och läsbar i
      // både ljust och mörkt läge.
      color: "#0891b2",
      defaultVisible: true,
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

  // --- K2: efterlevnad inom blocket --------------------------------------
  // Samma fråga som CV ovan svarar på indirekt ("var träningen jämn"), fast
  // rakt på sak: "blev det gjort". Bara i blockvy, se kommentaren vid
  // planned_workouts-frågan ovan. `sessions`/`diaryEntries` täcker redan
  // exakt blockets fönster (startDate–endDateExclusive), så ingen ny fråga
  // mot databasen behövs utöver planned_workouts.
  const blockCompliance = activeBlock
    ? summarizeCompliance(matchPlanToSessions((plannedRows ?? []) as PlannedWorkout[], sessions))
    : null;
  const blockDayTypeByDate = new Map<string, string | null>(
    (diaryEntries ?? []).map((e) => [e.entry_date as string, e.day_type as string | null]),
  );

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

  // --- K5: tävlingsanalys och upptrappning -------------------------------
  // En tränare jämför samma distans över tid ("hur har 1500m utvecklats?"),
  // inte två godtyckliga lopp mot varandra — sektionen utgår därför från en
  // gren (competition_events.event), inte från ett fritt par lopp. Se
  // docs/tranarperspektiv.md K5. Bygger ingen egen resultattabell —
  // competition_events har redan actual_result/placement.
  const competitions: CompetitionRow[] = (competitionRows ?? []) as CompetitionRow[];

  type EventResultRow = {
    eventRowId: string;
    competitionId: string;
    competitionName: string;
    competitionDate: string;
    venue: SeasonKind | null;
    event: string;
    resultLabel: string;
    resultSeconds: number;
  };

  // Bara löpgrenar har result_seconds (hopp/kast mäts i meter och lämnades
  // null vid import, se migration 20260803100000) — de filtreras bort här,
  // innan grenväljaren eller grafen ser dem, så de aldrig kan väljas eller
  // krascha något nedströms.
  const eventResults: EventResultRow[] = competitions.flatMap((c) =>
    c.competition_events
      .filter((e) => e.result_seconds != null)
      .map((e) => ({
        eventRowId: e.id,
        competitionId: c.id,
        competitionName: c.name,
        competitionDate: c.competition_date,
        venue: c.venue,
        event: e.event,
        resultLabel: e.actual_result ?? "inget resultat",
        resultSeconds: e.result_seconds as number,
      })),
  );

  const eventCounts = new Map<string, number>();
  for (const r of eventResults) {
    eventCounts.set(r.event, (eventCounts.get(r.event) ?? 0) + 1);
  }
  // Minst två resultat, annars finns ingen utveckling att visa — sorterad
  // flest först så väljaren öppnar på grenen med mest att visa.
  const eventOptions = [...eventCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event, "sv"));

  const selectedEvent =
    grenParam && eventOptions.some((o) => o.event === grenParam)
      ? grenParam
      : (eventOptions[0]?.event ?? null);

  const banaFilter: "alla" | "inne" | "ute" =
    banaParam === "inne" || banaParam === "ute" ? banaParam : "alla";
  const banaVenue: SeasonKind | null =
    banaFilter === "inne" ? "indoor" : banaFilter === "ute" ? "outdoor" : null;

  // Alla resultat i den valda grenen, oavsett bana — basen för
  // upptrappningsjämförelsens väljare (punkt 5 nedan) och för personbästat
  // innan bana-filtret smalnar av vad som faktiskt visas.
  const eventRaceRows = selectedEvent
    ? eventResults
        .filter((r) => r.event === selectedEvent)
        .sort((a, b) => (a.competitionDate < b.competitionDate ? -1 : a.competitionDate > b.competitionDate ? 1 : 0))
    : [];
  // Bana-filtret smalnar av vad grafen/tabellen visar. "Personbästa" räknas
  // ur samma filtrerade urval — annars kan hjälplinjen peka på ett lopp som
  // inte ens syns i vyn, vilket hade sett trasigt ut med filtret på "inne".
  const filteredRaceRows = banaVenue ? eventRaceRows.filter((r) => r.venue === banaVenue) : eventRaceRows;
  // Delas mellan grafen (ritar sin egen PB-markör internt) och tabellen
  // under den, så de aldrig kan peka ut olika lopp som personbästa.
  const pbSecondsInFilter =
    filteredRaceRows.length > 0
      ? Math.min(...filteredRaceRows.map((r) => r.resultSeconds))
      : null;
  // Etiketten måste följa filtret. Inne och ute är skilda rekord i friidrott,
  // så det snabbaste inomhusloppet är inte "personbästa" när ett utomhuslopp
  // gått fortare — Alices 800m-bästa (2:21,99) sattes utomhus i juni, och att
  // kalla inomhustiden personbästa hade varit direkt fel.
  const bestResultLabel =
    banaFilter === "inne" ? "Bästa inomhus" : banaFilter === "ute" ? "Bästa utomhus" : "Personbästa";

  const progressionPoints: RaceProgressionPoint[] = filteredRaceRows.map((r) => ({
    id: r.eventRowId,
    date: r.competitionDate,
    competitionName: r.competitionName,
    resultLabel: r.resultLabel,
    resultSeconds: r.resultSeconds,
    venue: r.venue,
  }));

  // Upptrappningsjämförelsens <select>-fält ska bara innehålla lopp i den
  // valda grenen (punkt 5) — det är så "jämför samma distans" blir konkret.
  const racesInSelectedEvent = selectedEvent
    ? competitions.filter((c) =>
        c.competition_events.some((e) => e.event === selectedEvent && e.actual_result),
      )
    : [];
  // Ligger raceA/raceB inte i den valda grenen (t.ex. efter att grenen
  // byttes) nollställs de tyst här — ingen trasig jämförelse renderas, se
  // docs/tranarperspektiv.md K5 och kommentaren vid `raceHref` ovan.
  const compareRaceA = raceAParam
    ? (racesInSelectedEvent.find((c) => c.id === raceAParam) ?? null)
    : null;
  const compareRaceB = raceBParam
    ? (racesInSelectedEvent.find((c) => c.id === raceBParam) ?? null)
    : null;
  // Fristående frågor per valt lopp — aldrig en fråga per tävling i listan,
  // det hade blivit dyrt så fort säsongen har ett tiotal lopp.
  const [raceAggregateA, raceAggregateB] =
    compareRaceA && compareRaceB && compareRaceA.id !== compareRaceB.id
      ? await Promise.all([
          loadRaceAggregate(supabase, compareRaceA),
          loadRaceAggregate(supabase, compareRaceB),
        ])
      : [null, null];

  // K5 sista upptrappningsupplysning: träningsdatan (Garmin-synken) börjar
  // 2025-07-25, men de importerade tävlingsresultaten slutar 2024-07-21. För
  // alla nuvarande lopp saknas därför träningsdata i de 21 dagarna före —
  // upptrappningstabellen blir tom av det skälet, inte för att inget
  // hände. Ett dataläge, inte ett fel; sant tills nyare lopp läggs in.
  const TRAINING_DATA_START = "2025-07-25";
  const buildupDataGapApplies =
    raceAggregateA != null &&
    raceAggregateB != null &&
    raceAggregateA.competition.competition_date < TRAINING_DATA_START &&
    raceAggregateB.competition.competition_date < TRAINING_DATA_START;

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

      {/* Pass/distans/tid/belastning och dagens status mot baslinjen visas på
          /dashboard i stället — den här sidan är för djupdykningen, inte
          sammanfattningen. Konsekvens (CV) hör bara hemma i blockvy och finns
          inte på dashboarden, så den är kvar här. */}
      {loadCv != null && (
        <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
          <div className="flex flex-col gap-1 rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <dt className="text-sm text-zinc-500 dark:text-zinc-400">Konsekvens (CV)</dt>
            <dd className="text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
              {loadCv.toFixed(2)}
            </dd>
            <dd className="text-xs text-zinc-500 dark:text-zinc-400">
              lägre = jämnare vecka för vecka
            </dd>
          </div>
        </dl>
      )}

      {/* K2: efterlevnad för blocket, samma kort som veckovyn använder.
          Konsekvens (ovan) svarar på om träningen var jämn, det här på om
          den blev av — besläktade frågor, därför placerade bredvid varandra. */}
      {activeBlock && blockCompliance && (
        <ComplianceCard
          title={activeBlock.name}
          compliance={blockCompliance}
          dayTypeByDate={blockDayTypeByDate}
        />
      )}

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
            siffrorna och dina egna dagboksord. Baslinjen är rullande och följer med datan,
            så Formkurva-linjen här visar kortsiktig avvikelse, inte den långsiktiga
            utvecklingen — vid många veckor, se Formkurva-diagrammet längre ner i stället,
            som visar råvärden och en glidande trend oavsett hur långt fönster du valt.
          </p>
        </div>

        <ComboChart
          periods={periods}
          load={load}
          series={series}
          events={events}
          loadLabel="Träningsbelastning"
          height={380}
          // HRV/vilopuls/sömn (återhämtning) + formkurva (fart) aktiva från
          // start — fyra i stället för standardtaket på tre.
          maxVisibleSeries={4}
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

      {/* ================= Fördelning per kategori ============================ */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Fördelning per kategori
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Andel av distansen per kategori,{" "}
            {activeBlock ? `i ${activeBlock.name}` : `de senaste ${weeks} veckorna`} — samma
            fönster som väljaren högst upp.
          </p>
        </div>
        <CategoryDistributionBar rows={categoryDistributionRows} />
      </section>

      {/* ================= Distans och tid per vecka ========================= */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {volumeMetric === "distance" ? "Distans per vecka" : "Träningstid per vecka"}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Välj vilka passkategorier som ska räknas med — annars blandas t ex cykel och
              styrka in i &quot;tränade km&quot;.
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            {(["distance", "time"] as const).map((m) => (
              <Link
                key={m}
                href={volumeHref({ volumeMetric: m })}
                className={`rounded px-3 py-1 ${
                  volumeMetric === m
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {m === "distance" ? "Distans" : "Tid"}
              </Link>
            ))}
          </div>
        </div>

        <form method="get" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {weeksParam && <input type="hidden" name="weeks" value={weeksParam} />}
          {blockParam && <input type="hidden" name="block" value={blockParam} />}
          <input type="hidden" name="volumeFiltered" value="1" />
          <input type="hidden" name="volumeMetric" value={volumeMetric} />
          {CATEGORY_VALUES.map((c) => (
            <label key={c} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                name="volumeCategories"
                value={c}
                defaultChecked={selectedVolumeCategories.has(c)}
              />
              {CATEGORY_LABELS[c]}
            </label>
          ))}
          <button
            type="submit"
            className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Uppdatera
          </button>
        </form>

        {volumeMetric === "distance" ? (
          <BarChart data={distanceBarData} formatKind="km" emptyLabel="Inga pass i perioden." />
        ) : (
          <BarChart data={durationBarData} formatKind="hours" emptyLabel="Inga pass i perioden." />
        )}
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

      {/* ================= K6: avbrottstidslinjen ============================ */}
      {/* Hopfälld från start (djupanalys, inte förstaintryck) — se K6 i
          docs/tranarperspektiv.md. Beskriver vad som föregick varje sjuk-/
          skadeperiod, aldrig vad som orsakade den (fallgrop 2): med i
          storleksordningen tre perioder per år räcker underlaget aldrig till
          ett samband, bara till vad som brukade synas samtidigt. */}
      <section className="flex flex-col gap-4">
        <details className="rounded border border-zinc-200 dark:border-zinc-800">
          <summary className="flex cursor-pointer flex-wrap items-center justify-between gap-2 p-4 text-zinc-900 dark:text-zinc-100">
            <span className="text-lg font-medium">Avbrott</span>
            <span className="text-xs font-normal text-zinc-500 dark:text-zinc-400">
              {interruptionPeriods.length}{" "}
              {interruptionPeriods.length === 1 ? "period" : "perioder"} senaste året
            </span>
          </summary>
          <div className="flex flex-col gap-4 border-t border-zinc-200 p-4 dark:border-zinc-800">
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              Sjuk- och skadeperioder ur dagboken, med vad som hände samtidigt: belastning och
              kvalitetspass veckan före, sömn och HRV mot din egen baslinje, och dina egna ord
              dagarna innan. Det är ett underlag för att lägga märke till mönster, inte ett
              påstående om orsak — för få perioder per år för att kunna särskilja slump från
              samband.
            </p>

            {interruptionPrecursors.length === 0 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Inga registrerade sjuk- eller skadeperioder det senaste året.
              </p>
            ) : (
              <ul className="flex flex-col gap-3">
                {interruptionPrecursors.map((p) => (
                  <li
                    key={`${p.period.dayType}-${p.period.startDate}`}
                    className="rounded border border-zinc-100 p-3 dark:border-zinc-800"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">
                        {formatPeriodRange(p.period)}
                      </span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">
                        {STATUS_LABEL[p.period.dayType]}, {p.period.days}{" "}
                        {p.period.days === 1 ? "dag" : "dagar"}
                      </span>
                    </div>
                    <ul className="mt-2 flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
                      <li>
                        Veckan före: {Math.round(p.loadWeekBefore)} belastning
                        {p.loadBaselinePerWeek != null
                          ? ` (snitt ${Math.round(p.loadBaselinePerWeek)})`
                          : " (för kort historik för ett snitt)"}
                        , {p.qualitySessionsWeekBefore} kvalitetspass
                      </li>
                      <li>
                        Sömn{" "}
                        {p.sleepHoursWeekBefore != null
                          ? formatHoursMinutes(p.sleepHoursWeekBefore * 3600)
                          : "okänd"}{" "}
                        i snitt
                        {p.sleepBaselineHours != null &&
                          ` (baslinje ${formatHoursMinutes(p.sleepBaselineHours * 3600)})`}
                        , HRV{" "}
                        {p.hrvDeviationSd != null
                          ? `${p.hrvDeviationSd > 0 ? "+" : ""}${p.hrvDeviationSd.toFixed(1)} SD`
                          : "otillräcklig historik för en baslinje"}
                      </li>
                      {p.notesBefore.map((note) => (
                        <li key={note.date}>
                          Dagboken {shortDateLabel(note.date)}: &quot;{note.note}&quot;
                        </li>
                      ))}
                    </ul>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </details>
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

      {/* ================= K5: Tävlingar och upptrappning ==================== */}
      {/* Ligger bredvid blockjämförelsen ovan — samma sorts retrospektiv, bara
          med tävlingar som enhet. Utgår från en gren, inte från ett fritt par
          lopp — se docs/tranarperspektiv.md K5. */}
      <section id="tavlingar" className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Tävlingar</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Med i storleksordningen tio lopp per säsong är det här beskrivande, inte
            statistiskt. Ingen trendlinje och ingen prognos — bara vad som faktiskt
            hände, gren för gren.
          </p>
        </div>

        {competitions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inga tävlingar inlagda ännu. Lägg till dem på{" "}
            <Link href="/planering" className="underline">
              planeringssidan
            </Link>
            .
          </p>
        ) : (
          <div className="w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Datum
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Tävling
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Bana
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Prioritet
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Resultat
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr]:border-t [&_tr]:border-zinc-100 dark:[&_tr]:border-zinc-800">
                {competitions.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 pr-4 tabular-nums">{c.competition_date}</td>
                    <td className="py-1.5 pr-4">{c.name}</td>
                    <td className="py-1.5 pr-4">{c.venue ? SEASON_LABELS[c.venue] : "–"}</td>
                    <td className="py-1.5 pr-4">{PRIORITY_LABELS[c.priority]}</td>
                    <td className="py-1.5">{raceResultsLabel(c.competition_events)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {eventOptions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ingen gren har minst två tidtagna resultat ännu (hopp och kast mäts i meter
            och räknas inte hit). Fyll i fler resultat på{" "}
            <Link href="/planering" className="underline">
              planeringssidan
            </Link>
            .
          </p>
        ) : (
          <>
            {/* Grenväljare — flest resultat först, default öppnar på den grenen. */}
            <div className="flex flex-wrap gap-2 text-sm">
              {eventOptions.map((o) => (
                <Link
                  key={o.event}
                  href={raceHref({ gren: o.event })}
                  className={`rounded px-3 py-1 ${
                    o.event === selectedEvent
                      ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {o.event} ({o.count})
                </Link>
              ))}
            </div>

            {/* Inne/ute-filter — samma knappradsstil som vecko-/blockväljaren
                högst upp. Formen (fylld/ihålig) i grafen bär skillnaden när
                filtret står på "alla"; knapparna här smalnar av vad som visas. */}
            <div className="flex flex-wrap gap-2 text-sm">
              {(
                [
                  { key: "alla", label: "Alla" },
                  { key: "inne", label: "Inomhus" },
                  { key: "ute", label: "Utomhus" },
                ] as const
              ).map((b) => (
                <Link
                  key={b.key}
                  href={raceHref({ bana: b.key })}
                  className={`rounded px-3 py-1 ${
                    banaFilter === b.key
                      ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {b.label}
                </Link>
              ))}
            </div>

            <RaceProgressionChart
              points={progressionPoints}
              bestLabel={bestResultLabel}
              emptyLabel="Inga lopp i den här grenen med det valda banfiltret."
            />

            {/* Tabellen under grafen — samma urval som grafen (gren + bana),
                kronologisk, personbästa markerad. */}
            {filteredRaceRows.length > 0 && (
              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-max text-left text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                      <th scope="col" className="py-1 pr-4 font-normal">
                        Datum
                      </th>
                      <th scope="col" className="py-1 pr-4 font-normal">
                        Tävling
                      </th>
                      <th scope="col" className="py-1 pr-4 font-normal">
                        Bana
                      </th>
                      <th scope="col" className="py-1 font-normal">
                        Resultat
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr]:border-t [&_tr]:border-zinc-100 dark:[&_tr]:border-zinc-800">
                    {filteredRaceRows.map((r) => {
                      const isPb = r.resultSeconds === pbSecondsInFilter;
                      return (
                        <tr
                          key={r.eventRowId}
                          className={isPb ? "bg-zinc-50 dark:bg-zinc-900" : undefined}
                        >
                          <td className="py-1.5 pr-4 tabular-nums">{r.competitionDate}</td>
                          <td className="py-1.5 pr-4">{r.competitionName}</td>
                          <td className="py-1.5 pr-4">
                            {r.venue ? SEASON_LABELS[r.venue] : "–"}
                          </td>
                          <td className="py-1.5 tabular-nums">
                            {r.resultLabel}
                            {isPb && (
                              <span className="ml-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                {bestResultLabel}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Upptrappningsjämförelsen — samma tabellstruktur som
                blockjämförelsen (P1.5), men bara lopp i den valda grenen. */}
            {racesInSelectedEvent.length < 2 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Upptrappningsjämförelsen kräver minst två lopp i den här grenen med
                registrerat resultat.
              </p>
            ) : (
              <>
                <form
                  action="/trends"
                  method="get"
                  className="flex flex-wrap items-end gap-3 text-sm"
                >
                  {weeksParam && <input type="hidden" name="weeks" value={weeksParam} />}
                  {blockParam && <input type="hidden" name="block" value={blockParam} />}
                  {selectedEvent && <input type="hidden" name="gren" value={selectedEvent} />}
                  {banaParam && <input type="hidden" name="bana" value={banaParam} />}
                  <label className="flex flex-col gap-1">
                    <span className="text-zinc-600 dark:text-zinc-400">Lopp A</span>
                    <select
                      name="raceA"
                      defaultValue={raceAParam ?? ""}
                      className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="" disabled>
                        Välj lopp
                      </option>
                      {racesInSelectedEvent.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.competition_date})
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-zinc-600 dark:text-zinc-400">Lopp B</span>
                    <select
                      name="raceB"
                      defaultValue={raceBParam ?? ""}
                      className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="" disabled>
                        Välj lopp
                      </option>
                      {racesInSelectedEvent.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.competition_date})
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className={primaryButtonClass}>
                    Jämför
                  </button>
                </form>

                {raceAParam && raceBParam && !(raceAggregateA && raceAggregateB) && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Kunde inte jämföra — välj två olika lopp i den här grenen med resultat.
                  </p>
                )}

                {raceAggregateA &&
                  raceAggregateB &&
                  (buildupDataGapApplies ? (
                    <p className="rounded border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                      Träningsdatan börjar 2025-07-25, men de importerade tävlingsresultaten
                      slutar 2024-07-21. De {BUILDUP_WINDOW_DAYS} dagarna före de här två
                      loppen ligger därför före träningsdatans start, och upptrappningen går
                      inte att visa — inget mättes, det är inte det samma som att inget
                      hände. Så fort ett lopp med träningsdata i fönstret jämförs dyker
                      tabellen upp här.
                    </p>
                  ) : (
                    <details className="rounded border border-zinc-200 dark:border-zinc-800" open>
                      <summary className="cursor-pointer p-4 text-sm text-zinc-600 dark:text-zinc-400">
                        Upptrappning de {BUILDUP_WINDOW_DAYS} dagarna före respektive lopp
                      </summary>
                      <div className="w-full max-w-full overflow-x-auto border-t border-zinc-200 p-4 dark:border-zinc-800">
                        <table className="w-full min-w-max text-left text-sm">
                          <thead>
                            <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                              <th scope="col" className="py-1 pr-4 font-normal">
                                Mått
                              </th>
                              <th scope="col" className="py-1 pr-4 font-normal">
                                {raceAggregateA.competition.name}
                              </th>
                              <th scope="col" className="py-1 font-normal">
                                {raceAggregateB.competition.name}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="[&_tr]:border-t [&_tr]:border-zinc-100 dark:[&_tr]:border-zinc-800">
                            {raceComparisonRows(raceAggregateA, raceAggregateB).map((row) => (
                              <tr key={row.label}>
                                <th
                                  scope="row"
                                  className="py-1.5 pr-4 font-normal text-zinc-600 dark:text-zinc-400"
                                >
                                  {row.label}
                                </th>
                                <td className="py-1.5 pr-4 tabular-nums">{row.a}</td>
                                <td className="py-1.5 tabular-nums">{row.b}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ))}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
