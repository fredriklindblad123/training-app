import { ManualSessions, type ManualActivity } from "@/components/ManualSessions";
import { PlannedSessions, type PlannedRow } from "@/components/PlannedSessions";
import { DaySection } from "@/components/DaySection";
import { createClient } from "@/lib/supabase/server";
import { groupActivitiesIntoSessions, sessionComments, trainingSeconds, type SessionActivity } from "@/lib/sessions";
import { SessionComments } from "@/components/ui/SessionComments";
import { pairPlanDone } from "@/lib/pair-plan";
import {
  matchPlanToSessions,
  type PlannedWorkout,
} from "@/lib/plan-matching";
import { dateKey, type DayStatus } from "@/lib/calendar-utils";
import { DiaryMarkers } from "@/components/DiaryMarkers";
import { LactateLog, type LactateReading } from "@/components/LactateLog";
import type { ActivityCategory } from "@/lib/categories";
import {
  saveManualActivity,
  deleteManualActivity,
  saveDiaryEntry,
  updateActivityCategory,
  resetActivityCategory,
  deletePlannedWorkout,
  updatePlannedWorkout,
  saveTestLt2,
  addPlannedRepGroup,
  updatePlannedRepGroup,
  deletePlannedRepGroup,
  addLactateReading,
  deleteLactateReading,
} from "@/app/(app)/calendar/[year]/[month]/[day]/actions";
import {
  formatDuration,
  formatPace,
  formatKm,
  formatHoursMinutes,
} from "@/lib/format";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  isActivityCategory,
} from "@/lib/categories";
import { analyzeDiaryNote } from "@/lib/diary-text";
import { reviewSession, type ReviewRep } from "@/lib/session-review";
import {
  easyPartsFromLaps,
  edgeLaps,
  qualityRange,
  sessionParts,
  SPLIT_CATEGORIES,
  THRESHOLD_FLOOR_PACE,
  type SplitLap,
} from "@/lib/quality-split";
import {
  WORKOUT_LABELS,
  workoutTypeColorVar,
  type PhaseType,
  type WorkoutType,
} from "@/lib/planning";
import { estimateLt2, LT2_SOURCE_LABELS, type Lt2Estimate } from "@/lib/threshold-test";
import type { SignatureLap } from "@/lib/session-signature";
import { fieldClass, primaryButtonClass, smallButtonClass } from "@/components/ui/controls";

/* Hela innehållet i en dagvy för EN löpare: nyckeltal, tröskeltestkort,
 * planerade pass, genomförda pass med varvtabeller, träningsdagbok och
 * sömn/återhämtning.
 *
 * Bruten ut ur calendar/[year]/[month]/[day]/page.tsx 2026-08-22 för att
 * Blockplans dagsvy (/blockplan/pass) ska kunna visa exakt samma sak i en
 * kolumn per löpare. Att kopiera sektionerna dit hade garanterat att de två
 * vyerna glider isär — det här är samma "en datamodul/en komponent"-princip
 * som lib/arsplan-grid.ts och lib/blockplan-grid.ts redan följer.
 *
 * Komponenten hämtar sin egen data utifrån (userId, dateStr), så anroparen
 * bara behöver veta vem och vilken dag. */

