import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DailyStatus } from "@/components/DailyStatus";
import { KpiRing } from "@/components/KpiRing";
import { ActionCard } from "@/components/ActionCard";
import { ringFillAndStatus, type RingStatus } from "@/lib/kpi-ring";
import { BASELINE_WINDOW_DAYS, computeDailyStatus } from "@/lib/daily-status";
import { computeEfficiencyPoints, METERS_PER_BEAT } from "@/lib/efficiency";
import { median } from "@/lib/stats-utils";
import { QUALITY_WORKOUT_TYPES, addDays as planAddDays, mondayOf } from "@/lib/planning";
import { buildReadinessAlert } from "@/lib/readiness-alert";
import { nextActions, type NextActionInput } from "@/lib/next-actions";
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

/* Idag: startsidan efter inloggning (se app/page.tsx, login/actions.ts,
 * auth/confirm/route.ts). Sidorna delades om efter loopens kadenser
 * (docs/tranarloopen.md 1.1, 3.1) — /veckan äger veckan, /blocket blocket,
 * /sasongen säsongen. Den här sidan äger bara dagen: beredskap inför
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
 * dagbokstexten (lib/diary-text.ts) — se /blocket och veckoagendan. */

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

/** Baslinjen för formkurve-ringen kräver minst så här många lugna/långa pass
 * innan de senaste tre jämförs mot något — annars är "baslinjen" bara
 * ett par slumpmässiga pass. */
const MIN_EF_BASELINE_POINTS = 5;
/** Antal senaste passen som räknas som "nuläget", samma smetning som
 * dämpar enskilda pass i motvind eller med tappat pulsband. */
const EF_RECENT_COUNT = 3;

/** Formkurvan (P1.4): median av de tre senaste jämförbara passen mot en
 * baslinje av de föregående. Samma pass-urval som /blocket
 * (lib/efficiency.ts) — bara lugna/långa pass räknas, så en hård
 * intervallvecka inte får formkurvan att se sämre ut än den är. */
function efficiencyRing(efPoints: { ef: number }[]) {
  const values = efPoints.map((p) => p.ef * METERS_PER_BEAT);
  const recent = values.slice(-EF_RECENT_COUNT);
  const prior = values.slice(0, -EF_RECENT_COUNT);
  const current = median(recent);
  const baseline = prior.length >= MIN_EF_BASELINE_POINTS ? median(prior) : null;

  const { fill, status } = ringFillAndStatus(current, baseline, "higher_is_better");
  return {
    label: "Formkurva",
    valueText: current != null ? current.toFixed(2) : "–",
    unit: "m/slag",
    fill,
    status: (baseline == null ? "unknown" : status) as RingStatus,
    targetText: baseline != null ? `Baslinje ${baseline.toFixed(2)}` : undefined,
    detailRows: [
      {
        label: `Senaste ${EF_RECENT_COUNT} lugna/långa passen`,
        value: current != null ? `${current.toFixed(2)} m/slag` : "–",
      },
      {
        label: "Baslinje",
        value:
          baseline != null
            ? `${baseline.toFixed(2)} m/slag`
            : `bygger baslinje (${prior.length} av ${MIN_EF_BASELINE_POINTS} pass)`,
      },
    ],
    hint:
      "Meter per hjärtslag på lugna/långa pass (minst 20 min, se /blocket) — högre är effektivare " +
      "löpning vid samma puls. Intervaller och tävlingar räknas inte in, de mäter annat.",
  };
}

/** Kondition (VO2max): Garmins egen skattning, satt sällan — bara när
 * klockan räknar om den, inte på varje pass. Jämförs mot senaste *andra*
 * värdet (inte ett medelvärde) eftersom det är en diskret uppdatering, inte
 * en brusig mätning som behöver dämpas. */
function vo2maxRing(readings: { value: number }[]) {
  const current = readings.length > 0 ? readings[readings.length - 1].value : null;
  let previous: number | null = null;
  for (let i = readings.length - 2; i >= 0; i--) {
    if (readings[i].value !== current) {
      previous = readings[i].value;
      break;
    }
  }

  const { fill, status } = ringFillAndStatus(current, previous, "higher_is_better");
  return {
    label: "Kondition",
    valueText: current != null ? String(Math.round(current)) : "–",
    unit: "VO2max",
    fill,
    status: (previous == null ? "unknown" : status) as RingStatus,
    targetText: previous != null ? `Förra värdet ${Math.round(previous)}` : undefined,
    detailRows: [
      { label: "Senaste värdet", value: current != null ? `${Math.round(current)} ml/kg/min` : "–" },
      {
        label: "Föregående värde",
        value: previous != null ? `${Math.round(previous)} ml/kg/min` : "ingen tidigare mätning ännu",
      },
    ],
    hint: "Garmins egen konditionsskattning. Uppdateras sällan och oregelbundet, inte per pass.",
  };
}

