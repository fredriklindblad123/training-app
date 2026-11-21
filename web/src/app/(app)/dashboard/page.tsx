import { fetchEasyParts } from "@/lib/quality-split";
import Link from "next/link";
import { formatKmSv } from "@/lib/format";
import { loadLatestLabZoneSet } from "@/lib/zone-sources";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { DailyStatus } from "@/components/DailyStatus";
import { KpiRing } from "@/components/KpiRing";
import type { TrendDirection } from "@/components/ui/TrendMark";
import { ringFillAndStatus, type RingStatus } from "@/lib/kpi-ring";
import { BASELINE_WINDOW_DAYS, computeDailyStatus } from "@/lib/daily-status";
import { isoWeekStart } from "@/lib/stats-utils";
import { QUALITY_WORKOUT_TYPES } from "@/lib/planning";
import { buildReadinessAlert } from "@/lib/readiness-alert";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  trainingSeconds,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import { toDateKey } from "@/lib/week-series";
import { getViewMode } from "@/lib/view-mode";
import { TodaySession, dayAccent, type TodayPlanned } from "@/components/TodaySession";
import { reviewSession, type ReviewRep, type SessionReview } from "@/lib/session-review";
import type { PhaseType } from "@/lib/planning";
import { RecordCard } from "@/components/RecordCard";
import { SeasonContext } from "@/components/SeasonContext";
import { WeekStrip, type WeekStripDay } from "@/components/WeekStrip";

/* Dashboard (döpt om från /idag 2026-08-12, på uttrycklig begäran): start-
 * sidan efter inloggning (se app/page.tsx, login/actions.ts,
 * auth/confirm/route.ts). Sidorna delades om efter loopens kadenser
 * (docs/tranarloopen.md 1.1, 3.1) — kalenderns veckovy äger veckan, /trender
 * blocket, /sasongsoversikt säsongen. Den här sidan äger bara dagen: beredskap inför
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
/** Under den här förändringen räknas formen som oförändrad — EF svänger
 * naturligt någon procent mellan enskilda pass utan att något ändrats. */

/** Under den här förändringen räknas rullande volym som oförändrad (pilen
 * blir ett streck). Baslinjen är årets snitt, ett stabilt tal, så 8 % är
 * redan ett meningsfullt utslag. */
const WEEKLY_NOISE_THRESHOLD_PCT = 0.08;

function shiftDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
}

/** Pilens riktning för en förändring, med samma brustal som kortet.
 *
 * Skild funktion, samma tröskel: färgen säger OM förändringen är bra, pilen
 * säger ÅT VILKET HÅLL talet gick. För belastning kan de två peka olika, och
 * att härleda den ena ur den andra hade gjort just det omöjligt. Brus får ett
 * streck, inte en pil — annars pekar kortet åt ett håll som inte finns. */
function trendDirection(change: number | null, noiseThreshold: number): TrendDirection {
  if (change == null || Math.abs(change) < noiseThreshold) return "flat";
  return change > 0 ? "up" : "down";
}

