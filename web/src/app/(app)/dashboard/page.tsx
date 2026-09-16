import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { DailyStatus } from "@/components/DailyStatus";
import { KpiRing } from "@/components/KpiRing";
import type { TrendDirection } from "@/components/ui/TrendMark";
import { ringFillAndStatus, type RingStatus } from "@/lib/kpi-ring";
import { BASELINE_WINDOW_DAYS, computeDailyStatus } from "@/lib/daily-status";
import { computeEfficiencyPoints, METERS_PER_BEAT } from "@/lib/efficiency";
import { median } from "@/lib/stats-utils";
import { isoWeekStart } from "@/lib/stats-utils";
import { QUALITY_WORKOUT_TYPES } from "@/lib/planning";
import { buildReadinessAlert } from "@/lib/readiness-alert";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import { toDateKey } from "@/lib/week-series";
import {
  computeContinuityStreaks,
  type ContinuitySession,
  type ContinuityStreaks,
  type InterruptionDay,
} from "@/lib/continuity";
import { getViewMode } from "@/lib/view-mode";
import { TodaySession, dayAccent, type TodayPlanned } from "@/components/TodaySession";
import { RecordCard } from "@/components/RecordCard";
import { StreakStrip, type StreakWeek } from "@/components/StreakStrip";

/* Dashboard (döpt om från /idag 2026-08-12, på uttrycklig begäran): start-
 * sidan efter inloggning (se app/page.tsx, login/actions.ts,
 * auth/confirm/route.ts). Sidorna delades om efter loopens kadenser
 * (docs/tranarloopen.md 1.1, 3.1) — kalenderns veckovy äger veckan, /trender
 * blocket, /blockoversikt säsongen. Den här sidan äger bara dagen: beredskap inför
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

/** Statusen en trend ska visas med. Två färger: rött bara för en verklig
 * försämring, grönt för allt annat.
 *
 * Brusbandet låg tidigare på en egen färg — först indigo, sedan grått. Båda
 * lästes som att kortet var trasigt snarare än som ett besked, och
 * rapporterades två gånger. Ett oförändrat värde är heller inget att åtgärda,
 * vilket är precis vad grönt betyder här: inte "du har förbättrats", utan
 * "inget som kräver något av dig". Att talet står stilla syns ändå — pilen
 * blir ett streck (trendDirection) och texten säger 0.
 *
 * Grått finns kvar, men bara för "unknown": när det inte finns någon
 * förändring att bedöma alls. Det är en frånvaro av data, inte en frånvaro av
 * bedömning, och då är ett neutralt kort rätt svar. */
function trendRingStatus(change: number | null, noiseThreshold: number): RingStatus {
  if (change == null) return "unknown";
  return change <= -noiseThreshold ? "concern" : "good";
}

/** Pilens riktning för samma förändring som trendRingStatus bedömer.
 *
 * Skild funktion, samma tröskel: färgen säger OM förändringen är bra, pilen
 * säger ÅT VILKET HÅLL talet gick. För belastning kan de två peka olika, och
 * att härleda den ena ur den andra hade gjort just det omöjligt. Brus får ett
 * streck, inte en pil — annars pekar kortet åt ett håll som inte finns. */
