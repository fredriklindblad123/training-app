import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  SeasonTimeline,
  type TimelineBlock,
  type TimelineCompetition,
} from "@/components/SeasonTimeline";
import {
  addDays as planAddDays,
  AVAILABILITY_KINDS,
  AVAILABILITY_LABELS,
  BLOCK_INTENT,
  BLOCK_LABELS,
  BLOCK_TYPES,
  COMMON_EVENTS,
  competitionYearCounts,
  defaultCompetitionYear,
  PRIORITY_LABELS,
  QUALITY_WORKOUT_TYPES,
  SEASON_LABELS,
  SLOT_LABELS,
  WEEKDAY_LABELS,
  WORKOUT_LABELS,
  WORKOUT_TYPES,
  toDateKey,
  weeksBetween,
  type AvailabilityKind,
  type Priority,
  type SeasonKind,
  type WorkoutType,
} from "@/lib/planning";
import { plannedSignatureLabel, type PlannedRepGroup } from "@/lib/session-signature";
import { RepGroupEditor, type RepGroupRow } from "@/components/RepGroupEditor";
import {
  addTemplateItem,
  addTemplateRepGroup,
  createAvailabilityPeriod,
  createBlock,
  createCompetition,
  createTemplate,
  deleteAvailabilityPeriod,
  deleteBlock,
  deleteCompetition,
  deleteTemplate,
  deleteTemplateItem,
  deleteTemplateRepGroup,
  saveEventResult,
  suggestPeriodisation,
  updateBlock,
  updateTemplateRepGroup,
} from "./actions";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import { BAND_LABELS } from "@/lib/intensity";
import { formatHoursMinutes } from "@/lib/format";
import { shortDateLabel } from "@/lib/week-series";
import { STATUS_LABEL } from "@/lib/calendar-utils";
import { BASELINE_WINDOW_DAYS, type DailyStatusInput } from "@/lib/daily-status";
import {
  computeInterruptionPrecursor,
  groupInterruptionPeriods,
  type InterruptionPeriod,
  type InterruptionPrecursor,
} from "@/lib/interruption-timeline";
import {
  computeRaceBuildup,
  BUILDUP_WINDOW_DAYS,
  type RaceBuildup,
} from "@/lib/race-buildup";
import {
  RaceProgressionChart,
  type RaceProgressionPoint,
} from "@/components/charts/RaceProgressionChart";

const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primaryBtn =
  "w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const ghostBtn =
  "w-fit rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

// --- K5: tävlingsanalys och upptrappning -----------------------------------
// Flyttad hit från /blocket (docs/tranarloopen.md 3.1) — tävlingsanalys och
// upptrappning är en säsongsfråga, inte en blockfråga.

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

/** Sammandrag för ett enskilt lopp i jämförelseläget (K5). */
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

/** Radlista för tävlingsjämförelsen (K5) — speglar blockjämförelsens rader i
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

/** "12–15 mar" resp. "12 mar – 3 apr" om perioden spänner över en
 * månadsgräns. Återanvänder `shortDateLabel` (lib/week-series.ts) i stället
 * för en egen datumformatering. Flyttad hit från /blocket med K6
 * (docs/tranarloopen.md 3.1). */
function formatPeriodRange(period: InterruptionPeriod): string {
  const fromLabel = shortDateLabel(period.startDate);
  if (period.startDate === period.endDate) return fromLabel;
  const toLabel = shortDateLabel(period.endDate);
  const fromMonth = fromLabel.split(" ")[1];
  const toMonth = toLabel.split(" ")[1];
  return fromMonth === toMonth ? `${fromLabel.split(" ")[0]}–${toLabel}` : `${fromLabel} – ${toLabel}`;
}

