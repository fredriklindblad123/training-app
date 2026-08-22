import { ManualSessions, type ManualActivity } from "@/components/ManualSessions";
import { PlannedSessions, type PlannedRow } from "@/components/PlannedSessions";
import { DaySection } from "@/components/DaySection";
import { PeriodStatTiles } from "@/components/PeriodStatTiles";
import { createClient } from "@/lib/supabase/server";
import { groupActivitiesIntoSessions, type SessionActivity } from "@/lib/sessions";
import {
  matchPlanToSessions,
  summarizeCompliance,
  type PlannedWorkout,
} from "@/lib/plan-matching";
import { dateKey } from "@/lib/calendar-utils";
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
import { WORKOUT_LABELS, workoutTypeColorVar, type WorkoutType } from "@/lib/planning";
import { estimateLt2, LT2_SOURCE_LABELS, type Lt2Estimate } from "@/lib/threshold-test";
import type { SignatureLap } from "@/lib/session-signature";

/* Hela innehållet i en dagvy för EN löpare: nyckeltal, tröskeltestkort,
 * planerade pass, genomförda pass med varvtabeller, träningsdagbok och
 * sömn/återhämtning.
 *
 * Bruten ut ur calendar/[year]/[month]/[day]/page.tsx 2026-08-22 för att
 * Detaljplans dagsvy (/detaljplan/pass) ska kunna visa exakt samma sak i en
 * kolumn per löpare. Att kopiera sektionerna dit hade garanterat att de två
 * vyerna glider isär — det här är samma "en datamodul/en komponent"-princip
 * som lib/arsplan-grid.ts och lib/detaljplan-grid.ts redan följer.
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
        .select("lt2_hr, lt2_source, lt2_measured_on")
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
  const dayKm = daySessions.reduce((sum, s) => sum + (s.distanceMeters ?? 0), 0) / 1000;
  const daySeconds = daySessions.reduce((sum, s) => sum + (s.durationSeconds ?? 0), 0);

  // Samma nyckeltalsrad som kalenderns övriga vyer (components/PeriodStatTiles.tsx).
  const dayPlanMatches = matchPlanToSessions(
    (plannedWorkouts ?? []) as unknown as PlannedWorkout[],
    daySessions,
  );
  const dayCompliance = summarizeCompliance(dayPlanMatches);

  const doneSummary =
    daySessions.length === 0
      ? "Inget pass"
      : `${daySessions.length} ${daySessions.length === 1 ? "pass" : "pass"} · ${formatKm(dayKm * 1000)} · ${formatDuration(daySeconds)}`;

  const diarySummary = diaryEntry?.notes
    ? diaryEntry.notes.replace(/\s+/g, " ").slice(0, 70) +
      (diaryEntry.notes.length > 70 ? "…" : "")
    : "Ingen anteckning";

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
      border: "border-zinc-300 dark:border-zinc-700",
      label: "Neutralt",
      labelClass: "text-zinc-500 dark:text-zinc-400",
    },
  } as const;

  const sleepSummary = dailyMetrics
    ? [
        formatHoursMinutes(dailyMetrics.sleep_seconds),
        dailyMetrics.sleep_score != null ? `poäng ${dailyMetrics.sleep_score}` : null,
        dailyMetrics.resting_hr != null ? `vilopuls ${dailyMetrics.resting_hr}` : null,
        dailyMetrics.hrv_overnight_avg != null
          ? `HRV ${Math.round(dailyMetrics.hrv_overnight_avg)} ms`
          : null,
      ]
        .filter(Boolean)
        .join(" · ")
    : "Ingen mätning";

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

  return (
    <>
      <PeriodStatTiles sessions={daySessions} compliance={dayCompliance} />

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

      {includePlanned && (
        <DaySection
          title="Planerat pass"
          hasData={hasPlan}
          summary={
            <span className="flex flex-wrap items-center gap-2">
              {hasPlan ? (
                (plannedWorkouts ?? []).map((p, i) => (
                  <span key={p.id ?? i} className="inline-flex items-center gap-1.5">
                    <TypeDot type={p.workout_type} />
                    {p.title || typeLabel(p.workout_type)}
                  </span>
                ))
              ) : (
                "Inget planerat"
              )}
              <PlanStatusBadge status={planStatus} />
            </span>
          }
        >
          <PlannedSessions
            planned={(plannedWorkouts ?? []) as PlannedRow[]}
            updateAction={updatePlannedWorkout}
            deleteAction={deletePlannedWorkout}
            addRepGroupAction={addPlannedRepGroup}
            updateRepGroupAction={updatePlannedRepGroup}
            deleteRepGroupAction={deletePlannedRepGroup}
          />
        </DaySection>
      )}

      <DaySection
        title="Genomförda pass"
        hasData={hasOutcome}
        summary={
          daySessions.length === 0 ? (
            doneSummary
          ) : (
            <span className="flex flex-wrap items-center gap-2">
              {daySessions.map((s) => (
                <span key={s.id} className="inline-flex items-center gap-1.5">
                  <TypeDot type={s.category} />
                  {s.category ? CATEGORY_LABELS[s.category] : "Pass"}
                </span>
              ))}
              <span className="text-zinc-400 dark:text-zinc-600">
                · {formatKm(dayKm * 1000)} · {formatDuration(daySeconds)}
              </span>
            </span>
          )
        }
      >
        {garminActivities.length === 0 && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inget synkat pass den här dagen.
          </p>
        )}
        {garminActivities.map((a) => (
          <div
            key={a.id}
            className="grid grid-cols-2 gap-x-6 gap-y-2 rounded border border-zinc-200 p-4 text-sm sm:grid-cols-4 dark:border-zinc-800"
          >
            <div className="col-span-2 flex flex-wrap items-center gap-3 text-base font-medium text-zinc-900 sm:col-span-4 dark:text-zinc-100">
              <span>
                {a.name ?? "Pass"}{" "}
                <span className="text-zinc-400">({a.activity_type})</span>
              </span>
              <CategoryBadge category={a.category} />
            </div>
            <div className="col-span-2 flex flex-wrap items-center gap-3 sm:col-span-4">
              <form action={updateActivityCategory} className="flex items-center gap-2">
                <input type="hidden" name="activity_id" value={a.id} />
                <select
                  name="category"
                  defaultValue={isActivityCategory(a.category ?? "") ? a.category! : ""}
                  className="rounded border border-zinc-300 bg-transparent px-2 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900"
                >
                  {CATEGORY_VALUES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
                <button
                  type="submit"
                  className="rounded border border-zinc-300 px-2 py-1 text-xs text-zinc-700 hover:border-zinc-950 hover:text-zinc-950 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-zinc-50 dark:hover:text-zinc-50"
                >
                  Spara kategori
                </button>
              </form>
              {a.category_source === "manual" ? (
                <form action={resetActivityCategory}>
                  <input type="hidden" name="activity_id" value={a.id} />
                  <button
                    type="submit"
                    className="text-xs text-zinc-400 underline hover:text-zinc-950 dark:hover:text-zinc-50"
                  >
                    återställ till auto
                  </button>
                </form>
              ) : (
                <span className="text-xs text-zinc-400">auto</span>
              )}
            </div>
            <Stat label="Distans" value={formatKm(a.distance_meters)} />
            <Stat label="Tid" value={formatDuration(a.duration_seconds)} />
            <Stat label="Snittpace" value={formatPace(a.avg_pace_seconds_per_km)} />
            <Stat
              label="Puls"
              value={
                a.avg_hr ? `${Math.round(a.avg_hr)} (max ${Math.round(a.max_hr ?? 0)})` : "–"
              }
            />
            <Stat
              label="Träningseffekt"
              value={
                a.aerobic_training_effect
                  ? `${a.aerobic_training_effect.toFixed(1)} (${a.training_effect_label ?? ""})`
                  : "–"
              }
            />
            <Stat
              label="Kadens"
              value={a.avg_cadence ? `${Math.round(a.avg_cadence)} spm` : "–"}
            />
            <Stat
              label="Höjdmeter"
              value={a.elevation_gain != null ? `${Math.round(a.elevation_gain)} m` : "–"}
            />
            <Stat label="Kalorier" value={a.calories ? `${Math.round(a.calories)}` : "–"} />

            {a.activity_splits?.length > 0 && (
              <div className="col-span-2 mt-2 sm:col-span-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500 dark:text-zinc-400">
                      <th className="pr-3 font-normal">#</th>
                      <th className="pr-3 font-normal">Distans</th>
                      <th className="pr-3 font-normal">Tid</th>
                      <th className="pr-3 font-normal">Pace</th>
                      <th className="font-normal">Puls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.activity_splits
                      .sort(
                        (x: { split_index: number }, y: { split_index: number }) =>
                          x.split_index - y.split_index,
                      )
                      .map(
                        (s: {
                          split_index: number;
                          distance_meters: number | null;
                          duration_seconds: number | null;
                          avg_pace_seconds_per_km: number | null;
                          avg_hr: number | null;
                        }) => (
                          <tr key={s.split_index} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-1 pr-3">{s.split_index}</td>
                            <td className="pr-3">{formatKm(s.distance_meters)}</td>
                            <td className="pr-3">{formatDuration(s.duration_seconds)}</td>
                            <td className="pr-3">{formatPace(s.avg_pace_seconds_per_km)}</td>
                            <td>{s.avg_hr ? Math.round(s.avg_hr) : "–"}</td>
                          </tr>
                        ),
                      )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}

        {manualActivities.length > 0 && (
          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">Egna pass</div>
        )}
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Träning som inte kommer från klockan — styrka, cykel, simning eller ett löppass du
          glömt starta klockan på. Flera per dag går bra.
        </p>
        <ManualSessions
          dateStr={dateStr}
          activities={manualActivities as ManualActivity[]}
          saveAction={saveManualActivity}
          deleteAction={deleteManualActivity}
          athleteId={scopedUserId}
        />
      </DaySection>

      <DaySection title="Träningsdagbok" summary={diarySummary} hasData={hasDiaryData}>
        {diaryEntry?.session_log && (
          <div className="rounded border border-zinc-200 p-4 text-sm dark:border-zinc-800">
            <div className="text-xs text-zinc-500 dark:text-zinc-400">Träningslogg</div>
            <div className="whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
              {diaryEntry.session_log}
            </div>
          </div>
        )}

        {diaryEntry?.coach_notes && (
          <div className="rounded border border-sky-300 bg-sky-50/60 p-4 text-sm dark:border-sky-800 dark:bg-sky-950/20">
            <div className="text-xs text-sky-700 dark:text-sky-400">Tränarens kommentar</div>
            <div className="whitespace-pre-wrap text-zinc-900 dark:text-zinc-100">
              {diaryEntry.coach_notes}
            </div>
          </div>
        )}

        <form
          action={saveDiaryEntry}
          className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
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
              className={`rounded border-2 px-2 py-1 dark:bg-zinc-900 ${NOTE_SENTIMENT_STYLE[noteSentiment].border}`}
            />
          </label>

          <button
            type="submit"
            className="w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Spara
          </button>
        </form>
      </DaySection>

      {dailyMetrics && (
        <DaySection title="Sömn &amp; återhämtning" summary={sleepSummary} hasData={true}>
          <div className="grid grid-cols-2 gap-x-6 gap-y-3 rounded border border-zinc-200 p-4 text-sm sm:grid-cols-4 dark:border-zinc-800">
            <Stat label="Sömn" value={formatHoursMinutes(dailyMetrics.sleep_seconds)} />
            <Stat
              label="Sömnpoäng"
              value={dailyMetrics.sleep_score ? `${dailyMetrics.sleep_score} / 100` : "–"}
            />
            <Stat
              label="Vilopuls"
              value={dailyMetrics.resting_hr ? `${dailyMetrics.resting_hr} slag/min` : "–"}
            />
            <Stat
              label="HRV (natt)"
              value={
                dailyMetrics.hrv_overnight_avg
                  ? `${Math.round(dailyMetrics.hrv_overnight_avg)} ms`
                  : "–"
              }
            />
            <Stat label="Djupsömn" value={formatHoursMinutes(dailyMetrics.deep_sleep_seconds)} />
            <Stat label="REM" value={formatHoursMinutes(dailyMetrics.rem_sleep_seconds)} />
            <Stat label="Lätt sömn" value={formatHoursMinutes(dailyMetrics.light_sleep_seconds)} />
            <Stat label="Vaken" value={formatHoursMinutes(dailyMetrics.awake_seconds)} />
          </div>
        </DaySection>
      )}
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
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}

function PlanStatusBadge({
  status,
}: {
  status: "done" | "today" | "missed" | "upcoming" | null;
}) {
  if (!status) return null;
  const label = {
    done: "Genomfört",
    today: "Idag",
    missed: "Missat",
    upcoming: "Planerat",
  }[status];
  const className = {
    done: "bg-emerald-500 text-white",
    today: "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300",
    missed: "bg-amber-500 text-white",
    upcoming: "border border-zinc-300 text-zinc-700 dark:border-zinc-700 dark:text-zinc-300",
  }[status];
  return (
    <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
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
              <div className="text-xs text-zinc-500 dark:text-zinc-400">Uppskattat LT2</div>
              <div className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
                {estimate.lt2}{" "}
                <span className="text-base font-normal text-zinc-500 dark:text-zinc-400">
                  slag/min
                </span>
              </div>
            </div>
            {currentLabel && (
              <div>
                <div className="text-xs text-zinc-500 dark:text-zinc-400">Sparat sedan tidigare</div>
                <div className="text-sm text-zinc-600 dark:text-zinc-400">{currentLabel}</div>
              </div>
            )}
          </div>

          <p className="text-xs text-zinc-500 dark:text-zinc-400">
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
              className="w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              {currentLt2 != null
                ? `Ersätt sparat LT2 (${currentLt2}) med ${estimate.lt2}`
                : "Spara som LT2"}
            </button>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              Sparas som fälttest — en uppskattning, inte ett laktattest.
            </span>
          </form>
        </>
      ) : (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">{estimate.reason}</p>
      )}
    </section>
  );
}

function CategoryBadge({ category }: { category: string | null }) {
  if (!category || !isActivityCategory(category)) return null;
  return (
    <span
      className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-xs font-normal text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ backgroundColor: `var(--cat-${category})` }}
      />
      {CATEGORY_LABELS[category]}
    </span>
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
        <p className="text-sm text-zinc-400 dark:text-zinc-600">Inget planerat pass den här dagen.</p>
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
              <div className="flex flex-wrap items-center gap-1 text-xs text-zinc-500 dark:text-zinc-400">
                <span>Gäller:</span>
                {names.map((n) => (
                  <span
                    key={n}
                    className="rounded-full bg-zinc-200 px-1.5 py-0.5 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
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
