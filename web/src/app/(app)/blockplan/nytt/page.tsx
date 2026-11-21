import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { assignableAthletes, getScopedProfile } from "@/lib/auth-scope";
import { getViewMode } from "@/lib/view-mode";
import { addDays, mondayOf, toDateKey, PHASE_INTENT, PHASE_LABELS, PERIOD_LABELS, PERIOD_TYPES, PHASE_TYPES } from "@/lib/planning";
import { formatDateShort } from "@/lib/format";
import { Wizard, type PatternSource } from "./Wizard";
import type { PatternItem } from "./actions";

/* /blockplan/nytt — skapa ett block i tre steg (2026-11-21, mockupens
 * "Skapa block"). Sidan hämtar bara underlaget; stegen och sparandet bor i
 * Wizard.tsx och actions.ts. */

const REP_COLS =
  "sort_order, reps, distance_meters, duration_seconds, target_pace_seconds_per_km, target_hr_low, target_hr_high, recovery_seconds, recovery_kind, note";

export default async function NewBlockPage({
  searchParams,
}: {
  searchParams: Promise<{ fran?: string }>;
}) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  if (scoped.role !== "coach" || (await getViewMode()) === "runner") redirect("/dashboard");

  const { fran } = await searchParams;
  const athletes = assignableAthletes(scoped);
  const ids = athletes.map((a) => a.id);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

  const { data: blockRows } = ids.length
    ? await supabase
        .from("season_blocks")
        .select("id, name, phase, start_date, end_date, blockFilter:season_block_athletes!inner(athlete_id)")
        .in("blockFilter.athlete_id", ids)
        .order("start_date")
    : { data: [] };
  const blocks = [
    ...new Map(
      ((blockRows ?? []) as { id: string; name: string; phase: string; start_date: string; end_date: string }[]).map((b) => [b.id, b]),
    ).values(),
  ];

  // Förslag på start: ?fran, annars dagen efter blocket som pågår idag.
  const current = blocks.find((b) => b.start_date <= today && b.end_date >= today);
  const start =
    fran && /^\d{4}-\d{2}-\d{2}$/.test(fran)
      ? fran
      : current
        ? toDateKey(addDays(new Date(`${current.end_date}T12:00:00`), 1))
        : toDateKey(addDays(mondayOf(today), 7));
  const before = [...blocks].reverse().find((b) => b.end_date < start) ?? null;
  const after = blocks.find((b) => b.start_date > start) ?? null;

  const [{ data: raceRows }, { data: itemRows }, { data: weekRows }] = await Promise.all([
    ids.length
      ? supabase
          .from("competitions")
          .select("name, competition_date, priority")
          .in("user_id", ids)
          .gte("competition_date", start)
          .order("competition_date")
          .limit(12)
      : Promise.resolve({ data: [] }),
    supabase
      .from("week_template_items")
      .select(
        `block_id, weekday, slot, workout_type, title, description, target_distance_meters, target_duration_seconds, training_factor, template_rep_groups(${REP_COLS})`,
      )
      .in("block_id", blocks.map((b) => b.id)),
    // Veckan som pågår, för varje löpare — Alices verkliga plan ligger som
    // handlagda pass, inte i blockets mall.
    ids.length
      ? supabase
          .from("planned_workouts")
          .select(
            `user_id, scheduled_date, slot, workout_type, title, description, target_distance_meters, target_duration_seconds, training_factor, planned_rep_groups(${REP_COLS})`,
          )
          .in("user_id", ids)
          .gte("scheduled_date", toDateKey(mondayOf(today)))
          .lte("scheduled_date", toDateKey(addDays(mondayOf(today), 6)))
      : Promise.resolve({ data: [] }),
  ]);

  type Row = Omit<PatternItem, "rep_groups" | "weekday"> & { template_rep_groups?: PatternItem["rep_groups"] };
  const sources: PatternSource[] = [];

  const weekByAthlete = new Map<string, PatternItem[]>();
  for (const w of (weekRows ?? []) as (Row & { user_id: string; scheduled_date: string; planned_rep_groups?: PatternItem["rep_groups"] })[]) {
    const weekday = ((new Date(`${w.scheduled_date}T12:00:00`).getDay() + 6) % 7) + 1;
    const list = weekByAthlete.get(w.user_id) ?? [];
    list.push({
      weekday,
      slot: w.slot,
      workout_type: w.workout_type,
      title: w.title,
      description: w.description,
      target_distance_meters: w.target_distance_meters,
      target_duration_seconds: w.target_duration_seconds,
      training_factor: w.training_factor ?? null,
      rep_groups: w.planned_rep_groups ?? [],
    });
    weekByAthlete.set(w.user_id, list);
  }
  for (const a of athletes) {
    const items = weekByAthlete.get(a.id);
    if (items?.length) sources.push({ key: `vecka-${a.id}`, label: `${a.fullName ?? "Löpare"}s vecka som pågår (från ${formatDateShort(toDateKey(mondayOf(today)))})`, items });
  }

  const itemsByBlock = new Map<string, PatternItem[]>();
  for (const it of (itemRows ?? []) as (Row & { block_id: string; weekday: number })[]) {
    const list = itemsByBlock.get(it.block_id) ?? [];
    list.push({ ...it, rep_groups: it.template_rep_groups ?? [], training_factor: it.training_factor ?? null });
    itemsByBlock.set(it.block_id, list);
  }
  for (const b of [...blocks].reverse()) {
    const items = itemsByBlock.get(b.id);
    if (items?.length) sources.push({ key: b.id, label: `Mallen för ${b.name}`, items });
  }
  sources.push({ key: "tom", label: "Tom vecka", items: [] });

  return (
    <Wizard
      athletes={athletes.map((a) => ({ id: a.id, name: a.fullName ?? "Löpare" }))}
      defaultAthletes={athletes.filter((a) => weekByAthlete.has(a.id)).map((a) => a.id)}
      start={start}
      context={{
        before: before ? { name: before.name, end: before.end_date } : null,
        after: after ? { name: after.name, start: after.start_date } : null,
        blocks: blocks.map((b) => ({ name: b.name, start: b.start_date, end: b.end_date })),
        races: ((raceRows ?? []) as { name: string; competition_date: string; priority: string }[])
          .filter((r, i, arr) => arr.findIndex((x) => x.name === r.name && x.competition_date === r.competition_date) === i)
          .slice(0, 4)
          .map((r) => ({ name: r.name, date: r.competition_date, priority: r.priority })),
      }}
      periods={PERIOD_TYPES.map((p) => ({ value: p, label: PERIOD_LABELS[p] }))}
      phases={PHASE_TYPES.map((p) => ({ value: p, label: PHASE_LABELS[p], intent: PHASE_INTENT[p] }))}
      sources={sources}
    />
  );
}
