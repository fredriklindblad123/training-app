import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DailyCheckIn } from "@/components/DailyCheckIn";
import { DailyStatus } from "@/components/DailyStatus";
import { KpiRing } from "@/components/KpiRing";
import { ringFillAndStatus, type RingDirection, type RingStatus } from "@/lib/kpi-ring";
import { BASELINE_WINDOW_DAYS, computeDailyStatus } from "@/lib/daily-status";
import { computeCheckInStats } from "@/lib/checkin";
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

/* Idag: startsidan efter inloggning (se app/page.tsx, login/actions.ts,
 * auth/confirm/route.ts). Sidorna delades om efter loopens kadenser
 * (docs/tranarloopen.md 1.1, 3.1) — /veckan äger veckan, /blocket blocket,
 * /sasongen säsongen. Den här sidan äger bara dagen: dagens incheckning,
 * beredskap inför morgondagen (K3), status mot baslinjen (P1.2) och dagens
 * pass. Kontinuiteten (K6) är enda undantaget med lång horisont — den står
 * kvar som ett ankare, inte som en periodvy. Nyckeltalen visas som samma
 * sorts KPI-ring: en siffra i mitten, en ring som visar hur nära riktvärdet
 * man ligger, färgad grönt/gult/rött. */

/** Bygger ring-props för ett incheckningsmått (1–5-skalan). Riktvärdet är
 * inte en personlig baslinje utan skalans egen ände: 5 (bäst) för
 * higher_is_better, 2 (lite men inte noll) för lower_is_better — annars blir
 * en hög muskelömhet fylld och grön av samma anledning som en hög känsla,
 * vilket var precis den bugg som gjorde färgsättningen orimlig. */
function scoreRing({
  label,
  value,
  direction,
  hint,
}: {
  label: string;
  value: number | null;
  direction: RingDirection;
  hint: string;
}) {
  const target = direction === "lower_is_better" ? 2 : 5;
  const { fill, status } = ringFillAndStatus(value, target, direction);
  return {
    label,
    valueText: value != null ? (Number.isInteger(value) ? String(value) : value.toFixed(1)) : "–",
    unit: "/5",
    fill,
    status: (value == null ? "unknown" : status) as RingStatus,
    targetText: direction === "neutral" ? undefined : `Mål ${target}/5`,
    detailRows: [
      { label: "Idag", value: value != null ? `${value.toFixed(1)} av 5` : "–" },
      { label: "Mål", value: direction === "neutral" ? "–" : `${target} av 5` },
    ],
    hint,
  };
}

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

  const [
    { data: activityRows },
    { data: allActivityRows },
    { data: allInterruptionEntries },
    { data: todayEntry },
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
    supabase
      .from("diary_entries")
      .select("feeling, motivation, soreness_level, rpe")
      .eq("user_id", user.id)
      .eq("entry_date", todayKey)
      .maybeSingle(),
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

  // --- Dagens incheckning (P0.4): visas bara om den inte redan är gjord. --
  const checkInStats = await computeCheckInStats(supabase, user.id, todayKey);
  const checkIn = {
    initialDone: todayEntry?.feeling != null,
    initialScores: {
      feeling: todayEntry?.feeling ?? null,
      effort: todayEntry?.rpe != null ? Math.round(todayEntry.rpe / 2) : null,
      soreness: todayEntry?.soreness_level ?? null,
      motivation: todayEntry?.motivation ?? null,
    },
    initialStats: checkInStats,
  };

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

  // --- Incheckning som ringar: dagens värden, inget snitt ------------------
  const checkInRingsVisible = checkIn.initialDone;

  const checkInRings = [
    scoreRing({
      label: "Känsla i kroppen",
      value: checkIn.initialScores.feeling,
      direction: "higher_is_better",
      hint: "Din egen skattning, 1–5, från den dagliga incheckningen.",
    }),
    scoreRing({
      label: "Motivation/ork",
      value: checkIn.initialScores.motivation,
      direction: "higher_is_better",
      hint: "Din egen skattning, 1–5, från den dagliga incheckningen.",
    }),
    scoreRing({
      label: "Muskelömhet",
      value: checkIn.initialScores.soreness,
      direction: "lower_is_better",
      hint: "Din egen skattning, 1–5 — lägre är mindre öm.",
    }),
    scoreRing({
      label: "Ansträngning",
      value: checkIn.initialScores.effort,
      direction: "neutral",
      hint: "Upplevd ansträngning i passet, 1–5. Varken bra eller dåligt i sig — bara beskrivande.",
    }),
  ];

  const todayHref = `/calendar/${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Idag</h1>

      {/* --- Dagens incheckning: första vyn för dagen tills den är gjord —
          därefter försvinner den helt. Utfallet lever bara som KPI-ringar i
          "Incheckning"-sektionen nedan. -------------------------------- */}
      {!checkIn.initialDone && (
        <DailyCheckIn
          entryDate={todayKey}
          initialDone={checkIn.initialDone}
          initialScores={checkIn.initialScores}
          initialStats={checkIn.initialStats}
        />
      )}

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

      {checkInRingsVisible && (
        <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Incheckning</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">Idag</p>
          </div>
          <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
            {checkInRings.map((r) => (
              <KpiRing key={r.label} {...r} />
            ))}
          </div>
        </div>
      )}

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
