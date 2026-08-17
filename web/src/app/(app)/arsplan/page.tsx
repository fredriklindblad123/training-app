import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  canEditPlanning,
  getScopedProfile,
  planningOwnerId,
  resolveScopedUserId,
  viewableAthletes,
} from "@/lib/auth-scope";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
import {
  SeasonTimeline,
  type TimelineBlock,
  type TimelineCompetition,
} from "@/components/SeasonTimeline";
import {
  addDays as planAddDays,
  AVAILABILITY_KINDS,
  AVAILABILITY_LABELS,
  PERIOD_LABELS,
  PERIOD_TYPES,
  PHASE_INTENT,
  PHASE_LABELS,
  PHASE_TYPES,
  SEASON_LABELS,
  toDateKey,
  weeksBetween,
  type AvailabilityKind,
  type PeriodType,
  type PhaseType,
} from "@/lib/planning";
import {
  createAvailabilityPeriod,
  createBlock,
  deleteAvailabilityPeriod,
  deleteBlock,
  updateBlock,
} from "./actions";
import { TRAINING_FACTORS, TRAINING_FACTOR_GROUP_LABELS, type TrainingFactorGroup } from "@/lib/training-factors";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import {
  addZoneSeconds,
  bandsFromZones,
  zoneTotal,
  emptyZoneSeconds,
  BAND_LABELS,
  type BandKey,
} from "@/lib/intensity";
import { formatHoursMinutes } from "@/lib/format";
import { shortDateLabel, buildWeekSeriesForRange } from "@/lib/week-series";
import { STATUS_LABEL } from "@/lib/calendar-utils";
import { BASELINE_WINDOW_DAYS } from "@/lib/daily-status";
import { coefficientOfVariation, isoWeekStart, mean } from "@/lib/stats-utils";
import { CATEGORY_LABELS, isActivityCategory, type ActivityCategory } from "@/lib/categories";
import {
  computeInterruptionPrecursor,
  groupInterruptionPeriods,
  type InterruptionPeriod,
  type InterruptionPrecursor,
} from "@/lib/interruption-timeline";
import { buildArsplanWeeks, computeMergeRuns, type ArsplanCompetitionInput } from "@/lib/arsplan-grid";
import { matchPlanToSessions, summarizeCompliance, type PlannedWorkout } from "@/lib/plan-matching";

/* Årsplan: säsongens block, standardvecka och ett rutnät som speglar
 * Excel-mallens Årsplan-flik (en kolumn per vecka) — flyttad hit ur
 * /sasongen 2026-08-17. Veckomallarnas dag-för-dag-innehåll (tidigare
 * nästlat under varje block) flyttades samtidigt till /detaljplan, som
 * speglar mallens Detaljplan-flik — se motiveringen i lib/template-sync.ts
 * och lib/arsplan-grid.ts. */

const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primaryBtn =
  "w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";

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

/** Vilka löpare ett block gäller för — bara synlig för en coach (en
 * självcoachad löpare har ingen väljare, blocket gäller alltid bara hen
 * själv, se targetAthletesFromForm i actions.ts). De flesta tränar
 * tillsammans, så samma block/mall kryssas ofta i för flera löpare i stället
 * för att matas in en gång per löpare. */
function AthleteTargetFields({
  athletes,
  selectedIds,
}: {
  athletes: { id: string; fullName: string | null }[];
  selectedIds: Set<string>;
}) {
  if (athletes.length === 0) return null;
  return (
    <fieldset className="flex flex-wrap items-center gap-3 text-sm">
      <legend className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Gäller för</legend>
      {athletes.map((a) => (
        <label key={a.id} className="flex items-center gap-1.5">
          <input type="checkbox" name="athletes" value={a.id} defaultChecked={selectedIds.has(a.id)} />
          {a.fullName ?? "Namnlös löpare"}
        </label>
      ))}
    </fieldset>
  );
}

/** Läsvy av ett block för en coachad löpare — samma innehåll som
 * redigeringsformuläret visar, men utan formulär/knappar. Planeringen ägs av
 * coachen (se canEditPlanning); löparen ska ändå se vad som väntar och
 * varför. */
