"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { assignableAthletes, getScopedProfile } from "@/lib/auth-scope";
import { syncBlockPattern } from "@/lib/template-sync";
import {
  PERIOD_TYPES,
  PHASE_TYPES,
  THRESHOLD_TEST_PROTOCOL,
  addDays,
  mondayOf,
  toDateKey,
  type RepGroupInput,
  type TemplateItem,
} from "@/lib/planning";

/* Skapa block i ett svep (2026-11-21) — ram, veckomönster och veckornas typ.
 *
 * Ersätter vägen genom tre sidor (Säsongsöversikt för ramen, Blockplan för
 * mönstret, Detaljplan för veckorna). Allt sparas först när tränaren trycker
 * på sista knappen; inget halvfärdigt block kan bli liggande.
 *
 * Utrullningen går genom samma syncBlockPattern som resten av planeringen,
 * så ett pass som redan ligger på ett datum (status 'modified', handlagt)
 * skrivs aldrig över. Veckotyperna justerar sedan bara de pass som just
 * skapades i blocket (block_id + status 'planned'):
 *   Lättare — planerad tid och distans ca 20 % kortare.
 *   Test    — veckans första tröskelpass blir ett tröskeltest. */

export type WeekKind = "normal" | "lattare" | "test";
export type PatternItem = TemplateItem & { rep_groups: RepGroupInput[] };

const LIGHT_FACTOR = 0.8;

function str(fd: FormData, k: string): string | null {
  const v = fd.get(k);
  return typeof v === "string" && v.trim() !== "" ? v.trim() : null;
}

export async function createBlockFromWizard(formData: FormData) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped || scoped.role !== "coach") return;

  const name = str(formData, "name");
  const start = str(formData, "start_date");
  const end = str(formData, "end_date");
  const period = str(formData, "period");
  const phase = str(formData, "phase");
  if (!name || !start || !end || end < start) return;
  if (!period || !(PERIOD_TYPES as readonly string[]).includes(period)) return;
  if (!phase || !(PHASE_TYPES as readonly string[]).includes(phase)) return;

  const valid = new Set(assignableAthletes(scoped).map((a) => a.id));
  const athleteIds = formData.getAll("athletes").map(String).filter((id) => valid.has(id));
  if (athleteIds.length === 0) return;

  let pattern: PatternItem[] = [];
  let weekKinds: Record<string, WeekKind> = {};
  try {
    pattern = JSON.parse(str(formData, "pattern") ?? "[]") as PatternItem[];
    weekKinds = JSON.parse(str(formData, "week_kinds") ?? "{}") as Record<string, WeekKind>;
  } catch {
    return;
  }

  const { data: block } = await supabase
    .from("season_blocks")
    .insert({
      user_id: scoped.userId,
      name,
      period,
      phase,
      season: str(formData, "season"),
      start_date: start,
      end_date: end,
      focus: str(formData, "focus"),
    })
    .select("id, start_date, end_date")
    .single();
  if (!block) return;

  await supabase
    .from("season_block_athletes")
    .insert(athleteIds.map((athlete_id) => ({ block_id: block.id, athlete_id })));

  // Veckomönstret: ett item per dag och slot, repgrupperna i ett andra steg
  // mot de id:n som kommer tillbaka (samma mönster som template-sync).
  for (const it of pattern) {
    if (!Number.isInteger(it.weekday) || it.weekday < 1 || it.weekday > 7) continue;
    const { data: item } = await supabase
      .from("week_template_items")
      .insert({
        block_id: block.id,
        weekday: it.weekday,
        slot: it.slot ?? 1,
        workout_type: it.workout_type,
        title: it.title,
        description: it.description,
        target_distance_meters: it.target_distance_meters,
        target_duration_seconds: it.target_duration_seconds,
        training_factor: it.training_factor ?? null,
      })
      .select("id")
      .single();
    if (item && it.rep_groups?.length) {
      await supabase
        .from("template_rep_groups")
        .insert(it.rep_groups.map((g, i) => ({ ...g, sort_order: g.sort_order ?? i, template_item_id: item.id })));
    }
  }

  await syncBlockPattern(supabase, block);

  // Veckornas typ, bara på passen som just rullades ut.
  for (const [monday, kind] of Object.entries(weekKinds)) {
    if (kind === "normal" || !/^\d{4}-\d{2}-\d{2}$/.test(monday)) continue;
    const weekStart = toDateKey(mondayOf(monday));
    const weekEnd = toDateKey(addDays(mondayOf(monday), 6));
    const { data: rows } = await supabase
      .from("planned_workouts")
      .select("id, user_id, scheduled_date, slot, workout_type, description, target_distance_meters, target_duration_seconds")
      .eq("block_id", block.id)
      .eq("status", "planned")
      .gte("scheduled_date", weekStart)
      .lte("scheduled_date", weekEnd)
      .order("scheduled_date")
      .order("slot");
    const list = rows ?? [];
    if (kind === "lattare") {
      for (const w of list) {
        if (w.workout_type === "rest" || w.workout_type === "race") continue;
        await supabase
          .from("planned_workouts")
          .update({
            target_duration_seconds:
              w.target_duration_seconds != null ? Math.round(Number(w.target_duration_seconds) * LIGHT_FACTOR) : null,
            target_distance_meters:
              w.target_distance_meters != null ? Math.round(Number(w.target_distance_meters) * LIGHT_FACTOR) : null,
            description: `${w.description ? `${w.description} ` : ""}Lättare vecka: ca 20 % kortare än vanligt.`,
          })
          .eq("id", w.id);
      }
    } else if (kind === "test") {
      for (const athleteId of athleteIds) {
        const first = list.find((w) => w.user_id === athleteId && w.workout_type === "threshold");
        if (!first) continue;
        await supabase.from("planned_rep_groups").delete().eq("planned_workout_id", first.id);
        await supabase
          .from("planned_workouts")
          .update({
            workout_type: "test",
            title: "Tröskeltest",
            description: THRESHOLD_TEST_PROTOCOL,
            target_distance_meters: null,
          })
          .eq("id", first.id);
      }
    }
  }

  revalidatePath("/sasongsoversikt");
  revalidatePath("/blockplan");
  revalidatePath("/calendar", "layout");
  redirect(`/calendar/block/${block.id}?athlete=${athleteIds[0]}`);
}
