import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { getViewMode } from "@/lib/view-mode";
import {
  groupActivitiesIntoSessions,
  SESSION_ACTIVITY_COLUMNS,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import type { PlannedWorkout } from "@/lib/plan-matching";
import { computeRangeStats, passedCutoff, type RangeInterruption } from "@/lib/range-stats";
import { STATUS_COLOR_VAR, STATUS_LABEL } from "@/lib/calendar-utils";
import { WORKOUT_LABELS, type WorkoutType } from "@/lib/planning";
import { CATEGORY_LABELS, categoryColorVar, type ActivityCategory } from "@/lib/categories";
import {
  activeSeconds,
  blockLength,
  cumulative,
  dailyValues,
  dayIndex,
  findComparisonBlock,
  missedPasses,
  sessionKm,
  shiftKey,
  totalsUpToDay,
  weeklySums,
  type AnalysisBlock,
  type BlockTotals,
  type MovingById,
} from "@/lib/block-analysis";

/* Passtyperna användaren kan välja in i minuter, distans och träningsdagar,
 * i kategoriordning. Alla är valda från början. */
const TYPE_OPTIONS: ActivityCategory[] = [
  "easy",
  "long_run",
  "threshold",
  "interval",
  "race",
  "test",
  "cross_training",
  "strength",
];
import { CumulativeLineChart, GroupedBarChart, type DayMark, type MarkRow } from "@/components/charts/AnalysisCharts";
import { strengthDatesFromDiary, type DiaryLogRow } from "@/lib/diary-strength";
import { fetchEasyParts } from "@/lib/quality-split";
import {
  mainCategory,
  quoteFor,
  themeTable,
  THEMES,
  THEMES_FROM,
  type ThemeNote,
} from "@/lib/diary-themes";

/* /analys — ett block i siffror och grafer, mot motsvarande block förra året.
 * Beräkningarna och deras avgränsningar står i lib/block-analysis.ts. */

const THIS_YEAR = "var(--foreground)";
const LAST_YEAR = "var(--ink-3)";

function short(dateKey: string): string {
  const [, m, d] = dateKey.split("-");
  return `${Number(d)}/${Number(m)}`;
}

function signed(n: number, digits = 0): string {
  const r = Number(n.toFixed(digits));
  return `${r > 0 ? "+" : ""}${r.toLocaleString("sv-SE")}`;
}

/* I år och förra året lika tydligt, med en stapel var på samma skala så att
 * skillnaden syns utan att läsa siffrorna. Neutrala toner, inget rött för ett
 * lägre värde (CLAUDE.md, Ton mot adepterna). */
function TotalTile({
  label,
  now,
  before,
  unit = "",
  digits = 0,
  note,
  nowLabel = "I år",
  beforeLabel = "Förra året",
}: {
  label: string;
  now: number;
  before: number | null;
  nowLabel?: string;
  beforeLabel?: string;
  unit?: string;
  digits?: number;
  /** Rad under jämförelsen, t.ex. minuter för en ruta som visar km. */
  note?: string;
}) {
  const max = Math.max(now, before ?? 0, 1);
  const fmtN = (v: number) => Number(v.toFixed(digits)).toLocaleString("sv-SE");
  const row = (name: string, v: number, color: string, strong: boolean) => (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-[var(--ink-3)]">{name}</span>
        <span
          className={`tabular ${strong ? "display text-xl font-semibold text-[var(--foreground)]" : "text-base text-[var(--ink-2)]"}`}
        >
          {fmtN(v)}
          {unit && <span className="ml-1 text-xs font-normal text-[var(--ink-3)]">{unit}</span>}
        </span>
      </div>
      <div className="h-1.5 rounded-full bg-[var(--line)]">
        <div className="h-1.5 rounded-full" style={{ width: `${(v / max) * 100}%`, backgroundColor: color }} />
      </div>
    </div>
  );
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
      <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
        {label}
      </span>
      {row(nowLabel, now, THIS_YEAR, true)}
      {before != null && row(beforeLabel, before, LAST_YEAR, false)}
      {before != null && (
        <span className="tabular text-xs text-[var(--ink-2)]">
          {signed(now - before, digits)} mot {beforeLabel.toLowerCase()}
        </span>
      )}
      {note && <span className="tabular text-xs text-[var(--ink-3)]">{note}</span>}
    </div>
  );
}

const GRAF_LABELS = { minuter: "Aktiva minuter", distans: "Distans", pass: "Pass" } as const;

/** En rad val där ett är aktivt, som länkar. scroll={false} så att sidan
 * står kvar vid grafen när man byter. */
