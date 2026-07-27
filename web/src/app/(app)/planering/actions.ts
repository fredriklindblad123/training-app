"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  generateFromTemplate,
  suggestBlocks,
  toDateKey,
  type BlockType,
  type SeasonKind,
  type TemplateItem,
} from "@/lib/planning";

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
  revalidatePath("/planering");
  revalidatePath("/calendar", "layout");
}

async function currentUserId() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { supabase, userId: user?.id ?? null };
}

// --- Säsongsblock ----------------------------------------------------------

export async function createBlock(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  if (!userId) return;

  const name = str(formData, "name");
  const start = str(formData, "start_date");
  const end = str(formData, "end_date");
  const blockType = str(formData, "block_type") as BlockType | null;
  if (!name || !start || !end || !blockType) return;
  // Databasen har en check-constraint, men ett tyst avvisat formulär är
  // bättre än ett 500-fel när någon vänt på datumen.
  if (end < start) return;

  await supabase.from("season_blocks").insert({
    user_id: userId,
    name,
    block_type: blockType,
    season: str(formData, "season"),
    start_date: start,
    end_date: end,
    focus: str(formData, "focus"),
  });

  refresh();
}

export async function deleteBlock(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  const id = str(formData, "id");
  if (!userId || !id) return;
  await supabase.from("season_blocks").delete().eq("id", id);
  refresh();
}

/**
 * Skapar en hel periodisering bakåt från en A-tävling.
 *
 * Det här är den funktion som gör att man slipper lägga in fyra block för
 * hand varje säsong. Förslaget är en utgångspunkt — blocken går att flytta
 * och byta namn på efteråt.
 */
export async function suggestPeriodisation(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  if (!userId) return;

  const competitionDate = str(formData, "competition_date");
  const startFrom = str(formData, "start_from") ?? toDateKey(new Date());
  const season = str(formData, "season") as SeasonKind | null;
  if (!competitionDate) return;

  const blocks = suggestBlocks(competitionDate, season, startFrom);
  if (blocks.length === 0) return;

  await supabase
    .from("season_blocks")
    .insert(blocks.map((b) => ({ ...b, user_id: userId })));

  refresh();
}

// --- Tävlingar -------------------------------------------------------------

export async function createCompetition(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  if (!userId) return;

  const name = str(formData, "name");
  const date = str(formData, "competition_date");
  if (!name || !date) return;

  const { data: competition } = await supabase
    .from("competitions")
    .insert({
      user_id: userId,
      name,
      competition_date: date,
      location: str(formData, "location"),
      venue: str(formData, "venue"),
      priority: str(formData, "priority") ?? "C",
      notes: str(formData, "notes"),
    })
    .select("id")
    .single();

  // Grenarna kommer som en kommaseparerad rad ("1500m, 800m") för att hålla
  // formuläret till ett fält — de flesta tävlingar har en eller två grenar.
  const eventsRaw = str(formData, "events");
  if (competition && eventsRaw) {
    const events = eventsRaw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (events.length > 0) {
      await supabase.from("competition_events").insert(
        events.map((event, i) => ({
          competition_id: competition.id,
          event,
          target_result: i === 0 ? str(formData, "target_result") : null,
          sort_order: i,
        })),
      );
    }
  }

  refresh();
}

export async function deleteCompetition(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  const id = str(formData, "id");
  if (!userId || !id) return;
  await supabase.from("competitions").delete().eq("id", id);
  refresh();
}

export async function saveEventResult(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  const id = str(formData, "event_id");
  if (!userId || !id) return;
  await supabase
    .from("competition_events")
    .update({
      actual_result: str(formData, "actual_result"),
      placement: num(formData, "placement"),
    })
    .eq("id", id);
  refresh();
}

// --- Veckomallar -----------------------------------------------------------

export async function createTemplate(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  if (!userId) return;
  const name = str(formData, "name");
  if (!name) return;

  await supabase.from("week_templates").insert({
    user_id: userId,
    name,
    block_type: str(formData, "block_type"),
    notes: str(formData, "notes"),
  });

  refresh();
}

export async function deleteTemplate(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  const id = str(formData, "id");
  if (!userId || !id) return;
  await supabase.from("week_templates").delete().eq("id", id);
  refresh();
}

export async function addTemplateItem(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  if (!userId) return;

  const templateId = str(formData, "template_id");
  const weekday = num(formData, "weekday");
  const workoutType = str(formData, "workout_type");
  if (!templateId || weekday == null || !workoutType) return;

  await supabase.from("week_template_items").upsert(
    {
      template_id: templateId,
      weekday,
      slot: num(formData, "slot") ?? 1,
      workout_type: workoutType,
      title: str(formData, "title"),
      description: str(formData, "description"),
      target_distance_meters: num(formData, "target_distance_meters"),
      target_duration_seconds:
        num(formData, "target_duration_minutes") != null
          ? (num(formData, "target_duration_minutes") as number) * 60
          : null,
    },
    { onConflict: "template_id,weekday,slot" },
  );

  refresh();
}

export async function deleteTemplateItem(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  const id = str(formData, "id");
  if (!userId || !id) return;
  await supabase.from("week_template_items").delete().eq("id", id);
  refresh();
}

/**
 * Rullar ut en veckomall över ett datumintervall.
 *
 * Hoppar över dagar som redan har ett planerat pass i samma slot, så att en
 * utrullning aldrig skriver över något som lagts in för hand — och så att
 * samma mall kan rullas ut igen efter att intervallet förlängts, utan att
 * skapa dubbletter.
 */
export async function applyTemplate(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  if (!userId) return;

  const templateId = str(formData, "template_id");
  const from = str(formData, "from");
  const to = str(formData, "to");
  const blockId = str(formData, "block_id");
  if (!templateId || !from || !to || to < from) return;

  const { data: items } = await supabase
    .from("week_template_items")
    .select("weekday, slot, workout_type, title, description, target_distance_meters, target_duration_seconds")
    .eq("template_id", templateId);

  if (!items || items.length === 0) return;

  const { data: existing } = await supabase
    .from("planned_workouts")
    .select("scheduled_date, slot")
    .eq("user_id", userId)
    .gte("scheduled_date", from)
    .lte("scheduled_date", to);

  const existingKeys = new Set(
    (existing ?? []).map((w) => `${w.scheduled_date}|${w.slot ?? 1}`),
  );

  const rows = generateFromTemplate({
    userId,
    templateId,
    blockId,
    items: items as TemplateItem[],
    from,
    to,
    existingKeys,
  });

  // Utan pass att skapa är allt redan planerat — inget fel, bara inget att göra.
  if (rows.length > 0) {
    for (let i = 0; i < rows.length; i += 200) {
      await supabase.from("planned_workouts").insert(rows.slice(i, i + 200));
    }
  }

  refresh();
}

/** Tar bort pass som en viss mall skapat i ett intervall. Rör aldrig pass
 * som lagts in för hand, eftersom de saknar template_id. */
export async function clearTemplateWorkouts(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  const templateId = str(formData, "template_id");
  const from = str(formData, "from");
  const to = str(formData, "to");
  if (!userId || !templateId || !from || !to) return;

  await supabase
    .from("planned_workouts")
    .delete()
    .eq("user_id", userId)
    .eq("template_id", templateId)
    .eq("status", "planned")
    .gte("scheduled_date", from)
    .lte("scheduled_date", to);

  refresh();
}