function ReadOnlyBlockSummary({
  block,
  templateNames,
}: {
  block: {
    focus: string | null;
    sessions_count: number | null;
    days_count: number | null;
    starts_count: number | null;
    hours_count: number | null;
    has_test: boolean;
  };
  templateNames: string[];
}) {
  const bits = [
    block.sessions_count != null ? `${block.sessions_count} pass/vecka` : null,
    block.days_count != null ? `${block.days_count} dagar` : null,
    block.starts_count != null ? `${block.starts_count} tävlingsstarter` : null,
    block.hours_count != null ? `${block.hours_count} timmar` : null,
    block.has_test ? "test" : null,
  ].filter(Boolean);
  return (
    <div className="mt-4 flex flex-col gap-2 border-t border-zinc-100 pt-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
      {block.focus && <p>{block.focus}</p>}
      <p>{bits.length > 0 ? bits.join(" · ") : "Ingen standardvecka ifylld ännu."}</p>
      {templateNames.length > 0 && <p>Veckomallar: {templateNames.join(", ")}</p>}
    </div>
  );
}

/** Standardveckan för ett block — Årsplan-parametrarna (pass/dagar/
 * tävlingsstarter/timmar/test) gäller för varje kalendervecka inom blockets
 * datumintervall, och används som förval i rutnätet nedan tills Detaljplan
 * har fyllts i (se `usedFallback` i lib/arsplan-grid.ts). Delad mellan
 * redigerings- och skapa-formulären, så fältlistan aldrig kan glida isär
 * mellan dem. INTE träningsfaktorerna (Snabbhet/Uthållighet/...) — den
 * detaljnivån hör hemma per pass i Detaljplan, inte som en klumpsumma för
 * blocket. */
function StandardWeekFields({
  block,
}: {
  block?: {
    sessions_count: number | null;
    days_count: number | null;
    starts_count: number | null;
    hours_count: number | null;
    has_test: boolean;
  };
}) {
  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-100 p-3 dark:border-zinc-800">
      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
        Standardvecka — förval i Årsplan-rutnätet tills Detaljplan fyllts i
      </div>
      <div className="flex flex-wrap gap-3">
        <Field label="Pass">
          <input
            type="number"
            name="sessions_count"
            defaultValue={block?.sessions_count ?? ""}
            className={`${input} w-20`}
          />
        </Field>
        <Field label="Dagar">
          <input
            type="number"
            name="days_count"
            defaultValue={block?.days_count ?? ""}
            className={`${input} w-20`}
          />
        </Field>
        <Field label="Tävlingsstarter">
          <input
            type="number"
            name="starts_count"
            defaultValue={block?.starts_count ?? ""}
            className={`${input} w-20`}
          />
        </Field>
        <Field label="Timmar">
          <input
            type="number"
            step="0.5"
            name="hours_count"
            defaultValue={block?.hours_count ?? ""}
            className={`${input} w-20`}
          />
        </Field>
        <label className="flex items-center gap-1.5 self-end pb-1.5 text-sm">
          <input type="checkbox" name="has_test" defaultChecked={block?.has_test ?? false} />
          Test
        </label>
      </div>
    </div>
  );
}

// --- P1.5: blockjämförelse, flyttad hit från /trender --------------------
// Att jämföra två block hör hemma i planeringen, inte i trendanalysen —
// samma skäl som K5/K6 redan flyttades hit: "vad gav förra blocket, och hur
// ska nästa se ut" är en säsongsfråga.

type SeasonBlockRow = {
  id: string;
  name: string;
  period: PeriodType;
  phase: PhaseType;
  start_date: string;
  end_date: string;
  focus: string | null;
  sessions_count: number | null;
  days_count: number | null;
  starts_count: number | null;
  hours_count: number | null;
  has_test: boolean;
};

/** Tävlingsdagar: `competitions`/`competition_events` (idrottarens egna
 * importerade resultat), INTE `activities.category === "race"`. Se
 * motiveringen vid samma mönster i /tavlingsresultat. */
type CompetitionEventLite = { event: string };
type CompetitionLite = {
  competition_date: string;
  name: string;
  competition_events: CompetitionEventLite[];
};

function competitionLabel(c: CompetitionLite): string {
  const events = c.competition_events.map((e) => e.event).join(", ");
  return events ? `${c.name} (${events})` : c.name;
}

/** date (YYYY-MM-DD) -> läsbar tävlingsetikett. Unionen av `competitions`
 * (primär källa) och Garmin race-pass på dagar `competitions` inte täcker. */