function Segment({
  label,
  options,
}: {
  label: string;
  options: { key: string; label: string; href: string; active: boolean; disabled?: boolean }[];
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <span className="w-20 shrink-0 text-xs text-[var(--ink-3)]">{label}</span>
      <div className="flex flex-wrap gap-1 text-sm" role="group" aria-label={label}>
        {options.map((o) =>
          o.disabled ? (
            <span key={o.key} aria-disabled className="rounded border border-dashed border-[var(--line)] px-3 py-1 text-[var(--ink-3)]">
              {o.label}
            </span>
          ) : (
            <Link
              key={o.key}
              href={o.href}
              scroll={false}
              aria-current={o.active ? "true" : undefined}
              className={`rounded px-3 py-1 ${
                o.active ? "bg-[var(--foreground)] text-[var(--background)]" : "border border-[var(--line)]"
              }`}
            >
              {o.label}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}

export default async function AnalysPage({
  searchParams,
}: {
  searchParams: Promise<{
    block?: string;
    athlete?: string;
    typer?: string;
    visa?: string;
    graf?: string;
    mot?: string;
    vy?: string;
    jmf?: string;
    tema?: string;
    tematyp?: string;
  }>;
}) {
  const { block: blockParam, athlete: athleteParam, typer, visa, graf: grafParam, mot: motParam, vy: vyParam, jmf, tema, tematyp } =
    await searchParams;
  // Hittills-rutorna: summa för blocket eller snitt per vecka.
  const perWeek = visa === "vecka";
  const include = new Set<string>(
    typer != null
      ? typer.split(",").filter((t) => (TYPE_OPTIONS as string[]).includes(t))
      : TYPE_OPTIONS,
  );
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const runnerMode = scoped.role === "coach" && (await getViewMode()) === "runner";
  const userId = resolveScopedUserId(scoped, athleteParam, runnerMode);
  const athleteQuery = scoped.role === "coach" && !runnerMode ? `&athlete=${userId}` : "";
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

  const { data: blockRows } = await supabase
    .from("season_blocks")
    .select("id, name, phase, start_date, end_date, blockFilter:season_block_athletes!inner(athlete_id)")
    .eq("blockFilter.athlete_id", userId)
    .order("start_date");
  const blocks: AnalysisBlock[] = ((blockRows ?? []) as (AnalysisBlock & { blockFilter?: unknown })[]).map(
    (b) => ({ id: b.id, name: b.name, phase: b.phase, start_date: b.start_date, end_date: b.end_date }),
  );
  const started = blocks.filter((b) => b.start_date <= today);
  const block =
    started.find((b) => b.id === blockParam) ??
    started.find((b) => b.start_date <= today && b.end_date >= today) ??
    started[started.length - 1] ??
    null;

  const header = (
    <div className="flex flex-col gap-3">
      <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Analys</h1>
      {started.length > 0 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {[...started].reverse().slice(0, 6).map((b) => (
            <Link
              key={b.id}
              href={`/analys?block=${b.id}${athleteQuery}`}
              className={`rounded px-3 py-1 ${
                block?.id === b.id
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "border border-[var(--line)]"
              }`}
            >
              {b.name}
            </Link>
          ))}
        </div>
      )}
    </div>
  );

  if (!block) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-6 py-8">
        {header}
        <p className="text-sm text-[var(--ink-3)]">Inga påbörjade block att analysera än.</p>
      </div>
    );
  }

  // Jämförelseblocket: förra årets motsvarighet om inget annat valts, annars
  // vilket annat påbörjat block som helst (t.ex. vårens uppbyggnad).
  const defaultComparison = findComparisonBlock(blocks, block);
  const comparisonOptions = started.filter((b) => b.id !== block.id);
  const comparison = comparisonOptions.find((b) => b.id === jmf) ?? defaultComparison;
  const isLastYear = comparison != null && comparison.id === defaultComparison?.id;
  // "ht 2026", "vår 2026" — kort nog för etiketter i 390 px.
  const shortName = (b: AnalysisBlock) =>
    `${Number(b.start_date.slice(5, 7)) >= 7 ? "ht" : "vår"} ${b.start_date.slice(0, 4)}`;
  const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
  // Samma halvår (t.ex. ht 2026 mot Tävlingsperiod 2026 Aug) ger samma korta
  // namn — då "Detta block" mot "Jämförelse", så att de aldrig heter lika.
  const sameShort = comparison != null && shortName(comparison) === shortName(block);
  const nowName =
    isLastYear || !comparison ? "I år" : sameShort ? "Detta block" : cap(shortName(block));
  const cmpName =
    isLastYear || !comparison ? "Förra året" : sameShort ? "Jämförelse" : cap(shortName(comparison));
  const nowLower = nowName.toLowerCase();
  const cmpLower = cmpName.toLowerCase();
  const length = blockLength(block);
  const ongoing = today >= block.start_date && today <= block.end_date;
  const daysSoFar = ongoing ? dayIndex(today, block.start_date) + 1 : length;

  const from = comparison && comparison.start_date < block.start_date ? comparison.start_date : block.start_date;
  const [{ data: activityRows }, { data: plannedRows }, { data: diaryRows }] = await Promise.all([
    supabase
      .from("activities")
      // Tid i rörelse ur raw_data, utan att hämta hela raw_data.
      .select(`${SESSION_ACTIVITY_COLUMNS}, moving:raw_data->>movingDuration`)
      .eq("user_id", userId)
      .gte("start_time", from)
      .lt("start_time", shiftKey(block.end_date, 1))
      .order("start_time"),
    supabase
      .from("planned_workouts")
      .select("id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds")
      .eq("user_id", userId)
      .gte("scheduled_date", block.start_date)
      .lte("scheduled_date", block.end_date),
    // Passloggen (styrkepass loggas där snarare än med klockan) och
    // dagtypen (sjuk/skadad).
    supabase
      .from("diary_entries")
      .select("entry_date, session_log, day_type")
      .eq("user_id", userId)
      .gte("entry_date", from)
      .lte("entry_date", block.end_date),
  ]);
  const diary = (diaryRows ?? []) as (DiaryLogRow & { day_type: string | null })[];
  const diaryStrength = strengthDatesFromDiary(diary);
  const interruptions: RangeInterruption[] = diary
    .filter((e) => e.day_type === "sick" || e.day_type === "injured")
    .map((e) => ({ date: e.entry_date, dayType: e.day_type as "sick" | "injured" }));
  const interruptionOn = new Map(interruptions.map((i) => [i.date, i.dayType]));
  const interruptedDays = (b: AnalysisBlock, days: number) => {
    days = Math.min(days, blockLength(b));
    const n = { sick: 0, injured: 0 };
    for (const i of interruptions) {
      const d = dayIndex(i.date, b.start_date);
      if (d >= 0 && d < days) n[i.dayType]++;
    }
    return n;
  };
  const sickNow = interruptedDays(block, daysSoFar);
  const sickBefore = comparison ? interruptedDays(comparison, daysSoFar) : null;
  // Sjuk/skadad per dag i blocket, för remsorna under graferna. Förra årets
  // rad gäller hela det blocket, årets bara dagarna som passerat.
  const marksFor = (b: { start_date: string }, days: number): (DayMark | null)[] =>
    Array.from({ length }, (_, i) => {
      const t = i < days ? interruptionOn.get(shiftKey(b.start_date, i)) : undefined;
      return t ? { label: STATUS_LABEL[t], color: STATUS_COLOR_VAR[t] } : null;
    });
  const marksNow = marksFor(block, daysSoFar);
  const marksBefore = comparison ? marksFor(comparison, blockLength(comparison)) : null;
  const markRows: MarkRow[] = [
    // Årtalet som etikett: kort nog att läsas i 390 px och säger exakt vilket år.
    { label: isLastYear ? block.start_date.slice(0, 4) : sameShort ? "detta" : shortName(block), marks: marksNow },
    ...(marksBefore && comparison
      ? [
          {
            label: isLastYear ? comparison.start_date.slice(0, 4) : sameShort ? "jmf" : shortName(comparison),
            marks: marksBefore,
            outline: true,
          },
        ]
      : []),
  ];
  const dayLabels = Array.from({ length }, (_, i) => {
    const key = shiftKey(block.start_date, i);
    const notes = [
      marksNow[i] ? `${marksNow[i]!.label} ${nowLower}` : null,
      marksBefore?.[i] ? `${marksBefore[i]!.label} ${cmpLower}` : null,
    ].filter(Boolean);
    return `Dag ${i + 1} · ${short(key)}${notes.length ? ` · ${notes.join(", ")}` : ""}`;
  });
  const rows = (activityRows ?? []) as unknown as (SessionActivity & { moving: string | null })[];
  const moving: MovingById = new Map(
    rows.filter((r) => r.moving != null).map((r) => [r.id, Number(r.moving)]),
  );
  const sessions: TrainingSession[] = groupActivitiesIntoSessions(rows);
  // Minuter, distans och träningsdagar räknas på de valda passtyperna.
  const chosen = sessions.filter((s) => include.has(s.category));
  // Tid och distans per passtyp: ett tröskelpass delas i tröskeldel och
  // distansdel (uppvärmning, nerjogg), se lib/quality-split.ts. Antalet pass
  // räknas fortfarande på hela pass (chosen).
  const easyParts = await fetchEasyParts(supabase, userId, sessions);
  const volumeSessions: TrainingSession[] = sessions.flatMap((s) => {
    const e = easyParts.get(s.dominantActivity.id);
    if (!e) return [s];
    const qualitySeconds = Math.max(0, activeSeconds(s, moving) - e.seconds);
    const qualityMeters = Math.max(0, sessionKm(s) * 1000 - e.meters);
    const part = (suffix: string, meters: number, seconds: number) => ({
      ...s.dominantActivity,
      id: `${s.dominantActivity.id}:${suffix}`,
      distance_meters: meters,
      duration_seconds: seconds,
    });
    return [
      { ...s, activities: [part("kvalitet", qualityMeters, qualitySeconds)] },
      { ...s, category: "easy" as const, activities: [part("distans", e.meters, e.seconds)] },
    ];
  });
  const chosenVolume = volumeSessions.filter((s) => include.has(s.category));
  const planned = (plannedRows ?? []) as PlannedWorkout[];

  // --- Hittills i år mot samma antal dagar förra året -----------------------
  // Styrka loggas oftast bara i dagboken. Är styrka vald räknas en dag med
  // ett eget styrkepass där som träningsdag; minuter finns inte i dagboken.
  const chosenDiaryStrength = include.has("strength") ? diaryStrength : [];
  const now: BlockTotals = totalsUpToDay(chosenVolume, block, daysSoFar, moving, chosenDiaryStrength);
  const before: BlockTotals | null = comparison
    ? totalsUpToDay(chosenVolume, comparison, daysSoFar, moving, chosenDiaryStrength)
    : null;
  // Alternativ träning räknas aldrig i distans, bara i tid (sessionKm), så
  // Distans är löpdistansen och alternativ träning visas i minuter.
  const kmMain = now.km;
  const kmMainBefore = before?.km ?? null;
  const crossOnly = sessions.filter((s) => s.category === "cross_training");
  const showCross = include.has("cross_training");
  const cross = totalsUpToDay(crossOnly, block, daysSoFar, moving);
  const crossBefore = comparison ? totalsUpToDay(crossOnly, comparison, daysSoFar, moving) : null;
  // Snitt per vecka: delat med antalet veckor som passerat (dagar / 7).
  // Jämförelseblocket delas med sina egna dagar om det är kortare.
  const per = perWeek ? 7 / daysSoFar : 1;
  const perBefore = perWeek && comparison ? 7 / Math.min(daysSoFar, blockLength(comparison)) : 1;
  const scaled = (v: number) => v * per;
  const scaledOrNull = (v: number | null | undefined) => (v == null ? null : v * perBefore);
  // Kvalitets- och styrkepass räknas alltid, oavsett valda typer.
  const nowAll = totalsUpToDay(sessions, block, daysSoFar, moving, diaryStrength);
  const beforeAll = comparison
    ? totalsUpToDay(sessions, comparison, daysSoFar, moving, diaryStrength)
    : null;

  // --- Grafen: ett mått, en jämförelse, en vy -----------------------------
  // Planen har ingen tid eller distans (målminuter finns på 8 av ~650 pass),
  // så mot planen jämförs alltid antal pass.
  const hasPlan = planned.some((p) => p.workout_type !== "rest");
  const mot: "fjol" | "plan" =
    (motParam === "plan" && hasPlan) || (!comparison && hasPlan) ? "plan" : "fjol";
  const graf: "minuter" | "distans" | "pass" =
    mot === "plan" ? "pass" : grafParam === "distans" || grafParam === "pass" ? grafParam : "minuter";
  const vy: "vecka" | "ack" = vyParam === "ack" ? "ack" : "vecka";
  const unit = graf === "minuter" ? "min" : graf === "distans" ? "km" : "pass";

  const minutesOf = (s: TrainingSession) => activeSeconds(s, moving) / 60;
  // Antal pass av de valda typerna. Med styrka vald räknas ett styrkepass i
  // dagboken som ett pass, om klockan inte redan har ett styrkepass den dagen.
  const passDaily = (b: AnalysisBlock) => {
    const out = dailyValues(chosen, b, () => 1);
    if (include.has("strength")) {
      for (const d of diaryStrength) {
        const i = dayIndex(d, b.start_date);
        if (i < 0 || i >= out.length) continue;
        if (!sessions.some((x) => x.date === d && x.category === "strength")) out[i]++;
      }
    }
    return out;
  };
  const dailyOf = (b: AnalysisBlock) =>
    graf === "pass" ? passDaily(b) : dailyValues(chosenVolume, b, graf === "minuter" ? minutesOf : sessionKm);
  const weeks = Math.ceil(length / 7);
  const dailyNow = dailyOf(block).slice(0, daysSoFar);
  const dailyBefore = comparison ? dailyOf(comparison).slice(0, length) : null;

  // Staplat per passtyp när flera typer är valda (veckovyn, mot förra året).
  // Segmenten summerar till årets stapel: samma underlag, bara uppdelat per
  // typ. Distansdelen av ett tröskelpass ligger i Distans (quality-split).
  const typesShown = TYPE_OPTIONS.filter((t) => include.has(t));
  const weeklyByType =
    typesShown.length > 1
      ? typesShown
          .map((t) => {
            let daily: number[];
            if (graf === "pass") {
              daily = dailyValues(
                sessions.filter((x) => x.category === t),
                block,
                () => 1,
              );
              if (t === "strength") {
                for (const d of diaryStrength) {
                  const i = dayIndex(d, block.start_date);
                  if (i < 0 || i >= daily.length) continue;
                  if (!sessions.some((x) => x.date === d && x.category === "strength")) daily[i]++;
                }
              }
            } else {
              daily = dailyValues(
                volumeSessions.filter((x) => x.category === t),
                block,
                graf === "minuter" ? minutesOf : sessionKm,
              );
            }
            return {
              label: CATEGORY_LABELS[t],
              color: categoryColorVar(t) ?? "var(--ink-3)",
              values: weeklySums(daily.slice(0, daysSoFar)),
            };
          })
          .filter((seg) => seg.values.some((v) => v > 0))
      : null;

  // Alla länkar på sidan behåller övriga val.
  const href = (o: {
    typer?: string | null;
    visa?: boolean;
    graf?: string;
    mot?: string;
    vy?: string;
    jmf?: string | null;
  }) => {
    const t = o.typer !== undefined ? o.typer : typer ?? null;
    const v = o.visa ?? perWeek;
    const g = o.graf ?? graf;
    const m = o.mot ?? mot;
    const y = o.vy ?? vy;
    return (
      `/analys?block=${block.id}${athleteQuery}` +
      (t != null ? `&typer=${t}` : "") +
      (v ? "&visa=vecka" : "") +
      (g !== "minuter" ? `&graf=${g}` : "") +
      (m === "plan" ? "&mot=plan" : "") +
      (y === "ack" ? "&vy=ack" : "") +
      (o.jmf !== undefined ? (o.jmf ? `&jmf=${o.jmf}` : "") : jmf && !isLastYear ? `&jmf=${comparison?.id}` : "")
    );
  };
  const typeHref = (t: string) => {
    const next = new Set(include);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    return href({ typer: TYPE_OPTIONS.filter((x) => next.has(x)).join(",") });
  };
  const visaHref = (vecka: boolean) => href({ visa: vecka });

  // --- Planerat mot gjort per vecka (samma regel som Uppföljning) ---------
  const weekStats = Array.from({ length: weeks }, (_, w) => {
    const start = shiftKey(block.start_date, w * 7);
    if (start > today) return null;
    const end = shiftKey(block.start_date, Math.min(w * 7 + 6, length - 1));
    const s = computeRangeStats({
      range: { startDate: start, endDate: end },
      planned,
      sessions,
      competitionDates: [],
      today,
      diaryStrengthDates: diaryStrength,
      interruptions,
    });
    return {
      due: s.qualityDue + s.distanceDue + s.strengthDue,
      done: s.qualityDone + s.distanceDone + s.strengthDone,
    };
  });
  const blockStats = computeRangeStats({
    range: { startDate: block.start_date, endDate: block.end_date },
    planned,
    sessions,
    competitionDates: [],
    today,
    diaryStrengthDates: diaryStrength,
    interruptions,
  });
  // Planerat och gjort ackumulerat: samma räkning som veckorna, från
  // blockets start till och med varje dag.
  const planCumulative =
    mot === "plan" && vy === "ack"
      ? Array.from({ length: daysSoFar }, (_, i) => {
          const st = computeRangeStats({
            range: { startDate: block.start_date, endDate: shiftKey(block.start_date, i) },
            planned,
            sessions,
            competitionDates: [],
            today,
            diaryStrengthDates: diaryStrength,
            interruptions,
          });
          return {
            due: st.qualityDue + st.distanceDue + st.strengthDue,
            done: st.qualityDone + st.distanceDone + st.strengthDone,
          };
        })
      : null;

  const weekLabel = (w: number) => {
    const s = shiftKey(block.start_date, w * 7);
    const e = shiftKey(block.start_date, Math.min(w * 7 + 6, length - 1));
    const count = (marks: (DayMark | null)[] | null, year: string) => {
      if (!marks) return null;
      const n = { sick: 0, injured: 0 };
      for (let i = w * 7; i < Math.min(w * 7 + 7, length); i++) {
        const m = marks[i];
        if (m) n[m.label === STATUS_LABEL.sick ? "sick" : "injured"]++;
      }
      const parts = [
        n.sick > 0 ? `${n.sick} d sjuk` : null,
        n.injured > 0 ? `${n.injured} d skadad` : null,
      ].filter(Boolean);
      return parts.length ? `${year} ${parts.join(", ")}` : null;
    };
    const notes = [count(marksNow, nowLower), mot === "plan" ? null : count(marksBefore, cmpLower)].filter(Boolean);
    return `v${w + 1} · ${short(s)}–${short(e)}${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
  };

  // --- Missade pass mot planen ---------------------------------------------
  const trainedToday =
    sessions.some((x) => x.date === today) || diaryStrength.includes(today);
  const cutoffRaw = ongoing ? passedCutoff(today, trainedToday) : block.end_date;
  const cutoff = cutoffRaw > block.end_date ? block.end_date : cutoffRaw;
  const missed = missedPasses(planned, sessions, diaryStrength, block.start_date, cutoff);

  // --- Teman i dagboken (lib/diary-themes.ts) -------------------------------
  const [{ data: themeActs }, { data: themeDiary }] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", userId)
      .gte("start_time", THEMES_FROM)
      .order("start_time"),
    supabase
      .from("diary_entries")
      .select("entry_date, notes, day_type")
      .eq("user_id", userId)
      .gte("entry_date", THEMES_FROM)
      .not("notes", "is", null)
      .order("entry_date"),
  ]);
  const themeSessions = groupActivitiesIntoSessions((themeActs ?? []) as unknown as SessionActivity[]);
  const catsByDate = new Map<string, string[]>();
  for (const x of themeSessions) catsByDate.set(x.date, [...(catsByDate.get(x.date) ?? []), x.category]);
  const themeNotes: ThemeNote[] = (
    (themeDiary ?? []) as { entry_date: string; notes: string | null; day_type: string | null }[]
  )
    // Rader utan day_type är importskräp. Sjuk- och skaddagar räknas när hon
    // ändå tränade — då handlar anteckningen om passet (höften 20/10–12/11).
    .filter((e) => e.day_type != null)
    .filter((e) => (e.notes ?? "").trim().length >= 10)
    .flatMap((e) => {
      const c = mainCategory(catsByDate.get(e.entry_date) ?? []);
      return c ? [{ date: e.entry_date, category: c, text: (e.notes ?? "").trim() }] : [];
    });
  const themes = themeTable(themeNotes);
  const activeTheme = THEMES.find((t) => t.key === tema) ?? null;
  const activeType = themes.categories.find((c) => c.category === tematyp)?.category ?? null;
  const themeQuotes =
    activeTheme && activeType
      ? themeNotes
          .filter((n) => n.category === activeType && activeTheme.re.test(n.text))
          .reverse()
      : [];
  const themeHref = (t: string | null, c: string | null) =>
    `${href({})}${t && c ? `&tema=${t}&tematyp=${c}` : ""}#teman`;
  const dayHref = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return `/calendar/${y}/${m}/${d}${athleteQuery ? `?athlete=${userId}` : ""}`;
  };
  const weekday = (key: string) =>
    new Date(`${key}T12:00:00Z`).toLocaleDateString("sv-SE", { weekday: "short", timeZone: "UTC" });
  const pct = (done: number, due: number) => (due > 0 ? ` · ${Math.round((done / due) * 100)} %` : "");

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      {header}

      <p className="-mt-4 max-w-3xl text-sm text-[var(--ink-2)]">
        {block.name}, {block.start_date} – {block.end_date}
        {ongoing ? `, dag ${daysSoFar} av ${length}` : ""}.{" "}
        {comparison
          ? blockLength(comparison) < daysSoFar
            ? `Jämförs med ${comparison.name}, som bara är ${blockLength(comparison)} dagar — hela det blocket mot de första ${daysSoFar} dagarna här.`
            : `Jämförs med ${comparison.name} fram till samma dag i blocket.`
          : "Det finns inget block att jämföra med."}
      </p>

      {comparisonOptions.length > 0 && (
        <Segment
          label="Jämför block"
          options={[...comparisonOptions].reverse().map((b) => ({
            key: b.id,
            label: b.id === defaultComparison?.id ? `${b.name} (förra året)` : b.name,
            href: href({ jmf: b.id === defaultComparison?.id ? null : b.id }),
            active: comparison?.id === b.id,
          }))}
        />
      )}

      {/* Vilka passtyper som räknas in i minuter, distans och träningsdagar. */}
      <section className="flex flex-col gap-2">
        <h2 className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
          Räkna med
        </h2>
        <div className="flex flex-wrap gap-2">
          {TYPE_OPTIONS.map((t) => {
            const on = include.has(t);
            return (
              <Link
                key={t}
                href={typeHref(t)}
                scroll={false}
                aria-pressed={on}
                className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${
                  on
                    ? "border-[var(--foreground)] text-[var(--foreground)]"
                    : "border-[var(--line)] text-[var(--ink-3)]"
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block h-2 w-2 rounded-full"
                  style={{
                    backgroundColor: on ? (categoryColorVar(t) ?? "var(--ink-3)") : "transparent",
                    border: on ? undefined : "1px solid var(--ink-3)",
                  }}
                />
                {CATEGORY_LABELS[t]}
              </Link>
            );
          })}
        </div>
        <p className="text-xs text-[var(--ink-3)]">
          Aktiv tid är tid i rörelse — vila där man står still räknas inte. För styrka och pass
          inomhus, där klockan inte kan mäta rörelse, räknas passets hela tid.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            {ongoing ? "Hittills i blocket" : "Hela blocket"}
          </h2>
          <div className="flex gap-1 text-sm" role="group" aria-label="Summering">
            {[
              { vecka: false, label: "Totalt" },
              { vecka: true, label: "Snitt per vecka" },
            ].map((o) => (
              <Link
                key={o.label}
                href={visaHref(o.vecka)}
                scroll={false}
                aria-current={perWeek === o.vecka ? "true" : undefined}
                className={`rounded px-3 py-1 ${
                  perWeek === o.vecka
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "border border-[var(--line)]"
                }`}
              >
                {o.label}
              </Link>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <TotalTile nowLabel={nowName} beforeLabel={cmpName} label="Aktiva minuter" now={scaled(now.minutes)} before={scaledOrNull(before?.minutes)} />
          <TotalTile
            nowLabel={nowName}
            beforeLabel={cmpName}
            label="Distans"
            now={scaled(kmMain)}
            before={scaledOrNull(kmMainBefore)}
            unit="km"
            digits={perWeek ? 1 : 0}
          />
          {showCross && (
            <TotalTile
            nowLabel={nowName}
            beforeLabel={cmpName}
              label="Alternativ träning"
              now={scaled(cross.minutes)}
              before={scaledOrNull(crossBefore?.minutes)}
              unit="min"
            />
          )}
          <TotalTile nowLabel={nowName} beforeLabel={cmpName} label="Träningsdagar" now={scaled(now.trainingDays)} before={scaledOrNull(before?.trainingDays)} digits={perWeek ? 1 : 0} />
          <TotalTile nowLabel={nowName} beforeLabel={cmpName} label="Kvalitetspass" now={scaled(nowAll.qualitySessions)} before={scaledOrNull(beforeAll?.qualitySessions)} digits={perWeek ? 1 : 0} />
          <TotalTile nowLabel={nowName} beforeLabel={cmpName} label="Styrkepass" now={scaled(nowAll.strengthSessions)} before={scaledOrNull(beforeAll?.strengthSessions)} digits={perWeek ? 1 : 0} />
          <TotalTile
            nowLabel={nowName}
            beforeLabel={cmpName}
            label="Sjuk/skadad, dagar"
            now={scaled(sickNow.sick + sickNow.injured)}
            before={sickBefore ? (sickBefore.sick + sickBefore.injured) * perBefore : null}
            digits={perWeek ? 1 : 0}
          />
        </div>
        <p className="text-xs text-[var(--ink-3)]">
          {perWeek
            ? `Snitt per vecka över ${(daysSoFar / 7).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} veckor${
                comparison ? `, samma antal dagar ${cmpLower}` : ""
              }. `
            : ""}
          Alternativ träning (cykel, crosstrainer, vattenlöpning) räknas i tid men aldrig i
          distans, eftersom en km på cykel inte är en km löpning. Den ingår i aktiva minuter och
          träningsdagar.
        </p>
        <p className="text-xs text-[var(--ink-3)]">
          Styrkepass räknas också ur dagbokens passlogg, där de oftast skrivs in: gym, cirkel,
          medicinboll och liknande egna pass. Det underlaget är självskattat. Styrka som tillägg
          efter ett löppass räknas inte. Med styrka vald räknas en dag med ett styrkepass i
          dagboken som träningsdag; dagboken anger ingen tid, så aktiva minuter tar bara med
          styrkepass som loggats med klockan. Sjuk- och skaddagar är markerade i dagboken
          {sickNow.sick + sickNow.injured > 0
            ? ` — ${nowLower} ${[
                sickNow.sick > 0 ? `${sickNow.sick} sjuk` : null,
                sickNow.injured > 0 ? `${sickNow.injured} skadad` : null,
              ]
                .filter(Boolean)
                .join(", ")}`
            : ""}
          {sickBefore && sickBefore.sick + sickBefore.injured > 0
            ? `, ${cmpLower} ${[
                sickBefore.sick > 0 ? `${sickBefore.sick} sjuk` : null,
                sickBefore.injured > 0 ? `${sickBefore.injured} skadad` : null,
              ]
                .filter(Boolean)
                .join(", ")}`
            : ""}
          . De syns som remsor under graferna: fyllda för {nowLower}, konturerade för {cmpLower}.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            {GRAF_LABELS[graf]} {vy === "vecka" ? "per vecka" : "ackumulerat"}
            {mot === "plan" ? " mot planen" : comparison ? ` mot ${cmpLower}` : ""}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            {mot === "plan"
              ? "Kvalitet, distans och styrka räknas inom veckan, inte dag för dag. Bara dagar som passerat räknas. Ett planerat pass på en sjuk- eller skaddag som inte blev av räknas inte" +
                (blockStats.excusedCount > 0 ? ` (${blockStats.excusedCount} i blocket).` : ".")
              : `${graf === "minuter" ? "Aktiv tid" : graf === "distans" ? "Sträckan" : "Antal pass"} för de valda passtyperna${
                  vy === "vecka" ? ", per blockvecka" : ", dag för dag i blocket"
                }. Tryck i grafen för att se en ${vy === "vecka" ? "vecka" : "dag"}.`}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <Segment
            label="Mått"
            options={(["minuter", "distans", "pass"] as const).map((g) => ({
              key: g,
              label: GRAF_LABELS[g],
              href: href({ graf: g }),
              active: graf === g,
              disabled: mot === "plan" && g !== "pass",
            }))}
          />
          {(comparison || hasPlan) && (
            <Segment
              label="Jämför med"
              options={[
                ...(comparison
                  ? [{ key: "fjol", label: cmpName, href: href({ mot: "fjol" }), active: mot === "fjol" }]
                  : []),
                ...(hasPlan
                  ? [{ key: "plan", label: "Planerat", href: href({ mot: "plan" }), active: mot === "plan" }]
                  : []),
              ]}
            />
          )}
          <Segment
            label="Visa"
            options={[
              { key: "vecka", label: "Per vecka", href: href({ vy: "vecka" }), active: vy === "vecka" },
              { key: "ack", label: "Ackumulerat", href: href({ vy: "ack" }), active: vy === "ack" },
            ]}
          />
          {mot === "plan" && (
            <p className="text-xs text-[var(--ink-3)]">Planen har ingen tid eller distans, så den jämförs i antal pass.</p>
          )}
        </div>

        {vy === "vecka" ? (
          <GroupedBarChart
            groups={Array.from({ length: weeks }, (_, w) => `v${w + 1}`)}
            groupLabels={Array.from({ length: weeks }, (_, w) => weekLabel(w))}
            defaultIndex={Math.floor((daysSoFar - 1) / 7)}
            markRows={mot === "plan" ? markRows.slice(0, 1) : markRows}
            unit={unit}
            ariaLabel={`${GRAF_LABELS[graf]} per blockvecka`}
            series={
              mot === "plan"
                ? [
                    { label: "Planerat", values: weekStats.map((x) => (x ? x.due : null)), color: "var(--ink-2)", style: "outline" as const },
                    { label: "Gjort", values: weekStats.map((x) => (x ? x.done : null)), color: THIS_YEAR, style: "fill" as const },
                  ]
                : [
                    ...(dailyBefore
                      ? [{ label: cmpName, values: weeklySums(dailyBefore), color: LAST_YEAR, style: "outline" as const }]
                      : []),
                    {
                      label: nowName,
                      values: Array.from({ length: weeks }, (_, w) => {
                        const ws = weeklySums(dailyNow);
                        return w < ws.length ? ws[w] : null;
                      }),
                      color: THIS_YEAR,
                      style: "fill" as const,
                      ...(weeklyByType && weeklyByType.length > 1 ? { stack: weeklyByType } : {}),
                    },
                  ]
            }
          />
        ) : (
          <CumulativeLineChart
            days={length}
            unit={unit}
            ariaLabel={`${GRAF_LABELS[graf]} ackumulerat i ${block.name}`}
            defaultIndex={daysSoFar - 1}
            dayLabels={dayLabels}
            markRows={mot === "plan" ? markRows.slice(0, 1) : markRows}
            series={
              mot === "plan" && planCumulative
                ? [
                    { label: "Planerat", values: planCumulative.map((x) => x.due), color: "var(--ink-2)", dashed: true },
                    { label: "Gjort", values: planCumulative.map((x) => x.done), color: THIS_YEAR },
                  ]
                : [
                    ...(dailyBefore
                      ? [{ label: cmpName, values: cumulative(dailyBefore), color: LAST_YEAR, dashed: true }]
                      : []),
                    { label: nowName, values: cumulative(dailyNow), color: THIS_YEAR },
                  ]
            }
          />
        )}

        {mot === "plan" && (
          <dl className="grid grid-cols-3 gap-2 text-center">
            {[
              { label: "Kvalitet", done: blockStats.qualityDone, due: blockStats.qualityDue },
              { label: "Distans", done: blockStats.distanceDone, due: blockStats.distanceDue },
              { label: "Styrka", done: blockStats.strengthDone, due: blockStats.strengthDue },
            ].map((k) => (
              <div key={k.label} className="rounded-md bg-[var(--surface-raised)] px-2 py-2">
                <dt className="text-[0.65rem] tracking-wider text-[var(--ink-3)] uppercase">{k.label}</dt>
                <dd className="tabular text-sm font-medium text-[var(--foreground)]">
                  {k.due > 0 ? `${k.done}/${k.due}${pct(k.done, k.due)}` : "—"}
                </dd>
              </div>
            ))}
          </dl>
        )}
      </section>

      {hasPlan && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
              Planerat som inte blev av
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
              Planerade pass utan ett pass av samma slag samma dag. Ett pass som flyttats till en annan
              dag står också här. Tryck för att öppna dagen.
            </p>
          </div>
          {missed.length === 0 ? (
            <p className="text-sm text-[var(--ink-3)]">Alla planerade pass hittills blev av.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--surface)]">
              {missed.map(({ planned: p, doneThatDay }) => {
                const t = interruptionOn.get(p.scheduled_date);
                return (
                  <li key={p.id}>
                    <Link
                      href={dayHref(p.scheduled_date)}
                      className="flex items-start gap-3 px-3 py-2.5 hover:bg-[var(--surface-raised)]"
                    >
                      <span className="tabular w-14 shrink-0 text-sm text-[var(--ink-2)]">
                        <span className="block text-xs text-[var(--ink-3)]">{weekday(p.scheduled_date)}</span>
                        {short(p.scheduled_date)}
                      </span>
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="flex items-center gap-1.5 text-sm text-[var(--foreground)]">
                          <span
                            aria-hidden
                            className="inline-block h-2 w-2 shrink-0 rounded-full"
                            style={{ backgroundColor: categoryColorVar(p.workout_type as ActivityCategory) ?? "var(--ink-3)" }}
                          />
                          <span className="truncate">
                            {p.title || WORKOUT_LABELS[p.workout_type as WorkoutType] || p.workout_type}
                          </span>
                        </span>
                        <span className="text-xs text-[var(--ink-3)]">
                          {doneThatDay.length > 0
                            ? `Gjort den dagen: ${doneThatDay.map((x) => CATEGORY_LABELS[x.category as ActivityCategory] ?? x.category).join(", ")}`
                            : "Inget pass den dagen"}
                        </span>
                      </span>
                      {t && (
                        <span className="flex shrink-0 items-center gap-1 text-xs text-[var(--ink-2)]">
                          <span aria-hidden className="inline-block h-2 w-2 rounded-sm" style={{ backgroundColor: STATUS_COLOR_VAR[t] }} />
                          {STATUS_LABEL[t]}
                        </span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      )}

      {/* Vad hon skriver om, per passtyp. Ingen värdering — se
          lib/diary-themes.ts för varför ett stämningsbetyg inte byggdes. */}
      <section id="teman" className="flex scroll-mt-4 flex-col gap-3">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Ur dagboken
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Vad anteckningarna tar upp, per passtyp, sedan 1 januari 2026. Andelen är hur många
            av anteckningarna som nämner temat — inte hur det gick. Tryck på en ruta för att läsa
            anteckningarna.
          </p>
        </div>
        {themes.categories.length === 0 ? (
          <p className="text-sm text-[var(--ink-3)]">
            För få anteckningar ännu — minst 20 per passtyp behövs för att jämföra.
          </p>
        ) : (
          <>
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--ink-3)]">
                  <th className="w-[30%] pb-1 font-normal">Tema</th>
                  {themes.categories.map((c) => (
                    <th key={c.category} className="pb-1 font-normal">
                      <span className="block truncate">{CATEGORY_LABELS[c.category as ActivityCategory] ?? c.category}</span>
                      <span className="tabular">{c.notes} st</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {THEMES.map((t) => (
                  <tr key={t.key} className="border-t border-[var(--line)]">
                    <td className="py-1.5 pr-2 text-[var(--ink-2)]">{t.label}</td>
                    {themes.categories.map((c) => {
                      const cell = themes.cells.get(`${t.key}|${c.category}`);
                      const n = cell?.count ?? 0;
                      const active = activeTheme?.key === t.key && activeType === c.category;
                      return (
                        <td key={c.category} className="py-1.5">
                          {n === 0 ? (
                            <span className="text-[var(--ink-3)]">–</span>
                          ) : (
                            <Link
                              href={active ? themeHref(null, null) : themeHref(t.key, c.category)}
                              scroll={false}
                              title={`${n} av ${cell?.notes} anteckningar`}
                              className={`tabular rounded px-1.5 py-0.5 ${
                                active
                                  ? "bg-[var(--foreground)] text-[var(--background)]"
                                  : "underline decoration-[var(--line)] underline-offset-2"
                              }`}
                            >
                              {Math.round((n / (cell?.notes ?? 1)) * 100)} %
                            </Link>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            {activeTheme && activeType && (
              <div className="flex flex-col gap-2">
                <h3 className="text-sm font-medium text-[var(--foreground)]">
                  {activeTheme.label} · {CATEGORY_LABELS[activeType as ActivityCategory] ?? activeType} ·{" "}
                  {themeQuotes.length} anteckningar
                </h3>
                <ul className="flex flex-col divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--surface)]">
                  {themeQuotes.map((q) => (
                    <li key={q.date}>
                      <Link href={dayHref(q.date)} className="flex gap-3 px-3 py-2 hover:bg-[var(--surface-raised)]">
                        <span className="tabular w-12 shrink-0 text-xs text-[var(--ink-3)]">{short(q.date)}</span>
                        <span className="text-sm text-[var(--ink-2)]">”{quoteFor(q.text, activeTheme.re)}”</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <p className="text-xs text-[var(--ink-3)]">
              Underlaget är löparens egna anteckningar, självskattat. En anteckning räknas till dagens
              mest krävande pass. Dagar utan pass räknas inte. Anteckningarna före 2026
              blev förskjutna en dag vid importen och används inte här.
            </p>
          </>
        )}
      </section>
    </div>
  );
}
