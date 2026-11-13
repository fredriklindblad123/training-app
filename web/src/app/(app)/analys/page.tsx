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
}: {
  label: string;
  now: number;
  before: number | null;
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
      {row("I år", now, THIS_YEAR, true)}
      {before != null && row("Förra året", before, LAST_YEAR, false)}
      {before != null && (
        <span className="tabular text-xs text-[var(--ink-2)]">{signed(now - before, digits)} mot förra året</span>
      )}
      {note && <span className="tabular text-xs text-[var(--ink-3)]">{note}</span>}
    </div>
  );
}

export default async function AnalysPage({
  searchParams,
}: {
  searchParams: Promise<{ block?: string; athlete?: string; typer?: string; visa?: string }>;
}) {
  const { block: blockParam, athlete: athleteParam, typer, visa } = await searchParams;
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

  const comparison = findComparisonBlock(blocks, block);
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
  const interruptedDays = (b: { start_date: string }, days: number) => {
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
    { label: block.start_date.slice(0, 4), marks: marksNow },
    ...(marksBefore && comparison
      ? [{ label: comparison.start_date.slice(0, 4), marks: marksBefore, outline: true }]
      : []),
  ];
  const dayLabels = Array.from({ length }, (_, i) => {
    const key = shiftKey(block.start_date, i);
    const notes = [
      marksNow[i] ? `${marksNow[i]!.label} i år` : null,
      marksBefore?.[i] ? `${marksBefore[i]!.label} förra året` : null,
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
  const planned = (plannedRows ?? []) as PlannedWorkout[];

  // --- Hittills i år mot samma antal dagar förra året -----------------------
  const now: BlockTotals = totalsUpToDay(chosen, block, daysSoFar, moving);
  const before: BlockTotals | null = comparison
    ? totalsUpToDay(chosen, comparison, daysSoFar, moving)
    : null;
  // Distansen hålls isär: en km på cykel är inte en km löpning, så
  // alternativ träning får en egen ruta och ingår inte i Distans.
  const chosenNoCross = chosen.filter((s) => s.category !== "cross_training");
  const kmMain = totalsUpToDay(chosenNoCross, block, daysSoFar, moving).km;
  const kmMainBefore = comparison ? totalsUpToDay(chosenNoCross, comparison, daysSoFar, moving).km : null;
  const crossOnly = sessions.filter((s) => s.category === "cross_training");
  const showCross = include.has("cross_training");
  const cross = totalsUpToDay(crossOnly, block, daysSoFar, moving);
  const crossBefore = comparison ? totalsUpToDay(crossOnly, comparison, daysSoFar, moving) : null;
  // Snitt per vecka: delat med antalet veckor som passerat (dagar / 7).
  const per = perWeek ? 7 / daysSoFar : 1;
  const scaled = (v: number) => v * per;
  const scaledOrNull = (v: number | null | undefined) => (v == null ? null : v * per);
  // Kvalitets- och styrkepass räknas alltid, oavsett valda typer.
  const nowAll = totalsUpToDay(sessions, block, daysSoFar, moving, diaryStrength);
  const beforeAll = comparison
    ? totalsUpToDay(sessions, comparison, daysSoFar, moving, diaryStrength)
    : null;

  // --- Aktiva minuter ------------------------------------------------------
  const minutesOf = (s: TrainingSession) => activeSeconds(s, moving) / 60;
  const dailyNow = dailyValues(chosen, block, minutesOf).slice(0, daysSoFar);
  const dailyBefore = comparison ? dailyValues(chosen, comparison, minutesOf).slice(0, length) : null;
  const weeks = Math.ceil(length / 7);
  const weeklyNow = weeklySums(dailyNow);
  const weeklyBefore = dailyBefore ? weeklySums(dailyBefore) : null;
  const kmNow = dailyValues(chosen, block, sessionKm).slice(0, daysSoFar);
  const kmBefore = comparison ? dailyValues(chosen, comparison, sessionKm).slice(0, length) : null;
  const weeklyKmNow = weeklySums(kmNow);
  const weeklyKmBefore = kmBefore ? weeklySums(kmBefore) : null;

  const typerQuery = typer != null ? `&typer=${typer}` : "";
  const typeHref = (t: string) => {
    const next = new Set(include);
    if (next.has(t)) next.delete(t);
    else next.add(t);
    const list = TYPE_OPTIONS.filter((x) => next.has(x)).join(",");
    return `/analys?block=${block.id}${athleteQuery}&typer=${list}${perWeek ? "&visa=vecka" : ""}`;
  };
  const visaHref = (vecka: boolean) =>
    `/analys?block=${block.id}${athleteQuery}${typerQuery}${vecka ? "&visa=vecka" : ""}`;

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
  const hasPlan = planned.some((p) => p.workout_type !== "rest");

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
    const notes = [count(marksNow, "i år"), count(marksBefore, "förra året")].filter(Boolean);
    return `v${w + 1} · ${short(s)}–${short(e)}${notes.length ? ` · ${notes.join(" · ")}` : ""}`;
  };

  // --- Missade pass mot planen ---------------------------------------------
  const trainedToday =
    sessions.some((x) => x.date === today) || diaryStrength.includes(today);
  const cutoffRaw = ongoing ? passedCutoff(today, trainedToday) : block.end_date;
  const cutoff = cutoffRaw > block.end_date ? block.end_date : cutoffRaw;
  const missed = missedPasses(planned, sessions, diaryStrength, block.start_date, cutoff);
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
          ? `Jämförs med ${comparison.name} fram till samma dag i blocket.`
          : "Det finns inget motsvarande block förra året att jämföra med."}
      </p>

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
          <div className="flex gap-1 text-sm" role="group" aria-label="Visa">
            {[
              { vecka: false, label: "Totalt" },
              { vecka: true, label: "Snitt per vecka" },
            ].map((o) => (
              <Link
                key={o.label}
                href={visaHref(o.vecka)}
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
          <TotalTile label="Aktiva minuter" now={scaled(now.minutes)} before={scaledOrNull(before?.minutes)} />
          <TotalTile
            label={showCross ? "Distans utom alt. träning" : "Distans"}
            now={scaled(kmMain)}
            before={scaledOrNull(kmMainBefore)}
            unit="km"
            digits={perWeek ? 1 : 0}
          />
          {showCross && (
            <TotalTile
              label="Alternativ träning"
              now={scaled(cross.km)}
              before={scaledOrNull(crossBefore?.km)}
              unit="km"
              digits={perWeek ? 1 : 0}
              note={`${Math.round(scaled(cross.minutes))} min i år${
                crossBefore ? `, ${Math.round(scaled(crossBefore.minutes))} min förra året` : ""
              }`}
            />
          )}
          <TotalTile label="Träningsdagar" now={scaled(now.trainingDays)} before={scaledOrNull(before?.trainingDays)} digits={perWeek ? 1 : 0} />
          <TotalTile label="Kvalitetspass" now={scaled(nowAll.qualitySessions)} before={scaledOrNull(beforeAll?.qualitySessions)} digits={perWeek ? 1 : 0} />
          <TotalTile label="Styrkepass" now={scaled(nowAll.strengthSessions)} before={scaledOrNull(beforeAll?.strengthSessions)} digits={perWeek ? 1 : 0} />
          <TotalTile
            label="Sjuk/skadad, dagar"
            now={scaled(sickNow.sick + sickNow.injured)}
            before={sickBefore ? scaled(sickBefore.sick + sickBefore.injured) : null}
            digits={perWeek ? 1 : 0}
          />
        </div>
        <p className="text-xs text-[var(--ink-3)]">
          {perWeek
            ? `Snitt per vecka över ${(daysSoFar / 7).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} veckor${
                comparison ? ", samma antal dagar förra året" : ""
              }. `
            : ""}
          Alternativ träning (cykel, crosstrainer, vattenlöpning) räknas för sig, eftersom en km på
          cykel inte är en km löpning. Den ingår i aktiva minuter och träningsdagar.
        </p>
        <p className="text-xs text-[var(--ink-3)]">
          Styrkepass räknas också ur dagbokens passlogg, där de oftast skrivs in: gym, cirkel,
          medicinboll och liknande egna pass. Det underlaget är självskattat. Styrka som tillägg
          efter ett löppass räknas inte. Sjuk- och skaddagar är markerade i dagboken
          {sickNow.sick + sickNow.injured > 0
            ? ` — i år ${[
                sickNow.sick > 0 ? `${sickNow.sick} sjuk` : null,
                sickNow.injured > 0 ? `${sickNow.injured} skadad` : null,
              ]
                .filter(Boolean)
                .join(", ")}`
            : ""}
          {sickBefore && sickBefore.sick + sickBefore.injured > 0
            ? `, förra året ${[
                sickBefore.sick > 0 ? `${sickBefore.sick} sjuk` : null,
                sickBefore.injured > 0 ? `${sickBefore.injured} skadad` : null,
              ]
                .filter(Boolean)
                .join(", ")}`
            : ""}
          . De syns som remsor under graferna: fyllda för i år, konturerade för förra året.
        </p>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Aktiva minuter, ackumulerat
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Aktiv tid för de valda passtyperna, dag för dag i blocket. Tryck i grafen för att se en
            dag.
          </p>
        </div>
        <CumulativeLineChart
          days={length}
          unit="min"
          ariaLabel={`Aktiva minuter ackumulerat i ${block.name}${comparison ? ` och ${comparison.name}` : ""}`}
          defaultIndex={daysSoFar - 1}
          dayLabels={dayLabels}
          markRows={markRows}
          series={[
            ...(dailyBefore
              ? [{ label: "Förra året", values: cumulative(dailyBefore), color: LAST_YEAR, dashed: true }]
              : []),
            { label: "I år", values: cumulative(dailyNow), color: THIS_YEAR },
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Aktiva minuter per vecka
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Blockveckor, räknade från blockets första dag.
          </p>
        </div>
        <GroupedBarChart
          groups={Array.from({ length: weeks }, (_, w) => `v${w + 1}`)}
          groupLabels={Array.from({ length: weeks }, (_, w) => weekLabel(w))}
          defaultIndex={Math.floor((daysSoFar - 1) / 7)}
          markRows={markRows}
          unit="min"
          ariaLabel="Aktiva minuter per blockvecka"
          series={[
            ...(weeklyBefore
              ? [{ label: "Förra året", values: weeklyBefore, color: LAST_YEAR, style: "outline" as const }]
              : []),
            {
              label: "I år",
              values: Array.from({ length: weeks }, (_, w) => (w < weeklyNow.length ? weeklyNow[w] : null)),
              color: THIS_YEAR,
              style: "fill" as const,
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Distans, ackumulerat
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Sträckan för de valda passtyperna, dag för dag i blocket.
          </p>
        </div>
        <CumulativeLineChart
          days={length}
          unit="km"
          ariaLabel={`Distans ackumulerat i ${block.name}${comparison ? ` och ${comparison.name}` : ""}`}
          defaultIndex={daysSoFar - 1}
          dayLabels={dayLabels}
          markRows={markRows}
          series={[
            ...(kmBefore
              ? [{ label: "Förra året", values: cumulative(kmBefore), color: LAST_YEAR, dashed: true }]
              : []),
            { label: "I år", values: cumulative(kmNow), color: THIS_YEAR },
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Distans per vecka
        </h2>
        <GroupedBarChart
          groups={Array.from({ length: weeks }, (_, w) => `v${w + 1}`)}
          groupLabels={Array.from({ length: weeks }, (_, w) => weekLabel(w))}
          defaultIndex={Math.floor((daysSoFar - 1) / 7)}
          markRows={markRows}
          unit="km"
          ariaLabel="Distans per blockvecka"
          series={[
            ...(weeklyKmBefore
              ? [{ label: "Förra året", values: weeklyKmBefore, color: LAST_YEAR, style: "outline" as const }]
              : []),
            {
              label: "I år",
              values: Array.from({ length: weeks }, (_, w) => (w < weeklyKmNow.length ? weeklyKmNow[w] : null)),
              color: THIS_YEAR,
              style: "fill" as const,
            },
          ]}
        />
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Planerat och gjort
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Antal pass per vecka: kvalitet, distans och styrka. Gjorda pass räknas inom veckan, inte
            dag för dag. Bara dagar som passerat räknas. Ett planerat pass på en sjuk- eller skaddag
            som inte blev av räknas inte
            {blockStats.excusedCount > 0 ? ` (${blockStats.excusedCount} i blocket)` : ""}.
          </p>
        </div>
        {hasPlan ? (
          <>
            <GroupedBarChart
              groups={Array.from({ length: weeks }, (_, w) => `v${w + 1}`)}
              groupLabels={Array.from({ length: weeks }, (_, w) => weekLabel(w))}
              defaultIndex={Math.floor((daysSoFar - 1) / 7)}
              markRows={markRows}
              unit="pass"
              ariaLabel="Planerade och gjorda pass per blockvecka"
              series={[
                {
                  label: "Planerat",
                  values: weekStats.map((s) => (s ? s.due : null)),
                  color: "var(--ink-2)",
                  style: "outline",
                },
                {
                  label: "Gjort",
                  values: weekStats.map((s) => (s ? s.done : null)),
                  color: THIS_YEAR,
                  style: "fill",
                },
              ]}
            />
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
          </>
        ) : (
          <p className="text-sm text-[var(--ink-3)]">Inget planerat i blocket — bara utfall att visa.</p>
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
    </div>
  );
}
