import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { DailyCheckIn } from "@/components/DailyCheckIn";
import { DailyStatus } from "@/components/DailyStatus";
import { KpiRing, type KpiDetailRow } from "@/components/KpiRing";
import { CategoryBarChart, type CategoryDatum } from "@/components/CategoryBarChart";
import { ringFillAndStatus, type RingDirection, type RingStatus } from "@/lib/kpi-ring";
import { BASELINE_WINDOW_DAYS, computeDailyStatus } from "@/lib/daily-status";
import { computeCheckInStats } from "@/lib/checkin";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import { median, mean } from "@/lib/stats-utils";
import { buildWeekSeries, toDateKey } from "@/lib/week-series";
import { formatKm, formatDuration } from "@/lib/format";
import { CATEGORY_LABELS, categoryColorVar, type ActivityCategory } from "@/lib/categories";

/* Dashboard: startsidan efter inloggning (se app/page.tsx, login/actions.ts,
 * auth/confirm/route.ts). Poängen är att lyfta fram det viktigaste i en
 * blick — ringar man tolkar utan att räkna, inte text och tabeller. Alla
 * nyckeltal (status, incheckning, träningsvolym, formkurva, intensitet)
 * visas som samma sorts KPI-ring: en siffra i mitten, en ring som visar hur
 * nära riktvärdet man ligger, färgad grönt/gult/rött. Klick på en ring
 * öppnar den detaljerade tabellen — det är däråt "detaljerad analys" hör
 * hemma (se även /trends), inte i förstaintrycket. */

const PERIOD_OPTIONS = [
  { key: "today", label: "Idag" },
  { key: "7d", label: "7 dagar" },
  { key: "month", label: "Månad" },
  { key: "year", label: "År" },
] as const;
type Period = (typeof PERIOD_OPTIONS)[number]["key"];

const PERIOD_WINDOW_LABEL: Record<Period, string> = {
  today: "idag",
  "7d": "senaste 7 dagarna",
  month: "den här månaden",
  year: "det senaste året",
};

function isPeriod(value: string | undefined): value is Period {
  return (PERIOD_OPTIONS as readonly { key: string }[]).some((p) => p.key === value);
}

/** EF-filtret enligt P1.4: bara jämförbara pass, aldrig intervaller. */
const EF_MIN_SECONDS = 20 * 60;
const EF_CATEGORIES = ["easy", "long_run"] as const;

/** Norska modellens övre riktmärke för andel tid på/över tröskel (2.2 i
 * insikter-roadmap.md) — det enda intensitetsmåttet som har ett faktiskt
 * riktvärde ur forskningen snarare än den egna baslinjen. */
const INTENSITY_TARGET_PCT = 25;

function efValues(sessions: TrainingSession[]): number[] {
  return sessions
    .filter(
      (s) =>
        (EF_CATEGORIES as readonly string[]).includes(s.category) &&
        s.durationSeconds >= EF_MIN_SECONDS &&
        s.avgHr != null &&
        s.avgHr > 0 &&
        s.distanceMeters > 0,
    )
    .map((s) => (s.distanceMeters / s.durationSeconds / (s.avgHr as number)) * 60); // m/slag
}

function thresholdPlusPct(sessions: TrainingSession[]): number | null {
  let thresholdPlus = 0;
  let total = 0;
  for (const s of sessions) {
    thresholdPlus += s.hrZone4Seconds + s.hrZone5Seconds;
    total += s.hrZoneTotalSeconds;
  }
  return total > 0 ? (thresholdPlus / total) * 100 : null;
}

/** Bygger ring-props för ett volymmått (pass/distans/tid/belastning/EF):
 * riktvärdet är den egna baslinjen, "fullare ring" = minst lika bra som den. */
