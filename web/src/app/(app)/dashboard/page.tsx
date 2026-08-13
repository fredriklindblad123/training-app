import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DailyStatus } from "@/components/DailyStatus";
import { KpiRing } from "@/components/KpiRing";
import { ringFillAndStatus, type RingStatus } from "@/lib/kpi-ring";
import { BASELINE_WINDOW_DAYS, computeDailyStatus } from "@/lib/daily-status";
import { computeEfficiencyPoints, METERS_PER_BEAT } from "@/lib/efficiency";
import { median } from "@/lib/stats-utils";
import { QUALITY_WORKOUT_TYPES } from "@/lib/planning";
import { buildReadinessAlert } from "@/lib/readiness-alert";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import { toDateKey } from "@/lib/week-series";
import { formatKm, formatDuration } from "@/lib/format";
import { CATEGORY_LABELS, categoryColorVar } from "@/lib/categories";
import {
  computeContinuityStreaks,
  QUALITY_TARGET,
  type ContinuitySession,
  type ContinuityStreaks,
  type InterruptionDay,
} from "@/lib/continuity";
import { STATUS_LABEL } from "@/lib/calendar-utils";

/* Dashboard (döpt om från /idag 2026-08-12, på uttrycklig begäran): start-
 * sidan efter inloggning (se app/page.tsx, login/actions.ts,
 * auth/confirm/route.ts). Sidorna delades om efter loopens kadenser
 * (docs/tranarloopen.md 1.1, 3.1) — kalenderns veckovy äger veckan, /trender
 * blocket, /sasongen säsongen. Den här sidan äger bara dagen: beredskap inför
 * morgondagen (K3), status mot baslinjen (P1.2) och dagens pass.
 * Kontinuiteten (K6) är enda undantaget med lång horisont — den står kvar
 * som ett ankare, inte som en periodvy. Nyckeltalen visas som samma sorts
 * KPI-ring: en siffra i mitten, en ring som visar hur nära riktvärdet man
 * ligger, färgad grönt/gult/rött.
 *
 * Den dagliga incheckningen (subjektiv känsla/ansträngning) fanns tidigare
 * här men togs bort 2026-08-12 — fylldes i för sällan för att ge meningsfull
 * data. Samma sorts skattning (Känsla/Upplevd ansträngning) hämtas nu istället
 * från Garmin Connect-appens egen "Utvärdering" per pass
 * (activities.garmin_feel/garmin_rpe), och känsla ur Alices egna ord från
 * dagbokstexten (lib/diary-text.ts) — se /trender. */

/** Fallgrop 3 i K6 (tranarperspektiv.md): under den här mängden avslutade
 * veckor är "personbästa" bara brus från en kort historik — bättre att visa
 * enbart nuvarande svit utan riktvärde än att låtsas ett riktvärde finns. */
const MIN_COMPLETED_WEEKS_FOR_TARGET = 12;

/** Bygger ring-props för ett kontinuitetsmått (K6). Riktvärdet är alltid det
 * egna personbästa — det finns inget externt "rätt" antal veckor utan avbrott
 * att sikta mot.
 *
 * Ringen använder medvetet `direction: "neutral"` i stället för
 * "higher_is_better": med higher_is_better skulle en kort svit efter en
 * sjukdomsperiod färgas röd ("Avviker") jämfört med personbästa, och det är
 * exakt den dömande läsningen fallgrop 1 i K6 varnar för — sjukdom händer,
 * och ringen ska aldrig se ut som ett misslyckande för det. "neutral" ger
 * samma icke-dömande stil som Ansträngning-ringen nedan: ingen grön/gul/röd
 * bedömning, bara hur nuvarande svit förhåller sig till den längsta hittills.
 * Vad som faktiskt bröt senaste sviten står i detaljraderna, beskrivande
 * (sjukdom/skada + datum), inte som en varning. */
