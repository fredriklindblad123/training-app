"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  datesForWeekday,
  generateFromTemplate,
  suggestBlocks,
  toDateKey,
  type BlockType,
  type SeasonKind,
  type TemplateItem,
} from "@/lib/planning";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
type BlockRange = { id: string; start_date: string; end_date: string };

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

/**
 * Rullar ut en mall i ett block automatiskt. Ersätter det tidigare manuella
 * "Rulla ut"-steget: så fort ett block finns för en blocktyp, eller ett pass
 * läggs till i en mall för den typen, ska det synas i kalendern direkt.
 *
 * Hoppar över dagar som redan har ett planerat pass i samma slot, så att
 * körningen aldrig skriver över något som lagts in för hand och kan köras om
 * (t ex efter att ett blocks datum ändrats) utan att skapa dubbletter.
 */
async function syncTemplateIntoBlock(
  supabase: SupabaseServerClient,
  userId: string,
  templateId: string,
  block: BlockRange,
) {
  const { data: items } = await supabase
    .from("week_template_items")
    .select(
      "weekday, slot, workout_type, title, description, target_distance_meters, target_duration_seconds",
    )
    .eq("template_id", templateId);
  if (!items || items.length === 0) return;

  const { data: existing } = await supabase
    .from("planned_workouts")
    .select("scheduled_date, slot")
    .eq("user_id", userId)
    .gte("scheduled_date", block.start_date)
    .lte("scheduled_date", block.end_date);

  const existingKeys = new Set((existing ?? []).map((w) => `${w.scheduled_date}|${w.slot ?? 1}`));

  const rows = generateFromTemplate({
    userId,
    templateId,
    blockId: block.id,
    items: items as TemplateItem[],
    from: block.start_date,
    to: block.end_date,
    existingKeys,
  });

  for (let i = 0; i < rows.length; i += 200) {
    await supabase.from("planned_workouts").insert(rows.slice(i, i + 200));
  }
}

/** Synkar alla mallar för ett blocks typ in i blocket — anropas när ett block
 * skapas eller ändras (nytt datumintervall, eller ny typ). */
async function syncBlockWithTemplates(
  supabase: SupabaseServerClient,
  userId: string,
  block: BlockRange & { block_type: string },
) {
  const { data: templates } = await supabase
    .from("week_templates")
    .select("id")
    .eq("user_id", userId)
    .eq("block_type", block.block_type);
  for (const t of templates ?? []) {
    await syncTemplateIntoBlock(supabase, userId, t.id as string, block);
  }
}

/** Synkar en mall in i alla befintliga block av dess typ — anropas när ett
 * pass läggs till i mallen. */
async function syncTemplateAcrossBlocks(
  supabase: SupabaseServerClient,
  userId: string,
  templateId: string,
) {
  const { data: template } = await supabase
    .from("week_templates")
    .select("block_type")
    .eq("id", templateId)
    .maybeSingle();
  if (!template?.block_type) return;

  const { data: blocks } = await supabase
    .from("season_blocks")
    .select("id, start_date, end_date")
    .eq("user_id", userId)
    .eq("block_type", template.block_type);
  for (const b of (blocks ?? []) as BlockRange[]) {
    await syncTemplateIntoBlock(supabase, userId, templateId, b);
  }
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

  const { data: block } = await supabase
    .from("season_blocks")
    .insert({
      user_id: userId,
      name,
      block_type: blockType,
      season: str(formData, "season"),
      start_date: start,
      end_date: end,
      focus: str(formData, "focus"),
    })
    .select("id, start_date, end_date, block_type")
    .single();

  if (block) await syncBlockWithTemplates(supabase, userId, block);

  refresh();
}

export async function updateBlock(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  const id = str(formData, "id");
  if (!userId || !id) return;

  const name = str(formData, "name");
  const start = str(formData, "start_date");
  const end = str(formData, "end_date");
  const blockType = str(formData, "block_type") as BlockType | null;
  if (!name || !start || !end || !blockType) return;
  if (end < start) return;

  await supabase
    .from("season_blocks")
    .update({
      name,
      block_type: blockType,
      season: str(formData, "season"),
      start_date: start,
      end_date: end,
      focus: str(formData, "focus"),
    })
    .eq("id", id);

  // T ex ett förlängt slutdatum ska direkt ge fler pass i kalendern, utan
  // ett separat "rulla ut igen"-steg.
  await syncBlockWithTemplates(supabase, userId, {
    id,
    start_date: start,
    end_date: end,
    block_type: blockType,
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

  // Passet ska synas i kalendern direkt, i varje block som redan finns för
  // mallens blocktyp — inget separat "rulla ut"-steg.
  await syncTemplateAcrossBlocks(supabase, userId, templateId);

  refresh();
}

export async function deleteTemplateItem(formData: FormData) {
  const { supabase, userId } = await currentUserId();
  const id = str(formData, "id");
  if (!userId || !id) return;

  const { data: item } = await supabase
    .from("week_template_items")
    .select("template_id, weekday, slot")
    .eq("id", id)
    .maybeSingle();

  await supabase.from("week_template_items").delete().eq("id", id);

  // Tar bort exakt de kalenderrader det här passet skapade (aldrig genomförda
  // pass eller sådant som lagts in för hand — de saknar template_id, och
  // status filtreras till "planned"), i alla block av mallens blocktyp.
  if (item) {
    const { data: template } = await supabase
      .from("week_templates")
      .select("block_type")
      .eq("id", item.template_id)
      .maybeSingle();
    if (template?.block_type) {
      const { data: blocks } = await supabase
        .from("season_blocks")
        .select("start_date, end_date")
        .eq("user_id", userId)
        .eq("block_type", template.block_type);
      for (const b of blocks ?? []) {
        const dates = datesForWeekday(b.start_date, b.end_date, item.weekday);
        if (dates.length === 0) continue;
        await supabase
          .from("planned_workouts")
          .delete()
          .eq("user_id", userId)
          .eq("template_id", item.template_id)
          .eq("slot", item.slot)
          .eq("status", "planned")
          .in("scheduled_date", dates);
      }
    }
  }

  refresh();
}