function buildRaceDays(
  competitions: CompetitionLite[],
  raceSessions: { date: string; dominantActivity: { name: string | null } }[],
): Map<string, string> {
  const byDate = new Map<string, CompetitionLite[]>();
  for (const c of competitions) {
    byDate.set(c.competition_date, [...(byDate.get(c.competition_date) ?? []), c]);
  }
  const raceDays = new Map<string, string>();
  for (const [date, comps] of byDate) {
    raceDays.set(date, comps.map(competitionLabel).join(" + "));
  }
  for (const s of raceSessions) {
    if (!raceDays.has(s.date)) {
      raceDays.set(s.date, s.dominantActivity.name?.trim() || "Tävling");
    }
  }
  return raceDays;
}

/** Sammandrag för ett enskilt block. Räknat helt fristående från fönstret
 * ovan — jämförelsen ska kunna ställa två block mot varandra oavsett vilket
 * (om något) som är aktivt just nu. */
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
  userId: string,
  block: SeasonBlockRow,
): Promise<BlockAggregate> {
  const endExclusive = toDateKey(planAddDays(new Date(`${block.end_date}T00:00:00`), 1));

  const [
    { data: activityRows },
    { data: dailyMetrics },
    { data: diaryEntries },
    { data: availabilityRows },
    { data: competitionRows },
  ] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", userId)
      .gte("start_time", block.start_date)
      .lt("start_time", endExclusive)
      .order("start_time"),
    supabase
      .from("daily_metrics")
      .select("metric_date, sleep_seconds, resting_hr, hrv_overnight_avg")
      .eq("user_id", userId)
      .gte("metric_date", block.start_date)
      .lt("metric_date", endExclusive),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type")
      .eq("user_id", userId)
      .gte("entry_date", block.start_date)
      .lt("entry_date", endExclusive),
    // K7: överlappande tillgänglighetsperioder — se motiveringen vid
    // summarizeAvailability.
    supabase
      .from("availability_periods")
      .select("start_date, end_date, kind, label")
      .eq("user_id", userId)
      .lte("start_date", block.end_date)
      .gte("end_date", block.start_date),
    // Tävlingsdagar från idrottarens egna importerade resultat, inte Garmin
    // — se kommentaren vid buildRaceDays.
    supabase
      .from("competitions")
      .select("name, competition_date, competition_events(event)")
      .eq("user_id", userId)
      .gte("competition_date", block.start_date)
      .lt("competition_date", endExclusive),
  ]);

  const sessions = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );
  const blockWeeks = buildWeekSeriesForRange(block.start_date, block.end_date);

  const loadByWeek = new Map<string, number>();
  const loadByCategory = new Map<string, number>();
  const zones = emptyZoneSeconds();
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
  }
  const raceLabels = [
    ...buildRaceDays(
      (competitionRows ?? []) as CompetitionLite[],
      sessions.filter((s) => s.category === "race"),
    ).values(),
  ];

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
    { label: "Datumintervall", a: `${a.block.start_date} – ${a.block.end_date}`, b: `${b.block.start_date} – ${b.block.end_date}` },
    { label: "Period", a: PERIOD_LABELS[a.block.period], b: PERIOD_LABELS[b.block.period] },
    { label: "Fas", a: PHASE_LABELS[a.block.phase], b: PHASE_LABELS[b.block.phase] },
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