function volumeRing({
  label,
  value,
  target,
  direction,
  formatNumber,
  unit,
  hint,
}: {
  label: string;
  value: number | null;
  target: number | null;
  direction: RingDirection;
  formatNumber: (n: number) => string;
  unit?: string;
  hint: string;
}) {
  const { fill, status } = ringFillAndStatus(value, target, direction);
  const detailRows: KpiDetailRow[] = [
    {
      label: "Denna period",
      value: value != null ? `${formatNumber(value)}${unit ? ` ${unit}` : ""}` : "–",
    },
    {
      label: "Ditt riktvärde",
      value:
        target != null ? `${formatNumber(target)}${unit ? ` ${unit}` : ""}` : "otillräcklig historik",
    },
  ];
  return {
    label,
    valueText: value != null ? formatNumber(value) : "–",
    unit,
    fill,
    status: (target == null ? "unknown" : status) as RingStatus,
    targetText:
      target != null ? `Riktvärde ${formatNumber(target)}${unit ? ` ${unit}` : ""}` : undefined,
    detailRows,
    hint,
  };
}

/** Bygger ring-props för ett incheckningsmått (1–5-skalan). Riktvärdet är
 * inte en personlig baslinje utan skalans egen ände: 5 (bäst) för
 * higher_is_better, 2 (lite men inte noll) för lower_is_better — annars blir
 * en hög muskelömhet fylld och grön av samma anledning som en hög känsla,
 * vilket var precis den bugg som gjorde färgsättningen orimlig. */
