"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";

function str(form: FormData, key: string): string | null {
  const v = form.get(key);
  const s = typeof v === "string" ? v.trim() : "";
  return s === "" ? null : s;
}

function num(form: FormData, key: string): number | null {
  const s = str(form, key);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

function refresh() {
  revalidatePath("/flerarsplan");
}

/** Se motiveringen i sasongen/actions.ts — samma två hjälpare, samma
 * uppdelning (skapa ny toppnivårad kräver den valda löparen; ändra/ta bort
 * en befintlig rad härleder ägaren ur RLS och behöver den aldrig). */
async function requireUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase } : null;
}

async function resolvedAthleteId(
  supabase: Awaited<ReturnType<typeof createClient>>,
  formData: FormData,
): Promise<string | null> {
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  return resolveScopedUserId(scoped, str(formData, "athlete") ?? undefined);
}

/** "800m: 2.20, 1500m: 4.40" -> [{event, target}]. Samma fritextprincip som
 * createCompetitions kommaseparerade grenfält i /sasongen — ett fält att
 * fylla i är enklare än flera rader inputs för något som sällan ändras. */
function parseResultTargets(raw: string | null): { event: string; target: string }[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((pair) => {
      const [event, target] = pair.split(":").map((s) => s.trim());
      return event ? { event, target: target ?? "" } : null;
    })
    .filter((v): v is { event: string; target: string } => v != null);
}

export async function createYearPlan(formData: FormData) {
  const supabase = await createClient();
  const userId = await resolvedAthleteId(supabase, formData);
  if (!userId) return;

  const yearLabel = str(formData, "year_label");
  if (!yearLabel) return;

  const { count } = await supabase
    .from("multi_year_plans")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId);

  await supabase.from("multi_year_plans").insert({
    user_id: userId,
    year_label: yearLabel,
    sort_order: count ?? 0,
    overall_goal: str(formData, "overall_goal"),
    general_training_goal: str(formData, "general_training_goal"),
    specific_training_goal: str(formData, "specific_training_goal"),
    weekly_hours: num(formData, "weekly_hours"),
    weekly_days: num(formData, "weekly_days"),
    weekly_sessions: num(formData, "weekly_sessions"),
    target_competitions: str(formData, "target_competitions"),
    camps: str(formData, "camps"),
    result_targets: parseResultTargets(str(formData, "result_targets")),
    evaluations: str(formData, "evaluations"),
  });

  refresh();
}

export async function updateYearPlan(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;

  const yearLabel = str(formData, "year_label");
  if (!yearLabel) return;

  await auth.supabase
    .from("multi_year_plans")
    .update({
      year_label: yearLabel,
      overall_goal: str(formData, "overall_goal"),
      general_training_goal: str(formData, "general_training_goal"),
      specific_training_goal: str(formData, "specific_training_goal"),
      weekly_hours: num(formData, "weekly_hours"),
      weekly_days: num(formData, "weekly_days"),
      weekly_sessions: num(formData, "weekly_sessions"),
      target_competitions: str(formData, "target_competitions"),
      camps: str(formData, "camps"),
      result_targets: parseResultTargets(str(formData, "result_targets")),
      evaluations: str(formData, "evaluations"),
    })
    .eq("id", id);

  refresh();
}

export async function deleteYearPlan(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;
  await auth.supabase.from("multi_year_plans").delete().eq("id", id);
  refresh();
}