function continuityRing({
  label,
  currentWeeks,
  bestWeeks,
  totalCompletedWeeks,
  lastInterruption,
  hint,
}: {
  label: string;
  currentWeeks: number;
  bestWeeks: number;
  totalCompletedWeeks: number;
  lastInterruption: { date: string; dayType: "sick" | "injured" } | null;
  hint: string;
}) {
  const hasEnoughHistory = totalCompletedWeeks >= MIN_COMPLETED_WEEKS_FOR_TARGET;
  const target = hasEnoughHistory ? bestWeeks : null;
  const { fill, status } = ringFillAndStatus(currentWeeks, target, "neutral");

  return {
    label,
    valueText: String(currentWeeks),
    unit: currentWeeks === 1 ? "vecka" : "veckor",
    fill,
    status: (target == null ? "unknown" : status) as RingStatus,
    targetText: target != null ? `Bästa ${target} v` : undefined,
    detailRows: [
      { label: "Nuvarande svit", value: `${currentWeeks} v` },
      {
        label: "Personbästa",
        value: hasEnoughHistory
          ? `${bestWeeks} v`
          : `otillräcklig historik (${totalCompletedWeeks} av ${MIN_COMPLETED_WEEKS_FOR_TARGET} v)`,
      },
      {
        label: "Bröt senaste sviten",
        value: lastInterruption
          ? `${STATUS_LABEL[lastInterruption.dayType]}, ${lastInterruption.date}`
          : "Ingen svit bruten ännu",
      },
    ],
    hint,
  };
}

/** Rullande fönster, samma längd som trendlinjen i EfficiencyChart — så
 * ringen och grafen på /trender alltid pratar om samma period. En statisk
 * "hela historiken"-baslinje svarar på "var ligger jag mot mitt vanliga",
 * inte på frågan den här ringen faktiskt ska svara på: förbättrar jag mig?
 * Därför jämförs senaste fönstret alltid mot det *föregående* fönstret,
 * inte mot ett fast startvärde — jämförelsen flyttar sig framåt med tiden. */
const EF_TREND_WINDOW_DAYS = 28;
const EF_TREND_MIN_POINTS = 3;
/** Under den här förändringen räknas formen som oförändrad — EF svänger
 * naturligt någon procent mellan enskilda pass utan att något ändrats. */
const EF_NOISE_THRESHOLD_PCT = 0.02;

/** Hur långt tillbaka VO2max-ringen jämför. Garmins skattning uppdateras
 * sällan och oregelbundet, så ett kort fönster (som EF:s 28 dagar) skulle
 * ofta sakna en jämförelsepunkt helt. */
const VO2MAX_LOOKBACK_DAYS = 60;
/** Under så här stor förändring räknas konditionen som oförändrad — Garmins
 * skattning studsar ±1 mellan omräkningar utan att något faktiskt ändrats. */
const VO2MAX_NOISE_THRESHOLD = 1;

function shiftDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Statusen en trend ska visas med — good/concern är riktningen, "neutral"
 * (inte "watch") för brus: en oförändrad formkurva är inte något att hålla
 * koll på, bara ett beskrivande "ingen tydlig riktning än". */
function trendRingStatus(change: number | null, noiseThreshold: number): RingStatus {
  if (change == null) return "unknown";
  if (change >= noiseThreshold) return "good";
  if (change <= -noiseThreshold) return "concern";
  return "neutral";
}

function formatPctChange(pctChange: number): string {
  return `${pctChange >= 0 ? "+" : ""}${(pctChange * 100).toFixed(1)}%`;
}

/** Formkurvan (P1.4): senaste 4 veckorna mot de 4 veckorna innan — samma
 * pass-urval som /trender (lib/efficiency.ts), bara lugna/långa pass, så en
 * hård intervallvecka inte får kurvan att se sämre ut än den är. */