/** "+53 %", "−4 %" — hela procent och svenskt mellanslag (B3, 2026-11-21). */
function formatPctChange(pctChange: number): string {
  const v = Math.round(pctChange * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)} %`;
}

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
  /* Alltid neutral (B4, 2026-11-21). Mer eller mindre träning är varken bra
   * eller dåligt i sig — kortet sa "Bra" om +50 % distans, och det mönstret
   * hade föregått fyra av tolv sjuk- och skadeperioder. Pilen visar riktning,
   * färgen säger ingenting. */
  const status: RingStatus = pctChange == null ? "unknown" : "neutral";

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
    targetText: pctChange != null ? `mot ditt snitt ${formatValue(baseline)}/v` : undefined,
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
   * nu — samma `athlete`-param-mönster som /sasongsoversikt, se lib/auth-scope.ts.
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
  // Veckoremsans fönster: måndag till söndag i innevarande ISO-vecka.
  const weekStartKey = isoWeekStart(todayKey);
  const weekEnd = new Date(`${weekStartKey}T00:00:00`);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const weekEndKey = toDateKey(weekEnd);

  // Årets aktiviteter räcker sedan 2026-11-21: sviten och formkurvan, som
  // behövde tre års historik, har flyttat från Idag. Kvar är årssnittet för
  // Läget, som bara ser på innevarande år.
  const historyFrom = `${todayKey.slice(0, 4)}-01-01`;

  const [
    { data: activityRows },
    { data: allActivityRows },
    { data: statusMetrics },
    { data: tomorrowQualityWorkouts },
    { data: todayPlannedRows },
    { data: recentSplitRows },
    { data: currentBlockRows },
    { data: nextRaceRow },
    { data: weekPlannedRows },
  ] = await Promise.all([
    // Bara dagens aktiviteter — sidan äger dagen, inget periodfönster.
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", scopedUserId)
      .gte("start_time", todayKey)
      .order("start_time"),
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", scopedUserId)
      .gte("start_time", historyFrom)
      .order("start_time"),
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
    /* Blocket löparen är inne i — eller nästa som börjar.
     *
     * EN fråga för båda fallen: block vars slutdatum inte passerat, sorterade
     * på startdatum. Det första är antingen det pågående blocket eller, om man
     * ligger i ett glapp, nästa som börjar. Ett glapp är inget kantfall — när
     * det här byggdes låg hela gruppen i en lugn period efter tävlingssäsongen
     * och nästa block började först om tolv dagar, så "inget block" hade varit
     * det enda man såg.
     *
     * !inner-aliaset filtrerar fram just hennes block — samma mönster som
     * /blockplan använder; ett naivt !inner hade tyst reducerat listan. */
    supabase
      .from("season_blocks")
      .select("id, name, phase, start_date, end_date, blockFilter:season_block_athletes!inner(athlete_id)")
      .eq("blockFilter.athlete_id", scopedUserId)
      .gte("end_date", todayKey)
      .order("start_date")
      .limit(1)
      .maybeSingle(),
    // Nästa tävling framåt. Dagens räknas med — en tävling man ska springa om
    // några timmar är fortfarande nästa.
    supabase
      .from("competitions")
      .select("name, competition_date, priority")
      .eq("user_id", scopedUserId)
      .gte("competition_date", todayKey)
      .order("competition_date")
      .limit(1)
      .maybeSingle(),
    /* Veckans planerade pass, till veckoremsan under dagens pass. Bara typ
       och datum — remsan ritar en prick per pass, inget innehåll. De
       genomförda passen kommer ur allSessions, som redan är hämtad. */
    supabase
      .from("planned_workouts")
      .select("scheduled_date, workout_type")
      .eq("user_id", scopedUserId)
      .gte("scheduled_date", weekStartKey)
      .lte("scheduled_date", weekEndKey)
      .order("scheduled_date"),
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

  /* "Så gick passet" i dagens pass — samma läsning som dagvyn i kalendern
   * (components/DayContent.tsx), räknad på samma sätt: repen ur merged_splits
   * för passets dominerande aktivitet, trösklar och mål ur profilen, och
   * fasen för blocket dagen ligger i. Två extra frågor, och bara när det finns
   * ett genomfört pass idag. */
  // Uppvärmning och nerjogg i ett tröskelpass räknas som distans.
  const todayEasyParts = await fetchEasyParts(supabase, scopedUserId, sessions);
  const reviewBySession = new Map<string, SessionReview>();
  if (sessions.length > 0) {
    const dominantIds = sessions.map((s) => s.dominantActivity.id);
    const [{ data: reviewProfile }, { data: mergedRows }] = await Promise.all([
      supabase
        .from("profiles")
        .select("lt1_hr, lt2_hr, max_hr, lt2_source, goal_event, goal_seconds")
        .eq("id", scopedUserId)
        .maybeSingle(),
      supabase.rpc("merged_splits", { activity_ids: dominantIds }),
    ]);
    type MergedRow = {
      activity_id: string;
      is_rest: boolean;
      distance_meters: number | null;
      duration_seconds: number | null;
      avg_hr: number | null;
    };
    const repsByActivity = new Map<string, ReviewRep[]>();
    for (const r of (mergedRows ?? []) as MergedRow[]) {
      if (r.is_rest || r.distance_meters == null || r.duration_seconds == null) continue;
      repsByActivity.set(r.activity_id, [
        ...(repsByActivity.get(r.activity_id) ?? []),
        {
          distanceMeters: Number(r.distance_meters),
          durationSeconds: Number(r.duration_seconds),
          avgHr: r.avg_hr != null ? Number(r.avg_hr) : null,
        },
      ]);
    }
    // Blocket från frågan ovan är det pågående ELLER nästa; bara ett som
    // redan börjat ger dagens fas.
    const todayPhase =
      currentBlockRows && (currentBlockRows.start_date as string) <= todayKey
        ? ((currentBlockRows.phase as PhaseType | null) ?? null)
        : null;
    for (const s of sessions) {
      const review = reviewSession({
        category: s.category,
        avgHr: s.avgHr,
        distanceMeters: s.distanceMeters,
        durationSeconds: s.durationSeconds,
        reps: repsByActivity.get(s.dominantActivity.id) ?? [],
        lt1Hr: reviewProfile?.lt1_hr ?? null,
        lt2Hr: reviewProfile?.lt2_hr ?? null,
        maxHr: reviewProfile?.max_hr ?? null,
        lt2Source: reviewProfile?.lt2_source ?? null,
        goalEvent: reviewProfile?.goal_event ?? null,
        goalSeconds: reviewProfile?.goal_seconds != null ? Number(reviewProfile.goal_seconds) : null,
        phase: todayPhase,
      });
      if (review) reviewBySession.set(s.id, review);
    }
  }

  // --- Kontinuitet och kvalitetssviter (K6) -------------------------------
  // Egen, ofiltrerad grund (allActivityRows/allInterruptionEntries ovan) —
  // sviterna är personbästa över hela historiken, inte bara idag.
  const allSessions: TrainingSession[] = groupActivitiesIntoSessions(
    (allActivityRows ?? []) as unknown as SessionActivity[],
  );
  // --- Volym och belastning -----------------------------------------------
  // Samma treårsfönster (allSessions) som Form och kondition ovan, summerat
  // per dag så att både det rullande 7-dagarsfönstret och årssnittet kan
  // räknas ur samma dagliga underlag.
  const yearStartKey = `${todayKey.slice(0, 4)}-01-01`;

  const dailyDistanceKm = new Map<string, number>();
  const dailyLoad = new Map<string, number>();
  // Träningstid (2026-11-16, begärt): passens hela tid utan styrka, med
  // alternativ träning — trainingSeconds i lib/sessions.ts, samma regel som
  // Analys och Uppföljning. Distansen räknar bara löpning, så tiden är det
  // mått där en vecka med mycket cykel syns som den träning den är.
  const dailyMinutes = new Map<string, number>();
  for (const s of allSessions) {
    dailyDistanceKm.set(s.date, (dailyDistanceKm.get(s.date) ?? 0) + s.distanceMeters / 1000);
    dailyLoad.set(s.date, (dailyLoad.get(s.date) ?? 0) + s.trainingLoad);
    dailyMinutes.set(s.date, (dailyMinutes.get(s.date) ?? 0) + trainingSeconds(s) / 60);
  }


  const volumeRings = [
    rollingWeekRing("Distans", dailyDistanceKm, todayKey, yearStartKey, (v) =>
      formatKmSv(v),
    ),
    rollingWeekRing("Träningstid", dailyMinutes, todayKey, yearStartKey, (v) =>
      `${Math.round(v).toLocaleString("sv-SE")} min`,
    ),
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
  /* --- Veckoremsan ------------------------------------------------------
   * Sju dagar, måndag till söndag. Genomfört hämtas ur allSessions (redan
   * i minnet), planerat ur veckans planned_workouts. Ingen matchning mellan
   * dem görs: remsan visar genomfört där det finns och planerat annars,
   * samma regel som kalenderns månadsvy följer. En riktig parning hör hemma
   * i efterlevnadskortet, inte i sju prickar. */
  const weekPlannedByDate = new Map<string, string[]>();
  for (const row of (weekPlannedRows ?? []) as { scheduled_date: string; workout_type: string }[]) {
    const list = weekPlannedByDate.get(row.scheduled_date) ?? [];
    list.push(row.workout_type);
    weekPlannedByDate.set(row.scheduled_date, list);
  }

  const weekDoneByDate = new Map<string, TrainingSession[]>();
  for (const session of allSessions) {
    if (session.date < weekStartKey || session.date > weekEndKey) continue;
    weekDoneByDate.set(session.date, [...(weekDoneByDate.get(session.date) ?? []), session]);
  }

  const weekDays: WeekStripDay[] = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(`${weekStartKey}T00:00:00`);
    d.setDate(d.getDate() + i);
    const key = toDateKey(d);
    return {
      date: key,
      done: (weekDoneByDate.get(key) ?? []).map((session) => session.category),
      planned: weekPlannedByDate.get(key) ?? [],
      isToday: key === todayKey,
      isPast: key < todayKey,
    };
  });

  const weekDoneCount = [...weekDoneByDate.values()].reduce((n, list) => n + list.length, 0);
  const weekKilometres =
    [...weekDoneByDate.values()]
      .flat()
      .reduce((m, session) => m + session.distanceMeters, 0) / 1000;

    const latestSession = allSessions.length > 0 ? allSessions[allSessions.length - 1] : null;

  /* Dagens kulör för HELA sidan. Samma funktion som passkortet använder. */
  const pageAccent = dayAccent(
    (todayPlannedRows ?? []) as unknown as { workout_type: string }[],
    sessions.map((s) => ({ category: s.category })),
  );

  const labZoneSet = await loadLatestLabZoneSet(supabase, scopedUserId);
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
      <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Idag</h1>

      {/* Var i säsongen man är, före dagens pass. Dagens pass svarar på VAD
          man ska göra; det här svarar på varför — vilket block man bygger i
          och vad man bygger mot. */}
      <SeasonContext
        block={
          currentBlockRows
            ? {
                id: currentBlockRows.id as string,
                name: currentBlockRows.name as string,
                phase: currentBlockRows.phase as string,
                startDate: currentBlockRows.start_date as string,
                endDate: currentBlockRows.end_date as string,
              }
            : null
        }
        nextRace={
          nextRaceRow
            ? {
                name: nextRaceRow.name as string,
                date: nextRaceRow.competition_date as string,
                priority: nextRaceRow.priority as string,
              }
            : null
        }
        todayKey={todayKey}
        athleteQuery={athleteQuery}
      />

      {/* --- Veckan, mellan säsongen och dagen. Sidan går från grovt till
          fint: vilket block och vilken tävling man bygger mot, sedan hur
          veckan ser ut, sedan vad som gäller idag. Veckan är sammanhanget
          dagen ska läsas i — är det tredje kvalitetspasset på fyra dagar
          betyder "Intervaller" något annat än om det vore det första.
          Låg först som en textlänk längst ner, sedan under dagens pass, och
          före säsongsraden innan den hamnade här. ------------------- */}
      <WeekStrip
        days={weekDays}
        doneCount={weekDoneCount}
        plannedCount={(weekPlannedRows ?? []).length}
        kilometres={weekKilometres}
        href={`/calendar/vecka/${todayKey}${athleteQuery}`}
      />
      <Link
        href={`/calendar/vecka/${shiftDateKey(weekStartKey, -7)}${athleteQuery}`}
        className="-mt-5 self-end text-sm text-[var(--ink-2)] underline underline-offset-2 hover:text-[var(--foreground)]"
      >
        Förra veckans bokslut →
      </Link>

      {/* --- Dagens pass, efter veckan.
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
          labZoneSeconds: s.labZoneSeconds,
          review: reviewBySession.get(s.id) ?? null,
          easy: todayEasyParts.get(s.dominantActivity.id) ?? null,
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
        labSet={labZoneSet}
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



      {/* Formkurvan och syreupptaget låg här fram till 2026-11-21. Formkurvan
          (meter per hjärtslag) är samma mått som pulsslag per meter, som
          redan underkänts — den mätte fart, inte form. Syreupptaget bor på
          Form. Sviten likaså (Kontinuitet). */}

      {/* --- Volym och belastning: egen sektion, rullande 7 dagar mot årets
          snitt per vecka (P1.5) — flyttad hit från den borttagna /veckan
          2026-08-13. ---------------------------------------------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">Läget · senaste 7 dagarna</h2>
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

    </div>
  );
}