function scoreRing({
  label,
  value,
  direction,
  periodLabel,
  hint,
}: {
  label: string;
  value: number | null;
  direction: RingDirection;
  periodLabel: string;
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
      { label: periodLabel, value: value != null ? `${value.toFixed(1)} av 5` : "–" },
      { label: "Mål", value: direction === "neutral" ? "–" : `${target} av 5` },
    ],
    hint,
  };
}

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; catMetric?: string }>;
}) {
  const { period: periodParam, catMetric: catMetricParam } = await searchParams;
  const period: Period = isPeriod(periodParam) ? periodParam : "today";
  const catMetric: "distance" | "time" = catMetricParam === "time" ? "time" : "distance";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null; // Layouten redirectar redan utan inloggning.

  const now = new Date();
  const todayKey = toDateKey(now);

  // --- Periodens fönster: "fram till nu, aldrig framtid", samma princip
  // som /trends. Bara start- och slutdatum behövs — KPI-ringarna visar
  // periodens totaler, ingen tidsserie.
  let rangeFrom: string;
  if (period === "today") {
    rangeFrom = todayKey;
  } else if (period === "7d") {
    const from = new Date(now);
    from.setDate(from.getDate() - 6);
    rangeFrom = toDateKey(from);
  } else if (period === "month") {
    rangeFrom = toDateKey(new Date(now.getFullYear(), now.getMonth(), 1));
  } else {
    rangeFrom = buildWeekSeries(52)[0];
  }
  const periodDays =
    Math.round(
      (new Date(`${todayKey}T00:00:00`).getTime() - new Date(`${rangeFrom}T00:00:00`).getTime()) /
        86_400_000,
    ) + 1;

  // --- Referensfönster för riktvärden: de BASELINE_WINDOW_DAYS dagarna
  // omedelbart före den valda perioden, aldrig överlappande med den. Ett
  // riktvärde = din egen dagliga snitthastighet i det fönstret, skalat upp
  // till periodens längd — samma "avvikelse mot egen baslinje, inte råvärde"
  // -princip som P1.2, bara applicerad på volym i stället för fysiologi.
  const refToExclusive = rangeFrom;
  const refFrom = toDateKey(
    new Date(new Date(`${rangeFrom}T00:00:00`).getTime() - BASELINE_WINDOW_DAYS * 86_400_000),
  );

  const [
    { data: activityRows },
    { data: refActivityRows },
    { data: todayEntry },
    { data: periodDiary },
    { data: statusMetrics },
  ] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", rangeFrom)
      .order("start_time"),
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", refFrom)
      .lt("start_time", refToExclusive)
      .order("start_time"),
    supabase
      .from("diary_entries")
      .select("feeling, motivation, soreness_level, rpe")
      .eq("user_id", user.id)
      .eq("entry_date", todayKey)
      .maybeSingle(),
    // Periodens incheckningar (P0.4) — snitt när perioden är mer än idag.
    supabase
      .from("diary_entries")
      .select("entry_date, feeling, motivation, soreness_level, rpe")
      .gte("entry_date", rangeFrom)
      .lte("entry_date", todayKey),
    // P1.2-baslinjen (fysiologi) är alltid de senaste 60 dagarna, oavsett
    // period — "nu"-fönstret nedan styr bara hur stor bit av slutet av det
    // fönstret som räknas som "aktuellt".
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
  ]);

  // --- Dagens incheckning (P0.4): inmatningsformuläret gäller alltid idag,
  // oavsett vald period — och visas bara om den inte redan är gjord. -----
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
  // "Nu"-fönstret matchar den valda perioden (idag=1 dag, 7 dagar=7 osv),
  // men täcks aldrig mer än halva baslinjefönstret — annars slutar "nu" och
  // "baslinje" vara olika saker (i årsvyn skulle "nu" annars bli längre än
  // de 60 dagar baslinjen räknas på).
  const statusCurrentWindowDays = Math.min(periodDays, Math.floor(BASELINE_WINDOW_DAYS / 2));
  const dailyStatus = computeDailyStatus(
    (statusMetrics ?? []).map((m) => ({
      date: m.metric_date as string,
      hrv: m.hrv_overnight_avg,
      restingHr: m.resting_hr,
      sleepHours: m.sleep_seconds != null ? m.sleep_seconds / 3600 : null,
      sleepScore: m.sleep_score,
    })),
    todayKey,
    statusCurrentWindowDays,
  );
  const statusPeriodLabel =
    `Senaste ${statusCurrentWindowDays} ${statusCurrentWindowDays === 1 ? "dagen" : "dagarna"} ` +
    `mot din ${BASELINE_WINDOW_DAYS}-dagars baslinje`;

  // --- Pass som analysenhet (P0.5), precis som /trends -------------------
  const sessions: TrainingSession[] = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );
  const refSessions: TrainingSession[] = groupActivitiesIntoSessions(
    (refActivityRows ?? []) as unknown as SessionActivity[],
  );

  // --- Per kategori (ex-/stats): samma pass-baserade enhet som resten av
  // dashboarden, till skillnad från den gamla statistiksidans råa
  // aktivitetsgruppering — en löpning delad i uppvärmning/huvudpass/nerjogg
  // ska räknas som ett pass i en kategori, inte tre. ----------------------
  const categoryData: CategoryDatum[] = (() => {
    const byCategory = new Map<ActivityCategory, CategoryDatum>();
    for (const s of sessions) {
      const cat = byCategory.get(s.category) ?? {
        category: s.category,
        km: 0,
        seconds: 0,
        count: 0,
        sessions: [],
      };
      cat.km += s.distanceMeters / 1000;
      cat.seconds += s.durationSeconds;
      cat.count += 1;
      cat.sessions.push({
        id: s.id,
        date: s.date,
        name: s.dominantActivity.name,
        km: s.distanceMeters / 1000,
        seconds: s.durationSeconds,
      });
      byCategory.set(s.category, cat);
    }
    return [...byCategory.values()];
  })();

  const totalDistanceKm = sessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;
  const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const totalLoad = sessions.reduce((sum, s) => sum + s.trainingLoad, 0);

  // Riktvärden: minst 5 pass i referensfönstret krävs för att lita på en
  // dagsrate — annars är den bara ett par pass förklädd till statistik.
  const hasRefBaseline = refSessions.length >= 5;
  const refRate = hasRefBaseline
    ? {
        sessions: refSessions.length / BASELINE_WINDOW_DAYS,
        distanceKm: refSessions.reduce((s, x) => s + x.distanceMeters, 0) / 1000 / BASELINE_WINDOW_DAYS,
        seconds: refSessions.reduce((s, x) => s + x.durationSeconds, 0) / BASELINE_WINDOW_DAYS,
        load: refSessions.reduce((s, x) => s + x.trainingLoad, 0) / BASELINE_WINDOW_DAYS,
      }
    : null;
  const targets = refRate
    ? {
        sessions: refRate.sessions * periodDays,
        distanceKm: refRate.distanceKm * periodDays,
        seconds: refRate.seconds * periodDays,
        load: refRate.load * periodDays,
      }
    : { sessions: null, distanceKm: null, seconds: null, load: null };

  const efNow = median(efValues(sessions));
  const efTarget = hasRefBaseline ? median(efValues(refSessions)) : null;
  const intensityNow = thresholdPlusPct(sessions);

  const volumeHint =
    "Riktvärdet är din egen dagliga snitthastighet de föregående " +
    `${BASELINE_WINDOW_DAYS} dagarna, skalad till periodens längd — inte ett mål någon satt åt dig.`;

  const trainingRings = [
    volumeRing({
      label: "Pass",
      value: sessions.length,
      target: targets.sessions,
      direction: "higher_is_better",
      formatNumber: (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1)),
      hint: volumeHint,
    }),
    volumeRing({
      label: "Distans",
      value: totalDistanceKm,
      target: targets.distanceKm,
      direction: "higher_is_better",
      formatNumber: (n) => n.toFixed(1),
      unit: "km",
      hint: volumeHint,
    }),
    volumeRing({
      label: "Träningstid",
      value: totalSeconds / 3600,
      target: targets.seconds != null ? targets.seconds / 3600 : null,
      direction: "higher_is_better",
      formatNumber: (n) => n.toFixed(1),
      unit: "h",
      hint: volumeHint,
    }),
    volumeRing({
      label: "Belastning",
      value: totalLoad,
      target: targets.load,
      direction: "higher_is_better",
      formatNumber: (n) => n.toFixed(0),
      hint: volumeHint,
    }),
    volumeRing({
      label: "Formkurva",
      value: efNow,
      target: efTarget,
      direction: "higher_is_better",
      formatNumber: (n) => n.toFixed(2),
      unit: "m/slag",
      hint:
        "Meter per hjärtslag på lugna pass och långpass, ≥ 20 min. Riktvärdet är din egen " +
        `median de föregående ${BASELINE_WINDOW_DAYS} dagarna. Stiger den vid samma puls går formen åt rätt håll.`,
    }),
    volumeRing({
      label: "Tröskel+",
      value: intensityNow,
      target: INTENSITY_TARGET_PCT,
      direction: "lower_is_better",
      formatNumber: (n) => n.toFixed(0),
      unit: "%",
      hint:
        "Andel pulstid på eller över tröskel. Norska modellen siktar på 23–25 % — betydligt " +
        "högre kan betyda att lugna pass smyger upp i intensitet. Räknat på Garmins autozoner, " +
        "som kan vara fel kalibrerade (se /trends).",
    }),
  ];

  // --- Incheckning som ringar: idag specifikt för periodens "Idag", annars
  // periodens snitt — annars skulle ringarna se ut att strunta i väljaren. -
  const avg = (values: (number | null | undefined)[]): number | null =>
    mean(values.filter((v): v is number => v != null));

  const checkInValues =
    period === "today"
      ? checkIn.initialScores
      : {
          feeling: avg((periodDiary ?? []).map((r) => r.feeling)),
          motivation: avg((periodDiary ?? []).map((r) => r.motivation)),
          soreness: avg((periodDiary ?? []).map((r) => r.soreness_level)),
          effort: avg((periodDiary ?? []).map((r) => (r.rpe != null ? r.rpe / 2 : null))),
        };

  const checkInRingsVisible =
    period === "today"
      ? checkIn.initialDone
      : Object.values(checkInValues).some((v) => v != null);

  const checkInPeriodLabel = period === "today" ? "Idag" : `Snitt, ${PERIOD_WINDOW_LABEL[period]}`;

  const checkInRings = [
    scoreRing({
      label: "Känsla i kroppen",
      value: checkInValues.feeling,
      direction: "higher_is_better",
      periodLabel: checkInPeriodLabel,
      hint: "Din egen skattning, 1–5, från den dagliga incheckningen.",
    }),
    scoreRing({
      label: "Motivation/ork",
      value: checkInValues.motivation,
      direction: "higher_is_better",
      periodLabel: checkInPeriodLabel,
      hint: "Din egen skattning, 1–5, från den dagliga incheckningen.",
    }),
    scoreRing({
      label: "Muskelömhet",
      value: checkInValues.soreness,
      direction: "lower_is_better",
      periodLabel: checkInPeriodLabel,
      hint: "Din egen skattning, 1–5 — lägre är mindre öm.",
    }),
    scoreRing({
      label: "Ansträngning",
      value: checkInValues.effort,
      direction: "neutral",
      periodLabel: checkInPeriodLabel,
      hint: "Upplevd ansträngning i passet, 1–5. Varken bra eller dåligt i sig — bara beskrivande.",
    }),
  ];

  const todayHref = `/calendar/${now.getFullYear()}/${now.getMonth() + 1}/${now.getDate()}`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Dashboard</h1>
        <div className="flex gap-2 text-sm" role="group" aria-label="Period">
          {PERIOD_OPTIONS.map((p) => (
            <Link
              key={p.key}
              href={`/dashboard?period=${p.key}`}
              aria-current={period === p.key ? "page" : undefined}
              className={`rounded px-3 py-1 ${
                period === p.key
                  ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                  : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              {p.label}
            </Link>
          ))}
        </div>
      </div>

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

      {/* --- Träning: periodens volym, form, intensitet och fördelning, allt
          i samma stycke. Per kategori ligger överst, som liggande staplar —
          det tar mindre plats än ett tårtdiagram och läses lika snabbt. --- */}
      <div className="flex flex-col gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Träning</h2>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 capitalize">
            {PERIOD_WINDOW_LABEL[period]}
          </p>
        </div>

        <div className="flex flex-col gap-1.5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
              Per kategori
            </span>
            <div className="flex gap-1.5 text-xs">
              {(["distance", "time"] as const).map((m) => (
                <Link
                  key={m}
                  href={`/dashboard?period=${period}&catMetric=${m}`}
                  className={`rounded px-2 py-0.5 ${
                    catMetric === m
                      ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {m === "distance" ? "Distans" : "Tid"}
                </Link>
              ))}
            </div>
          </div>
          <CategoryBarChart data={categoryData} metric={catMetric} />
        </div>

        <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
          {trainingRings.map((r) => (
            <KpiRing key={r.label} {...r} />
          ))}
        </div>
      </div>

      {/* --- Status mot baslinje (P1.2), fönstret följer perioden --------- */}
      <DailyStatus status={dailyStatus} periodLabel={statusPeriodLabel} />

      {checkInRingsVisible && (
        <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Incheckning</h2>
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{checkInPeriodLabel}</p>
          </div>
          <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
            {checkInRings.map((r) => (
              <KpiRing key={r.label} {...r} />
            ))}
          </div>
        </div>
      )}

      {period === "today" && (
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
      )}

      <Link
        href={`/trends?weeks=${period === "year" ? 52 : 12}`}
        className="w-fit text-sm underline text-zinc-600 hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        Till Trender för mer djupgående analys →
      </Link>
    </div>
  );
}