export default async function ArsplanPage({
  searchParams,
}: {
  searchParams: Promise<{
    /** L5: loopens utgångar landar här. /trender skickar startdatum för
     * nästa block, /veckan skickar veckan som ska planeras — så man möter ett
     * förifyllt formulär i stället för sidans topp och en tom ruta. */
    nyttBlockFran?: string;
    vecka?: string;
    /** P1.5: blockjämförelsen, flyttad hit från /trender. */
    compareA?: string;
    compareB?: string;
    /** Fas 0: vilken löpare en coach tittar på just nu. Ignoreras helt för
     * en löpare (ser alltid bara sig själv) — se lib/auth-scope.ts. */
    athlete?: string;
  }>;
}) {
  const supabase = await createClient();
  const today = toDateKey(new Date());
  const {
    nyttBlockFran: nyttBlockFranParam,
    compareA: compareAParam,
    compareB: compareBParam,
    athlete: athleteParam,
  } = await searchParams;

  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null; // Layouten redirectar redan utan inloggning.
  const scopedUserId = resolveScopedUserId(scoped, athleteParam);
  // Vem som äger block/mallar (coachen för delad planering, löparen själv
  // annars) — inte nödvändigtvis samma som scopedUserId, se planningOwnerId.
  // canEdit styr om redigeringsformulären visas alls (RLS är den faktiska
  // spärren, se migration 20260816100000).
  const owner = planningOwnerId(scoped);
  const canEdit = canEditPlanning(scoped);

  // Block är kopplade till löpare via season_block_athletes, inte user_id
  // (samma block kan gälla flera löpare) — ett separat steg före
  // Promise.all nedan, eftersom season_blocks-frågan beror på resultatet.
  const { data: blockAthleteRows } = await supabase
    .from("season_block_athletes")
    .select("block_id")
    .eq("athlete_id", scopedUserId);
  const blockIds = [...new Set((blockAthleteRows ?? []).map((r) => r.block_id as string))];

  const [
    { data: blocks },
    { data: templates },
    { data: plannedCounts },
    { data: blockTemplateLinks },
    { data: availabilityPeriods },
    { data: timelineCompetitionRows },
    { data: nextACompetition },
    { data: blockMembership },
  ] = await Promise.all([
    blockIds.length > 0
      ? supabase.from("season_blocks").select("*").in("id", blockIds).order("start_date")
      : Promise.resolve({ data: [] as never[] }),
    // Bara namn+fas här — dag-för-dag-innehållet redigeras på /detaljplan.
    // Mallar ägs av samma person som blocken (owner), inte nödvändigtvis den
    // löpare som råkar vara vald i växlaren — se planningOwnerId.
    supabase.from("week_templates").select("id, name, phase").eq("user_id", owner),
    supabase
      .from("planned_workouts")
      .select("scheduled_date")
      .eq("user_id", scopedUserId)
      .gte("scheduled_date", today),
    // Vilka mallar som redan rullats ut i vilket block — härlett ur de
    // planerade passens egna block_id/template_id, eftersom det inte finns
    // någon separat koppling lagrad någon annanstans (se applyTemplate).
    supabase
      .from("planned_workouts")
      .select("block_id, template_id")
      .eq("user_id", scopedUserId)
      .not("block_id", "is", null)
      .not("template_id", "is", null),
    // K7: migrationen är inte körd (se AGENTS/uppdraget) — en saknad tabell
    // ger bara { data: null, error }, aldrig ett kastat fel, och `?? []`
    // nedan faller tillbaka till "inga perioder" precis som övriga frågor
    // på den här sidan gör för sina egna eventuellt okörda tabeller.
    supabase.from("availability_periods").select("*").eq("user_id", scopedUserId).order("start_date"),
    // Till tidslinjens markörer (SeasonTimeline) OCH Årsplan-rutnätets
    // tävlingsrad — competition_events(event) hämtas med här så rutnätet
    // slipper en egen fråga. Att lägga till/redigera/logga resultat för en
    // tävling flyttade till /tavlingsresultat 2026-08-16 (retrospektivt,
    // inte säsongsplanering).
    supabase
      .from("competitions")
      .select("id, name, competition_date, priority, venue, competition_events(event)")
      .eq("user_id", scopedUserId)
      .order("competition_date"),
    // "Nästa A-tävling" i läget-just-nu-korten — egen liten fråga (bara
    // namn+datum, inte hela raden) i stället för att leta i
    // timelineCompetitionRows. Träffar aldrig fler än en rad.
    supabase
      .from("competitions")
      .select("name, competition_date")
      .eq("user_id", scopedUserId)
      .eq("priority", "A")
      .gte("competition_date", today)
      .order("competition_date")
      .limit(1)
      .maybeSingle(),
    // Vilka löpare varje block gäller för — bara relevant för
    // kryssrutorna i redigeringsformuläret (bara en coach ser dem), men
    // hämtas alltid, samma "tomt är ofarligt"-mönster som resten av sidan.
    blockIds.length > 0
      ? supabase.from("season_block_athletes").select("block_id, athlete_id").in("block_id", blockIds)
      : Promise.resolve({ data: [] as { block_id: string; athlete_id: string }[] }),
  ]);

  const athleteIdsByBlockId = new Map<string, Set<string>>();
  for (const row of blockMembership ?? []) {
    const set = athleteIdsByBlockId.get(row.block_id as string) ?? new Set<string>();
    set.add(row.athlete_id as string);
    athleteIdsByBlockId.set(row.block_id as string, set);
  }

  /** Byter vilken löpare en coach tittar på, behåller övriga val oförändrade.
   * No-op-länk (samma URL) för en löpare, som aldrig ser väljaren över
   * huvud taget. */
  function athleteHref(id: string): string {
    const params = new URLSearchParams();
    params.set("athlete", id);
    return `/arsplan?${params.toString()}`;
  }

  // TimelineBlock beskriver bara det tidslinjen behöver; sidan visar även
  // fokustexten, därav den utökade typen här. Samma form täcker också
  // ArsplanBlockInput (lib/arsplan-grid.ts) rakt av.
  const blockList = (blocks ?? []) as (TimelineBlock & { focus: string | null })[];
  const competitionList = (timelineCompetitionRows ?? []) as (TimelineCompetition & {
    competition_events: { event: string }[];
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

  // --- Årsplan-rutnät (speglar Excel-mallens Årsplan-flik) -----------------
  // Samma datamodul som Excel-exporten (flerarsplan/export/route.ts)
  // använder, se lib/arsplan-grid.ts — de kan aldrig visa olika siffror för
  // samma data. Bara planned_workouts/competitions i blockens datumspann
  // behövs, inte hela historiken.
  const gridMinDate = blockList.reduce((m, b) => (b.start_date < m ? b.start_date : m), blockList[0]?.start_date ?? "");
  const gridMaxDate = blockList.reduce((m, b) => (b.end_date > m ? b.end_date : m), blockList[0]?.end_date ?? "");

  const [{ data: gridWorkoutRows }, { data: gridActivityRows }] =
    blockList.length === 0
      ? [{ data: [] }, { data: [] }]
      : await Promise.all([
          supabase
            .from("planned_workouts")
            .select("id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds, training_factor")
            .eq("user_id", scopedUserId)
            .gte("scheduled_date", gridMinDate)
            .lte("scheduled_date", gridMaxDate),
          supabase
            .from("activities")
            .select(SESSION_ACTIVITY_COLUMNS)
            .eq("user_id", scopedUserId)
            .gte("start_time", gridMinDate)
            .order("start_time"),
        ]);

  const gridPlannedWorkouts = (gridWorkoutRows ?? []) as (PlannedWorkout & { training_factor: string | null })[];
  const arsplanWeeks = buildArsplanWeeks(
    blockList,
    gridPlannedWorkouts,
    (competitionList ?? []) as ArsplanCompetitionInput[],
  );

  // Utfall per vecka (mervärdet jämfört med Excel: planen syns bredvid vad
  // som faktiskt genomfördes, utan att man behöver jämföra två dokument).
  // matchPlanToSessions/summarizeCompliance är samma rena funktioner
  // kalenderns dag/veckovy och /trender redan använder, se lib/plan-matching.ts.
  const gridSessions = groupActivitiesIntoSessions(
    (gridActivityRows ?? []) as unknown as SessionActivity[],
  );
  const gridMatches = matchPlanToSessions(gridPlannedWorkouts, gridSessions);
  const matchesByWeek = new Map<string, typeof gridMatches>();
  for (const m of gridMatches) {
    const date = m.planned?.scheduled_date ?? m.session?.date;
    if (!date) continue;
    const wk = isoWeekStart(date);
    matchesByWeek.set(wk, [...(matchesByWeek.get(wk) ?? []), m]);
  }
  const complianceByWeek = new Map(
    [...matchesByWeek.entries()].map(([wk, matches]) => [wk, summarizeCompliance(matches)]),
  );

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
  ] = await Promise.all([
    supabase
      .from("diary_entries")
      .select("entry_date, day_type, notes")
      .eq("user_id", scopedUserId)
      .gte("entry_date", timelineLookbackFrom)
      .order("entry_date"),
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", scopedUserId)
      .gte("start_time", timelineLookbackFrom)
      .order("start_time"),
    supabase
      .from("daily_metrics")
      .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
      .eq("user_id", scopedUserId)
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

  // --- P1.5: blockjämförelse ----------------------------------------------
  // Fristående från allt ovan — man kan jämföra två gamla block oavsett
  // vilket (om något) som är aktivt just nu.
  const compareBlockA = compareAParam ? (blockList.find((b) => b.id === compareAParam) ?? null) : null;
  const compareBlockB = compareBParam ? (blockList.find((b) => b.id === compareBParam) ?? null) : null;
  const [compareAggregateA, compareAggregateB] =
    compareBlockA && compareBlockB && compareBlockA.id !== compareBlockB.id
      ? await Promise.all([
          loadBlockAggregate(supabase, scopedUserId, compareBlockA),
          loadBlockAggregate(supabase, scopedUserId, compareBlockB),
        ])
      : [null, null];

  return (
    <div className="flex flex-1 flex-col gap-10 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Årsplan</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Lägg upp säsongen i block och låt planeringen skärpas ju närmare tävlingarna du
          kommer. Dag-för-dag-innehållet i varje veckomall redigeras på{" "}
          <Link href="/detaljplan" className="underline">
            Detaljplan
          </Link>
          .
        </p>
      </div>

      {/* Fas 0: löparväljare, bara synlig för en coach. En löpare ser aldrig
          det här — hen är alltid sig själv (se lib/auth-scope.ts). */}
      {scoped.role === "coach" && (
        <AthleteSwitcher
          athletes={viewableAthletes(scoped)}
          activeId={scopedUserId}
          viewerUserId={scoped.userId}
          buildHref={athleteHref}
        />
      )}

      {/* ---------------- Läget just nu ---------------- */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Aktuellt block</div>
          <div className="mt-1 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {activeBlock ? activeBlock.name : "Inget block"}
          </div>
          {activeBlock && (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {PHASE_LABELS[activeBlock.phase]} · slutar {activeBlock.end_date}
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
        <SeasonTimeline blocks={blockList} competitions={competitionList} />
      </section>

      {/* ---------------- Årsplan-rutnät ---------------- */}
      {arsplanWeeks.length > 0 && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Årsplan</h2>
            <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
              En kolumn per vecka, precis som Excel-mallens Årsplan-flik. Pass/dagar/timmar
              räknas live ur faktiskt utrullade pass när Detaljplan är ifylld för veckan
              (nedtonat = fortfarande bara standardveckans förval). Utfall visar hur många av
              veckans planerade pass som faktiskt genomfördes.
            </p>
          </div>
          <div className="w-full max-w-full overflow-x-auto">
            <table className="w-max min-w-full text-left text-xs">
              <tbody className="[&_tr]:border-t [&_tr]:border-zinc-100 dark:[&_tr]:border-zinc-800">
                <tr className="font-medium text-zinc-900 dark:text-zinc-100">
                  <th scope="row" className="sticky left-0 bg-white py-1 pr-4 font-medium dark:bg-zinc-950">
                    Vecka #
                  </th>
                  {arsplanWeeks.map((w) => (
                    <td key={w.weekStart} className="py-1 pr-3 tabular-nums">
                      {w.isoWeekNumber}
                    </td>
                  ))}
                </tr>
                <tr className="text-zinc-500 dark:text-zinc-400">
                  <th scope="row" className="sticky left-0 bg-white py-1 pr-4 font-normal dark:bg-zinc-950">
                    Månad
                  </th>
                  {arsplanWeeks.map((w) => (
                    <td key={w.weekStart} className="py-1 pr-3">
                      {w.monthLabel}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="sticky left-0 bg-white py-1 pr-4 font-normal text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                    Period / fas
                  </th>
                  {(() => {
                    const runs = computeMergeRuns(arsplanWeeks);
                    const runByStart = new Map(runs.map((r) => [r.startIndex, r]));
                    const covered = new Set<number>();
                    for (const r of runs) for (let i = r.startIndex; i < r.startIndex + r.length; i++) covered.add(i);
                    return arsplanWeeks.map((w, i) => {
                      if (covered.has(i) && !runByStart.has(i)) return null;
                      const run = runByStart.get(i);
                      return (
                        <td
                          key={w.weekStart}
                          colSpan={run?.length ?? 1}
                          className="py-1 pr-3 text-zinc-600 dark:text-zinc-400"
                        >
                          {w.block ? `${PERIOD_LABELS[w.block.period]} · ${PHASE_LABELS[w.block.phase]}` : "–"}
                        </td>
                      );
                    });
                  })()}
                </tr>
                <tr>
                  <th scope="row" className="sticky left-0 bg-white py-1 pr-4 font-normal text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                    Pass
                  </th>
                  {arsplanWeeks.map((w) => (
                    <td key={w.weekStart} className={`py-1 pr-3 tabular-nums ${w.usedFallback ? "text-zinc-400 italic dark:text-zinc-600" : ""}`}>
                      {w.sessionsCount || "–"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="sticky left-0 bg-white py-1 pr-4 font-normal text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                    Dagar
                  </th>
                  {arsplanWeeks.map((w) => (
                    <td key={w.weekStart} className={`py-1 pr-3 tabular-nums ${w.usedFallback ? "text-zinc-400 italic dark:text-zinc-600" : ""}`}>
                      {w.daysCount || "–"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="sticky left-0 bg-white py-1 pr-4 font-normal text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                    Timmar
                  </th>
                  {arsplanWeeks.map((w) => (
                    <td key={w.weekStart} className={`py-1 pr-3 tabular-nums ${w.usedFallback ? "text-zinc-400 italic dark:text-zinc-600" : ""}`}>
                      {w.hoursCount ? (Math.round(w.hoursCount * 10) / 10) : "–"}
                    </td>
                  ))}
                </tr>
                <tr>
                  <th scope="row" className="sticky left-0 bg-white py-1 pr-4 font-normal text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                    Tävlingsstarter
                  </th>
                  {arsplanWeeks.map((w) => (
                    <td key={w.weekStart} className="py-1 pr-3 tabular-nums">
                      {w.startsCount || "–"}
                    </td>
                  ))}
                </tr>
                <tr className="font-medium text-zinc-900 dark:text-zinc-100">
                  <th scope="row" className="sticky left-0 bg-white py-1 pr-4 font-medium dark:bg-zinc-950">
                    Utfall
                  </th>
                  {arsplanWeeks.map((w) => {
                    const c = complianceByWeek.get(w.weekStart);
                    return (
                      <td key={w.weekStart} className="py-1 pr-3 tabular-nums">
                        {c && c.plannedCount > 0 ? `${c.completedCount}/${c.plannedCount}` : "–"}
                      </td>
                    );
                  })}
                </tr>
                {(() => {
                  let lastGroup: TrainingFactorGroup | null = null;
                  return TRAINING_FACTORS.flatMap((factor) => {
                    const rows = [];
                    if (factor.group !== lastGroup) {
                      rows.push(
                        <tr key={`group-${factor.group}`}>
                          <th
                            scope="row"
                            colSpan={arsplanWeeks.length + 1}
                            className="sticky left-0 bg-white py-1 text-left font-medium italic text-zinc-500 dark:bg-zinc-950 dark:text-zinc-400"
                          >
                            {TRAINING_FACTOR_GROUP_LABELS[factor.group]}
                          </th>
                        </tr>,
                      );
                      lastGroup = factor.group;
                    }
                    rows.push(
                      <tr key={factor.key}>
                        <th scope="row" className="sticky left-0 bg-white py-1 pr-4 font-normal text-zinc-600 dark:bg-zinc-950 dark:text-zinc-400">
                          {factor.label}
                        </th>
                        {arsplanWeeks.map((w) => (
                          <td key={w.weekStart} className="py-1 pr-3 tabular-nums">
                            {w.factorCounts[factor.key] ?? ""}
                          </td>
                        ))}
                      </tr>,
                    );
                    return rows;
                  });
                })()}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* ---------------- Block ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Block</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Klicka på ett block för att redigera det. Veckomallarnas dag-för-dag-innehåll
          hanteras på <Link href="/detaljplan" className="underline">Detaljplan</Link> — ett
          pass som läggs till där dyker automatiskt upp i kalendern för varje block av samma fas.
        </p>

        {blockList.length > 0 && (
          <div className="flex flex-col gap-2">
            {blockList.map((b) => {
              const linkedNames = [...(templateIdsByBlock.get(b.id) ?? [])]
                .map((id) => templateNameById.get(id))
                .filter((n): n is string => n != null);
              // Mallar hör till en fas, inte till ett specifikt block — samma
              // mall kan återanvändas av flera block av samma fas över
              // säsonger. Bara namnen listas här, se /detaljplan för innehåll.
              const matchingTemplateNames = (templates ?? [])
                .filter((t) => t.phase === b.phase)
                .map((t) => t.name as string);

              return (
                <details
                  key={b.id}
                  className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{b.name}</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {PERIOD_LABELS[b.period]} · {PHASE_LABELS[b.phase]}
                      {b.season ? ` · ${SEASON_LABELS[b.season]}` : ""} · {b.start_date} –{" "}
                      {b.end_date} · {weeksBetween(b.start_date, b.end_date)} veckor
                      {linkedNames.length > 0 ? ` · ${linkedNames.join(", ")}` : ""}
                    </span>
                  </summary>

                  {canEdit ? (
                  <div className="mt-4 flex flex-col gap-4">
                    <form
                      action={updateBlock}
                      className="flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800"
                    >
                      <input type="hidden" name="id" value={b.id} />
                      <div className="flex flex-wrap items-end gap-3">
                        <Field label="Namn">
                          <input name="name" defaultValue={b.name} required className={input} />
                        </Field>
                        <Field label="Period">
                          <select name="period" defaultValue={b.period} className={input}>
                            {PERIOD_TYPES.map((p) => (
                              <option key={p} value={p}>
                                {PERIOD_LABELS[p]}
                              </option>
                            ))}
                          </select>
                        </Field>
                        <Field label="Fas">
                          <select name="phase" defaultValue={b.phase} className={input}>
                            {PHASE_TYPES.map((p) => (
                              <option key={p} value={p}>
                                {PHASE_LABELS[p]}
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
                      </div>

                      {scoped.role === "coach" && (
                        <AthleteTargetFields
                          athletes={viewableAthletes(scoped)}
                          selectedIds={athleteIdsByBlockId.get(b.id) ?? new Set()}
                        />
                      )}

                      <StandardWeekFields block={b} />

                      <button type="submit" className={`${primaryBtn} self-start`}>
                        Spara ändringar
                      </button>
                    </form>

                    <div className="border-t border-zinc-100 pt-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                      {matchingTemplateNames.length > 0 ? (
                        <p>
                          Veckomallar: {matchingTemplateNames.join(", ")} ·{" "}
                          <Link href="/detaljplan" className="underline">
                            Redigera i Detaljplan →
                          </Link>
                        </p>
                      ) : (
                        <p>
                          Ingen veckomall för {PHASE_LABELS[b.phase]} än ·{" "}
                          <Link href="/detaljplan" className="underline">
                            Skapa en i Detaljplan →
                          </Link>
                        </p>
                      )}
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
                  ) : (
                    <ReadOnlyBlockSummary block={b} templateNames={matchingTemplateNames} />
                  )}
                </details>
              );
            })}
          </div>
        )}

        {canEdit && (
        <details className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Lägg till block för hand
          </summary>
          <form action={createBlock} className="mt-3 flex flex-col gap-3">
            <div className="flex flex-wrap items-end gap-3">
              <Field label="Namn">
                <input name="name" required placeholder="Grundträning 1" className={input} />
              </Field>
              <Field label="Period">
                <select name="period" className={input} defaultValue="forberedelse">
                  {PERIOD_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {PERIOD_LABELS[p]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fas">
                <select name="phase" className={input} defaultValue="allman">
                  {PHASE_TYPES.map((p) => (
                    <option key={p} value={p}>
                      {PHASE_LABELS[p]}
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
            </div>

            {scoped.role === "coach" && (
              <AthleteTargetFields
                athletes={viewableAthletes(scoped)}
                selectedIds={new Set([scopedUserId])}
              />
            )}

            <StandardWeekFields />

            <button type="submit" className={`${primaryBtn} self-start`}>
              Lägg till
            </button>
          </form>
          <dl className="mt-4 grid grid-cols-1 gap-1 text-xs text-zinc-500 sm:grid-cols-2 dark:text-zinc-400">
            {PHASE_TYPES.map((p) => (
              <div key={p}>
                <dt className="inline font-medium text-zinc-700 dark:text-zinc-300">
                  {PHASE_LABELS[p]}:{" "}
                </dt>
                <dd className="inline">{PHASE_INTENT[p]}</dd>
              </div>
            ))}
          </dl>
        </details>
        )}
      </section>

      {/* ---------------- Jämför block (P1.5) ---------------- */}
      {blockList.length >= 2 && (
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

          <form action="/arsplan" method="get" className="flex flex-wrap items-end gap-3 text-sm">
            {athleteParam && <input type="hidden" name="athlete" value={athleteParam} />}
            <label className="flex flex-col gap-1">
              <span className="text-zinc-600 dark:text-zinc-400">Block A</span>
              <select
                name="compareA"
                defaultValue={compareAParam ?? ""}
                className={input}
              >
                <option value="" disabled>
                  Välj block
                </option>
                {blockList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({PHASE_LABELS[b.phase]}, {b.start_date} – {b.end_date})
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-zinc-600 dark:text-zinc-400">Block B</span>
              <select
                name="compareB"
                defaultValue={compareBParam ?? ""}
                className={input}
              >
                <option value="" disabled>
                  Välj block
                </option>
                {blockList.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name} ({PHASE_LABELS[b.phase]}, {b.start_date} – {b.end_date})
                  </option>
                ))}
              </select>
            </label>
            <button type="submit" className={primaryBtn}>
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
            <input type="hidden" name="athlete" value={scopedUserId} />
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
    </div>
  );
}