export default async function PlaneringPage({
  searchParams,
}: {
  searchParams: Promise<{
    tavlingsAr?: string;
    tavlingsBana?: string;
    gren?: string;
    bana?: string;
    raceA?: string;
    raceB?: string;
    /** L5: loopens utgångar landar här. /blocket skickar startdatum för
     * nästa block, /veckan skickar veckan som ska planeras — så man möter ett
     * förifyllt formulär i stället för sidans topp och en tom ruta. */
    nyttBlockFran?: string;
    vecka?: string;
  }>;
}) {
  const supabase = await createClient();
  const today = toDateKey(new Date());
  const {
    nyttBlockFran: nyttBlockFranParam,
    tavlingsAr: tavlingsArParam,
    tavlingsBana: tavlingsBanaParam,
    gren: grenParam,
    bana: banaParam,
    raceA: raceAParam,
    raceB: raceBParam,
  } = await searchParams;

  const [
    { data: blocks },
    { data: templates },
    { data: plannedCounts },
    { data: blockTemplateLinks },
    { data: availabilityPeriods },
    { data: competitionDateRows },
    { data: nextACompetition },
  ] = await Promise.all([
    supabase.from("season_blocks").select("*").order("start_date"),
    // template_rep_groups(*) hämtas nästlat två led ner (K1) — en saknad
    // tabell (migrationen inte körd) ger bara undefined per mallrad, aldrig
    // ett kastat fel. Alla ställen nedan som läser det gör det via `?? []`.
    supabase
      .from("week_templates")
      .select("*, week_template_items(*, template_rep_groups(*))")
      .order("created_at"),
    supabase
      .from("planned_workouts")
      .select("scheduled_date")
      .gte("scheduled_date", today),
    // Vilka mallar som redan rullats ut i vilket block — härlett ur de
    // planerade passens egna block_id/template_id, eftersom det inte finns
    // någon separat koppling lagrad någon annanstans (se applyTemplate).
    supabase
      .from("planned_workouts")
      .select("block_id, template_id")
      .not("block_id", "is", null)
      .not("template_id", "is", null),
    // K7: migrationen är inte körd (se AGENTS/uppdraget) — en saknad tabell
    // ger bara { data: null, error }, aldrig ett kastat fel, och `?? []`
    // nedan faller tillbaka till "inga perioder" precis som övriga frågor
    // på den här sidan gör för sina egna eventuellt okörda tabeller.
    supabase.from("availability_periods").select("*").order("start_date"),
    // Smal fråga för årsväljaren: bara datumet, inte hela raden med
    // competition_events(*) nästlat — historiken (flera säsongers
    // tävlingar) ska kunna byggas till en väljare utan att dra in allt.
    supabase.from("competitions").select("competition_date").order("competition_date"),
    // "Nästa A-tävling" i läget-just-nu-korten ska visa sanningen oavsett
    // vilket år/bana som råkar vara valt i tävlingslistan längre ner —
    // därför en egen liten fråga i stället för att söka i competitionList
    // (som är filtrerad). Träffar aldrig fler än en rad.
    supabase
      .from("competitions")
      .select("name, competition_date")
      .eq("priority", "A")
      .gte("competition_date", today)
      .order("competition_date")
      .limit(1)
      .maybeSingle(),
  ]);

  const { years: competitionYears, countsByYear: competitionCountsByYear } =
    competitionYearCounts((competitionDateRows ?? []).map((r) => r.competition_date as string));
  const currentYear = today.slice(0, 4);
  const defaultYear = defaultCompetitionYear(currentYear, competitionYears, competitionCountsByYear);
  // "Alla år" är ett explicit val (query-param), annars gäller förvalet ovan.
  const tavlingsAr = tavlingsArParam ?? defaultYear;
  const tavlingsBana: "alla" | "inne" | "ute" =
    tavlingsBanaParam === "inne" || tavlingsBanaParam === "ute" ? tavlingsBanaParam : "alla";
  const venueFilter = tavlingsBana === "inne" ? "indoor" : tavlingsBana === "ute" ? "outdoor" : null;

  // Huvudfrågan (med competition_events nästlat) hämtar bara det valda
  // årets tävlingar — sidan växer med ett år per år i takt med säsongerna,
  // och /planering har redan flera tunga frågor ovan.
  let competitionsQuery = supabase
    .from("competitions")
    .select("*, competition_events(*)")
    .order("competition_date");
  if (tavlingsAr !== "alla") {
    competitionsQuery = competitionsQuery
      .gte("competition_date", `${tavlingsAr}-01-01`)
      .lt("competition_date", `${Number(tavlingsAr) + 1}-01-01`);
  }
  if (venueFilter) {
    competitionsQuery = competitionsQuery.eq("venue", venueFilter);
  }
  const { data: competitions } = await competitionsQuery;

  /** Bygger en /planering-länk som behåller både årsfiltret och bana-filtret
   * — bara den del som skickas in i `overrides` byts ut. Samma mönster som
   * volumeHref i trends/page.tsx (läst för formen, inte kopierad rakt av):
   * utan den skulle t.ex. bana-växlaren nollställa årsvalet varje gång man
   * klickade. Bär också med sig K5-sektionens gren/bana/raceA/raceB om de är
   * satta — annars skulle ett klick här nollställa tävlingsanalysen längre
   * ner på sidan (docs/tranarloopen.md 3.1: "se till att parametrarna inte
   * krockar eller nollställer varandra"). */
  function competitionHref(overrides: { tavlingsAr?: string; tavlingsBana?: string }): string {
    const params = new URLSearchParams();
    params.set("tavlingsAr", overrides.tavlingsAr ?? tavlingsAr);
    params.set("tavlingsBana", overrides.tavlingsBana ?? tavlingsBana);
    if (grenParam) params.set("gren", grenParam);
    if (banaParam) params.set("bana", banaParam);
    if (raceAParam) params.set("raceA", raceAParam);
    if (raceBParam) params.set("raceB", raceBParam);
    return `/sasongen?${params.toString()}#tavlingar`;
  }

  /** Samma mönster som `competitionHref` ovan, för K5-sektionens gren-/bana-
   * växlare: behåller alla parametrar på sidan (inklusive den andra av
   * gren/bana, och tavlingsAr/tavlingsBana ovan) och byter bara det som
   * skickas in i `overrides`. Utan den skulle t.ex. bana-knapparna
   * nollställa grenvalet och tvärtom. `raceA`/`raceB` följer med
   * oförändrade — väljer man en gren de inte tillhör tystnar jämförelsen
   * själv längre ner (se `racesInSelectedEvent`), det behöver inte städas
   * bort ur URL:en här. Flyttad hit från /blocket (docs/tranarloopen.md
   * 3.1) — bara `#tavlingar`-ankaret bytt till `#tavlingsanalys` eftersom
   * /sasongen redan hade en egen sektion med id `tavlingar`. */
  function raceHref(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    params.set("tavlingsAr", tavlingsAr);
    params.set("tavlingsBana", tavlingsBana);
    if (grenParam) params.set("gren", grenParam);
    if (banaParam) params.set("bana", banaParam);
    if (raceAParam) params.set("raceA", raceAParam);
    if (raceBParam) params.set("raceB", raceBParam);
    for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    return `/sasongen?${params.toString()}#tavlingsanalys`;
  }

  // TimelineBlock beskriver bara det tidslinjen behöver; sidan visar även
  // fokustexten, därav den utökade typen här.
  const blockList = (blocks ?? []) as (TimelineBlock & { focus: string | null })[];
  const competitionList = (competitions ?? []) as (TimelineCompetition & {
    location: string | null;
    notes: string | null;
    competition_events: {
      id: string;
      event: string;
      target_result: string | null;
      actual_result: string | null;
      placement: number | null;
    }[];
  })[];

  const availabilityList = (availabilityPeriods ?? []) as {
    id: string;
    start_date: string;
    end_date: string;
    kind: AvailabilityKind;
    label: string | null;
  }[];

  const nextA = nextACompetition;
  const activeBlock = blockList.find((b) => b.start_date <= today && b.end_date >= today);

  const templateNameById = new Map((templates ?? []).map((t) => [t.id as string, t.name as string]));
  const templateIdsByBlock = new Map<string, Set<string>>();
  for (const row of blockTemplateLinks ?? []) {
    const blockId = row.block_id as string;
    const set = templateIdsByBlock.get(blockId) ?? new Set<string>();
    set.add(row.template_id as string);
    templateIdsByBlock.set(blockId, set);
  }

  // --- K6: avbrottstidslinjen (docs/tranarperspektiv.md), flyttad hit från
  // /blocket (docs/tranarloopen.md 3.1) ---------------------------------------
  // Helt fristående från årsfiltret ovan — perioderna som visas är alltid
  // "senaste året" oavsett vilket tävlingsår som råkar vara valt i
  // tävlingslistan. Lookback-bufferten (utöver de 365 dagarna) täcker det
  // längsta en enskild period kan behöva bakåt: BASELINE_WINDOW_DAYS för
  // sömn-/HRV-baslinjen (lib/daily-status.ts) plus ytterligare en vecka för
  // jämförelseveckan precis före den.
  const TIMELINE_WINDOW_DAYS = 365;
  const timelineLookbackFrom = toDateKey(
    planAddDays(new Date(`${today}T00:00:00`), -(TIMELINE_WINDOW_DAYS + BASELINE_WINDOW_DAYS + 14)),
  );
  const timelineEarliestPeriodStart = toDateKey(
    planAddDays(new Date(`${today}T00:00:00`), -TIMELINE_WINDOW_DAYS),
  );

  const [
    { data: timelineDiaryRows },
    { data: timelineActivityRows },
    { data: timelineMetricRows },
    { data: competitionRows },
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
    // K5: tävlingslistan hämtas alltid (billigt, en handfull rader) — det är
    // bara upptrappningsprofilerna för de två valda loppen som hämtas
    // separat nedan, se compareRaceA/compareRaceB. En egen, obegränsad fråga
    // — till skillnad från competitionsQuery ovan (som bara hämtar det valda
    // tävlingsåret) behöver grenutvecklingen hela historiken.
    supabase
      .from("competitions")
      .select(
        "id, name, competition_date, priority, venue, competition_events(id, event, target_result, actual_result, placement, result_seconds)",
      )
      .order("competition_date"),
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

  // --- K5: tävlingsanalys och upptrappning, flyttad hit från /blocket
  // (docs/tranarloopen.md 3.1) -------------------------------------------
  // En tränare jämför samma distans över tid ("hur har 1500m utvecklats?"),
  // inte två godtyckliga lopp mot varandra — sektionen utgår därför från en
  // gren (competition_events.event), inte från ett fritt par lopp. Se
  // docs/tranarperspektiv.md K5. Bygger ingen egen resultattabell —
  // competition_events har redan actual_result/placement. Kallas
  // `allCompetitions` (inte `competitions`) för att skiljas från den
  // årsfiltrerade listan ovan — grenutvecklingen behöver hela historiken.
  const allCompetitions: CompetitionRow[] = (competitionRows ?? []) as CompetitionRow[];

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
  const eventResults: EventResultRow[] = allCompetitions.flatMap((c) =>
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
    ? allCompetitions.filter((c) =>
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
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Planering</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Lägg upp säsongen i block och låt planeringen skärpas ju närmare tävlingarna du
          kommer. En veckomall skapas en gång och rullas sedan ut över hela blocket — du
          fyller aldrig i samma vecka två gånger.
        </p>
      </div>

      {/* ---------------- Läget just nu ---------------- */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Aktuellt block</div>
          <div className="mt-1 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {activeBlock ? activeBlock.name : "Inget block"}
          </div>
          {activeBlock && (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {BLOCK_LABELS[activeBlock.block_type]} · slutar {activeBlock.end_date}
            </div>
          )}
        </div>
        <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Nästa A-tävling</div>
          <div className="mt-1 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {nextA ? nextA.name : "Ingen inlagd"}
          </div>
          {nextA && (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {nextA.competition_date} · {weeksBetween(today, nextA.competition_date) - 1} veckor kvar
            </div>
          )}
        </div>
        <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Planerade pass framåt</div>
          <div className="mt-1 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {(plannedCounts ?? []).length}
          </div>
        </div>
      </section>

      {/* ---------------- Säsongsöversikt ---------------- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Säsongsöversikt</h2>
        {/* Tar samma årsfilter som tävlingslistan (competitionList är redan
         * begränsad till tavlingsAr/tavlingsBana ovan) — med hela historiken
         * (2019–2024 importerad) ritad i ett band blir markörerna för många
         * för att gå att läsa, precis som listan. Blocken (blockList) filtreras
         * inte: banden är redan få och kortlivade (en säsong i taget), så de
         * blir aldrig oöverskådliga på samma sätt. Väljer man "Alla år" är
         * det ett medvetet val att se allt, inklusive en tätare tidslinje. */}
        <SeasonTimeline blocks={blockList} competitions={competitionList} />
      </section>

      {/* ---------------- Periodiseringsförslag ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Föreslå periodisering
        </h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Räknar bakåt från en tävling och delar tiden i grund, uppbyggnad, skärpning och
          nedtrappning. Blocklängderna följer principen att strukturen hålls fast i ungefär
          sex veckor i taget — Almgren beskriver det som att man kan justera, men bör vara
          konsekvent inom perioden. Förslaget är en utgångspunkt att flytta på, inte ett facit.
        </p>
        <form
          action={suggestPeriodisation}
          className="flex flex-wrap items-end gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <Field label="Tävlingsdatum">
            <input type="date" name="competition_date" required className={input} />
          </Field>
          <Field label="Börja planera från">
            <input type="date" name="start_from" defaultValue={today} className={input} />
          </Field>
          <Field label="Säsong">
            <select name="season" className={input} defaultValue="">
              <option value="">Ingen</option>
              <option value="indoor">{SEASON_LABELS.indoor}</option>
              <option value="outdoor">{SEASON_LABELS.outdoor}</option>
            </select>
          </Field>
          <button type="submit" className={primaryBtn}>
            Skapa block
          </button>
        </form>
      </section>

      {/* ---------------- Block ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Block</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Klicka på ett block för att redigera det eller hantera dess veckomallar. Ett pass som
          läggs till i en mall dyker automatiskt upp i kalendern för varje block av den typen.
        </p>

        {blockList.length > 0 && (
          <div className="flex flex-col gap-2">
            {blockList.map((b) => {
              const linkedNames = [...(templateIdsByBlock.get(b.id) ?? [])]
                .map((id) => templateNameById.get(id))
                .filter((n): n is string => n != null);
              // Mallar hör till en blocktyp (t ex "grund"), inte till ett
              // specifikt block — samma mall kan alltså återanvändas av flera
              // block av samma typ över säsonger. Det är därför den visas
              // här i stället för i en egen lista: den hör hemma där den
              // faktiskt används.
              const matchingTemplates = (templates ?? []).filter(
                (t) => t.block_type === b.block_type,
              );

              return (
                <details
                  key={b.id}
                  className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{b.name}</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {BLOCK_LABELS[b.block_type]}
                      {b.season ? ` · ${SEASON_LABELS[b.season]}` : ""} · {b.start_date} –{" "}
                      {b.end_date} · {weeksBetween(b.start_date, b.end_date)} veckor
                      {linkedNames.length > 0 ? ` · ${linkedNames.join(", ")}` : ""}
                    </span>
                  </summary>

                  <div className="mt-4 flex flex-col gap-4">
                    <form
                      action={updateBlock}
                      className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800"
                    >
                      <input type="hidden" name="id" value={b.id} />
                      <Field label="Namn">
                        <input name="name" defaultValue={b.name} required className={input} />
                      </Field>
                      <Field label="Typ">
                        <select name="block_type" defaultValue={b.block_type} className={input}>
                          {BLOCK_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {BLOCK_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Säsong">
                        <select name="season" defaultValue={b.season ?? ""} className={input}>
                          <option value="">Ingen</option>
                          <option value="indoor">{SEASON_LABELS.indoor}</option>
                          <option value="outdoor">{SEASON_LABELS.outdoor}</option>
                        </select>
                      </Field>
                      <Field label="Från">
                        <input
                          type="date"
                          name="start_date"
                          defaultValue={b.start_date}
                          required
                          className={input}
                        />
                      </Field>
                      <Field label="Till">
                        <input
                          type="date"
                          name="end_date"
                          defaultValue={b.end_date}
                          required
                          className={input}
                        />
                      </Field>
                      <Field label="Fokus">
                        <input name="focus" defaultValue={b.focus ?? ""} className={input} />
                      </Field>
                      <button type="submit" className={primaryBtn}>
                        Spara ändringar
                      </button>
                    </form>

                    <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                      <div className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Veckomallar för {BLOCK_LABELS[b.block_type]}
                      </div>

                      {matchingTemplates.length === 0 && (
                        <p className="text-sm text-zinc-400 dark:text-zinc-600">
                          Ingen mall för den här blocktypen än.
                        </p>
                      )}

                      <div className="flex flex-col gap-2">
                        {matchingTemplates.map((t) => {
                          const items = (t.week_template_items ?? []) as {
                            id: string;
                            weekday: number;
                            slot: number;
                            workout_type: string;
                            title: string | null;
                            description: string | null;
                            template_rep_groups?: RepGroupRow[] | null;
                          }[];
                          const isLinked = linkedNames.includes(t.name as string);
                          // K1: repgrupps-redigeraren visas bara för
                          // kvalitetstyper som standard (fallgrop 1), men
                          // aldrig hårt blockerad — redan inlagda grupper
                          // (t.ex. efter ett typbyte) visas oavsett.
                          const repEditableItems = items.filter(
                            (it) =>
                              QUALITY_WORKOUT_TYPES.includes(it.workout_type as WorkoutType) ||
                              (it.template_rep_groups ?? []).length > 0,
                          );
                          return (
                            <details
                              key={t.id}
                              className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
                            >
                              <summary className="cursor-pointer">
                                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                                  {t.name}
                                </span>
                                <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
                                  {items.length} pass/vecka
                                  {isLinked ? " · utrullad i det här blocket" : ""}
                                </span>
                              </summary>

                              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-7">
                                {WEEKDAY_LABELS.map((label, wi) => {
                                  const day = items
                                    .filter((it) => it.weekday === wi + 1)
                                    .sort((a, b2) => a.slot - b2.slot);
                                  return (
                                    <div key={label} className="flex flex-col gap-1">
                                      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                        {label.slice(0, 3)}
                                      </div>
                                      {day.length === 0 && (
                                        <div className="text-xs text-zinc-300 dark:text-zinc-700">
                                          —
                                        </div>
                                      )}
                                      {day.map((it) => (
                                        <div
                                          key={it.id}
                                          className="rounded bg-zinc-100 px-1.5 py-1 text-xs dark:bg-zinc-800"
                                        >
                                          <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                            {WORKOUT_LABELS[
                                              it.workout_type as keyof typeof WORKOUT_LABELS
                                            ] ?? it.workout_type}
                                          </div>
                                          {it.title && (
                                            <div className="text-zinc-600 dark:text-zinc-400">
                                              {it.title}
                                            </div>
                                          )}
                                          {(() => {
                                            // Samma nyckelformat som utfallets
                                            // buildSessionSignature — se
                                            // lib/session-signature.ts.
                                            const sigLabel = plannedSignatureLabel(
                                              (it.template_rep_groups ?? []).map(
                                                (g): PlannedRepGroup => ({
                                                  reps: g.reps,
                                                  distanceMeters: g.distance_meters,
                                                  durationSeconds: g.duration_seconds,
                                                  sortOrder: g.sort_order,
                                                }),
                                              ),
                                            );
                                            return (
                                              sigLabel && (
                                                <div className="text-zinc-600 dark:text-zinc-400">
                                                  {sigLabel}
                                                </div>
                                              )
                                            );
                                          })()}
                                          {it.slot > 1 && (
                                            <div className="text-[10px] text-zinc-500 dark:text-zinc-500">
                                              {SLOT_LABELS[it.slot]}
                                            </div>
                                          )}
                                          <form action={deleteTemplateItem}>
                                            <input type="hidden" name="id" value={it.id} />
                                            <button
                                              type="submit"
                                              className="mt-0.5 text-[10px] text-zinc-400 hover:text-red-600"
                                            >
                                              ta bort
                                            </button>
                                          </form>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>

                              {repEditableItems.length > 0 && (
                                <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                    Repgrupper — samma struktur som ett enskilt planerat pass
                                    (K1), så mallen bär med sig &ldquo;5×1000 m&rdquo; i stället
                                    för bara en rubrik.
                                  </div>
                                  {/* Ligger utanför veckorutnätet ovan med flit: rutnätets
                                   * kolumner är för smala för repgrupps-radens många fält, och
                                   * en tränare redigerar ett pass i taget här ändå. */}
                                  {repEditableItems.map((it) => (
                                    <div key={it.id}>
                                      <div className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
                                        {WEEKDAY_LABELS[it.weekday - 1]} ·{" "}
                                        {WORKOUT_LABELS[
                                          it.workout_type as keyof typeof WORKOUT_LABELS
                                        ] ?? it.workout_type}
                                        {it.title ? ` · ${it.title}` : ""}
                                      </div>
                                      <RepGroupEditor
                                        groups={it.template_rep_groups ?? []}
                                        parentIdField="template_item_id"
                                        parentId={it.id}
                                        addAction={addTemplateRepGroup}
                                        updateAction={updateTemplateRepGroup}
                                        deleteAction={deleteTemplateRepGroup}
                                      />
                                    </div>
                                  ))}
                                </div>
                              )}

                              <form
                                action={addTemplateItem}
                                className="mt-4 flex flex-wrap items-end gap-2"
                              >
                                <input type="hidden" name="template_id" value={t.id} />
                                <Field label="Dag">
                                  <select name="weekday" className={input} defaultValue="1">
                                    {WEEKDAY_LABELS.map((d, wi) => (
                                      <option key={d} value={wi + 1}>
                                        {d}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                                <Field label="Pass">
                                  <select name="slot" className={input} defaultValue="1">
                                    {[1, 2, 3].map((s) => (
                                      <option key={s} value={s}>
                                        {SLOT_LABELS[s]}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                                <Field label="Typ">
                                  <select name="workout_type" className={input} defaultValue="easy">
                                    {WORKOUT_TYPES.map((w) => (
                                      <option key={w} value={w}>
                                        {WORKOUT_LABELS[w]}
                                      </option>
                                    ))}
                                  </select>
                                </Field>
                                <Field label="Rubrik">
                                  <input name="title" placeholder="10x400m" className={input} />
                                </Field>
                                <Field label="Minuter">
                                  <input
                                    name="target_duration_minutes"
                                    type="number"
                                    min="0"
                                    className={`${input} w-24`}
                                  />
                                </Field>
                                <button type="submit" className={ghostBtn}>
                                  Lägg till pass
                                </button>
                              </form>

                              <form action={deleteTemplate} className="mt-3">
                                <input type="hidden" name="id" value={t.id} />
                                <button
                                  type="submit"
                                  className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                                >
                                  Ta bort hela mallen
                                </button>
                              </form>
                            </details>
                          );
                        })}
                      </div>

                      <form
                        action={createTemplate}
                        className="mt-3 flex flex-wrap items-end gap-3"
                      >
                        <input type="hidden" name="block_type" value={b.block_type} />
                        <Field label="Ny mall för den här blocktypen">
                          <input
                            name="name"
                            required
                            placeholder="Grundvecka med dubbeltröskel"
                            className={input}
                          />
                        </Field>
                        <button type="submit" className={ghostBtn}>
                          Skapa mall
                        </button>
                      </form>
                    </div>

                    <form action={deleteBlock}>
                      <input type="hidden" name="id" value={b.id} />
                      <button
                        type="submit"
                        className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        Ta bort block
                      </button>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
        )}

        <details className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Lägg till block för hand
          </summary>
          <form action={createBlock} className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Namn">
              <input name="name" required placeholder="Grundträning 1" className={input} />
            </Field>
            <Field label="Typ">
              <select name="block_type" className={input} defaultValue="grund">
                {BLOCK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {BLOCK_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Säsong">
              <select name="season" className={input} defaultValue="">
                <option value="">Ingen</option>
                <option value="indoor">{SEASON_LABELS.indoor}</option>
                <option value="outdoor">{SEASON_LABELS.outdoor}</option>
              </select>
            </Field>
            <Field label="Från">
              <input
                type="date"
                name="start_date"
                required
                defaultValue={nyttBlockFranParam ?? undefined}
                className={input}
              />
            </Field>
            <Field label="Till">
              <input type="date" name="end_date" required className={input} />
            </Field>
            <Field label="Fokus">
              <input name="focus" placeholder="Tröskelvolym, 2 pass/vecka" className={input} />
            </Field>
            <button type="submit" className={primaryBtn}>
              Lägg till
            </button>
          </form>
          <dl className="mt-4 grid grid-cols-1 gap-1 text-xs text-zinc-500 sm:grid-cols-2 dark:text-zinc-400">
            {BLOCK_TYPES.map((t) => (
              <div key={t}>
                <dt className="inline font-medium text-zinc-700 dark:text-zinc-300">
                  {BLOCK_LABELS[t]}:{" "}
                </dt>
                <dd className="inline">{BLOCK_INTENT[t]}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      {/* ---------------- Tävlingar ---------------- */}
      <section id="tavlingar" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Tävlingar</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Prioriteten styr hur planeringen toppar. A är säsongens huvudmål och får en
          nedtrappning före sig; C är träningstävling och planeras rakt igenom.
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Årsväljare. Byggd ur datan (competitionYears), inte en hårdkodad
           * lista — annars slutar den fungera så fort ett nytt år börjar
           * tävlas i. "Alla år" ligger sist så historiken alltid går att nå,
           * men aldrig är förvalet. */}
          <div className="flex flex-wrap gap-1 text-sm" role="group" aria-label="Tävlingsår">
            {competitionYears.map((year) => (
              <Link
                key={year}
                href={competitionHref({ tavlingsAr: year })}
                aria-current={tavlingsAr === year ? "page" : undefined}
                className={`rounded px-3 py-1 ${
                  tavlingsAr === year
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {year} ({competitionCountsByYear.get(year)})
              </Link>
            ))}
            <Link
              href={competitionHref({ tavlingsAr: "alla" })}
              aria-current={tavlingsAr === "alla" ? "page" : undefined}
              className={`rounded px-3 py-1 ${
                tavlingsAr === "alla"
                  ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                  : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Alla år ({competitionDateRows?.length ?? 0})
            </Link>
          </div>

          <div className="flex gap-1 text-sm" role="group" aria-label="Inne eller ute">
            {(
              [
                { key: "alla", label: "Alla banor" },
                { key: "inne", label: SEASON_LABELS.indoor },
                { key: "ute", label: SEASON_LABELS.outdoor },
              ] as const
            ).map((opt) => (
              <Link
                key={opt.key}
                href={competitionHref({ tavlingsBana: opt.key })}
                aria-current={tavlingsBana === opt.key ? "page" : undefined}
                className={`rounded px-3 py-1 ${
                  tavlingsBana === opt.key
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>

        {competitionList.length === 0 && (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">
            Inga tävlingar {tavlingsAr === "alla" ? "" : `${tavlingsAr} `}
            {tavlingsBana !== "alla" ? `(${tavlingsBana === "inne" ? "inomhus" : "utomhus"}) ` : ""}
            än.
          </p>
        )}

        {competitionList.length > 0 && (
          <div className="flex flex-col gap-2">
            {competitionList.map((c) => (
              <div
                key={c.id}
                className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        c.priority === "A"
                          ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                          : c.priority === "B"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {c.priority}
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {c.competition_date}
                      {c.venue ? ` · ${SEASON_LABELS[c.venue]}` : ""}
                      {c.location ? ` · ${c.location}` : ""}
                    </span>
                  </div>
                  <form action={deleteCompetition}>
                    <input type="hidden" name="id" value={c.id} />
                    <button
                      type="submit"
                      className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      Ta bort
                    </button>
                  </form>
                </div>

                {c.competition_events.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    {c.competition_events
                      .slice()
                      .sort((a, b) => a.event.localeCompare(b.event))
                      .map((e) => (
                        <form
                          key={e.id}
                          action={saveEventResult}
                          className="flex flex-wrap items-end gap-2 text-sm"
                        >
                          <input type="hidden" name="event_id" value={e.id} />
                          <span className="w-28 font-medium text-zinc-900 dark:text-zinc-100">
                            {e.event}
                          </span>
                          <span className="text-zinc-500 dark:text-zinc-400">
                            mål {e.target_result ?? "—"}
                          </span>
                          <input
                            name="actual_result"
                            defaultValue={e.actual_result ?? ""}
                            placeholder="resultat"
                            className={`${input} w-28`}
                          />
                          <input
                            name="placement"
                            type="number"
                            min="1"
                            defaultValue={e.placement ?? ""}
                            placeholder="plats"
                            className={`${input} w-20`}
                          />
                          <button type="submit" className={ghostBtn}>
                            Spara
                          </button>
                        </form>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <details className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Lägg till tävling
          </summary>
          <form action={createCompetition} className="mt-3 flex flex-wrap items-end gap-3">
            {/* Så att createCompetition kan avgöra om det aktiva filtret
             * skulle dölja den nyskapade tävlingen och navigera om till rätt
             * år/bana i så fall — se motiveringen i actions.ts. */}
            <input type="hidden" name="current_tavlingsAr" value={tavlingsAr} />
            <input type="hidden" name="current_tavlingsBana" value={tavlingsBana} />
            <Field label="Namn">
              <input name="name" required placeholder="Inomhus-SM" className={input} />
            </Field>
            <Field label="Datum">
              <input type="date" name="competition_date" required className={input} />
            </Field>
            <Field label="Plats">
              <input name="location" placeholder="Göteborg" className={input} />
            </Field>
            <Field label="Inne/ute">
              <select name="venue" className={input} defaultValue="">
                <option value="">—</option>
                <option value="indoor">{SEASON_LABELS.indoor}</option>
                <option value="outdoor">{SEASON_LABELS.outdoor}</option>
              </select>
            </Field>
            <Field label="Prioritet">
              <select name="priority" className={input} defaultValue="C">
                {(["A", "B", "C"] as const).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grenar (komma mellan)">
              <input
                name="events"
                list="common-events"
                placeholder="1500m, 800m"
                className={input}
              />
              <datalist id="common-events">
                {COMMON_EVENTS.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>
            </Field>
            <Field label="Måltid (första grenen)">
              <input name="target_result" placeholder="4:35.00" className={input} />
            </Field>
            <button type="submit" className={primaryBtn}>
              Lägg till
            </button>
          </form>
        </details>
      </section>

      {/* ---------------- Tillgänglighet (K7) ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Tillgänglighet</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Tentaveckor, lov, läger och resor styr träningen minst lika mycket som
          periodiseringen, men syns ingen annanstans i appen. Det här är bara kontext som gör
          en avvikande vecka förklarlig i efterhand — ingen logik, inga justerade riktvärden,
          ingen påverkan på beräkningarna någon annanstans i appen.
        </p>

        {availabilityList.length > 0 && (
          <div className="flex flex-col gap-2">
            {availabilityList.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-medium"
                    style={{ border: "1px solid var(--availability-band)", color: "var(--availability-band)" }}
                  >
                    {AVAILABILITY_LABELS[p.kind]}
                  </span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {p.label ?? AVAILABILITY_LABELS[p.kind]}
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {p.start_date} – {p.end_date}
                  </span>
                </div>
                <form action={deleteAvailabilityPeriod}>
                  <input type="hidden" name="id" value={p.id} />
                  <button
                    type="submit"
                    className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    Ta bort
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        <details className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Lägg till period
          </summary>
          <form action={createAvailabilityPeriod} className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Från">
              <input type="date" name="start_date" required className={input} />
            </Field>
            <Field label="Till">
              <input type="date" name="end_date" required className={input} />
            </Field>
            <Field label="Typ">
              <select name="kind" className={input} defaultValue="skola">
                {AVAILABILITY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {AVAILABILITY_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Etikett">
              <input name="label" placeholder="Tentavecka" className={input} />
            </Field>
            <button type="submit" className={primaryBtn}>
              Lägg till
            </button>
          </form>
        </details>
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

        {allCompetitions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inga tävlingar inlagda ännu. Lägg till dem på{" "}
            <Link href="/sasongen" className="underline">
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
                {allCompetitions.map((c) => (
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
            <Link href="/sasongen" className="underline">
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
                  action="/blocket"
                  method="get"
                  className="flex flex-wrap items-end gap-3 text-sm"
                >
                  {tavlingsArParam && <input type="hidden" name="tavlingsAr" value={tavlingsArParam} />}
                  {tavlingsBanaParam && <input type="hidden" name="tavlingsBana" value={tavlingsBanaParam} />}
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
                  <button type="submit" className="w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200">
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