function efficiencyRing(efPoints: { date: string; ef: number }[], todayKey: string) {
  const recentFrom = shiftDateKey(todayKey, -EF_TREND_WINDOW_DAYS);
  const priorFrom = shiftDateKey(todayKey, -EF_TREND_WINDOW_DAYS * 2);

  const recent = efPoints.filter((p) => p.date >= recentFrom).map((p) => p.ef * METERS_PER_BEAT);
  const prior = efPoints
    .filter((p) => p.date >= priorFrom && p.date < recentFrom)
    .map((p) => p.ef * METERS_PER_BEAT);

  const current = recent.length >= EF_TREND_MIN_POINTS ? median(recent) : null;
  const baseline = prior.length >= EF_TREND_MIN_POINTS ? median(prior) : null;
  const pctChange =
    current != null && baseline != null && baseline > 0 ? (current - baseline) / baseline : null;

  const { fill } = ringFillAndStatus(current, baseline, "higher_is_better");
  const status = trendRingStatus(pctChange, EF_NOISE_THRESHOLD_PCT);

  return {
    label: "Formkurva",
    valueText: current != null ? current.toFixed(2) : "–",
    unit: "m/slag",
    fill,
    status,
    statusLabel: status === "neutral" ? "Oförändrad" : undefined,
    targetText: pctChange != null ? `${formatPctChange(pctChange)} senaste 4 v` : undefined,
    detailRows: [
      {
        label: `Senaste ${EF_TREND_WINDOW_DAYS} dagarna`,
        value:
          current != null
            ? `${current.toFixed(2)} m/slag (${recent.length} pass)`
            : `bygger underlag (${recent.length} av ${EF_TREND_MIN_POINTS} pass)`,
      },
      {
        label: `${EF_TREND_WINDOW_DAYS} dagarna innan dess`,
        value:
          baseline != null
            ? `${baseline.toFixed(2)} m/slag (${prior.length} pass)`
            : `bygger underlag (${prior.length} av ${EF_TREND_MIN_POINTS} pass)`,
      },
      { label: "Förändring", value: pctChange != null ? formatPctChange(pctChange) : "–" },
    ],
    hint:
      "Meter per hjärtslag på lugna/långa pass (minst 20 min), senaste 4 veckorna mot de 4 " +
      `veckorna innan — visar om du bättrar dig, inte var du ligger mot ditt vanliga. Under ±` +
      `${(EF_NOISE_THRESHOLD_PCT * 100).toFixed(0)}% räknas som brus. Hela kurvan finns på /trender.`,
  };
}

/** Kondition (VO2max): Garmins egen skattning, nu mot vad den var för ~60
 * dagar sedan — visar riktningen (blir jag bättre?), inte bara nuläget.
 * Jämförs mot faktiska värdet vid den tidpunkten, inte mot "senaste andra
 * värdet", som kan ligga hur långt eller kort tillbaka som helst beroende på
 * hur ofta klockan råkat räkna om det. */
