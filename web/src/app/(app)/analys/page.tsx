import Link from "next/link";
import { PageHeader, Section } from "@/components/ui/Page";
import { SegmentedSmall } from "@/components/ui/Segmented";
import { HowCalculated, Observations } from "@/components/ui/Explain";
import { DataTable } from "@/components/ui/DataTable";
import { ToneDots } from "@/components/ToneDots";
import { blockClosure, closureLines } from "@/lib/block-closure";
import { formatDateShort, formatNumber } from "@/lib/format";
import { PHASE_LABELS, type PhaseType } from "@/lib/planning";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { getViewMode } from "@/lib/view-mode";
import {
  groupActivitiesIntoSessions,
  trainingSeconds,
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
  TONE_COLORS,
  TONE_LABELS,
  toneOf,
  topWords,
  mentionCounts,
  mentionTone,
  type ThemeNote,
  type Tone,
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

/** Liten stapel under ett tal i tematabellen: hur omnämnandena fördelar sig på
 * grönt (bra), blandat och rosa (mindre bra) — se mentionTone. */
function MentionBar({ c }: { c: { bra: number; blandat: number; mindre_bra: number } }) {
  const total = c.bra + c.blandat + c.mindre_bra;
  if (total === 0) return null;
  return (
    <span
      className="mt-0.5 flex h-1 w-10 gap-px overflow-hidden rounded-sm"
      title={`${c.bra} bra · ${c.blandat} blandat · ${c.mindre_bra} mindre bra`}
      aria-label={`${c.bra} bra, ${c.blandat} blandat, ${c.mindre_bra} mindre bra`}
    >
      {(["bra", "blandat", "mindre_bra"] as const).map((t) =>
        c[t] > 0 ? <span key={t} style={{ width: `${(c[t] / total) * 100}%`, backgroundColor: TONE_COLORS[t] }} /> : null,
      )}
    </span>
  );
}

const GRAF_LABELS = { minuter: "Träningstid (min)", distans: "Distans", pass: "Pass" } as const;

/** En rad val där ett är aktivt, som länkar. scroll={false} så att sidan
 * står kvar vid grafen när man byter. */
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
    /** Urval i känslostaplarna: passtyp (eller "alla"), block ("nu"/"jmf")
     * och känsla (bra/blandat/mindre_bra, utelämnad = alla). */
    kc?: string;
    kb?: string;
    kt?: string;
    missade?: string;
  }>;
}) {
  const { block: blockParam, athlete: athleteParam, typer, visa, graf: grafParam, mot: motParam, vy: vyParam, jmf, tema, tematyp, kc, kb, kt, missade } =
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
      <PageHeader title="Blocket" lead="Blocket i siffror: bokslutet överst, därefter veckorna, det som blev annat och dagboken." />
    </div>
  );

  if (!block) {
    return (
      <div className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
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
  // Samma halvår (t.ex. ht 2026 mot Tävlingsperiod 2026 Aug) ger samma korta
  // namn — då "Detta block" mot "Jämförelse", så att de aldrig heter lika.
  const sameShort = comparison != null && shortName(comparison) === shortName(block);
  /* Blocken heter vid namn överallt (2026-11-21): "ht 2026 mot ht 2025", inte
     "I år mot förra året" — det gick inte att se vilket block som jämfördes,
     och "förra året" stämde inte när man valt vårblocket. Samma halvår
     (ht 2026 mot Tävlingsperiod 2026 Aug) skrivs med blockets fulla namn. */
  const blockLabel = (b: AnalysisBlock) => (sameShort ? b.name : shortName(b));
  const nowName = blockLabel(block);
  const cmpName = comparison ? blockLabel(comparison) : "jämförelsen";
  const nowLower = nowName;
  const cmpLower = cmpName;
  const length = blockLength(block);
  const ongoing = today >= block.start_date && today <= block.end_date;
  const daysSoFar = ongoing ? dayIndex(today, block.start_date) + 1 : length;

  const from = comparison && comparison.start_date < block.start_date ? comparison.start_date : block.start_date;
  const [{ data: activityRows }, { data: plannedRows }, { data: diaryRows }] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
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
    { label: nowName, marks: marksNow },
    ...(marksBefore && comparison
      ? [
          {
            label: cmpName,
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
  const rows = (activityRows ?? []) as unknown as SessionActivity[];
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
    const qualitySeconds = Math.max(0, trainingSeconds(s) - e.seconds);
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
  const now: BlockTotals = totalsUpToDay(chosenVolume, block, daysSoFar, chosenDiaryStrength);
  const before: BlockTotals | null = comparison
    ? totalsUpToDay(chosenVolume, comparison, daysSoFar, chosenDiaryStrength)
    : null;
  // Alternativ träning räknas aldrig i distans, bara i tid (sessionKm), så
  // Distans är löpdistansen och alternativ träning visas i minuter.
  const kmMain = now.km;
  const kmMainBefore = before?.km ?? null;
  const crossOnly = sessions.filter((s) => s.category === "cross_training");
  const showCross = include.has("cross_training");
  const cross = totalsUpToDay(crossOnly, block, daysSoFar);
  const crossBefore = comparison ? totalsUpToDay(crossOnly, comparison, daysSoFar) : null;
  // Snitt per vecka: delat med antalet veckor som passerat (dagar / 7).
  // Jämförelseblocket delas med sina egna dagar om det är kortare.
  const per = perWeek ? 7 / daysSoFar : 1;
  const perBefore = perWeek && comparison ? 7 / Math.min(daysSoFar, blockLength(comparison)) : 1;
  const scaled = (v: number) => v * per;
  const scaledOrNull = (v: number | null | undefined) => (v == null ? null : v * perBefore);
  // Kvalitets- och styrkepass räknas alltid, oavsett valda typer.
  const nowAll = totalsUpToDay(sessions, block, daysSoFar, diaryStrength);
  const beforeAll = comparison
    ? totalsUpToDay(sessions, comparison, daysSoFar, diaryStrength)
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

  const minutesOf = (s: TrainingSession) => trainingSeconds(s) / 60;
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
  // Samma passtyper och ordning för båda blocken, så att färgerna matchar.
  const stackFor = (b: AnalysisBlock, days: number) =>
    typesShown.map((t) => {
      let daily: number[];
      if (graf === "pass") {
        daily = dailyValues(
          sessions.filter((x) => x.category === t),
          b,
          () => 1,
        );
        if (t === "strength") {
          for (const d of diaryStrength) {
            const i = dayIndex(d, b.start_date);
            if (i < 0 || i >= daily.length) continue;
            if (!sessions.some((x) => x.date === d && x.category === "strength")) daily[i]++;
          }
        }
      } else {
        daily = dailyValues(
          volumeSessions.filter((x) => x.category === t),
          b,
          graf === "minuter" ? minutesOf : sessionKm,
        );
      }
      return {
        label: CATEGORY_LABELS[t],
        color: categoryColorVar(t) ?? "var(--ink-3)",
        values: weeklySums(daily.slice(0, days)),
      };
    });
  const stackNow = typesShown.length > 1 ? stackFor(block, daysSoFar) : null;
  const stackBefore =
    typesShown.length > 1 && comparison ? stackFor(comparison, blockLength(comparison)) : null;
  // Passtyper utan ett enda värde i något av blocken tas bort ur båda.
  const usedTypes = new Set(
    [...(stackNow ?? []), ...(stackBefore ?? [])].filter((seg) => seg.values.some((v) => v > 0)).map((seg) => seg.label),
  );
  const weeklyByType = stackNow ? stackNow.filter((seg) => usedTypes.has(seg.label)) : null;
  const weeklyByTypeBefore = stackBefore ? stackBefore.filter((seg) => usedTypes.has(seg.label)) : null;

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
  // Sammanfattningen ovanför listan (ny UX): hur många, och hur många av
  // dem som låg på sjuk- eller skaddagar — det är det som avgör hur listan
  // ska läsas.
  const missedOnInjured = missed.filter((m) => interruptionOn.get(m.planned.scheduled_date) === "injured").length;
  const missedOnSick = missed.filter((m) => interruptionOn.get(m.planned.scheduled_date) === "sick").length;
  const missedReplaced = missed.filter((m) => m.doneThatDay.length > 0).length;
  const missedSummary = `${missed.length} planerade pass blev något annat eller inte av. ${
    missedReplaced > 0 ? `${missedReplaced} av dem blev ett annat pass samma dag. ` : ""
  }${missedOnInjured > 0 ? `${missedOnInjured} låg på dagar med skada noterad` : ""}${
    missedOnInjured > 0 && missedOnSick > 0 ? " och " : ""
  }${missedOnSick > 0 ? `${missedOnSick} på sjukdagar` : ""}${missedOnInjured + missedOnSick > 0 ? "." : ""}`.trim();
  const showAllMissed = missade === "alla";

  // --- Ur dagboken (lib/diary-themes.ts) -----------------------------------
  // Samma fönster som resten av sidan: blocket fram till idag, och
  // jämförelseblocket fram till samma dag i blocket.
  const { data: themeDiary } = await supabase
    .from("diary_entries")
    .select("entry_date, notes, day_type, notes_good_chars, notes_bad_chars, notes_good_text, notes_bad_text")
    .eq("user_id", userId)
    .gte("entry_date", from)
    .lte("entry_date", block.end_date)
    .order("entry_date");
  const catsByDate = new Map<string, string[]>();
  for (const x of sessions) catsByDate.set(x.date, [...(catsByDate.get(x.date) ?? []), x.category]);
  type DiaryNoteRow = {
    entry_date: string;
    notes: string | null;
    day_type: string | null;
    notes_good_chars: number | null;
    notes_bad_chars: number | null;
    notes_good_text: string | null;
    notes_bad_text: string | null;
  };
  const notesFor = (b: AnalysisBlock): ThemeNote[] => {
    const last = shiftKey(b.start_date, Math.min(daysSoFar, blockLength(b)) - 1);
    return ((themeDiary ?? []) as DiaryNoteRow[])
      .filter((e) => e.entry_date >= b.start_date && e.entry_date <= last)
      // Rader utan day_type är importskräp. Sjuk- och skaddagar räknas när
      // hon ändå tränade — då handlar anteckningen om passet.
      .filter((e) => e.day_type != null)
      .flatMap((e) => {
        const c = mainCategory(catsByDate.get(e.entry_date) ?? []);
        const tone = toneOf(e.notes_good_chars, e.notes_bad_chars);
        const text = (e.notes ?? "").trim();
        if (!c || (!tone && text.length < 10)) return [];
        return [{ date: e.entry_date, category: c, text, tone, good: e.notes_good_text, bad: e.notes_bad_text }];
      });
  };
  const notesNow = notesFor(block);
  const notesBefore = comparison ? notesFor(comparison) : [];
  // Känslan per passtyp, i ordning efter antal markerade anteckningar.
  // Passtyper från båda blocken, så att jämförelsen syns även när det ena
  // saknar färgmarkering.
  const toned = [...notesNow, ...notesBefore].filter((n) => n.tone);
  const toneCats = [...new Set(toned.map((n) => n.category))].sort(
    (a, b2) =>
      toned.filter((n) => n.category === b2).length - toned.filter((n) => n.category === a).length,
  );
  const hasTone = notesNow.some((n) => n.tone) || notesBefore.some((n) => n.tone);
  // Teman ur texten från första dagboksdatum på rätt dag (THEMES_FROM).
  const themeNotes = notesNow.filter((n) => n.date >= THEMES_FROM && n.text.length >= 10);
  // Urval från en klickad känslostapel. Då gäller tabellen, orden och
  // anteckningslistan bara urvalet.
  const selBlock: "nu" | "jmf" = kb === "jmf" && comparison ? "jmf" : "nu";
  const selTone = (["bra", "blandat", "mindre_bra"] as const).find((t) => t === kt) ?? null;
  const selCat = kc ?? null;
  const selPool = selCat
    ? (selBlock === "jmf" ? notesBefore : notesNow).filter(
        (n) => n.text.length >= 10 && (selCat === "alla" || n.category === selCat),
      )
    : [];
  const selNotes = selPool.filter((n) => !selTone || n.tone === selTone);
  const selLabel = selCat
    ? `${selCat === "alla" ? "Alla pass" : (CATEGORY_LABELS[selCat as ActivityCategory] ?? selCat)} · ${
        selBlock === "jmf" ? cmpName : nowName
      }${selTone ? ` · ${TONE_LABELS[selTone]}` : ""}`
    : null;
  const selWords = selCat ? topWords(selNotes) : [];
  /* Observationer ur dagboken (2026-11-21). Bara det som går att räkna
     direkt ur hennes färgmarkering — inga omdömen, och bara när underlaget
     är mer än ett par anteckningar. */
  const diaryObs: string[] = (() => {
    const out: string[] = [];
    const tonedNow = notesNow.filter((n) => n.tone);
    const tonedBefore = notesBefore.filter((n) => n.tone);
    if (tonedNow.length >= 3) {
      const g = tonedNow.filter((n) => n.tone === "bra").length;
      const gb = tonedBefore.filter((n) => n.tone === "bra").length;
      out.push(
        `${g} av ${tonedNow.length} anteckningar ${ongoing ? "hittills " : ""}är mest i grönt${
          comparison && tonedBefore.length >= 3 ? ` — ${cmpLower} ${gb} av ${tonedBefore.length}` : ""
        }.`,
      );
    }
    const pinkCat = toneCats
      .map((c) => {
        const ns = tonedNow.filter((n) => n.category === c);
        return { c, n: ns.length, pink: ns.filter((n) => n.tone === "mindre_bra").length };
      })
      .filter((x) => x.n >= 3 && x.pink >= 2)
      .sort((a2, b2) => b2.pink / b2.n - a2.pink / a2.n)[0];
    if (pinkCat)
      out.push(
        `Mest rosa i ${(CATEGORY_LABELS[pinkCat.c as ActivityCategory] ?? pinkCat.c).toLowerCase()}: ${pinkCat.pink} av ${pinkCat.n} anteckningar.`,
      );
    const themeStats = THEMES.map((t) => ({ t, c: mentionCounts(themeNotes, t.re) }));
    const pinkTheme = themeStats.filter((x) => x.c.mindre_bra >= 3).sort((a2, b2) => b2.c.mindre_bra - a2.c.mindre_bra)[0];
    if (pinkTheme)
      out.push(
        `${pinkTheme.t.label} tas upp i ${pinkTheme.c.total} anteckningar, ${pinkTheme.c.mindre_bra} gånger i rosa text.`,
      );
    const greenTheme = themeStats
      .filter((x) => x.c.bra >= 3 && x.t.key !== pinkTheme?.t.key)
      .sort((a2, b2) => b2.c.bra - a2.c.bra)[0];
    if (greenTheme)
      out.push(`${greenTheme.t.label} tas upp i ${greenTheme.c.total} anteckningar, ${greenTheme.c.bra} gånger i grön text.`);
    return out;
  })();
  const themes = themeTable(themeNotes, 3);
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
  const selThemeHref = (t: string | null) =>
    `${href({})}&kc=${selCat}&kb=${selBlock}${selTone ? `&kt=${selTone}` : ""}${t ? `&tema=${t}` : ""}#teman`;
  const toneHref = (cat: string | null, blk: "nu" | "jmf", tone: string | null) =>
    `${href({})}${cat ? `&kc=${cat}&kb=${blk}${tone ? `&kt=${tone}` : ""}` : ""}#teman`;
  const dayHref = (key: string) => {
    const [y, m, d] = key.split("-").map(Number);
    return `/calendar/${y}/${m}/${d}${athleteQuery ? `?athlete=${userId}` : ""}`;
  };
  const weekday = (key: string) =>
    new Date(`${key}T12:00:00Z`).toLocaleDateString("sv-SE", { weekday: "short", timeZone: "UTC" });
  const pct = (done: number, due: number) => (due > 0 ? ` · ${Math.round((done / due) * 100)} %` : "");

  const closure = await blockClosure(supabase, userId, blocks, block, today);
  const closureObs = closureLines(closure);

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      {header}

      {/* Sidans inställningar, samlade i toppen (2026-11-21): de styr både
          bokslutet, rutorna och graferna. Grafens egna val (mått, visning)
          sitter vid grafen. Varje rad fälls ut till sina alternativ. */}
      <div className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)] text-sm">
        {[
          {
            key: "block",
            label: "Block",
            value: `${block.name} · ${ongoing ? `dag ${daysSoFar} av ${length}` : `${Math.round(length / 7)} v`}`,
            body: (
              <div className="flex flex-col">
                {[...started].reverse().slice(0, 8).map((b) => (
                  <Link
                    key={b.id}
                    href={`/analys?block=${b.id}${athleteQuery}`}
                    aria-current={block.id === b.id ? "true" : undefined}
                    className={`flex min-h-10 items-center justify-between gap-2 ${block.id === b.id ? "font-semibold text-[var(--foreground)]" : "text-[var(--ink-2)]"}`}
                  >
                    {b.name}
                    <span className="tabular text-xs text-[var(--ink-3)]">
                      {formatDateShort(b.start_date)}–{formatDateShort(b.end_date)} {b.end_date.slice(0, 4)}
                    </span>
                  </Link>
                ))}
              </div>
            ),
          },
          ...(comparisonOptions.length > 0
            ? [
                {
                  key: "jmf",
                  label: "Jämför med",
                  value: comparison
                    ? `${comparison.name}${blockLength(comparison) < daysSoFar ? " (hela)" : ", samma dag"}`
                    : "inget block",
                  body: (
                    <div className="flex flex-col">
                      {[...comparisonOptions].reverse().map((b) => (
                        <Link
                          key={b.id}
                          href={href({ jmf: b.id === defaultComparison?.id ? null : b.id })}
                          scroll={false}
                          aria-current={comparison?.id === b.id ? "true" : undefined}
                          className={`flex min-h-10 items-center justify-between gap-2 ${comparison?.id === b.id ? "font-semibold text-[var(--foreground)]" : "text-[var(--ink-2)]"}`}
                        >
                          {b.name}
                          {b.id === defaultComparison?.id && <span className="text-xs text-[var(--ink-3)]">förra året</span>}
                        </Link>
                      ))}
                      {comparison && blockLength(comparison) < daysSoFar && (
                        <p className="pt-1 text-xs text-[var(--ink-3)]">
                          {comparison.name} är bara {blockLength(comparison)} dagar — hela det blocket jämförs med de första {daysSoFar} dagarna här.
                        </p>
                      )}
                    </div>
                  ),
                },
              ]
            : []),
          {
            key: "typer",
            label: "Räkna med",
            value: include.size === TYPE_OPTIONS.length ? "alla passtyper" : `${include.size} av ${TYPE_OPTIONS.length} passtyper`,
            body: (
              <div className="flex flex-col gap-2">
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
                <p className="text-xs text-[var(--ink-3)]">Styr träningstid, distans och träningsdagar i rutorna och grafen.</p>
              </div>
            ),
          },
        ].map((row, i) => (
          <details key={row.key} className={`group ${i > 0 ? "border-t border-[var(--line)]" : ""}`}>
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-3.5 [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 flex-col">
                <span className="text-xs text-[var(--ink-3)]">{row.label}</span>
                <span className="truncate font-medium text-[var(--foreground)]">{row.value}</span>
              </span>
              <span aria-hidden className="text-[var(--ink-3)] transition-transform group-open:rotate-90">›</span>
            </summary>
            <div className="border-t border-[var(--line)] px-3.5 py-2">{row.body}</div>
          </details>
        ))}
      </div>

      {/* ===== Blockbokslut (C5, 2026-11-21) ===== */}
      {closure.length > 1 && (
        <Section
          title={ongoing ? "Blocket hittills" : "Bokslut"}
          description={`Mot de ${closure.length - 1 === 1 ? "senaste blocket" : `${closure.length - 1} senaste blocken`} av samma typ (${PHASE_LABELS[block.phase as PhaseType] ?? block.phase}).`}
        >
          <Observations items={closureObs} source="Ur klockan och dagboken · sjuk- och skadedagar är självskattade" />
          <DataTable
            minWidth="20rem"
            head={[
              "",
              ...closure.map((c, i) => (
                <span key={c.block.id} className="flex flex-col">
                  <span>{i === 0 ? "Detta" : c.block.name.replace(/^Allmän förberedelse /, "").replace(/^Tävlingsperiod /, "")}</span>
                  <span className="font-normal text-[var(--ink-3)]">{formatNumber(c.weeks, 0)} v{c.ongoing ? " hittills" : ""}</span>
                </span>
              )),
            ]}
            rows={[
              { cells: ["Träningstid/v", ...closure.map((c) => `${Math.round(c.minutesPerWeek)} min`)] },
              { cells: ["Distans/v", ...closure.map((c) => `${Math.round(c.kmPerWeek)} km`)] },
              { cells: ["Längsta vecka", ...closure.map((c) => `${Math.round(c.longestWeek)} min`)] },
              { cells: ["Träningsdagar", ...closure.map((c) => `${c.trainingDays} av ${c.days}`)] },
              { cells: ["Sjukdagar", ...closure.map((c) => c.sickDays)] },
              { cells: ["Skadedagar", ...closure.map((c) => c.injuredDays)] },
            ]}
          />
          {closure.slice(1).some((c) => c.racesAfter.length > 0) && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold text-[var(--foreground)]">Lopp efter blocken</span>
              {closure.slice(1).map((c) =>
                c.racesAfter.length > 0 ? (
                  <p key={c.block.id} className="text-sm text-[var(--ink-2)]">
                    <span className="text-[var(--ink-3)]">{c.block.name}: </span>
                    {c.racesAfter.map((r) => `${r.event.replace("m", " m")} ${r.result} (${formatDateShort(r.date)})`).join(" · ")}
                  </p>
                ) : null,
              )}
            </div>
          )}
          <HowCalculated>
            <p>
              Träningstid och distans är snitt per vecka över blockets dagar — för ett pågående block
              bara dagarna hittills. Tiden är hela passet utan styrka, samma regel som Idag. Distans
              räknas utan alternativ träning. Lopp är 800 och 1500 m inom åtta veckor efter blocket.
            </p>
          </HowCalculated>
        </Section>
      )}


      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            {comparison ? `Mot ${cmpLower}` : ongoing ? "Hittills i blocket" : "Hela blocket"}
          </h2>
          <SegmentedSmall
            label="Summering"
            options={[
              { key: "tot", label: "Totalt", href: visaHref(false), active: !perWeek },
              { key: "vecka", label: "Per vecka", href: visaHref(true), active: perWeek },
            ]}
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <TotalTile nowLabel={nowName} beforeLabel={cmpName} label="Träningstid (min)" now={scaled(now.minutes)} before={scaledOrNull(before?.minutes)} />
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
        <HowCalculated>
        <p >
          {perWeek
            ? `Snitt per vecka över ${(daysSoFar / 7).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} veckor${
                comparison ? `, samma antal dagar ${cmpLower}` : ""
              }. `
            : ""}
          Alternativ träning (cykel, crosstrainer, vattenlöpning) räknas i tid men aldrig i
          distans, eftersom en km på cykel inte är en km löpning. Den ingår i träningstid och
          träningsdagar.
        </p>
        <p >
          Styrkepass räknas också ur dagbokens passlogg, där de oftast skrivs in: gym, cirkel,
          medicinboll och liknande egna pass. Det underlaget är självskattat. Styrka som tillägg
          efter ett löppass räknas inte. Med styrka vald räknas en dag med ett styrkepass i
          dagboken som träningsdag; styrka räknas aldrig i
          träningstid. Sjuk- och skaddagar är markerade i dagboken
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
        </HowCalculated>
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
              : `${graf === "minuter" ? "Träningstiden" : graf === "distans" ? "Sträckan" : "Antal pass"} för de valda passtyperna${
                  vy === "vecka" ? ", per blockvecka" : ", dag för dag i blocket"
                }. Tryck i grafen för att se en ${vy === "vecka" ? "vecka" : "dag"}.`}
          </p>
        </div>

        <div className="flex flex-col gap-2">
          <div className="flex flex-wrap items-center gap-2">
            <SegmentedSmall
              label="Mått"
              options={(["minuter", "distans", "pass"] as const).map((g) => ({
                key: g,
                label: g === "minuter" ? "Tid" : GRAF_LABELS[g],
                href: href({ graf: g }),
                active: graf === g,
                disabled: mot === "plan" && g !== "pass",
              }))}
            />
            <SegmentedSmall
              label="Visa"
              options={[
                { key: "vecka", label: "Per vecka", href: href({ vy: "vecka" }), active: vy === "vecka" },
                { key: "ack", label: "Ackumulerat", href: href({ vy: "ack" }), active: vy === "ack" },
              ]}
            />
            {(comparison || hasPlan) && (
              <SegmentedSmall
                label="Jämför med"
                options={[
                  ...(comparison
                    ? [{ key: "fjol", label: `mot ${cmpLower}`, href: href({ mot: "fjol" }), active: mot === "fjol" }]
                    : []),
                  ...(hasPlan
                    ? [{ key: "plan", label: "mot planen", href: href({ mot: "plan" }), active: mot === "plan" }]
                    : []),
                ]}
              />
            )}
          </div>
          <p className="text-xs text-[var(--ink-3)]">
            Valen gäller bara den här grafen. Vilket block som jämförs väljer du under Jämför med i toppen.
            {mot === "plan" ? " Planen jämförs i antal pass." : ""}
          </p>
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
                    { label: "Planerat", short: "plan", values: weekStats.map((x) => (x ? x.due : null)), color: "var(--ink-2)", style: "outline" as const },
                    { label: "Gjort", short: "gjort", values: weekStats.map((x) => (x ? x.done : null)), color: THIS_YEAR, style: "fill" as const },
                  ]
                : [
                    ...(dailyBefore
                      ? [
                          {
                            label: cmpName,
                            short: markRows[1]?.label,
                            values: weeklySums(dailyBefore),
                            color: LAST_YEAR,
                            style: "outline" as const,
                            ...(weeklyByTypeBefore && weeklyByTypeBefore.length > 1 ? { stack: weeklyByTypeBefore } : {}),
                          },
                        ]
                      : []),
                    {
                      label: nowName,
                      short: markRows[0].label,
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
        <section id="missade" className="flex scroll-mt-4 flex-col gap-3">
          <div>
            <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
              Planerat som blev annat
            </h2>
          </div>
          {missed.length > 0 && (
            <Observations
              items={[missedSummary]}
              source="Ur planen, klockan och dagboken · sjuk och skadad är självskattat"
            />
          )}
          {missed.length === 0 ? (
            <p className="text-sm text-[var(--ink-3)]">Alla planerade pass hittills blev av.</p>
          ) : (
            <ul className="flex flex-col divide-y divide-[var(--line)] overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
              {(showAllMissed ? missed : missed.slice(-4).reverse()).map(({ planned: p, doneThatDay }) => {
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
          {missed.length > 4 && (
            <Link href={`${href({})}${showAllMissed ? "" : "&missade=alla"}#missade`} scroll={false} className="text-sm underline underline-offset-2">
              {showAllMissed ? "Visa bara de senaste" : `Visa alla ${missed.length} →`}
            </Link>
          )}
        </section>
      )}

      {/* Ur dagboken: känslan hon själv färgat (grönt/rosa) och vad hon skriver
          om, per passtyp, i valt block mot jämförelseblocket. Appen värderar
          inget själv — se lib/diary-themes.ts. */}
      <section id="teman" className="flex scroll-mt-4 flex-col gap-4">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Ur dagboken
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Hur passen kändes enligt löparens egen färgmarkering i dagboken — grönt för bra, rosa
            för mindre bra — {ongoing ? `fram till dag ${daysSoFar}` : "hela blocket"}
            {comparison ? `, mot ${cmpLower} fram till samma dag` : ""}.
          </p>
        </div>

        {!hasTone ? (
          <p className="text-sm text-[var(--ink-3)]">
            Det finns ingen färgmarkering för de här veckorna ännu.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <Observations items={diaryObs} source="Färgerna är hennes egen markering i dagboken — självskattat." />
            <div className="overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
              <div className="grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] gap-2 border-b border-[var(--line)] px-3.5 py-2 text-xs text-[var(--ink-3)]">
                <span>Passtyp</span>
                <span className="font-semibold text-[var(--foreground)]">{nowName}</span>
                <span>{comparison ? cmpName : ""}</span>
              </div>
              {[null, ...toneCats].map((cat) => {
                const catKey = cat ?? "alla";
                const dotsFor = (ns: ThemeNote[]) =>
                  (cat ? ns.filter((n) => n.category === cat) : ns)
                    .filter((n) => n.tone)
                    .map((n) => ({ date: n.date, tone: n.tone }));
                const selected = selCat === catKey;
                return (
                  <div
                    key={catKey}
                    className={`grid grid-cols-[minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1fr)] items-start gap-2 border-t border-[var(--line)] px-3.5 py-2.5 first:border-t-0 ${
                      selected ? "bg-[var(--surface-raised)]" : ""
                    }`}
                  >
                    <Link
                      href={selected ? toneHref(null, "nu", null) : toneHref(catKey, "nu", null)}
                      scroll={false}
                      className={`text-sm ${cat ? "text-[var(--ink-2)]" : "font-semibold text-[var(--foreground)]"} underline decoration-[var(--line)] underline-offset-2`}
                    >
                      {cat ? (CATEGORY_LABELS[cat as ActivityCategory] ?? cat) : "Alla pass"}
                    </Link>
                    <ToneDots dots={dotsFor(notesNow)} hrefFor={dayHref} />
                    {comparison ? <ToneDots dots={dotsFor(notesBefore)} hrefFor={dayHref} size={8} /> : <span />}
                  </div>
                );
              })}
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-2)]">
              {(["bra", "blandat", "mindre_bra"] as Tone[]).map((t) => (
                <span key={t} className="flex items-center gap-1.5">
                  <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TONE_COLORS[t] }} />
                  {TONE_LABELS[t]}
                </span>
              ))}
              <span>· en prick per anteckning, tryck för dagen · tryck på passtypen för att läsa</span>
            </div>
            {selLabel && (
              <div className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-sm font-semibold text-[var(--foreground)]">
                    {selLabel} · {selNotes.length} anteckningar
                  </h3>
                  <Link href={toneHref(null, "nu", null)} scroll={false} className="text-xs text-[var(--ink-3)] underline">
                    stäng
                  </Link>
                </div>
                <div className="flex flex-wrap gap-1 text-xs" role="group" aria-label="Känsla i urvalet">
                  {([null, "bra", "blandat", "mindre_bra"] as (Tone | null)[]).map((t) => {
                    const n = t ? selPool.filter((x) => x.tone === t).length : selPool.length;
                    const on = selTone === t;
                    return (
                      <Link
                        key={t ?? "alla"}
                        href={toneHref(selCat, selBlock, t)}
                        scroll={false}
                        aria-current={on ? "true" : undefined}
                        className={`flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 ${
                          on ? "border-[var(--foreground)] text-[var(--foreground)]" : "border-[var(--line)] text-[var(--ink-2)]"
                        }`}
                      >
                        {t && <span aria-hidden className="inline-block h-2 w-2 rounded-full" style={{ backgroundColor: TONE_COLORS[t] }} />}
                        {t ? TONE_LABELS[t] : "Alla"} <span className="tabular text-[var(--ink-3)]">{n}</span>
                      </Link>
                    );
                  })}
                </div>
                {selWords.length > 0 && (
                  <div className="flex flex-col gap-1">
                    <span className="text-xs text-[var(--ink-3)]">Vanligaste orden — i hur många av anteckningarna de står</span>
                    <div className="flex flex-wrap gap-1.5">
                      {selWords.map((w) => (
                        <span key={w.word} className="rounded bg-[var(--surface-raised)] px-2 py-0.5 text-xs text-[var(--ink-2)]">
                          {w.word} <span className="tabular text-[var(--ink-3)]">{w.notes}</span>
                        </span>
                      ))}
                    </div>
                  </div>
                )}
                {activeTheme && (
                  <p className="text-xs text-[var(--ink-2)]">
                    Visar anteckningar som tar upp {activeTheme.label.toLowerCase()} ·{" "}
                    <Link href={selThemeHref(null)} scroll={false} className="underline">
                      visa alla
                    </Link>
                  </p>
                )}
                {selNotes.length > 0 && (
                  <ul className="flex flex-col divide-y divide-[var(--line)]">
                    {[...selNotes].filter((q) => !activeTheme || activeTheme.re.test(q.text)).reverse().map((q) => (
                      <li key={q.date}>
                        <Link href={dayHref(q.date)} className="flex items-start gap-3 py-2 hover:bg-[var(--surface-raised)]">
                          <span className="tabular w-12 shrink-0 text-xs text-[var(--ink-3)]">{short(q.date)}</span>
                          {(activeTheme ? mentionTone(q, activeTheme.re) : q.tone) && (
                            <span
                              aria-label={TONE_LABELS[(activeTheme ? mentionTone(q, activeTheme.re) : q.tone)!]}
                              title={TONE_LABELS[(activeTheme ? mentionTone(q, activeTheme.re) : q.tone)!]}
                              className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: TONE_COLORS[(activeTheme ? mentionTone(q, activeTheme.re) : q.tone)!] }}
                            />
                          )}
                          <span className="text-sm text-[var(--ink-2)]">
                            {q.text.length > 240 ? `${q.text.slice(0, 240).trim()}…` : q.text}
                          </span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            <HowCalculated>
              <p>
                En anteckning räknas som bra när minst två tredjedelar av den färgade texten är grön, mindre bra
                när minst två tredjedelar är rosa, annars blandat. Anteckningen hör till dagens mest krävande
                pass. Få anteckningar per passtyp i ett block — läs dem som en fingervisning, inte ett mått.
              </p>
            </HowCalculated>
          </div>
        )}

        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-semibold text-[var(--foreground)]">
            Vad anteckningarna tar upp{selLabel ? ` · ${selLabel}` : ""}
          </h3>
          <p className="-mt-1 text-xs text-[var(--ink-3)]">
            En prick per anteckning som tar upp temat, i den färg temat skrevs:{" "}
            <span style={{ color: TONE_COLORS.bra }}>grönt</span> = bra,{" "}
            <span style={{ color: TONE_COLORS.mindre_bra }}>rosa</span> = mindre bra, grått = båda i samma
            anteckning.
          </p>
          {selLabel ? (
            <table className="w-full table-fixed text-sm">
              <thead>
                <tr className="text-left text-xs text-[var(--ink-3)]">
                  <th className="w-[40%] pb-1 font-normal">Tema</th>
                  <th className="pb-1 font-normal">
                    Urvalet <span className="tabular">{selNotes.length} st</span>
                  </th>
                  {selTone && (
                    <th className="pb-1 font-normal">
                      Alla i passtypen <span className="tabular">{selPool.length} st</span>
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {THEMES.map((t) => {
                  const mc = mentionCounts(selNotes, t.re);
                  const n = mc.total;
                  const all = mentionCounts(selPool, t.re).total;
                  const active = activeTheme?.key === t.key;
                  return (
                    <tr key={t.key} className="border-t border-[var(--line)]">
                      <td className="py-1.5 pr-2 text-[var(--ink-2)]">{t.label}</td>
                      <td className="py-1.5">
                        {n === 0 ? (
                          <span className="text-[var(--ink-3)]">–</span>
                        ) : (
                          <Link
                            href={selThemeHref(active ? null : t.key)}
                            scroll={false}
                            className={`tabular rounded px-1.5 py-0.5 ${
                              active
                                ? "bg-[var(--foreground)] text-[var(--background)]"
                                : "underline decoration-[var(--line)] underline-offset-2"
                            }`}
                          >
                            {n}/{selNotes.length}
                          </Link>
                        )}
                        <MentionBar c={mc} />
                      </td>
                      {selTone && (
                        <td className="tabular py-1.5 text-[var(--ink-3)]">{all === 0 ? "–" : `${all}/${selPool.length}`}</td>
                      )}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : block.end_date < THEMES_FROM ? (
            <p className="text-sm text-[var(--ink-3)]">
              Det finns ingen dagbok från den här perioden.
            </p>
          ) : themes.categories.length === 0 ? (
            <p className="text-sm text-[var(--ink-3)]">För få anteckningar i blocket ännu.</p>
          ) : (
            <>
              <table className="w-full table-fixed text-sm">
                <thead>
                  <tr className="text-left text-xs text-[var(--ink-3)]">
                    <th className="w-[30%] pb-1 font-normal">Tema</th>
                    {themes.categories.map((c) => (
                      <th key={c.category} className="pb-1 font-normal">
                        <span className="block truncate">
                          {({ cross_training: "Alt.träning", interval: "Intervall" } as Record<string, string>)[c.category] ??
                            CATEGORY_LABELS[c.category as ActivityCategory] ??
                            c.category}
                        </span>
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
                        const dots = themeNotes
                          .filter((x) => x.category === c.category && (t.re.test(x.text) || (x.good && t.re.test(x.good)) || (x.bad && t.re.test(x.bad))))
                          .map((x) => ({ date: x.date, tone: mentionTone(x, t.re) }));
                        const active = activeTheme?.key === t.key && activeType === c.category;
                        return (
                          <td key={c.category} className="py-2 pr-1 align-top">
                            {n === 0 ? (
                              <span className="text-[var(--ink-3)]">–</span>
                            ) : (
                              <Link
                                href={active ? themeHref(null, null) : themeHref(t.key, c.category)}
                                scroll={false}
                                title={`${n} av ${cell?.notes} anteckningar — tryck för att läsa`}
                                className={`inline-flex rounded-md p-1 ${active ? "bg-[var(--surface-raised)] ring-1 ring-[var(--foreground)]" : "hover:bg-[var(--surface-raised)]"}`}
                              >
                                <ToneDots dots={dots} size={8} />
                              </Link>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              {activeTheme && activeType && themeQuotes.length > 0 && (
                <div className="flex flex-col gap-2">
                  <h4 className="text-sm font-medium text-[var(--foreground)]">
                    {activeTheme.label} · {CATEGORY_LABELS[activeType as ActivityCategory] ?? activeType} ·{" "}
                    {themeQuotes.length} anteckningar
                  </h4>
                  <ul className="flex flex-col divide-y divide-[var(--line)] rounded-lg border border-[var(--line)] bg-[var(--surface)]">
                    {themeQuotes.map((q) => (
                      <li key={q.date}>
                        <Link href={dayHref(q.date)} className="flex items-start gap-3 px-3 py-2 hover:bg-[var(--surface-raised)]">
                          <span className="tabular w-12 shrink-0 text-xs text-[var(--ink-3)]">{short(q.date)}</span>
                          {(activeTheme ? mentionTone(q, activeTheme.re) : q.tone) && (
                            <span
                              aria-label={TONE_LABELS[(activeTheme ? mentionTone(q, activeTheme.re) : q.tone)!]}
                              title={TONE_LABELS[(activeTheme ? mentionTone(q, activeTheme.re) : q.tone)!]}
                              className="mt-1.5 inline-block h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: TONE_COLORS[(activeTheme ? mentionTone(q, activeTheme.re) : q.tone)!] }}
                            />
                          )}
                          <span className="text-sm text-[var(--ink-2)]">”{quoteFor(q.text, activeTheme.re)}”</span>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          <p className="text-xs text-[var(--ink-3)]">
            Underlaget är löparens egna anteckningar, självskattat. En anteckning räknas till dagens
            mest krävande pass. Dagar utan pass räknas inte.
          </p>
        </div>
      </section>
    </div>
  );
}