function trendDirection(change: number | null, noiseThreshold: number): TrendDirection {
  if (change == null || Math.abs(change) < noiseThreshold) return "flat";
  return change > 0 ? "up" : "down";
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
    trend:
      pctChange != null
        ? {
            direction: trendDirection(pctChange, EF_NOISE_THRESHOLD_PCT),
            text: formatPctChange(pctChange),
          }
        : null,
    // Bara perioden kvar — talet står i symbolen och ska inte stå två gånger.
    targetText: pctChange != null ? "senaste 4 v" : undefined,
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
    trend:
      delta != null
        ? {
            direction: trendDirection(delta, VO2MAX_NOISE_THRESHOLD),
            text: `${delta >= 0 ? "+" : ""}${delta.toFixed(0)}`,
          }
        : null,
    targetText: delta != null ? `senaste ${VO2MAX_LOOKBACK_DAYS} d` : undefined,
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
    trend:
      pctChange != null
        ? {
            direction: trendDirection(pctChange, WEEKLY_NOISE_THRESHOLD_PCT),
            text: formatPctChange(pctChange),
          }
        : null,
    targetText: pctChange != null ? "mot årets snitt" : undefined,
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

export default async function DashboardPage({
  searchParams,
}: {
  /** Fas 0-uppföljning (2026-08-16): vilken löpare en coach tittar på just
   * nu — samma `athlete`-param-mönster som /blockoversikt, se lib/auth-scope.ts.
   * Ignoreras helt för en löpare (ser alltid bara sig själv). */
  searchParams: Promise<{ athlete?: string }>;
}) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null; // Layouten redirectar redan utan inloggning.
  const { athlete: athleteParam } = await searchParams;
  const runnerMode = scoped.role === "coach" && (await getViewMode()) === "runner";
  const scopedUserId = resolveScopedUserId(scoped, athleteParam, runnerMode);
  // Bifogas på sidans egna länkar (till dagvyn/veckovyn) så växlingen
  // följer med dit också — navigeringen (BottomNav) gör samma sak för
  // menylänkarna.
  const athleteQuery = scoped.role === "coach" ? `?athlete=${scopedUserId}` : "";

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
    { data: todayPlannedRows },
    { data: recentSplitRows },
  ] = await Promise.all([
    // Bara dagens aktiviteter — sidan äger dagen, inget periodfönster.
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", scopedUserId)
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
      .eq("user_id", scopedUserId)
      .gte("start_time", continuityFrom)
      .order("start_time"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type")
      .eq("user_id", scopedUserId)
      .gte("entry_date", continuityFrom)
      .in("day_type", ["sick", "injured"]),
    // P1.2-baslinjen (fysiologi) är alltid de senaste 60 dagarna.
    supabase
      .from("daily_metrics")
      .select("metric_date, sleep_seconds, sleep_score, resting_hr, hrv_overnight_avg")
      .eq("user_id", scopedUserId)
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
      .eq("user_id", scopedUserId)
      .eq("scheduled_date", tomorrowKey)
      .in("workout_type", QUALITY_WORKOUT_TYPES)
      .order("slot", { ascending: true }),
    /* Dagens planerade pass, till kortet överst. Alla typer — till skillnad
       från morgondagens fråga ovanför, som bara vill ha kvalitetspass till
       beredskapskortet. Här är ett lugnt distanspass precis lika mycket
       "dagens pass" som ett intervallpass. */
    supabase
      .from("planned_workouts")
      .select(
        "id, slot, workout_type, title, description, target_distance_meters, target_duration_seconds, " +
          "planned_rep_groups(reps, distance_meters, duration_seconds, sort_order)",
      )
      .eq("user_id", scopedUserId)
      .eq("scheduled_date", todayKey)
      .order("slot", { ascending: true }),
    /* Senaste passets varv OCH årets bästa tid på samma sträcka, i en runda.
       Jämförelsen görs i databasen: att skicka hem årets alla varv för att
       kunna säga "snabbaste i år" vore 1 242 rader för den mest aktiva
       löparen, på appens landningssida. Se migrationen för varför sträckan
       avrundas till närmaste 50 m. */
    supabase.rpc("latest_splits_with_record", { target: scopedUserId }),
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
  const tomorrowHref = `/calendar/${tomorrow.getFullYear()}/${tomorrow.getMonth() + 1}/${tomorrow.getDate()}${athleteQuery}`;

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

  /* --- Varven från senaste passet ------------------------------------- */
  // Raderna kom sorterade nyast först; alla som hör till samma aktivitet som
  // den allra senaste är det pass vi visar. Sedan vänds de till stigande
  // ordning, eftersom varv läses 1, 2, 3 — inte baklänges.
  /* Funktionen svarar bara för SENASTE passet, och bara om det har aktiva
   * varv. Ett lugnt distanspass har inga och ger noll rader — då visas ingen
   * varvsektion alls.
   *
   * Det här var en rapporterad bugg innan: koden tog det senaste passet SOM
   * HADE VARV, vilket kunde vara ett intervallpass flera dagar bak, och
   * visade alltså intervaller för en dag då löparen sprang distans. */
  type SplitRowRaw = {
    split_index: number;
    distance_meters: number | null;
    duration_seconds: number | null;
    activity_name: string | null;
    activity_category: string | null;
    started: string | null;
    previous_best: number | null;
    canonical_distance: number | null;
  };
  const latestSplits = ((recentSplitRows ?? []) as unknown as SplitRowRaw[]).slice();

  /* --- Rekordet -----------------------------------------------------------
   * Snabbaste varvet i passet, om det slår årets bästa på samma sträcka.
   * previous_best är null när det inte finns någon tidigare tid att jämföra
   * mot — då är det inte ett rekord utan ett första värde, och kortet visas
   * inte. Marginalen måste vara minst en halv sekund: Garmins varvtider är
   * inte exakta på hundradelen, och ett "rekord" på två hundradelar hade
   * dykt upp stup i kvarten och slutat betyda något. */
  const record = latestSplits
    .filter(
      (s) =>
        s.duration_seconds != null &&
        s.previous_best != null &&
        // canonical_distance är null för varv som inte är en riktig sträcka —
        // ett tidsintervalls 757 m kan varken sätta eller slå ett rekord.
        s.canonical_distance != null &&
        s.duration_seconds <= s.previous_best - 0.5,
    )
    .sort((a, b) => (a.duration_seconds as number) - (b.duration_seconds as number))[0];

  /* Senaste passet i helhet — bär varvsektionen när passet inte har några
   * repetitioner. allSessions är redan hämtad och sorterad; sista posten är
   * det senaste passet. */
  const latestSession = allSessions.length > 0 ? allSessions[allSessions.length - 1] : null;

  /* --- Sviten som rutor -------------------------------------------------- */
  // En ruta per kalendervecka bakåt, med veckans antal pass och om någon av
  // dem var kvalitet. Räknas ur allSessions, som redan är hämtad — ingen ny
  // fråga för det här.
  const QUALITY_CATEGORIES = new Set(["interval", "threshold", "race"]);
  const weekAgg = new Map<string, { sessions: number; quality: boolean }>();
  for (const s of allSessions) {
    const key = isoWeekStart(s.date);
    const cur = weekAgg.get(key) ?? { sessions: 0, quality: false };
    cur.sessions += 1;
    if (QUALITY_CATEGORIES.has(s.category)) cur.quality = true;
    weekAgg.set(key, cur);
  }
  // Sammanhängande veckoserie, så att en helt tom vecka blir en tom ruta i
  // stället för att försvinna och få sviten att se obruten ut.
  const streakWeeks: StreakWeek[] = [];
  {
    const thisWeek = isoWeekStart(todayKey);
    const cursor = new Date(`${thisWeek}T00:00:00Z`);
    cursor.setUTCDate(cursor.getUTCDate() - 7 * 13);
    for (let i = 0; i < 14; i++) {
      const key = cursor.toISOString().slice(0, 10);
      const agg = weekAgg.get(key);
      streakWeeks.push({
        weekStart: key,
        sessions: agg?.sessions ?? 0,
        quality: agg?.quality ?? false,
      });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  }

  /* Dagens kulör för HELA sidan. Samma funktion som passkortet använder. */
  const pageAccent = dayAccent(
    (todayPlannedRows ?? []) as unknown as { workout_type: string }[],
    sessions.map((s) => ({ category: s.category })),
  );

  const todayHref = `/calendar/${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}${athleteQuery}`;

  return (
    /* Hela sidan bär dagens färg, inte bara passkortet (begärt 2026-09-16).
       --day-accent kommer ur samma dayAccent() som kortet använder, så sidan
       och kortet kan aldrig visa olika färg för samma dag. Saknas den — en
       vilodag, eller inget pass alls — sätts ingen variabel, och .day-theme
       faller tillbaka på appens vanliga ytor via sina egna fallback-värden. */
    <div
      className="day-theme flex flex-1 flex-col gap-8 px-6 py-8"
      style={pageAccent ? ({ "--day-accent": pageAccent } as React.CSSProperties) : undefined}
    >
      <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Dashboard</h1>

      {/* --- Dagens pass, allra överst.
          Den första frågan en löpare har när hon öppnar appen är vad som
          gäller idag — inte hur formkurvan ser ut över sex veckor. Kortet låg
          tidigare längst NED, under tre ringsektioner och statusrutan.
          Hela kortet länkar till dagen i kalendern, där passet loggas och
          rättas. --------------------------------------------------------- */}
      <TodaySession
        planned={(todayPlannedRows ?? []) as unknown as TodayPlanned[]}
        /* Varven hör till EN aktivitet, och funktionen svarar bara för den
           allra senaste. De hängs därför bara på det pass de faktiskt kommer
           ifrån — och bara om det passet är idag. Är senaste passet från i
           går har dagens pass inga varv att visa, vilket är rätt svar. */
        done={sessions.map((s) => ({
          id: s.id,
          category: s.category,
          name: s.dominantActivity.name,
          distanceMeters: s.distanceMeters,
          durationSeconds: s.durationSeconds,
          avgHr: s.avgHr,
          zoneSeconds: [
            s.hrZone1Seconds,
            s.hrZone2Seconds,
            s.hrZone3Seconds,
            s.hrZone4Seconds,
            s.hrZone5Seconds,
          ] as [number, number, number, number, number],
          splits:
            latestSession?.id === s.id
              ? latestSplits.map((r) => ({
                  splitIndex: r.split_index,
                  distanceMeters: r.distance_meters,
                  durationSeconds: r.duration_seconds,
                  canonicalDistance: r.canonical_distance,
                }))
              : [],
        }))}
        href={todayHref}
      />


      {/* --- Status mot baslinje (P1.2), plats två direkt efter dagens pass.
          Ersätter den råa nyckeltalsraden som låg här: den visade samma tre
          mått (HRV, vilopuls, sömnpoäng) men bara som dagens siffra. Samma
          plats säger mer när talet ställs mot den egna baslinjen — "80 ms"
          betyder ingenting utan "normalt 74". Två rader med samma mätvärden
          strax under varandra var dessutom ren dubblering. ------------- */}
      {/* Rekordet före varven: slog man något ska det vara det första man ser,
          inte något man hittar efter att ha läst en stapellista. */}
      {record && (
        <RecordCard
          distanceMeters={record.canonical_distance as number}
          durationSeconds={record.duration_seconds as number}
          previousBest={record.previous_best as number}
        />
      )}

      {/* Varven direkt under dagens pass: det är de två sakerna en löpare
          öppnar appen för — vad ska jag göra, och hur gick det sist.
          Ritas bara när passet faktiskt har varv; ett lugnt distanspass har
          inga, och en tom rubrik är värre än ingen. */}
      <StreakStrip
        currentWeeks={continuity.currentWeeksWithoutInterruption}
        bestWeeks={continuity.bestWeeksWithoutInterruption}
        weeks={streakWeeks}
      />


      {/* --- Form och kondition: överst på sidan, egen sektion. Långa
          horisontmått precis som Kontinuitet nedan — formkurvan och VO2max
          ändras inte dag för dag, så de hör hemma bredvid varandra, inte i
          "dagens" brus. --------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">Form och kondition</h2>
        {/* Rutnät och inte flexrad: lika breda kort som radbryter jämnt, i
            stället för kort vars bredd styrs av hur långt mätvärdet råkar
            vara. */}
        <div className="day-grid grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
          {formRings.map((r) => (
            <KpiRing key={r.label} {...r} />
          ))}
        </div>
      </section>

      {/* --- Volym och belastning: egen sektion, rullande 7 dagar mot årets
          snitt per vecka (P1.5) — flyttad hit från den borttagna /veckan
          2026-08-13. ---------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">Volym och belastning</h2>
        {/* Rutnät och inte flexrad: lika breda kort som radbryter jämnt, i
            stället för kort vars bredd styrs av hur långt mätvärdet råkar
            vara. */}
        <div className="day-grid grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
          {volumeRings.map((r) => (
            <KpiRing key={r.label} {...r} />
          ))}
        </div>
      </section>

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

      {/* Kontinuitetssektionen togs bort 2026-09-16 (begärt). Den visade
          samma svit som "Din svit" högre upp, fast som två nyckeltalskort med
          en ring runt — samma siffra två gånger på samma sida. Rutorna är det
          som faktiskt blev läst, så de fick stanna.
          Byggarfunktionen är borttagen med. Underlaget (computeContinuity)
          räknas fortfarande och driver rutorna, så måtten finns kvar om
          korten någon gång ska tillbaka. ------------------------------- */}

      {/* Status sist (2026-09-16, begärt). Den svarar på "hur mår jag", vilket
          är en bakgrundsfråga — den styr inte vad man gör idag, den färgar hur
          man läser resten. Överst tog den plats från dagens pass, som är det
          man öppnar appen för. */}
      <DailyStatus status={dailyStatus} periodLabel={statusPeriodLabel} />

      {/* --- Utgången: loopens nästa steg efter dagen är veckan. /veckan togs
          bort 2026-08-13 (dubblerade kalenderns veckovy) — länken pekar dit
          i stället. ---------------------------------------------------- */}
      <Link
        href={`/calendar/vecka/${todayKey}${athleteQuery}`}
        className="w-fit text-sm underline text-[var(--ink-2)] hover:text-[var(--foreground)]"
      >
        Veckans genomgång →
      </Link>
    </div>
  );
}