export async function DayContent({
  userId,
  dateStr,
  nextDateStr,
  includePlanned = true,
}: {
  userId: string;
  dateStr: string;
  /** Dagen efter, för aktivitetsintervallet. */
  nextDateStr: string;
  /** Dagsvyn för flera löpare visar planeringen EN gång ovanför kolumnerna
   * (passet är gemensamt, se SharedPlannedDay) och stänger av den här. */
  includePlanned?: boolean;
}) {
  const supabase = await createClient();
  const scopedUserId = userId;

  const [
    { data: activities },
    { data: diaryEntry },
    { data: plannedWorkouts },
    { data: dailyMetrics },
    { data: profile },
  ] = await Promise.all([
      supabase
        .from("activities")
        .select("*, activity_splits(*)")
        .eq("user_id", scopedUserId)
        .gte("start_time", dateStr)
        .lt("start_time", nextDateStr)
        .order("start_time"),
      supabase
        .from("diary_entries")
        .select("*")
        .eq("user_id", scopedUserId)
        .eq("entry_date", dateStr)
        .order("created_at", { ascending: true })
        .limit(1)
        .maybeSingle(),
      // Alla dagens planerade pass, inte bara ett: dubbeltröskel innebär två
      // riktiga pass samma dag och båda ska kunna jämföras mot sitt utfall.
      // Blocknamnet hängs på via relationen till season_blocks, så varje pass
      // vet vilket block det hör till utan en extra fråga.
      // planned_rep_groups(*) hämtas nästlat (K1) — en saknad tabell (om
      // migrationen inte är körd) gör bara att fältet blir undefined på
      // varje rad, aldrig ett kastat fel. PlannedSessions faller tillbaka på
      // `?? []` överallt den läser det.
      supabase
        .from("planned_workouts")
        .select("*, season_blocks(name), planned_rep_groups(*)")
        .eq("user_id", scopedUserId)
        .eq("scheduled_date", dateStr)
        .order("slot", { ascending: true }),
      supabase
        .from("daily_metrics")
        .select("*")
        .eq("user_id", scopedUserId)
        .eq("metric_date", dateStr)
        .maybeSingle(),
      // Bara för K8-kortet nedan: befintligt LT2 (för att visa "ersätter",
      // se lib/threshold-test.ts) och dess källa/datum.
      supabase
        .from("profiles")
        .select(
          "lt2_hr, lt2_source, lt2_measured_on, lt1_hr, max_hr, goal_event, goal_seconds",
        )
        .eq("id", scopedUserId)
        .maybeSingle(),
    ]);

  // Formuläret nedan redigerar dagens första planerade pass; jämförelsen
  // ovanför visar alla.
  const plannedWorkout = (plannedWorkouts ?? [])[0] ?? null;

  // Jämförelsen görs mot passet, inte mot enskilda aktiviteter: uppvärmning,
  // huvudpass och nerjogg loggas separat i Garmin och bara det sammanslagna
  // passet är jämförbart med en plan (se 1.3 i docs/insikter-roadmap.md).
  const hasPlan = (plannedWorkouts ?? []).length > 0;


  const daySessions = groupActivitiesIntoSessions(
    (activities ?? []) as unknown as SessionActivity[],
  );


  // Egna pass (source='manual') redigeras i sin egen sektion, separat från
  // Garmin-listan. Flera per dag stöds, även när dagen redan har Garmin-pass
  // — ett styrkepass på kvällen efter morgonens löpning är normalfallet.
  const garminActivities = (activities ?? []).filter((a) => a.source !== "manual");
  /* Varven hopslagna, hämtade från databasen — INTE uträknade här.
   *
   * Regeln (klockan delar en repetition mitt itu vid varje kilometer, vilorna
   * definierar var repetitionerna går) låg tidigare som en TS-kopia bredvid
   * SQL-versionen som dashboarden använder. Två implementationer av samma
   * domänregel glider isär, det är inte en fråga om om utan när. Nu finns ett
   * facit: funktionen merged_splits.
   *
   * En extra runda, inte en per pass: funktionen tar hela dagens aktiviteter
   * som lista. */
  const activityIds = (activities ?? []).map((a) => (a as { id: string }).id);
  const { data: mergedSplitRows } = activityIds.length
    ? await supabase.rpc("merged_splits", { activity_ids: activityIds })
    : { data: [] };

  type MergedSplitRow = {
    activity_id: string;
    split_index: number;
    parts: number;
    is_rest: boolean;
    distance_meters: number | null;
    duration_seconds: number | null;
    avg_hr: number | null;
  };
  const splitsByActivity = new Map<string, MergedSplitRow[]>();
  for (const r of (mergedSplitRows ?? []) as MergedSplitRow[]) {
    splitsByActivity.set(r.activity_id, [...(splitsByActivity.get(r.activity_id) ?? []), r]);
  }

  /* Blockets fas för dagen. Jämförelsen mot måltiden är fasberoende: i ett
     allmänt block SKA reppen ligga lugnare än tävlingsfart, så utan fasen
     hade varje höstpass sett ut att missa målet. Ligger dagen i ett glapp
     mellan block blir fasen null och jämförelsen görs utan fasomdöme. */
  const { data: dayBlockRow } = await supabase
    .from("season_blocks")
    .select("phase, season_block_athletes!inner(athlete_id)")
    .eq("season_block_athletes.athlete_id", scopedUserId)
    .lte("start_date", dateStr)
    .gte("end_date", dateStr)
    .limit(1)
    .maybeSingle();
  const dayPhase = (dayBlockRow?.phase as PhaseType | undefined) ?? null;

  /* Dagens laktatmätningar. Tabellen och dess actions har funnits sedan
     juli utan gränssnitt; formuläret är nytt 2026-09-26. Hämtas på dagen,
     inte per pass, eftersom ett tröskeltest kan ha stick både under och
     efter passet och alla hör till samma tillfälle. */
  const { data: lactateRows } = await supabase
    .from("lactate_readings")
    .select("id, lactate_mmol, pace_seconds_per_km, heart_rate, context, note, measured_at, activity_id")
    .eq("user_id", scopedUserId)
    .gte("measured_at", dateStr)
    .lt("measured_at", nextDateStr)
    .order("measured_at");

  const manualActivities = (activities ?? []).filter((a) => a.source === "manual");
  const hasOutcome = garminActivities.length > 0 || manualActivities.length > 0;

  // K8 (docs/tranarperspektiv.md): ordinerat tröskeltest + ett genomfört
  // pass samma dag → föreslå LT2. Ett riktigt tröskeltest är nästan alltid
  // dagens enda eller klart längsta Garmin-aktivitet (uppvärmning/nerjogg är
  // kortare fragment) — samma "hårdaste meningsfulla del"-tanke som
  // buildSession i lib/sessions.ts använder för att avgöra passets kategori,
  // fast här räcker varaktighet: vi vill ha den faktiska testinsatsen, inte
  // uppvärmningen. Splitsen läses direkt av den aktiviteten så att
  // varv-index inte blandas ihop mellan flera Garmin-aktiviteter samma dag.
  /* En läsning per genomfört pass. Reppen tas ur merged_splits för passets
     DOMINERANDE aktivitet, inte ur alla fragment: uppvärmningens kilometer
     är inga reps, och att blanda in dem drog intervallernas snittfart åt
     fel håll (samma fallgrop som växlarna gick i, se training-gears.ts). */
  const sessionReviews = daySessions
    .map((session) => {
      const dominantId = session.dominantActivity?.id ?? null;
      const reps: ReviewRep[] = dominantId
        ? (splitsByActivity.get(dominantId) ?? [])
            .filter((r) => !r.is_rest && r.distance_meters != null && r.duration_seconds != null)
            .map((r) => ({
              distanceMeters: Number(r.distance_meters),
              durationSeconds: Number(r.duration_seconds),
              avgHr: r.avg_hr != null ? Number(r.avg_hr) : null,
            }))
        : [];

      const review = reviewSession({
        category: session.category,
        avgHr: session.avgHr,
        distanceMeters: session.distanceMeters,
        durationSeconds: session.durationSeconds,
        reps,
        lt1Hr: profile?.lt1_hr ?? null,
        lt2Hr: profile?.lt2_hr ?? null,
        maxHr: profile?.max_hr ?? null,
        lt2Source: profile?.lt2_source ?? null,
        goalEvent: profile?.goal_event ?? null,
        goalSeconds: profile?.goal_seconds ?? null,
        phase: dayPhase,
      });
      return review ? { sessionId: session.id, category: session.category, review } : null;
    })
    .filter((r) => r !== null);

  const plannedTest = (plannedWorkouts ?? []).find((p) => p.workout_type === "test") ?? null;
  const testActivity =
    plannedTest && garminActivities.length > 0
      ? garminActivities.reduce((best, a) =>
          (a.duration_seconds ?? 0) > (best.duration_seconds ?? 0) ? a : best,
        )
      : null;
  const lt2Estimate =
    plannedTest && hasOutcome
      ? estimateLt2({
          laps: (testActivity?.activity_splits ?? []) as SignatureLap[],
          totalDurationSeconds: testActivity?.duration_seconds ?? null,
          avgHr: testActivity?.avg_hr ?? null,
        })
      : null;

  // Sammanfattningsrader: målet är att man ska slippa öppna en sektion för att
  // veta om den innehåller något.
  /* Passets kategori, men BARA för den aktivitet som avgjorde den.
     Dagvyn visar två tal — passets i sammanfattningen, aktivitetens på
     kortet — och när de skiljer sig såg appen ut att motsäga sig själv.
     Kartan låter kortet förklara skillnaden i stället.
     
     Uppvärmning och nerjogg utelämnas med flit. De ÄR lugna fragment i ett
     intervallpass, och att påpeka det på varje sådant kort hade gett en not
     på åtta av tretton aktiviteter — brus, inte förklaring. Skillnaden är
     bara förvirrande på det fragment kategorin faktiskt kom ifrån. */
  const sessionCategoryByActivity = new Map<string, ActivityCategory>();
  for (const session of daySessions) {
    sessionCategoryByActivity.set(session.dominantActivity.id, session.category);
  }

  // Uppvärmning och nerjogg i ett tröskelpass räknas som distans
  // (lib/quality-split.ts). Varven finns redan hämtade på aktiviteterna.
  const lapsByActivity = new Map<string, SplitLap[]>(
    (activities ?? []).map((a) => [
      (a as { id: string }).id,
      ((a as { activity_splits?: SplitLap[] }).activity_splits ?? []) as SplitLap[],
    ]),
  );
  const dayEasyParts = easyPartsFromLaps(scopedUserId, daySessions, lapsByActivity);

  // Samma nyckeltalsrad som kalenderns övriga vyer (components/PeriodStatTiles.tsx).
  const dayPlanMatches = matchPlanToSessions(
    (plannedWorkouts ?? []) as unknown as PlannedWorkout[],
    daySessions,
  );



  const hasDiaryData = !!(diaryEntry?.notes || diaryEntry?.session_log || diaryEntry?.coach_notes);

  // Anteckningarna kom en gång ur en färgkodad PDF (grönt/rosa = Alice egna
  // ord, positivt/negativt). Den uppdelningen finns redan i schemat (notes
  // vs. session_log vs. coach_notes, se lib/diary-text.ts), men positivt/
  // negativt sparades aldrig som eget fält — det härleds i stället här med
  // samma regelbaserade analys som redan driver P1.2/P2.2, så färgen i UI:t
  // matchar utan att vi behöver importera om PDF:en.
  const noteAnalysis = analyzeDiaryNote(diaryEntry?.notes);
  const noteSentiment: "positive" | "negative" | "neutral" =
    noteAnalysis.score == null
      ? "neutral"
      : noteAnalysis.score > 0.15
        ? "positive"
        : noteAnalysis.score < -0.15
          ? "negative"
          : "neutral";
  const NOTE_SENTIMENT_STYLE = {
    positive: {
      border: "border-emerald-300 dark:border-emerald-800",
      label: "Positivt",
      labelClass: "text-emerald-700 dark:text-emerald-400",
    },
    negative: {
      border: "border-rose-300 dark:border-rose-800",
      label: "Negativt",
      labelClass: "text-rose-700 dark:text-rose-400",
    },
    neutral: {
      border: "border-[var(--line)]",
      label: "Neutralt",
      labelClass: "text-[var(--ink-3)]",
    },
  } as const;


  const todayStr = dateKey(
    new Date().getFullYear(),
    new Date().getMonth() + 1,
    new Date().getDate(),
  );
  const planStatus: "done" | "today" | "missed" | "upcoming" | null = !plannedWorkout
    ? null
    : hasOutcome
      ? "done"
      : dateStr === todayStr
        ? "today"
        : dateStr < todayStr
          ? "missed"
          : "upcoming";

  /* Dagvyn i ny UX (2026-11-21). Förut sju block i rad — Planerat pass,
     Genomförda pass, Träningsdagbok, Sömn — hopfällda var för sig, med
     redigeringsformulär blandade med det man läser. Nu i läsordning:
       Passet   plan och utfall i ett kort, "Så gick passet", kommentaren
       Kroppen  sömn och återhämtning
       Dagboken vad hon skrev
       Ändra    alla formulär, infällda
     Statusen är grå: "Genomfört" i grönt var ett betyg (B4). */
  const reviewBySession = new Map(sessionReviews.map((r) => [r.sessionId, r.review]));
  /* Ingen status vid planen (2026-11-21, begärt): att det genomförda står
     under planen säger redan att passet blev av. Bara det som INTE syns av
     sig självt skrivs ut — att passet blev en annan passtyp, eller inte av. */
  const statusText = !plannedWorkout
    ? null
    : hasOutcome
      ? dayPlanMatches.some((m) => m.outcome === "avvikande typ")
        ? "Blev av som en annan passtyp än planerat."
        : null
      : planStatus === "missed"
        ? "Blev inte av."
        : null;
  const eyebrow = "display text-xs font-semibold tracking-[0.08em] text-[var(--ink-3)] uppercase";
  const card = "rounded-[14px] border border-[var(--line)] bg-[var(--surface)]";

  return (
    <>
      {(diaryEntry?.day_type || diaryEntry?.session_log) && (
        <div className="-mt-2 flex flex-wrap items-center gap-3">
          <DiaryMarkers
            dayType={(diaryEntry.day_type as DayStatus | null) ?? null}
            sessionLog={diaryEntry.session_log as string | null}
            hasSessions={daySessions.length > 0}
          />
        </div>
      )}

      {/* ---------------- Passet ---------------- */}
      <section className="flex flex-col gap-2.5">
        <h2 className={eyebrow}>Passet</h2>
        {!hasPlan && !hasOutcome ? (
          <div className="rounded-[14px] border border-dashed border-[var(--line)] px-4 py-3.5 text-sm text-[var(--ink-2)]">
            Inget planerat och inget genomfört den här dagen.
          </div>
        ) : (
          <div className={`${card} flex flex-col`}>
            {/* Plan och utfall pass för pass (2026-11-21): planen till
                vänster, det genomförda till höger på samma rad, och detaljerna
                (siffror, Så gick passet, kommentaren) i full bredd under. */}
            <div className="grid grid-cols-2 gap-3 px-4 pt-3 text-xs text-[var(--ink-3)]">
              <span>{includePlanned ? "Plan" : ""}</span>
              <span>Genomfört</span>
            </div>
            {pairPlanDone(
              includePlanned ? (plannedWorkouts ?? []) : [],
              daySessions,
              (p) => p.workout_type as string,
              (x) => x.category ?? "",
            ).map(({ plan: p, done: sess }, pi) => {
              const e = sess ? dayEasyParts.get(sess.dominantActivity.id) : undefined;
              const review = sess ? reviewBySession.get(sess.id) : undefined;
              const comments = sess ? sessionComments(sess) : [];
              const minutes = sess ? trainingSeconds(sess) / 60 : 0;
              const pace = sess && sess.distanceMeters > 0 ? sess.durationSeconds / (sess.distanceMeters / 1000) : null;
              return (
                <div key={`${p?.id ?? "x"}-${sess?.id ?? pi}`} className={`flex flex-col gap-3 px-4 py-3 ${pi > 0 ? "border-t border-[var(--line)]" : ""}`}>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {p ? (
                        <>
                          <span className="flex items-start gap-1.5">
                            <span className="mt-1.5"><TypeDot type={p.workout_type} /></span>
                            <span className="display text-base leading-tight font-semibold text-[var(--foreground)]">
                              {p.title || typeLabel(p.workout_type)}
                            </span>
                          </span>
                          {p.description && (
                            <p className="line-clamp-4 text-xs whitespace-pre-line text-[var(--ink-2)]">{p.description}</p>
                          )}
                        </>
                      ) : (
                        <span className="text-sm text-[var(--ink-3)]">{includePlanned ? "Inte planerat" : ""}</span>
                      )}
                    </div>
                    <div className="flex min-w-0 flex-col gap-0.5">
                      {sess ? (
                        <>
                          <span className="flex items-start gap-1.5">
                            <span className="mt-1.5"><TypeDot type={sess.category} /></span>
                            <span className="display text-base leading-tight font-semibold text-[var(--foreground)]">
                              {sess.category ? CATEGORY_LABELS[sess.category] : "Pass"}
                            </span>
                          </span>
                          {sess.dominantActivity.name &&
                            sess.dominantActivity.name.trim().toLowerCase() !==
                              (sess.category ? CATEGORY_LABELS[sess.category] : "").toLowerCase() && (
                              <span className="text-xs text-[var(--ink-2)]">{sess.dominantActivity.name.trim()}</span>
                            )}
                        </>
                      ) : (
                        <span className="text-sm text-[var(--ink-3)]">
                          {p?.workout_type === "strength"
                            ? "Inte loggat med klockan"
                            : planStatus === "missed"
                              ? "Blev inte av"
                              : planStatus === "upcoming"
                                ? "Kommande"
                                : "Inte gjort ännu"}
                        </span>
                      )}
                    </div>
                  </div>
                  {sess && (
                    <>
                  <div className="grid grid-cols-4 gap-2">
                        {[
                          { l: "Distans", v: sess.distanceMeters > 0 ? formatKm(sess.distanceMeters).replace(" km", "") : "–", u: sess.distanceMeters > 0 ? "km" : "" },
                          { l: "Tid", v: String(Math.round(minutes || sess.durationSeconds / 60)), u: "min" },
                          { l: "Fart", v: pace ? formatPace(pace).replace(" /km", "") : "–", u: pace ? "/km" : "" },
                          { l: "Puls", v: sess.avgHr ? String(Math.round(sess.avgHr)) : "–", u: "" },
                        ].map((t) => (
                          <div key={t.l} className="flex flex-col">
                            <span className="text-xs text-[var(--ink-3)]">{t.l}</span>
                            <span className="display tabular text-xl font-bold text-[var(--foreground)]">
                              {t.v}
                              {t.u && <span className="ml-0.5 text-xs font-medium text-[var(--ink-3)]">{t.u}</span>}
                            </span>
                          </div>
                        ))}
                      </div>
                      {e && (
                        <p className="text-sm text-[var(--ink-2)]">
                          {sessionParts(sess.category, sess.distanceMeters, sess.durationSeconds, e)
                            .map((part) => `${part.category === "easy" ? "uppvärmning och nerjogg" : CATEGORY_LABELS[part.category as ActivityCategory] ?? "kvalitet"} ${formatKm(part.meters)}`)
                            .join(" · ")}
                        </p>
                      )}
                      {review && (
                        <div className="flex flex-col gap-1 rounded-[10px] px-3 py-2.5" style={{ backgroundColor: "var(--surface-insight)" }}>
                          <span className={eyebrow}>Så gick passet</span>
                          <p className="text-sm font-medium text-[var(--foreground)]">{review.headline}</p>
                          {review.lines.map((line, i) => (
                            <p key={i} className="text-sm text-[var(--ink-2)]">{line}</p>
                          ))}
                          {review.caveat && <p className="text-xs text-[var(--ink-3)]">{review.caveat}</p>}
                        </div>
                      )}
                      {comments.length > 0 && (
                        <div className="flex flex-col gap-1">
                          <span className={eyebrow}>Kommentar i Garmin</span>
                          <SessionComments comments={comments} />
                        </div>
                      )}
                    </>
                  )}
                </div>
              );
            })}
            {statusText && <p className="px-4 pb-3 text-sm text-[var(--ink-2)]">{statusText}</p>}

            {garminActivities.some((a) => a.activity_splits?.length > 0) && (
              <details className="group border-t border-[var(--line)]">
                <summary className="flex min-h-11 cursor-pointer list-none items-center justify-between px-4 text-sm text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
                  Varven
                  <span aria-hidden className="text-[var(--ink-3)] transition-transform group-open:rotate-90">›</span>
                </summary>
                <div className="flex flex-col gap-3 px-4 pb-4">
                  {garminActivities.filter((a) => a.activity_splits?.length > 0).map((a) => (
                    <div key={a.id} className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
                      <span className="col-span-2 font-medium text-[var(--foreground)] sm:col-span-4">{a.name ?? "Pass"}</span>
            {(() => {
              // Tröskeldel och distansdel, samma delning som Analys räknar på.
              const floor = THRESHOLD_FLOOR_PACE[scopedUserId];
              if (floor == null || !SPLIT_CATEGORIES.has(a.category ?? "")) return null;
              const e = edgeLaps((a.activity_splits ?? []) as SplitLap[], floor);
              if (e.meters <= 0 || !(a.distance_meters > 0)) return null;
              const qualityM = Math.max(0, a.distance_meters - e.meters);
              return (
                <p className="col-span-2 text-xs text-[var(--ink-2)] sm:col-span-4">
                  {CATEGORY_LABELS[a.category as ActivityCategory] ?? "Kvalitet"}{" "}
                  {formatKm(qualityM)} · distans (uppvärmning och nerjogg) {formatKm(e.meters)},{" "}
                  {formatDuration(e.seconds)}. Varv långsammare än{" "}
                  {formatPace(THRESHOLD_FLOOR_PACE[scopedUserId] ?? null)} räknas som distans.
                </p>
              );
            })()}
            {a.activity_splits?.length > 0 && (
              <div className="col-span-2 mt-2 sm:col-span-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-[var(--ink-3)]">
                      <th className="pr-3 font-normal">#</th>
                      <th className="pr-3 font-normal">Distans</th>
                      <th className="pr-3 font-normal">Tid</th>
                      <th className="pr-3 font-normal">Pace</th>
                      <th className="font-normal">Puls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {/* Varven kommer färdigt hopslagna från merged_splits.
                        Klockan delar en repetition mitt itu vid varje
                        kilometer, så 5×1600 m låg som tio rader: 1000 + 600,
                        1000 + 600 … Tabellen visade dem rått och passet gick
                        inte att känna igen. Regeln och dess undantag står i
                        migrationen merged_splits_single_source. */}
                    {(() => {
                      let repNr = 0;
                      const rows = splitsByActivity.get(a.id) ?? [];
                      // Uppvärmning och nerjogg i ett kvalitetspass: varven
                      // före första och efter sista varvet i tröskelfart
                      // (lib/quality-split.ts). De är distans, inte rep.
                      const floor = THRESHOLD_FLOOR_PACE[scopedUserId];
                      const range =
                        floor != null && SPLIT_CATEGORIES.has(a.category ?? "")
                          ? qualityRange(
                              rows.map((r) => ({
                                isRest: r.is_rest,
                                meters: r.distance_meters,
                                seconds: r.duration_seconds,
                              })),
                              floor,
                            )
                          : null;
                      return rows.map((s, i) => {
                        const edge =
                          range == null
                            ? null
                            : i < range.first
                              ? "uppvärmning"
                              : i > range.last && !s.is_rest
                                ? "nerjogg"
                                : null;
                        if (!s.is_rest && !edge) repNr += 1;
                        const dist = s.distance_meters ?? 0;
                        const dur = s.duration_seconds ?? 0;
                        const pace = dist > 0 ? dur / (dist / 1000) : null;
                        return (
                          <tr
                            key={s.split_index}
                            className={`border-t border-[var(--line)] ${
                              s.is_rest || edge ? "text-[var(--ink-3)]" : ""
                            }`}
                          >
                            <td className="py-1 pr-3">{edge ?? (s.is_rest ? "vila" : repNr)}</td>
                            <td className="pr-3">{formatKm(dist)}</td>
                            <td className="pr-3">{formatDuration(dur)}</td>
                            <td className="pr-3">{formatPace(pace)}</td>
                            <td>{s.avg_hr ? Math.round(s.avg_hr) : "–"}</td>
                          </tr>
                        );
                      });
                    })()}
                  </tbody>
                </table>
              </div>
            )}
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}
      </section>

      {plannedTest && hasOutcome && lt2Estimate && (
        <ThresholdTestCard
          dateStr={dateStr}
          athleteId={scopedUserId}
          estimate={lt2Estimate}
          currentLt2={profile?.lt2_hr ?? null}
          currentSource={profile?.lt2_source ?? null}
          currentMeasuredOn={profile?.lt2_measured_on ?? null}
          saveAction={saveTestLt2}
        />
      )}

      {/* ---------------- Kroppen ---------------- */}
      {dailyMetrics && (
        <section className="flex flex-col gap-2.5">
          <h2 className={eyebrow}>Kroppen · natten före</h2>
          <div className="grid grid-cols-4 gap-2">
            {[
              { l: "Sömn", v: formatHoursMinutes(dailyMetrics.sleep_seconds).replace(" min", "").replace(" h ", ":") },
              { l: "Poäng", v: dailyMetrics.sleep_score != null ? String(dailyMetrics.sleep_score) : "–" },
              { l: "Vilopuls", v: dailyMetrics.resting_hr != null ? String(dailyMetrics.resting_hr) : "–" },
              { l: "HRV", v: dailyMetrics.hrv_overnight_avg != null ? String(Math.round(dailyMetrics.hrv_overnight_avg)) : "–" },
            ].map((t) => (
              <div key={t.l} className="flex flex-col rounded-[12px] border border-[var(--line)] px-2.5 py-2">
                <span className="text-xs text-[var(--ink-3)]">{t.l}</span>
                <span className="display tabular text-lg font-bold text-[var(--foreground)]">{t.v}</span>
              </div>
            ))}
          </div>
          <details className="group text-sm text-[var(--ink-2)]">
            <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
              <span aria-hidden className="text-[var(--ink-3)] transition-transform group-open:rotate-90">›</span>
              Sömnens faser
            </summary>
            <div className="mt-1 grid grid-cols-2 gap-x-6 gap-y-2 pl-4 sm:grid-cols-4">
              <Stat label="Sömn" value={formatHoursMinutes(dailyMetrics.sleep_seconds)} />
              <Stat label="Djupsömn" value={formatHoursMinutes(dailyMetrics.deep_sleep_seconds)} />
              <Stat label="REM" value={formatHoursMinutes(dailyMetrics.rem_sleep_seconds)} />
              <Stat label="Lätt sömn" value={formatHoursMinutes(dailyMetrics.light_sleep_seconds)} />
              <Stat label="Vaken" value={formatHoursMinutes(dailyMetrics.awake_seconds)} />
            </div>
          </details>
        </section>
      )}

      {/* ---------------- Dagboken ---------------- */}
      <section className="flex flex-col gap-2.5">
        <h2 className={eyebrow}>Dagboken</h2>
        {hasDiaryData ? (
          <div className={`${card} flex flex-col gap-3 px-4 py-3.5 text-sm`}>
            {diaryEntry?.session_log && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-[var(--ink-3)]">Träningslogg</span>
                <p className="whitespace-pre-wrap text-[var(--foreground)]">{diaryEntry.session_log}</p>
              </div>
            )}
            {diaryEntry?.notes && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-[var(--ink-3)]">Anteckningar</span>
                <p className="whitespace-pre-wrap text-[var(--foreground)]">{diaryEntry.notes}</p>
              </div>
            )}
            {diaryEntry?.coach_notes && (
              <div className="flex flex-col gap-0.5">
                <span className="text-xs text-[var(--ink-3)]">Tränarens kommentar</span>
                <p className="whitespace-pre-wrap text-[var(--foreground)]">{diaryEntry.coach_notes}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="rounded-[14px] border border-dashed border-[var(--line)] px-4 py-3.5 text-sm text-[var(--ink-2)]">
            Ingen anteckning den här dagen.
          </div>
        )}
      </section>

      {/* ---------------- Ändra ---------------- */}
      <details className={`group ${card}`}>
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-semibold text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
          Ändra dagen
          <span aria-hidden className="text-[var(--ink-3)] transition-transform group-open:rotate-90">›</span>
        </summary>
        <div className="flex flex-col gap-5 border-t border-[var(--line)] p-4">
          {includePlanned && (
            <div className="flex flex-col gap-2">
              <span className={eyebrow}>Planerat pass</span>
          <PlannedSessions
            planned={(plannedWorkouts ?? []) as PlannedRow[]}
            updateAction={updatePlannedWorkout}
            deleteAction={deletePlannedWorkout}
            addRepGroupAction={addPlannedRepGroup}
            updateRepGroupAction={updatePlannedRepGroup}
            deleteRepGroupAction={deletePlannedRepGroup}
          />
            </div>
          )}
          {garminActivities.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className={eyebrow}>Passtyp</span>
              {garminActivities.map((a) => (
                <div key={a.id} className="flex flex-col gap-1.5">
                  <span className="text-sm text-[var(--ink-2)]">{a.name ?? "Pass"}</span>
                  <div className="flex flex-wrap items-center gap-3">
              <form action={updateActivityCategory} className="flex items-center gap-2">
                <input type="hidden" name="activity_id" value={a.id} />
                <select
                  name="category"
                  defaultValue={(() => {
                    const shown = sessionCategoryByActivity.get(a.id) ?? a.category;
                    return isActivityCategory(shown ?? "") ? shown! : "";
                  })()}
                  className={fieldClass}
                >
                  {CATEGORY_VALUES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className={smallButtonClass}
                >
                  Spara kategori
                </button>
              </form>
              {a.category_source === "manual" ? (
                <form action={resetActivityCategory}>
                  <input type="hidden" name="activity_id" value={a.id} />
                  <button
                    type="submit"
                    className="text-xs text-[var(--ink-3)] underline hover:text-[var(--foreground)]"
                  >
                    återställ till auto
                  </button>
                </form>
              ) : (
                <span className="text-xs text-[var(--ink-3)]">auto</span>
              )}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <span className={eyebrow}>Egna pass</span>
            <p className="text-sm text-[var(--ink-3)]">
              Träning som inte kommer från klockan — styrka, cykel, simning eller ett löppass utan klocka.
            </p>
        <ManualSessions
          dateStr={dateStr}
          activities={manualActivities as ManualActivity[]}
          saveAction={saveManualActivity}
          deleteAction={deleteManualActivity}
          athleteId={scopedUserId}
        />
          </div>
          <div className="flex flex-col gap-2">
            <span className={eyebrow}>Laktat</span>
        <LactateLog
          readings={(lactateRows ?? []) as LactateReading[]}
          activityId={daySessions[0]?.dominantActivity?.id ?? null}
          entryDate={dateStr}
          athleteId={scopedUserId}
          addAction={addLactateReading}
          deleteAction={deleteLactateReading}
        />
          </div>
          <div className="flex flex-col gap-2">
            <span className={eyebrow}>Skriv i dagboken</span>
        <form
          action={saveDiaryEntry}
          className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
        >
          <input type="hidden" name="entry_date" value={dateStr} />
          <input type="hidden" name="entry_id" value={diaryEntry?.id ?? ""} />
          <input type="hidden" name="athlete" value={scopedUserId} />

          <label className="flex flex-col gap-1 text-sm">
            <span className="flex items-center gap-2">
              Anteckningar (Alice egna ord)
              <span
                className={`text-xs font-medium ${NOTE_SENTIMENT_STYLE[noteSentiment].labelClass}`}
              >
                {NOTE_SENTIMENT_STYLE[noteSentiment].label}
              </span>
            </span>
            <textarea
              name="notes"
              rows={4}
              defaultValue={diaryEntry?.notes ?? ""}
              className={`rounded border-2 bg-[var(--surface)] px-2 py-1 ${NOTE_SENTIMENT_STYLE[noteSentiment].border}`}
            />
          </label>

          <button
            type="submit"
            className={primaryButtonClass}
          >
            Spara
          </button>
        </form>
          </div>
        </div>
      </details>
    </>
  );
}

function typeLabel(type: string): string {
  if (isActivityCategory(type)) return CATEGORY_LABELS[type];
  return WORKOUT_LABELS[type as WorkoutType] ?? type;
}

/** Liten färgad prick i passets typfärg — samma "se typen utan att läsa
 * etiketten"-princip som veckovyns Marker, bara utan den ihåliga/fyllda
 * plan-mot-utfall-distinktionen (den finns redan i respektive sektion). */
function TypeDot({ type }: { type: string | null }) {
  const color = type ? workoutTypeColorVar(type) : null;
  return (
    <span
      className="inline-block h-2 w-2 shrink-0 rounded-full"
      style={{ backgroundColor: color ?? "#a1a1aa" }}
      aria-hidden="true"
    />
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-[var(--ink-3)]">{label}</div>
      <div className="text-[var(--foreground)]">{value}</div>
    </div>
  );
}

/**
 * K8 (docs/tranarperspektiv.md): förslag på LT2 ur ett genomfört
 * tröskeltest. Visas bara den dag testet gjordes — dagvyn ser ut precis som
 * idag i övrigt. Skriver aldrig till profiles på egen hand; spara-knappen är
 * en vanlig `<form action={saveAction}>` (P0.4-mönstret i den här filen),
 * ingen klient-JS.
 */
function ThresholdTestCard({
  dateStr,
  athleteId,
  estimate,
  currentLt2,
  currentSource,
  currentMeasuredOn,
  saveAction,
}: {
  dateStr: string;
  /** Fas 0-uppföljning: vilken löpares profil ett sparat LT2 ska skrivas
   * till — se resolvedAthleteId i actions.ts. */
  athleteId: string;
  estimate: Lt2Estimate;
  currentLt2: number | null;
  currentSource: string | null;
  currentMeasuredOn: string | null;
  saveAction: (formData: FormData) => void;
}) {
  const currentLabel =
    currentLt2 != null
      ? [
          `${currentLt2} slag/min`,
          currentSource ? LT2_SOURCE_LABELS[currentSource] ?? currentSource : null,
          currentMeasuredOn,
        ]
          .filter(Boolean)
          .join(" · ")
      : null;

  return (
    <section className="flex flex-col gap-3 rounded border border-emerald-300/70 bg-emerald-50/40 p-4 dark:border-emerald-800/70 dark:bg-emerald-950/20">
      <h2 className="text-sm font-medium text-emerald-800 dark:text-emerald-300">
        Tröskeltest genomfört — förslag på LT2
      </h2>

      {estimate.lt2 != null ? (
        <>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-2">
            <div>
              <div className="text-xs text-[var(--ink-3)]">Uppskattat LT2</div>
              <div className="text-3xl font-semibold text-[var(--foreground)]">
                {estimate.lt2}{" "}
                <span className="text-base font-normal text-[var(--ink-3)]">
                  slag/min
                </span>
              </div>
            </div>
            {currentLabel && (
              <div>
                <div className="text-xs text-[var(--ink-3)]">Sparat sedan tidigare</div>
                <div className="text-sm text-[var(--ink-2)]">{currentLabel}</div>
              </div>
            )}
          </div>

          <p className="text-xs text-[var(--ink-3)]">
            {estimate.reason ??
              `Bygger på tidsviktad snittpuls för de sista ${estimate.minutesUsed} minuterna av passet.`}{" "}
            Klockans pulszoner räknas inte om av det här — värdet blir ett facit att jämföra
            fördelningen på /trends mot, inte en ny beräkning av staplarna.
          </p>

          <form action={saveAction} className="flex flex-wrap items-center gap-3">
            <input type="hidden" name="lt2_hr" value={estimate.lt2} />
            <input type="hidden" name="measured_on" value={dateStr} />
            <input type="hidden" name="athlete" value={athleteId} />
            <button
              type="submit"
              className={primaryButtonClass}
            >
              {currentLt2 != null
                ? `Ersätt sparat LT2 (${currentLt2}) med ${estimate.lt2}`
                : "Spara som LT2"}
            </button>
            <span className="text-xs text-[var(--ink-3)]">
              Sparas som fälttest — en uppskattning, inte ett laktattest.
            </span>
          </form>
        </>
      ) : (
        <p className="text-sm text-[var(--ink-2)]">{estimate.reason}</p>
      )}
    </section>
  );
}

/** Dagens planering EN gång för flera löpare — passets innehåll är
 * gemensamt (se passSiblingIds i calendar-dagvyns actions.ts), så det ska
 * inte redigeras en gång per kolumn. Uttrycklig begäran 2026-08-22: två
 * identiska formulär bredvid varandra för samma pass är fel bild av
 * modellen, man taggar löpare TILL ett pass.
 *
 * Passen grupperas på (block, slot) — samma nyckel som avgör vilka rader som
 * hör ihop. Varje grupp renderas med EN redigerare (första radens id;
 * uppdateringen propagerar till alla taggade) och namnen på dem som är med,
 * så det syns när ett pass bara gäller några av löparna i vyn. */
export async function SharedPlannedDay({
  athleteIds,
  dateStr,
  athleteNames,
}: {
  athleteIds: string[];
  dateStr: string;
  athleteNames: Map<string, string>;
}) {
  const supabase = await createClient();
  const { data: rows } = await supabase
    .from("planned_workouts")
    .select("*, season_blocks(name), planned_rep_groups(*)")
    .in("user_id", athleteIds)
    .eq("scheduled_date", dateStr)
    .order("slot", { ascending: true });

  const planned = (rows ?? []) as (PlannedRow & {
    user_id: string;
    block_id: string | null;
    slot: number | null;
  })[];

  const groups = new Map<string, typeof planned>();
  for (const row of planned) {
    const key = `${row.block_id ?? "utan-block"}|${row.slot ?? 1}`;
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }

  if (groups.size === 0) {
    return (
      <DaySection title="Planerat pass" hasData={false} summary="Inget planerat">
        <p className="text-sm text-[var(--ink-3)]">Inget planerat pass den här dagen.</p>
      </DaySection>
    );
  }

  return (
    <DaySection
      title="Planerat pass"
      hasData
      summary={
        <span className="flex flex-wrap items-center gap-2">
          {[...groups.values()].map((group) => (
            <span key={group[0].id} className="inline-flex items-center gap-1.5">
              <TypeDot type={group[0].workout_type} />
              {group[0].title || typeLabel(group[0].workout_type)}
            </span>
          ))}
        </span>
      }
    >
      {[...groups.values()].map((group) => {
        const names = group
          .map((r) => athleteNames.get(r.user_id))
          .filter((n): n is string => n != null);
        return (
          <div key={group[0].id} className="flex flex-col gap-2">
            {names.length > 0 && (
              <div className="flex flex-wrap items-center gap-1 text-xs text-[var(--ink-3)]">
                <span>Gäller:</span>
                {names.map((n) => (
                  <span
                    key={n}
                    className="rounded-full bg-[var(--line)] px-1.5 py-0.5 text-[var(--ink-2)]"
                  >
                    {n}
                  </span>
                ))}
              </div>
            )}
            {/* En redigerare för hela gruppen. Vilken rad den utgår från
                spelar ingen roll — updatePlannedWorkout skriver till alla
                löpares rader för passet. */}
            <PlannedSessions
              planned={[group[0]] as PlannedRow[]}
              updateAction={updatePlannedWorkout}
              deleteAction={deletePlannedWorkout}
              addRepGroupAction={addPlannedRepGroup}
              updateRepGroupAction={updatePlannedRepGroup}
              deleteRepGroupAction={deletePlannedRepGroup}
            />
          </div>
        );
      })}
    </DaySection>
  );
}
