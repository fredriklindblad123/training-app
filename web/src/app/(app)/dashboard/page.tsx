import { matchPlanToSessions, summarizeCompliance, type PlannedWorkout } from "@/lib/plan-matching";
import { sessionKm } from "@/lib/block-analysis";
import { fetchEasyParts } from "@/lib/quality-split";
import Link from "next/link";
import { formatDateShort, formatMinutes, formatNumber } from "@/lib/format";
import { PageHeader } from "@/components/ui/Page";
import { Eyebrow, HowCalculated } from "@/components/ui/Explain";
import { blockVsPlan, type PlanRow } from "@/lib/block-vs-plan";
import { loadLatestLabZoneSet } from "@/lib/zone-sources";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { BASELINE_WINDOW_DAYS, computeDailyStatus } from "@/lib/daily-status";
import { isoWeekStart } from "@/lib/stats-utils";
import { QUALITY_WORKOUT_TYPES } from "@/lib/planning";
import { buildReadinessAlert } from "@/lib/readiness-alert";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  trainingSeconds,
  sessionComments,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import { toDateKey } from "@/lib/week-series";
import { fetchRepStats, weekGap, type GapThresholds, type WeekPlanRow } from "@/lib/plan-gap";
import { PlanGapTiles } from "@/components/PlanGapTable";
import { getViewMode } from "@/lib/view-mode";
import { TodaySession, dayAccent, type TodayPlanned, type TodayTreadmill } from "@/components/TodaySession";
import { reviewSession, type ReviewRep, type SessionReview } from "@/lib/session-review";
import type { PhaseType } from "@/lib/planning";
import { RecordCard } from "@/components/RecordCard";
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


function shiftDateKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  return toDateKey(d);
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
          "target_pace_seconds_per_km, planned_rep_groups(reps, distance_meters, duration_seconds, sort_order)",
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
    /* Veckans planerade pass, till veckoremsan under dagens pass. Bara typ
       och datum — remsan ritar en prick per pass, inget innehåll. De
       genomförda passen kommer ur allSessions, som redan är hämtad. */
    supabase
      .from("planned_workouts")
      .select("scheduled_date, workout_type, target_distance_meters, target_duration_seconds, target_pace_seconds_per_km")
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
  /* "Läget · senaste 7 dagarna" (distans och träningstid mot eget årssnitt)
     togs bort 2026-11-24 och ersattes av "Veckan mot planen". */

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

  const bodyMarkers = dailyStatus.markers.filter((m) => m.spec.key !== "sleepHours" && m.spec.key !== "feeling");

  /* Plan mot utfall (lib/plan-gap.ts), för dagens pass och för veckan: repen
     i veckans pass och löparens trösklar. */
  const weekSessions = allSessions.filter((s) => s.date >= weekStartKey && s.date <= todayKey);
  const [repStats, { data: gapProfile }] = await Promise.all([
    fetchRepStats(supabase, [...new Set([...weekSessions, ...sessions].map((s) => s.dominantActivity.id))]),
    supabase.from("profiles").select("lt1_hr, lt2_hr, lt2_source").eq("id", scopedUserId).maybeSingle(),
  ]);
  /* Löparens band (lib/treadmill.ts), för "ställ bandet på" i dagens pass.
     En egen fråga: kolumnen kom med en senare migration, och ett fel här ska
     inte ta pulsraden i plan mot utfall med sig. */
  const treadmill = await fetchTreadmill(supabase, scopedUserId);
  const gapThresholds: GapThresholds = {
    lt1: gapProfile?.lt1_hr ?? null,
    lt2: gapProfile?.lt2_hr ?? null,
    measured: gapProfile?.lt2_source !== "manuell",
  };
  const vsWeek = weekGap(
    ((weekPlannedRows ?? []) as unknown as WeekPlanRow[]),
    weekSessions.map((s) => ({
      date: s.date,
      category: s.category,
      distanceMeters: s.distanceMeters,
      durationSeconds: s.durationSeconds,
      avgHr: s.avgHr,
      trainingSeconds: trainingSeconds(s),
      dominantId: s.dominantActivity.id,
      runMeters: sessionKm(s) * 1000,
    })),
    repStats,
    gapThresholds,
    weekStartKey,
    todayKey,
  );

  // Blocket mot planen (lib/block-vs-plan.ts): planerade pass med siffror i
  // det block som pågår, mot årets pass (allSessions täcker hela året).
  const block =
    currentBlockRows && (currentBlockRows.start_date as string) <= todayKey
      ? { start: currentBlockRows.start_date as string, end: currentBlockRows.end_date as string, name: currentBlockRows.name as string }
      : null;
  const { data: blockPlanRows } = block
    ? await supabase
        .from("planned_workouts")
        .select("id, slot, title, scheduled_date, workout_type, target_distance_meters, target_duration_seconds")
        .eq("user_id", scopedUserId)
        .gte("scheduled_date", block.start)
        .lte("scheduled_date", block.end)
    : { data: [] };
  const vsPlan = block ? blockVsPlan((blockPlanRows ?? []) as PlanRow[], allSessions, block.end, todayKey) : null;
  /* Hela blockets volym hittills (2026-11-27). "Blocket hittills" visade
     bara jämförelsen mot planen, som börjar först när planen fick siffror
     (16/11 för Alice) — 108 km såg ut som hela blocket när det var elva
     dagar av nio veckor (461 km). Samma regler som jämförelsen: löpning utan
     alternativträning, tid utan styrka, och samma sista dag. */
  const blockSoFar =
    block && vsPlan
      ? (() => {
          const ss = allSessions.filter((x) => x.date >= block.start && x.date <= vsPlan.to);
          return {
            km: ss.reduce((n, x) => n + sessionKm(x), 0),
            min: ss.reduce((n, x) => n + trainingSeconds(x), 0) / 60,
          };
        })()
      : null;
  /* Passen mot planen från blockets start (2026-11-27, begärt). Distans och
     tid går bara att jämföra från den dag planen fick siffror (16/11 för
     Alice — veckorna före har bara passnamn), men varje planerat pass har en
     typ, så antalet gjorda pass går att räkna för hela blocket. Samma
     matchning som veckobokslutet och Block (matchPlanToSessions).
     Styrka räknas inte: den loggas sällan med klockan och hade sett ut som
     missade pass. */
  const blockPasses =
    block && vsPlan
      ? (() => {
          const plans = ((blockPlanRows ?? []) as unknown as PlannedWorkout[]).filter(
            (p) => p.scheduled_date >= block.start && p.scheduled_date <= vsPlan.to && p.workout_type !== "strength",
          );
          const ss = allSessions.filter((x) => x.date >= block.start && x.date <= vsPlan.to);
          const matches = matchPlanToSessions(plans, ss);
          const c = summarizeCompliance(matches);
          return {
            planned: c.plannedCount,
            done: c.completedCount,
            otherType: matches.filter((m) => m.outcome === "avvikande typ").length,
          };
        })()
      : null;

  const labZoneSet = await loadLatestLabZoneSet(supabase, scopedUserId);
  const todayHref = `/calendar/${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}${athleteQuery}`;

  return (
    /* Hela sidan bär dagens färg, inte bara passkortet (begärt 2026-09-16).
       --day-accent kommer ur samma dayAccent() som kortet använder, så sidan
       och kortet kan aldrig visa olika färg för samma dag. Saknas den — en
       vilodag, eller inget pass alls — sätts ingen variabel, och .day-theme
       faller tillbaka på appens vanliga ytor via sina egna fallback-värden. */
    <div
      className="day-theme flex flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8"
      style={pageAccent ? ({ "--day-accent": pageAccent } as React.CSSProperties) : undefined}
    >
      <PageHeader
        title="Idag"
        lead={`${formatDateShort(todayKey, true)}${
          currentBlockRows && (currentBlockRows.start_date as string) <= todayKey
            ? ` · ${currentBlockRows.name as string}, vecka ${
                Math.floor((Date.parse(todayKey) - Date.parse(currentBlockRows.start_date as string)) / (7 * 86_400_000)) + 1
              } av ${Math.ceil((Date.parse(currentBlockRows.end_date as string) - Date.parse(currentBlockRows.start_date as string) + 86_400_000) / (7 * 86_400_000))}`
            : ""
        }`}
      />

      {/* --- Dagens pass, efter veckan.
          Den första frågan en löpare har när hon öppnar appen är vad som
          gäller idag — inte hur formkurvan ser ut över sex veckor. Kortet låg
          tidigare längst NED, under tre ringsektioner och statusrutan.
          Hela kortet länkar till dagen i kalendern, där passet loggas och
          rättas. --------------------------------------------------------- */}
      <TodaySession
        treadmill={treadmill}
        planned={(todayPlannedRows ?? []) as unknown as TodayPlanned[]}
        /* Varven hör till EN aktivitet, och funktionen svarar bara för den
           allra senaste. De hängs därför bara på det pass de faktiskt kommer
           ifrån — och bara om det passet är idag. Är senaste passet från i
           går har dagens pass inga varv att visa, vilket är rätt svar. */
        done={sessions.map((s) => ({
          id: s.id,
          category: s.category,
          name: s.dominantActivity.name,
          comments: sessionComments(s),
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
          reps: repStats.get(s.dominantActivity.id) ?? null,
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
        thresholds={gapThresholds}
        compact
      >
        <WeekStrip
          bare
          days={weekDays}
          doneCount={weekDoneCount}
          plannedCount={(weekPlannedRows ?? []).length}
          kilometres={weekKilometres}
          href={`/calendar/vecka/${todayKey}${athleteQuery}`}
        />
      </TodaySession>

      {/* Veckan mot planen (2026-11-24, begärt): ersätter "Läget · senaste 7
          dagarna" och "Blocket mot planen". Veckans utfall mot planen i tid,
          distans, fart och puls (lib/plan-gap.ts weekGap), och blocket
          hittills som en rad under. Läget jämförde de senaste sju dagarna
          med löparens eget snitt i år — utan planen var det ett mått på
          volym, inte på hur veckan gick mot det som var tänkt. */}
      {(vsWeek || (vsPlan && block)) && (
        <section className="flex flex-col gap-2.5">
          <div className="flex items-baseline justify-between gap-2">
            <Eyebrow>Veckan mot planen</Eyebrow>
            <Link href={`/calendar/vecka/${shiftDateKey(weekStartKey, -7)}${athleteQuery}`} className="text-sm underline underline-offset-2">
              Förra veckan →
            </Link>
          </div>
          <div className="flex flex-col gap-3 rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3.5">
            {vsWeek ? (
              <>
                <span className="text-xs text-[var(--ink-3)]">
                  {formatDateShort(vsWeek.from, true)}–{formatDateShort(vsWeek.to, true)}
                </span>
                <PlanGapTiles gap={vsWeek} />
              </>
            ) : (
              <p className="text-sm text-[var(--ink-3)]">Inget planerat pass har passerat än den här veckan.</p>
            )}
            {vsPlan && block && (
              <Link href={`/analys${athleteQuery}`} className="flex flex-col gap-0.5 border-t border-[var(--line)] pt-3 text-sm">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="display text-xs font-semibold tracking-[0.08em] text-[var(--ink-3)] uppercase">
                    Blocket hittills
                  </span>
                  <span className="text-xs text-[var(--ink-3)]">Blocket →</span>
                </span>
                {/* Planen har siffror från blockets start: en rad, gjort av
                    planerat. Annars blockets volym för sig och jämförelsen
                    från den dag planen fick siffror. */}
                {vsPlan.from <= block.start ? (
                  <span className="tabular text-[var(--ink-2)]">
                    <span className="font-semibold text-[var(--foreground)]">{formatNumber(vsPlan.doneKm, 1)}</span> av{" "}
                    {formatNumber(vsPlan.plannedKm, 1)} km ·{" "}
                    <span className="font-semibold text-[var(--foreground)]">{formatMinutes(vsPlan.doneMin)}</span> av{" "}
                    {formatMinutes(vsPlan.plannedMin)}{" "}
                    <span className="text-xs text-[var(--ink-3)]">
                      {formatDateShort(block.start)}–{formatDateShort(vsPlan.to)}
                    </span>
                  </span>
                ) : (
                  <>
                    {blockSoFar && (
                      <span className="tabular text-[var(--ink-2)]">
                        <span className="font-semibold text-[var(--foreground)]">{formatNumber(blockSoFar.km, 1)} km</span> ·{" "}
                        <span className="font-semibold text-[var(--foreground)]">{formatMinutes(blockSoFar.min)}</span>{" "}
                        <span className="text-xs text-[var(--ink-3)]">
                          {formatDateShort(block.start)}–{formatDateShort(vsPlan.to)}
                        </span>
                      </span>
                    )}
                    <span className="tabular text-xs text-[var(--ink-2)]">
                      Distans och tid mot planen sedan {formatDateShort(vsPlan.from)}:{" "}
                      {formatNumber(vsPlan.doneKm, 1)} av {formatNumber(vsPlan.plannedKm, 1)} km ·{" "}
                      {formatMinutes(vsPlan.doneMin)} av {formatMinutes(vsPlan.plannedMin)}
                    </span>
                  </>
                )}
                {blockPasses && blockPasses.planned > 0 && (
                  <span className="tabular text-xs text-[var(--ink-2)]">
                    Pass: {blockPasses.done} av {blockPasses.planned} planerade
                    {blockPasses.otherType > 0 ? ` · ${blockPasses.otherType} med annan typ` : ""} · styrka räknas inte
                  </span>
                )}
              </Link>
            )}
          </div>
          <HowCalculated>
            <p>
              Veckan från måndag till och med {vsWeek ? formatDateShort(vsWeek.to) : "igår"}: bara dagar som
              passerat, och idag först när dagens pass är gjort. Distans är löpning utan alternativträning; tid är
              hela passet, styrka inte med.
            </p>
            <p>
              Fart och puls räknas bara på pass som var planerade. Distanspassens fart jämförs med den fart planens
              distans och tid ger; kvalitetspassens repfart med fartmålet, som median av rep på minst en minut.
              Pulsen jämförs med dina trösklar för den planerade passtypen: snittpuls mot LT1 för distanspass,
              slutpuls per rep mot bandet LT1–LT2 för tröskel, högsta puls mot LT2 för intervall — samma mått som på
              Form.
            </p>
            {vsPlan && block && (
              <p>
                Blocket hittills: {block.name}, {formatDateShort(block.start)}–{formatDateShort(vsPlan.to)}. Passen
                räknas mot planen från blockets start: ett planerat pass är gjort när ett pass av samma typ finns den
                dagen, och ”annan typ” när det blev ett annat slags pass (till exempel cykel i stället för löpning).
                Distans och tid jämförs bara från den dag planen har siffror. Hela
                blocket är planerat till {formatNumber(vsPlan.blockPlannedKm, 1)} km och{" "}
                {formatMinutes(vsPlan.blockPlannedMin)}.
                {vsPlan.from > block.start
                  ? ` Blocket räknas från ${formatDateShort(vsPlan.from)}, då planen började ha distans och tid — dagarna före har inget att jämföra med.`
                  : ""}
              </p>
            )}
          </HowCalculated>
        </section>
      )}


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

      {bodyMarkers.length > 0 && (
        <section className="flex flex-col gap-2.5">
          <Eyebrow>Kroppen · senaste 7 dagarna</Eyebrow>
          <div className="overflow-hidden rounded-[14px] border border-[var(--line)]">
            {bodyMarkers.map((m, i) => (
              <div key={m.spec.key} className={`grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3.5 py-3 ${i > 0 ? "border-t border-[var(--line)]" : ""}`}>
                <span className="flex flex-col">
                  <span className="font-medium text-[var(--foreground)]">{m.spec.label}</span>
                  <span className="text-[0.8125rem] text-[var(--ink-3)]">
                    ditt vanliga: {m.baseline == null ? "–" : `${formatNumber(m.baseline, 0)}${m.spec.unit ? ` ${m.spec.unit}` : ""}`}
                  </span>
                </span>
                <span className="flex flex-col items-end gap-0.5">
                  <span className="display tabular text-[1.375rem] font-bold text-[var(--foreground)]">
                    {m.current == null ? "–" : formatNumber(m.current, 0)}
                  </span>
                  {m.band && m.band !== "good" && (
                    <span className="rounded-full px-2 py-0.5 text-xs" style={{ backgroundColor: "color-mix(in oklab, var(--status-watch) 18%, transparent)", color: "var(--status-watch-ink)" }}>
                      utanför ditt vanliga
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
          <HowCalculated>
            <p>
              Ur klockan över natten. &quot;Ditt vanliga&quot; är medianen av dina senaste {BASELINE_WINDOW_DAYS} dagar. Gult
              när veckan ligger utanför det som är vanligt för dig — aldrig grönt eller rött för en vanlig vecka.
            </p>
          </HowCalculated>
        </section>
      )}


    </div>
  );
}

async function fetchTreadmill(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<TodayTreadmill | null> {
  const { data: p, error } = await supabase.from("profiles").select("treadmill_id").eq("id", userId).maybeSingle();
  if (error || !p?.treadmill_id) return null;
  const [{ data: band }, { data: cal }] = await Promise.all([
    supabase.from("treadmills").select("name").eq("id", p.treadmill_id).maybeSingle(),
    supabase
      .from("treadmill_calibrations")
      .select("slope, intercept, loaded_factor")
      .eq("treadmill_id", p.treadmill_id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (!band || !cal) return null;
  return {
    name: band.name as string,
    calibration: {
      slope: Number(cal.slope),
      intercept: Number(cal.intercept),
      loadedFactor: cal.loaded_factor != null ? Number(cal.loaded_factor) : null,
    },
  };
}
