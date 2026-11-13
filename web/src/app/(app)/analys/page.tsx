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
import { computeRangeStats } from "@/lib/range-stats";
import {
  blockLength,
  cumulative,
  dailyMinutes,
  dayIndex,
  findComparisonBlock,
  shiftKey,
  totalsUpToDay,
  weeklySums,
  type AnalysisBlock,
  type BlockTotals,
} from "@/lib/block-analysis";
import { CumulativeLineChart, GroupedBarChart } from "@/components/charts/AnalysisCharts";

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

function TotalTile({
  label,
  now,
  before,
  unit = "",
  digits = 0,
}: {
  label: string;
  now: number;
  before: number | null;
  unit?: string;
  digits?: number;
}) {
  return (
    <div className="flex flex-col gap-0.5 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
      <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
        {label}
      </span>
      <span className="display tabular text-2xl font-semibold text-[var(--foreground)]">
        {Number(now.toFixed(digits)).toLocaleString("sv-SE")}
        {unit && <span className="ml-1 text-sm font-normal text-[var(--ink-3)]">{unit}</span>}
      </span>
      {before != null && (
        <span className="tabular text-xs text-[var(--ink-2)]">
          förra året {Number(before.toFixed(digits)).toLocaleString("sv-SE")} ({signed(now - before, digits)})
        </span>
      )}
    </div>
  );
}

export default async function AnalysPage({
  searchParams,
}: {
  searchParams: Promise<{ block?: string; athlete?: string }>;
}) {
  const { block: blockParam, athlete: athleteParam } = await searchParams;
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
  const [{ data: activityRows }, { data: plannedRows }] = await Promise.all([
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
  ]);
  const sessions: TrainingSession[] = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );
  const planned = (plannedRows ?? []) as PlannedWorkout[];

  // --- Hittills i år mot samma antal dagar förra året -----------------------
  const now: BlockTotals = totalsUpToDay(sessions, block, daysSoFar);
  const before: BlockTotals | null = comparison ? totalsUpToDay(sessions, comparison, daysSoFar) : null;

  // --- Aktiva minuter ------------------------------------------------------
  const dailyNow = dailyMinutes(sessions, block).slice(0, daysSoFar);
  const dailyBefore = comparison ? dailyMinutes(sessions, comparison).slice(0, length) : null;
  const weeks = Math.ceil(length / 7);
  const weeklyNow = weeklySums(dailyNow);
  const weeklyBefore = dailyBefore ? weeklySums(dailyBefore) : null;

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
  });
  const hasPlan = planned.some((p) => p.workout_type !== "rest");

  const weekLabel = (w: number) => {
    const s = shiftKey(block.start_date, w * 7);
    const e = shiftKey(block.start_date, Math.min(w * 7 + 6, length - 1));
    return `v${w + 1} · ${short(s)}–${short(e)}`;
  };
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

      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          {ongoing ? "Hittills i blocket" : "Hela blocket"}
        </h2>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
          <TotalTile label="Aktiva minuter" now={now.minutes} before={before?.minutes ?? null} />
          <TotalTile label="Träningsdagar" now={now.trainingDays} before={before?.trainingDays ?? null} />
          <TotalTile label="Löpning" now={now.runKm} before={before?.runKm ?? null} unit="km" />
          <TotalTile label="Kvalitetspass" now={now.qualitySessions} before={before?.qualitySessions ?? null} />
          <TotalTile label="Styrkepass" now={now.strengthSessions} before={before?.strengthSessions ?? null} />
        </div>
      </section>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Aktiva minuter, ackumulerat
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            All registrerad träningstid, dag för dag i blocket. Tryck i grafen för att se en dag.
          </p>
        </div>
        <CumulativeLineChart
          days={length}
          unit="min"
          ariaLabel={`Aktiva minuter ackumulerat i ${block.name}${comparison ? ` och ${comparison.name}` : ""}`}
          defaultIndex={daysSoFar - 1}
          dayLabels={Array.from({ length }, (_, i) => `Dag ${i + 1} · ${short(shiftKey(block.start_date, i))}`)}
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
            Planerat och gjort
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Antal pass per vecka: kvalitet, distans och styrka. Gjorda pass räknas inom veckan, inte
            dag för dag. Bara dagar som passerat räknas.
          </p>
        </div>
        {hasPlan ? (
          <>
            <GroupedBarChart
              groups={Array.from({ length: weeks }, (_, w) => `v${w + 1}`)}
              groupLabels={Array.from({ length: weeks }, (_, w) => weekLabel(w))}
          defaultIndex={Math.floor((daysSoFar - 1) / 7)}
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
    </div>
  );
}
