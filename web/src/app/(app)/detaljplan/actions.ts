"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, planningOwnerId } from "@/lib/auth-scope";
import { datesForWeekday, type RepGroupInput } from "@/lib/planning";
import { athletesForBlock, syncTemplateAcrossBlocks } from "@/lib/template-sync";

/* Veckomallarnas dag-för-dag-innehåll — flyttat hit ur sasongen/actions.ts
 * 2026-08-17. Block/tillgänglighet hör numera till /arsplan, se den filens
 * actions.ts. */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

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
  revalidatePath("/detaljplan");
  revalidatePath("/arsplan");
  revalidatePath("/calendar", "layout");
}

/** Bara "är någon inloggad" — för actions som opererar på en rad via `id`.
 * RLS avgör redan om raden faktiskt går att nå; den här funktionen behöver
 * aldrig veta VILKEN löpare raden tillhör. Där en action ändå behöver
 * ägarens user_id (t.ex. för att synka veckomallar mot rätt löpares block)
 * hämtas det ur raden själv — se deleteTemplateItem/syncTemplateAcrossBlocks
 * nedan — aldrig från klienten. */
async function requireUser(): Promise<{ supabase: SupabaseServerClient } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase } : null;
}

// --- Veckomallar -----------------------------------------------------------

export async function createTemplate(formData: FormData) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return;
  const name = str(formData, "name");
  if (!name) return;

  // Mallen ägs av samma person som blocken den matchar mot (coachen för ett
  // delat block, löparen själv för ett självcoachat) — inte nödvändigtvis
  // löparen som råkar vara vald i växlaren just nu, se planningOwnerId.
  await supabase.from("week_templates").insert({
    user_id: planningOwnerId(scoped),
    name,
    phase: str(formData, "phase"),
    notes: str(formData, "notes"),
  });

  refresh();
}

export async function deleteTemplate(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;
  await auth.supabase.from("week_templates").delete().eq("id", id);
  refresh();
}

export async function addTemplateItem(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;

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
      training_factor: str(formData, "training_factor"),
    },
    { onConflict: "template_id,weekday,slot" },
  );

  // Passet ska synas i kalendern direkt, i varje block som redan finns för
  // mallens fas — inget separat "rulla ut"-steg. Ägaren härleds ur mallen
  // själv, se syncTemplateAcrossBlocks.
  await syncTemplateAcrossBlocks(supabase, templateId);

  refresh();
}

export async function deleteTemplateItem(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;
  const { supabase } = auth;

  const { data: item } = await supabase
    .from("week_template_items")
    .select("template_id, weekday, slot")
    .eq("id", id)
    .maybeSingle();

  // template_rep_groups för den här mallraden städas av on delete cascade
  // (se migrationen) — ingen egen delete behövs här.
  await supabase.from("week_template_items").delete().eq("id", id);

  // Tar bort exakt de kalenderrader det här passet skapade (aldrig genomförda
  // pass eller sådant som lagts in för hand — de saknar template_id, och
  // status filtreras till "planned"), i alla block av mallens fas. Ägaren
  // härleds ur mallen (inte klienten) — samma mönster som ovan.
  if (item) {
    const { data: template } = await supabase
      .from("week_templates")
      .select("user_id, phase")
      .eq("id", item.template_id)
      .maybeSingle();
    if (template?.phase) {
      const { data: blocks } = await supabase
        .from("season_blocks")
        .select("id, start_date, end_date")
        .eq("user_id", template.user_id)
        .eq("phase", template.phase);
      for (const b of blocks ?? []) {
        const dates = datesForWeekday(b.start_date, b.end_date, item.weekday);
        if (dates.length === 0) continue;
        const athleteIds = await athletesForBlock(supabase, b.id as string);
        for (const athleteId of athleteIds) {
          // planned_rep_groups för de här raderna städas också av on delete
          // cascade — de pekar på planned_workouts.id, inte på mallraden.
          await supabase
            .from("planned_workouts")
            .delete()
            .eq("user_id", athleteId)
            .eq("template_id", item.template_id)
            .eq("slot", item.slot)
            .eq("status", "planned")
            .in("scheduled_date", dates);
        }
      }
    }
  }

  refresh();
}

// --- Repgrupper i veckomallar (K1) ------------------------------------------
// Samma modell som planned_rep_groups i calendar/[year]/[month]/[day]/actions.ts,
// men riktad mot en mallrad i stället för ett datumsatt pass. En ändring här
// slår bara igenom på FRAMTIDA utrullningar (nya datum som ännu inte har ett
// planned_workouts-pass för den slotten) — precis som addTemplateItem redan
// beter sig för titel/beskrivning, se existingKeys i lib/template-sync.ts.
// Redan utrullade pass rörs aldrig i efterhand.

/** Bygger insert/update-payloaden för en repgrupp ur formulärfälten. Delad
 * form mellan planerade pass och mallrader (samma kolumnnamn i båda
 * tabellerna), men bor här och inte i lib/planning.ts eftersom den bara
 * tolkar FormData — ett server-actions-detalj, inte planeringsmodellen. */
function repGroupFieldsFromForm(formData: FormData): Omit<RepGroupInput, "sort_order"> {
  const distanceRaw = str(formData, "distance_meters");
  const durationMinRaw = str(formData, "duration_minutes");
  const paceMinRaw = str(formData, "pace_min");
  const paceSekRaw = str(formData, "pace_sek");
  const recoveryMinRaw = str(formData, "recovery_minutes");

  const paceMin = paceMinRaw ? Number(paceMinRaw) : 0;
  const paceSek = paceSekRaw ? Number(paceSekRaw) : 0;

  return {
    reps: num(formData, "reps") ?? 1,
    distance_meters: distanceRaw ? Math.round(Number(distanceRaw)) : null,
    duration_seconds: durationMinRaw ? Math.round(Number(durationMinRaw) * 60) : null,
    target_pace_seconds_per_km: paceMinRaw || paceSekRaw ? paceMin * 60 + paceSek : null,
    target_hr_low: null,
    target_hr_high: null,
    recovery_seconds: recoveryMinRaw ? Math.round(Number(recoveryMinRaw) * 60) : null,
    recovery_kind: str(formData, "recovery_kind"),
    note: str(formData, "note"),
  };
}

export async function addTemplateRepGroup(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;

  const templateItemId = str(formData, "template_item_id");
  if (!templateItemId) return;

  const fields = repGroupFieldsFromForm(formData);
  // rep_has_a_measure-constrainten (databasen) kräver minst en av de två —
  // ett tyst no-op här är bättre än ett 500-fel för ett tomt formulär.
  if (fields.distance_meters == null && fields.duration_seconds == null) return;

  // Ny grupp läggs sist: sort_order = högsta befintliga + 1, så ordningen
  // tränaren skrev in grupperna i alltid bevaras.
  const { data: existing } = await supabase
    .from("template_rep_groups")
    .select("sort_order")
    .eq("template_item_id", templateItemId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = ((existing ?? [])[0]?.sort_order ?? -1) + 1;

  await supabase.from("template_rep_groups").insert({
    template_item_id: templateItemId,
    sort_order: nextSort,
    ...fields,
  });

  refresh();
}

export async function updateTemplateRepGroup(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;

  const fields = repGroupFieldsFromForm(formData);
  if (fields.distance_meters == null && fields.duration_seconds == null) return;

  await auth.supabase.from("template_rep_groups").update(fields).eq("id", id);
  refresh();
}

export async function deleteTemplateRepGroup(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;
  await auth.supabase.from("template_rep_groups").delete().eq("id", id);
  refresh();
}