export default async function IdagPage() {
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

  // L2 (docs/tranarloopen.md): regel 4 jämför förra veckan mot innevarande —
  // datumen räknas en gång här och återanvänds både i frågan och i
  // nextActions-indatan nedan.
  const currentWeekMonday = mondayOf(todayKey);
  const currentWeekSunday = planAddDays(currentWeekMonday, 6);
  const lastWeekMonday = planAddDays(currentWeekMonday, -7);
  const lastWeekSunday = planAddDays(currentWeekMonday, -1);

  const [
    { data: activityRows },
    { data: allActivityRows },
    { data: allInterruptionEntries },
    { data: recentDiaryEntries },
    { data: statusMetrics },
    { data: tomorrowQualityWorkouts },
    { data: currentWeekPlannedWorkouts },
    { data: activeBlock },
    { data: profileRow },
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
    // Gårdagens dagboksanteckning (L2, regel 3).
    supabase
      .from("diary_entries")
      .select("entry_date, notes")
      .eq("user_id", user.id)
      .in("entry_date", [todayKey, yesterdayKey]),
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
    // L2, regel 4: "oplanerad" avgörs av att raden här är tom — existensen
    // räcker, därför bara `id` och en `limit(1)`.
    supabase
      .from("planned_workouts")
      .select("id")
      .gte("scheduled_date", toDateKey(currentWeekMonday))
      .lte("scheduled_date", toDateKey(currentWeekSunday))
      .limit(1),
    // L2, regel 5: blocket som täcker idag, om något — samma "aktivt block"
    // som /blocket landar på när inget block-id anges i frågan.
    supabase
      .from("season_blocks")
      .select("end_date")
      .lte("start_date", todayKey)
      .gte("end_date", todayKey)
      .maybeSingle(),
    // L2, regel 6.
    supabase.from("profiles").select("lt2_hr").maybeSingle(),
  ]);

  const yesterdayEntry = (recentDiaryEntries ?? []).find((e) => e.entry_date === yesterdayKey);

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
  const yesterdayHref = `/calendar/${yesterday.getFullYear()}/${yesterday.getMonth() + 1}/${yesterday.getDate()}`;

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

  // --- L2: nästa steg (docs/tranarloopen.md) ------------------------------
  // Allt underlag är redan hämtat ovan — den här sektionen bara samlar det
  // åt nextActions(), som är ren logik utan egna databasanrop.
  // allSessions är redan grupperat ur samma sorterade rader (groupActivitiesIntoSessions
  // sorterar internt på start_time), så första posten är den tidigaste — och
  // typad, till skillnad från att gräva i allActivityRows direkt.
  const earliestActivityDate = allSessions[0]?.date ?? null;
  const hasEnoughTrainingHistoryForTest =
    earliestActivityDate != null &&
    (Date.parse(todayKey) - Date.parse(earliestActivityDate)) / 86_400_000 >= 30;

  const nextActionInput: NextActionInput = {
    todayKey,
    shouldEaseOff: dailyStatus.shouldEaseOff,
    hasQualityWorkoutTomorrow: (tomorrowQualityWorkouts ?? []).length > 0,
    tomorrowHref,
    hadSessionYesterday: allSessions.some((s) => s.date === yesterdayKey),
    yesterdayHasDiaryNote: !!yesterdayEntry?.notes?.trim(),
    yesterdayHref,
    lastWeekHadSession: allSessions.some(
      (s) => s.date >= toDateKey(lastWeekMonday) && s.date <= toDateKey(lastWeekSunday),
    ),
    currentWeekHasPlannedWorkout: (currentWeekPlannedWorkouts ?? []).length > 0,
    activeBlockEndDate: activeBlock?.end_date ?? null,
    hasLt2Hr: profileRow?.lt2_hr != null,
    hasEnoughTrainingHistoryForTest,
  };
  // Bara de tre viktigaste visas (fallgrop 1: appen får aldrig gnälla med en
  // lång lista) — en tom lista är ett gott tillstånd, se rendern nedan.
  const topActions = nextActions(nextActionInput).slice(0, 3);

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

  const formRings = [efficiencyRing(efPoints), vo2maxRing(vo2maxReadings)];

  const todayHref = `/calendar/${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Idag</h1>

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

      {/* --- L2: nästa steg, överst på sidan — se
          docs/tranarloopen.md. Max tre kort, alltid samma dämpade accent
          (ActionCard/--surface-action) oavsett vilken regel som träffade;
          ordningen bär prioriteten. En tom lista är ett gott tillstånd och
          visas som en kort neutral rad i stället för att sektionen
          försvinner — annars hoppar layouten och ytan känns opålitlig. ---- */}
      <section className="flex flex-col gap-2">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Nästa steg</h2>
        {topActions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">Inget som väntar just nu.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {topActions.map((a) => (
              <ActionCard key={a.id} title={a.title} why={a.why} href={a.href} />
            ))}
          </div>
        )}
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

      {/* --- Utgången: loopens nästa steg efter dagen är veckan. ----------- */}
      <Link
        href="/veckan"
        className="w-fit text-sm underline text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        Veckans genomgång →
      </Link>
    </div>
  );
}
