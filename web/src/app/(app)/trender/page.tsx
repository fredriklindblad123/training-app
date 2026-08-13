import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildInsights, insightsForPhase } from "@/lib/insights";
import { InsightCard } from "@/components/InsightCard";
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
import { EfficiencyChart, type EfficiencyRace } from "@/components/charts/EfficiencyChart";
import { computeEfficiencyPoints } from "@/lib/efficiency";
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
  isoWeekStart,
  mean,
  median,
  weekLabel,
} from "@/lib/stats-utils";
import { SessionQuality, type SignatureGroup } from "@/components/SessionQuality";
import { groupBySignature, toOccurrence, type SignatureLap } from "@/lib/session-signature";
import {
  addDays as planAddDays,
  BLOCK_LABELS,
  type BlockType,
} from "@/lib/planning";
import { matchPlanToSessions, summarizeCompliance, type PlannedWorkout } from "@/lib/plan-matching";
import { ComplianceCard } from "@/components/ComplianceCard";
import {
  buildWeekSeries,
  buildWeekSeriesForRange,
  toDateKey,
  weekRangeLabel,
} from "@/lib/week-series";

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

/** Tävlingsdagar: `competitions`/`competition_events` (idrottarens egna
 * importerade resultat), INTE `activities.category === "race"`. Alice bär
 * aldrig klockan under själva loppet på bana — bara uppvärmning och nerjogg
 * spelas in, och ingetdera matchar tävlingsdetekteringen i databasen
 * (`supabase/migrations/20260725120000_activity_category.sql`). Så för
 * banlopp (majoriteten av hennes tävlingar) är `activities` blind för att en
 * tävling ens ägde rum. Vid terränglöpning/väg bär hon klockan hela loppet,
 * så där FINNS en riktig `category==="race"`-aktivitet — den täcks då redan
 * in via `competitions` om resultatet är importerat, annars fångas den av
 * unionen i `buildRaceDays` nedan.
 *
 * `competitions` är alltså den auktoritativa källan för "ägde en tävling
 * rum den här dagen"; Garmin-taggade race-pass är bara ett komplement för
 * dagar som (ännu) saknar ett importerat resultat. */
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
  }>;
}) {
  const { weeks: weeksParam, block: blockParam } = await searchParams;
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
        .select("entry_date, day_type, notes")
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
    // Tävlingsdagar från idrottarens egna importerade resultat, inte Garmin
    // — se kommentaren vid buildRaceDays.
    (() => {
      let q = supabase
        .from("competitions")
        .select("name, competition_date, competition_events(event)")
        .gte("competition_date", startDate);
      if (endDateExclusive) q = q.lt("competition_date", endDateExclusive);
      return q.order("competition_date");
    })(),
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
  // RPE/känsla kom tidigare från den dagliga incheckningen
  // (diary_entries.rpe/feeling), borttagen 2026-08-12 — fylldes i för sällan
  // för att ge meningsfull data. Källan är nu Alices egen Känsla/Upplevd
  // ansträngning-skattning i Garmin Connect-appen efter varje pass
  // (activities.garmin_feel/garmin_rpe, se migration
  // 20260812100000_garmin_feel_rpe.sql), läst av passets dominantActivity —
  // samma fragment som redan avgör passets kategori och namn på andra håll.
  const rpeByDay = new Map<string, number>();
  const feelingByDay = new Map<string, number>();
  for (const session of sessions) {
    const feel = session.dominantActivity.garmin_feel;
    const rpe = session.dominantActivity.garmin_rpe;
    if (feel != null) feelingByDay.set(session.date, feel);
    if (rpe != null) rpeByDay.set(session.date, rpe);
  }

  for (const entry of diaryEntries ?? []) {
    const day: string = entry.entry_date;
    const wk = isoWeekStart(day);
    if (entry.notes) {
      const label = `${day.slice(8, 10)}/${day.slice(5, 7)}`;
      notesByWeek.set(wk, [...(notesByWeek.get(wk) ?? []), `${label}: ${entry.notes}`]);
    }
    if (entry.day_type === "sick") {
      sickDaysByWeek.set(wk, [...(sickDaysByWeek.get(wk) ?? []), day]);
    }
    if (entry.day_type === "injured") {
      injuredDaysByWeek.set(wk, [...(injuredDaysByWeek.get(wk) ?? []), day]);
    }
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
  // Delad med /dashboard (lib/efficiency.ts) — samma pass-urval och formel överallt.
  const efPoints = computeEfficiencyPoints(sessions);

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
      label: "RPE (Garmin)",
      values: rpeWeekly,
      formatKind: "decimal1",
      higherIsBetter: false,
    },
    {
      id: "feeling",
      label: "Känsla (Garmin)",
      values: feelingWeekly,
      formatKind: "decimal1",
      higherIsBetter: true,
    },
  ];

  // Ett lager som aldrig har ett enda värde är en knapp som inte gör något.
  // Serier utan data lyfts ur diagrammet och redovisas i täckningspanelen.
  const series = candidateSeries.filter((s) => s.values.some((v) => v != null));
  const missingSeries = candidateSeries.filter((s) => s.values.every((v) => v == null));

  const raceDays = buildRaceDays(
    (competitionRows ?? []) as CompetitionLite[],
    sessions.filter((s) => s.category === "race"),
  );

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
    ...[...raceDays].map(([date, label]) => ({
      periodKey: isoWeekStart(date),
      kind: "race" as const,
      label,
    })),
  ];

  // Ingen EF-punkt krävs för att visa flaggan (EfficiencyChart ritar den som
  // en ren datummarkör) — bra så, för banlopp saknar per definition egen
  // Garmin-data att räkna EF på.
  const efRaces: EfficiencyRace[] = [...raceDays].map(([date, label]) => ({ date, label }));

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

  // L3 (docs/tranarloopen.md): insikterna överst gör att man slipper skumma
  // sidans sex sektioner för att veta vad som är värt att titta närmare på.
  // Andelen räknas som tid i zon 4+5 av veckans totala pulstid — samma
  // definition som Tröskel+-måttet använder.
  const thresholdShareWeekly = intensityWeeks.map((w) => {
    const total = w.zoneSeconds.reduce((a, b) => a + b, 0);
    return total > 0 ? (w.zoneSeconds[3] + w.zoneSeconds[4]) / total : null;
  });
  const blockInsights = insightsForPhase(
    buildInsights({ efWeekly, thresholdShareWeekly }),
    "block",
  );

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

  // Bara datumen behövs här (Datatäckning-tabellen nedan) — Korrelationer
  // (som annars byggde det här från rpeByDay) flyttades ut 2026-08-13.
  const rpeDays = new Set(rpeByDay.keys());

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
      label: "RPE (Garmin)",
      weeksWithData: countWeeksWithData(rpeWeekly),
      range: dateRange(rpeDays),
    },
    {
      label: "Känsla (Garmin)",
      weeksWithData: countWeeksWithData(feelingWeekly),
      range: dateRange(feelingByDay.keys()),
    },
  ];

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
                href={`/trender?weeks=${w}`}
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
                  href={`/trender?block=${b.id}`}
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

      {/* L3: påståenden före diagram. Sidan har sex sektioner — den här
          ytan säger vad som är värt att titta på, i stället för att man ska
          skumma alla för att upptäcka det själv. */}
      {blockInsights.length > 0 && (
        <section className="flex flex-col gap-2">
          {blockInsights.map((i) => (
            <InsightCard key={i.id} headline={i.headline} detail={i.detail} href={i.href} tone={i.tone} />
          ))}
        </section>
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

      {/* ============ P2.1: passkvalitet ============ */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Passkvalitet: återkommande nyckelpass
        </h2>
        <SessionQuality groups={signatureGroups} />
      </section>

      {/* L5 (docs/tranarloopen.md): loopens utgång. Sidan slutar med nästa
          steg, inte med sista diagrammet — det är det som gör sidorna till en
          loop i stället för fyra hus. Datumet förifylls så det nya blocket
          börjar dagen efter det nuvarande slutar, i stället för att man
          landar på ett tomt formulär och får räkna själv. */}
      {activeBlock && (
        <div className="flex flex-wrap items-center gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="flex-1">
            <p className="font-medium text-zinc-900 dark:text-zinc-100">Nästa block</p>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {activeBlock.name} slutar {activeBlock.end_date}. Utvärderingen ovan är
              underlaget för hur nästa ska se ut.
            </p>
          </div>
          <Link
            href={`/sasongen?nyttBlockFran=${toDateKey(planAddDays(new Date(`${activeBlock.end_date}T00:00:00`), 1))}`}
            className="rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Skapa nästa block →
          </Link>
        </div>
      )}


    </div>
  );
}