function vo2maxRing(readings: { date: string; value: number }[], todayKey: string) {
  const current = readings.length > 0 ? readings[readings.length - 1].value : null;
  const lookbackFrom = shiftDateKey(todayKey, -VO2MAX_LOOKBACK_DAYS);

  let baseline: number | null = null;
  for (let i = readings.length - 1; i >= 0; i--) {
    if (readings[i].date <= lookbackFrom) {
      baseline = readings[i].value;
      break;
    }
  }
  const delta = current != null && baseline != null ? current - baseline : null;

  const { fill } = ringFillAndStatus(current, baseline, "higher_is_better");
  const status = trendRingStatus(delta, VO2MAX_NOISE_THRESHOLD);

  return {
    label: "Kondition",
    valueText: current != null ? String(Math.round(current)) : "–",
    unit: "VO2max",
    fill,
    status,
    statusLabel: status === "neutral" ? "Oförändrad" : undefined,
    targetText:
      delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(0)} senaste ${VO2MAX_LOOKBACK_DAYS} d` : undefined,
    detailRows: [
      { label: "Nu", value: current != null ? `${Math.round(current)} ml/kg/min` : "–" },
      {
        label: `För ~${VO2MAX_LOOKBACK_DAYS} dagar sedan`,
        value: baseline != null ? `${Math.round(baseline)} ml/kg/min` : "ingen mätning så långt tillbaka än",
      },
      { label: "Förändring", value: delta != null ? `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}` : "–" },
    ],
    hint:
      "Garmins egen konditionsskattning, nu jämfört med för ungefär två månader sedan — visar " +
      "riktningen, inte bara nuläget. Uppdateras sällan och oregelbundet, inte per pass.",
  };
}

/** Under den här förändringen räknas rullande volym/belastning som
 * oförändrad. Satt lägre än den gamla vecka-mot-vecka-jämförelsen (15%) —
 * baslinjen är nu årets snitt, ett mycket stabilare tal än förra veckan, så
 * en mindre avvikelse mot den baslinjen är redan ett meningsfullt utslag. */
const WEEKLY_NOISE_THRESHOLD_PCT = 0.08;

/** Distans/belastning (P1.5): rullande 7 dagar mot årets snitt per vecka —
 * inte förra veckan, som bara flyttar jämförelsen en vecka bakåt utan att
 * säga om nuläget faktiskt är högt eller lågt. Årssnittet ger en stabil
 * baslinje att mäta mot hela säsongen, och det rullande fönstret uppdateras
 * varje dag i stället för att hoppa i veckosteg. */
function rollingWeekRing(
  label: string,
  dailyTotals: Map<string, number>,
  todayKey: string,
  yearStartKey: string,
  formatValue: (v: number) => string,
) {
  const recentFrom = shiftDateKey(todayKey, -6);
  let recent = 0;
  for (const [date, value] of dailyTotals) {
    if (date >= recentFrom && date <= todayKey) recent += value;
  }

  let yearTotal = 0;
  for (const [date, value] of dailyTotals) {
    if (date >= yearStartKey && date <= todayKey) yearTotal += value;
  }
  const yearDays =
    Math.round(
      (new Date(`${todayKey}T00:00:00`).getTime() - new Date(`${yearStartKey}T00:00:00`).getTime()) /
        86_400_000,
    ) + 1;
  const baseline = yearDays > 0 ? (yearTotal / yearDays) * 7 : 0;
  const pctChange = baseline > 0 ? (recent - baseline) / baseline : null;

  const { fill } = ringFillAndStatus(recent, baseline, "higher_is_better");
  const status = trendRingStatus(pctChange, WEEKLY_NOISE_THRESHOLD_PCT);

  return {
    label,
    valueText: formatValue(recent),
    fill,
    status,
    statusLabel: status === "neutral" ? "Oförändrad" : undefined,
    targetText: pctChange != null ? `${formatPctChange(pctChange)} mot årets snitt` : undefined,
    detailRows: [
      { label: "Senaste 7 dagarna", value: formatValue(recent) },
      { label: "Årets snitt per vecka", value: formatValue(baseline) },
      { label: "Förändring", value: pctChange != null ? formatPctChange(pctChange) : "–" },
    ],
    hint:
      `${label} de senaste 7 dagarna jämfört med årets snitt per vecka — visar om nuläget ` +
      `faktiskt är högt eller lågt, inte bara hur det ändrats sen förra veckan. Under ±` +
      `${(WEEKLY_NOISE_THRESHOLD_PCT * 100).toFixed(0)}% räknas som brus.`,
  };
}

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // Layouten redirectar redan utan inloggning.

  const now = new Date();
  const todayKey = toDateKey(now);
  // K3: morgondagens datum, för beredskapskortet.
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowKey = toDateKey(tomorrow);
  // Gårdagens datum — inte hämtat ur en tabell, bara underlaget till
  // "andra dagen i rad" nedan (samma statusMetrics-rader, en dag tidigare).
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayKey = toDateKey(yesterday);

  // Se kommentaren vid kontinuitetsfrågan nedan. Tre år är gott om historik
  // för en 17-årings sviter och håller radantalet långt under PostgREST:s
  // tak — dagens data börjar 2025-07.
  const continuityFrom = toDateKey(new Date(now.getTime() - 3 * 365 * 86_400_000));

  const [
    { data: activityRows },
    { data: allActivityRows },
    { data: allInterruptionEntries },
    { data: statusMetrics },
    { data: tomorrowQualityWorkouts },
  ] = await Promise.all([
    // Bara dagens aktiviteter — sidan äger dagen, inget periodfönster.
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", todayKey)
      .order("start_time"),
    // Kontinuitetssviterna (K6) mäts över historiken, inte dagen — "personbästa"
    // ska vara personbästa, inte "bästa idag". Fönstret är ändå bundet, av två
    // skäl: PostgREST returnerar som mest 1 000 rader per fråga, och det finns
    // redan ~666 aktiviteter, så en ofiltrerad hämtning skulle inom ett år
    // börja trunkeras *tyst* och ge felräknade svitlängder utan att något
    // syns. Dessutom ligger den här frågan på appens landningssida och får
    // inte växa obegränsat. continuityFrom (tre år) täcker all befintlig
    // historik med marginal.
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", continuityFrom)
      .order("start_time"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type")
      .gte("entry_date", continuityFrom)
      .in("day_type", ["sick", "injured"]),
    // P1.2-baslinjen (fysiologi) är alltid de senaste 60 dagarna.
    supabase
      .from("daily_metrics")
      .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
      .gte(
        "metric_date",
        (() => {
          const d = new Date(now);
          d.setDate(d.getDate() - (BASELINE_WINDOW_DAYS + 5));
          return toDateKey(d);
        })(),
      ),
    // K3: bara morgondagens kvalitetspass, inte ett helt intervall — sidan är
    // landningssidan och ska inte hämta mer än kortet faktiskt behöver.
    // Filtret på workout_type görs redan i frågan, inte i JS efteråt, av samma
    // skäl. planned_rep_groups(*) hämtas nästlat för passignaturen (K1); en
    // saknad tabell (migrationen inte körd) ger bara ett tomt fält, inget
    // kastat fel — samma försiktiga mönster som dagvyns motsvarande fråga.
    supabase
      .from("planned_workouts")
      .select("workout_type, title, planned_rep_groups(reps, distance_meters, duration_seconds, sort_order)")
      .eq("scheduled_date", tomorrowKey)
      .in("workout_type", QUALITY_WORKOUT_TYPES)
      .order("slot", { ascending: true }),
  ]);

  // --- Status mot baslinje (P1.2) ----------------------------------------
  // Fönstret är fast på 7 dagar — det är fönstret modellen är designad för
  // mot en BASELINE_WINDOW_DAYS-dagars (60) baslinje. Innan periodväljaren
  // togs bort styrde den valda perioden det här talet, vilket gjorde
  // "nu"-fönstret rörligt utan att modellen faktiskt var det.
  const statusCurrentWindowDays = 7;
  const statusRows = (statusMetrics ?? []).map((m) => ({
    date: m.metric_date as string,
    hrv: m.hrv_overnight_avg,
    restingHr: m.resting_hr,
    sleepHours: m.sleep_seconds != null ? m.sleep_seconds / 3600 : null,
    sleepScore: m.sleep_score,
  }));
  const dailyStatus = computeDailyStatus(statusRows, todayKey, statusCurrentWindowDays);
  const statusPeriodLabel = `Senaste 7 dagarna mot din ${BASELINE_WINDOW_DAYS}-dagars baslinje`;

  // --- K3: beredskap kopplad till morgondagens pass -----------------------
  // "Andra dagen i rad" räknas ur samma markördata som dailyStatus, bara en
  // dag tidigare — ingen extra fråga, se readiness-alert.ts. Ingen egen
  // gate för baslinjen behövs: computeDailyStatus kan bara ge shouldEaseOff
  // när baslinjen redan är mogen (MIN_BASELINE_DAYS), både idag och igår.
  const wasEasingOffYesterday = computeDailyStatus(
    statusRows,
    yesterdayKey,
    statusCurrentWindowDays,
  ).shouldEaseOff;
  const readinessAlert = buildReadinessAlert(
    dailyStatus,
    tomorrowQualityWorkouts ?? [],
    wasEasingOffYesterday,
  );
  const tomorrowHref = `/calendar/${tomorrow.getFullYear()}/${tomorrow.getMonth() + 1}/${tomorrow.getDate()}`;

  // --- Pass som analysenhet (P0.5), precis som /trends -------------------
  const sessions: TrainingSession[] = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );

  // --- Kontinuitet och kvalitetssviter (K6) -------------------------------
  // Egen, ofiltrerad grund (allActivityRows/allInterruptionEntries ovan) —
  // sviterna är personbästa över hela historiken, inte bara idag.
  const allSessions: TrainingSession[] = groupActivitiesIntoSessions(
    (allActivityRows ?? []) as unknown as SessionActivity[],
  );
  const continuityInterruptions: InterruptionDay[] = (allInterruptionEntries ?? []).map((e) => ({
    date: e.entry_date as string,
    dayType: e.day_type as "sick" | "injured",
  }));
  const continuitySessions: ContinuitySession[] = allSessions.map((s) => ({
    date: s.date,
    category: s.category,
  }));
  const continuity: ContinuityStreaks = computeContinuityStreaks(
    continuityInterruptions,
    continuitySessions,
    todayKey,
  );

  // --- Form och kondition -------------------------------------------------
  // Samma treårsfönster som kontinuiteten (allSessions) — formkurvan och
  // VO2max-trenden ska kunna se bakåt, inte bara dagens/veckans data.
  const efPoints = computeEfficiencyPoints(allSessions);
  const vo2maxReadings = allSessions
    .flatMap((s) => s.activities.map((a) => ({ date: s.date, value: a.vo2max })))
    .filter((r): r is { date: string; value: number } => r.value != null)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));


  const continuityRings = [
    // K6: kontinuitet, det enda långa horisontmåttet på den här sidan (se
    // docs/tranarperspektiv.md) — räknat över hela historiken, ett ankare
    // bredvid dagens brus.
    continuityRing({
      label: "Kontinuitet",
      currentWeeks: continuity.currentWeeksWithoutInterruption,
      bestWeeks: continuity.bestWeeksWithoutInterruption,
      totalCompletedWeeks: continuity.totalCompletedWeeks,
      lastInterruption: continuity.lastInterruption,
      hint:
        "Sammanhängande avslutade veckor utan en sjuk- eller skaddag. Innevarande vecka räknas " +
        "inte förrän den är slut. En bruten svit är sjukdom eller skada, inte ett misslyckande " +
        "— se /trends för vad som brukar föregå ett avbrott.",
    }),
    continuityRing({
      label: "Kvalitetsveckor",
      currentWeeks: continuity.currentQualityWeeks,
      bestWeeks: continuity.bestQualityWeeks,
      totalCompletedWeeks: continuity.totalCompletedWeeks,
      lastInterruption: continuity.lastInterruption,
      hint:
        `Sammanhängande avslutade veckor med minst ${QUALITY_TARGET} genomförda kvalitetspass ` +
        "(tröskel, intervall, tävling eller tröskeltest). Almgren och Lindh pekar båda på att " +
        "kunna upprepa kvalitet är det som avgör, mer än ett enstaka hårt pass.",
    }),
  ];

  const formRings = [efficiencyRing(efPoints, todayKey), vo2maxRing(vo2maxReadings, todayKey)];

  // --- Volym och belastning -----------------------------------------------
  // Samma treårsfönster (allSessions) som Form och kondition ovan, summerat
  // per dag så att både det rullande 7-dagarsfönstret och årssnittet kan
  // räknas ur samma dagliga underlag.
  const yearStartKey = `${todayKey.slice(0, 4)}-01-01`;

  const dailyDistanceKm = new Map<string, number>();
  const dailyLoad = new Map<string, number>();
  for (const s of allSessions) {
    dailyDistanceKm.set(s.date, (dailyDistanceKm.get(s.date) ?? 0) + s.distanceMeters / 1000);
    dailyLoad.set(s.date, (dailyLoad.get(s.date) ?? 0) + s.trainingLoad);
  }

  const volumeRings = [
    rollingWeekRing("Distans", dailyDistanceKm, todayKey, yearStartKey, (v) =>
      v > 0 ? `${v.toFixed(1)} km` : "0 km",
    ),
    rollingWeekRing("Belastning", dailyLoad, todayKey, yearStartKey, (v) => String(Math.round(v))),
  ];

  const todayHref = `/calendar/${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Dashboard</h1>

      {/* --- Form och kondition: överst på sidan, egen sektion. Långa
          horisontmått precis som Kontinuitet nedan — formkurvan och VO2max
          ändras inte dag för dag, så de hör hemma bredvid varandra, inte i
          "dagens" brus. --------------------------------------------------- */}
      <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Form och kondition</h2>
        <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
          {formRings.map((r) => (
            <KpiRing key={r.label} {...r} />
          ))}
        </div>
      </div>

      {/* --- Volym och belastning: egen sektion, rullande 7 dagar mot årets
          snitt per vecka (P1.5) — flyttad hit från den borttagna /veckan
          2026-08-13. ---------------------------------------------------- */}
      <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Volym och belastning</h2>
        <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
          {volumeRings.map((r) => (
            <KpiRing key={r.label} {...r} />
          ))}
        </div>
      </div>

      {/* --- K3: beredskap kopplad till morgondagens pass. Visas bara när
          avvikelsen (P1.2) och ett kvalitetspass imorgon båda är sanna —
          se readiness-alert.ts. Ingen knapp som ändrar passet: beslutet är
          atletens och tränarens, appens jobb är att lägga uppgifterna
          bredvid varandra. --------------------------------------------- */}
      {readinessAlert && (
        <div className="flex flex-col gap-2 rounded border border-amber-400/60 bg-amber-50/60 p-4 dark:border-amber-500/40 dark:bg-amber-950/20">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="text-base font-medium text-amber-900 dark:text-amber-200">
              {readinessAlert.heading}
            </h2>
            <Link
              href={tomorrowHref}
              className="text-xs text-amber-800 underline hover:text-amber-950 dark:text-amber-300 dark:hover:text-amber-100"
            >
              Till morgondagens dagvy →
            </Link>
          </div>
          <p className="text-sm text-amber-900 dark:text-amber-200">{readinessAlert.markerSentence}</p>
          <p className="text-sm text-amber-900 dark:text-amber-200">
            I studier på elitlöpare är det den punkt där tränaren sänker belastningen i
            nästa pass. Värt att väga in — tillsammans med hur du faktiskt känner dig.
          </p>
        </div>
      )}

      {/* --- Kontinuitet (K6): den enda långa horisonten på den här sidan,
          ett ankare mot dagens brus. --------------------------------------- */}
      <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Kontinuitet</h2>
        <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
          {continuityRings.map((r) => (
            <KpiRing key={r.label} {...r} />
          ))}
        </div>
      </div>

      {/* --- Status mot baslinje (P1.2), fast 7-dagarsfönster -------------- */}
      <DailyStatus status={dailyStatus} periodLabel={statusPeriodLabel} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Dagens pass</h2>
        {sessions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inget pass loggat idag ännu.{" "}
            <Link href={todayHref} className="underline hover:text-zinc-950 dark:hover:text-zinc-50">
              Lägg till för hand
            </Link>
            .
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sessions.map((s) => (
              <li
                key={s.id}
                className="flex items-center justify-between gap-3 rounded border border-zinc-200 px-4 py-3 dark:border-zinc-800"
              >
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{ backgroundColor: categoryColorVar(s.category) }}
                  />
                  <div className="flex flex-col">
                    <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
                      {s.dominantActivity.name?.trim() || CATEGORY_LABELS[s.category]}
                    </span>
                    <span className="text-xs text-zinc-500 dark:text-zinc-400">
                      {CATEGORY_LABELS[s.category]}
                    </span>
                  </div>
                </div>
                <div className="text-right text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatKm(s.distanceMeters)} · {formatDuration(s.durationSeconds)}
                </div>
              </li>
            ))}
          </ul>
        )}
        <Link
          href={todayHref}
          className="w-fit text-sm underline text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
        >
          Till dagvyn →
        </Link>
      </section>

      {/* --- Utgången: loopens nästa steg efter dagen är veckan. /veckan togs
          bort 2026-08-13 (dubblerade kalenderns veckovy) — länken pekar dit
          i stället. ---------------------------------------------------- */}
      <Link
        href={`/calendar/vecka/${todayKey}`}
        className="w-fit text-sm underline text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        Veckans genomgång →
      </Link>
    </div>
  );
}
