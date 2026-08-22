"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type RepGroupInput } from "@/lib/planning";
import { athletesForBlock } from "@/lib/template-sync";

/* Ett blocks eget veckomönster — flyttat hit ur sasongen/actions.ts
 * 2026-08-17, förenklat samma dag när "mall" (week_templates) togs bort:
 * ett block äger sitt mönster direkt (week_template_items.block_id), inget
 * separat namngivet objekt att skapa/radera/matcha mot andra block. Block/
 * tillgänglighet hör till /arsplan, se den filens actions.ts. */

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
 * RLS avgör redan om raden faktiskt går att nå. */
async function requireUser(): Promise<{ supabase: SupabaseServerClient } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase } : null;
}

// --- Veckovyn: pass som faktiskt ligger i kalendern ---------------------
// Uttrycklig begäran 2026-08-21: Detaljplan visar riktiga veckor, och det
// ska gå att tagga på/av en enskild löpare per PASS samt öppna passet och
// fylla på detaljer. Ingen ny tabell behövs — planned_workouts har redan en
// rad per löpare och datum, se lib/detaljplan-weeks.ts.

/** Alla rader som utgör "samma pass" (block + datum + slot). */
async function passRows(
  supabase: SupabaseServerClient,
  blockId: string,
  scheduledDate: string,
  slot: number,
) {
  const { data } = await supabase
    .from("planned_workouts")
    .select(
      "id, user_id, workout_type, title, description, target_distance_meters, target_duration_seconds, target_pace_seconds_per_km, training_factor, status",
    )
    .eq("block_id", blockId)
    .eq("scheduled_date", scheduledDate)
    .eq("slot", slot);
  return data ?? [];
}

/** Taggar på en löpare på ett enskilt pass — hennes rad skapas genom att
 * kopiera innehållet från en löpare som redan har passet, inklusive
 * repgrupperna (annars får hon ett intervallpass utan intervaller). */
export async function addAthleteToPass(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;

  const blockId = str(formData, "block_id");
  const scheduledDate = str(formData, "scheduled_date");
  const slot = num(formData, "slot") ?? 1;
  const athleteId = str(formData, "athlete_id");
  if (!blockId || !scheduledDate || !athleteId) return;

  // Bara löpare som är taggade på blocket — annars vore det här en väg att
  // skriva pass i en godtycklig användares kalender. (RLS är den faktiska
  // spärren; det här är att inte ens försöka.)
  const blockAthletes = await athletesForBlock(supabase, blockId);
  if (!blockAthletes.includes(athleteId)) return;

  const rows = await passRows(supabase, blockId, scheduledDate, slot);
  if (rows.length === 0) return;
  if (rows.some((r) => r.user_id === athleteId)) return; // redan taggad

  const src = rows[0];
  const { data: created } = await supabase
    .from("planned_workouts")
    .insert({
      user_id: athleteId,
      scheduled_date: scheduledDate,
      slot,
      workout_type: src.workout_type,
      title: src.title,
      description: src.description,
      target_distance_meters: src.target_distance_meters,
      target_duration_seconds: src.target_duration_seconds,
      target_pace_seconds_per_km: src.target_pace_seconds_per_km,
      training_factor: src.training_factor,
      block_id: blockId,
      status: "planned",
    })
    .select("id")
    .single();

  if (created) {
    const { data: groups } = await supabase
      .from("planned_rep_groups")
      .select(
        "sort_order, reps, distance_meters, duration_seconds, target_pace_seconds_per_km, target_hr_low, target_hr_high, recovery_seconds, recovery_kind, note",
      )
      .eq("planned_workout_id", src.id)
      .order("sort_order");
    if (groups && groups.length > 0) {
      await supabase
        .from("planned_rep_groups")
        .insert(groups.map((g) => ({ planned_workout_id: created.id, ...g })));
    }
  }

  refresh();
}

/** Taggar av en löpare från ett enskilt pass. Bara `planned` — ett
 * genomfört pass är historik och tas aldrig bort så här. */
export async function removeAthleteFromPass(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;

  const blockId = str(formData, "block_id");
  const scheduledDate = str(formData, "scheduled_date");
  const slot = num(formData, "slot") ?? 1;
  const athleteId = str(formData, "athlete_id");
  if (!blockId || !scheduledDate || !athleteId) return;

  // planned_rep_groups städas av on delete cascade.
  await supabase
    .from("planned_workouts")
    .delete()
    .eq("block_id", blockId)
    .eq("scheduled_date", scheduledDate)
    .eq("slot", slot)
    .eq("user_id", athleteId)
    .eq("status", "planned");

  refresh();
}

/** Lägger till ett pass på ett konkret datum i veckovyn, för alla taggade
 * löpare på blocket eller bara en. Skriver rakt i planned_workouts, alltså
 * utan att röra blockets veckomönster — ett tillagt pass är ett tillägg
 * just den veckan, inte en ändring av standardveckan. (Vill man ändra
 * mönstret självt görs det på /arsplan där blocket bor.) */
export async function addPassOnDate(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;

  const blockId = str(formData, "block_id");
  const scheduledDate = str(formData, "scheduled_date");
  const workoutType = str(formData, "workout_type");
  if (!blockId || !scheduledDate || !workoutType) return;

  const scope = str(formData, "scope") ?? "alla";
  const blockAthletes = await athletesForBlock(supabase, blockId);
  const targets = scope === "alla" ? blockAthletes : blockAthletes.filter((a) => a === scope);
  if (targets.length === 0) return;

  // Slot väljs automatiskt när formuläret inte anger någon: "nytt pass" på
  // en dag som redan har ett förmiddagspass ska bli eftermiddagens, inte
  // krocka med det. Första lediga slot 1–3 bland de valda löparna vinner;
  // är alla tre tagna avbryter vi hellre än att skriva över något.
  let slot = num(formData, "slot");
  if (slot == null) {
    const { data: dayRows } = await supabase
      .from("planned_workouts")
      .select("slot, user_id")
      .eq("block_id", blockId)
      .eq("scheduled_date", scheduledDate)
      .in("user_id", targets);
    const usedSlots = new Set((dayRows ?? []).map((r) => r.slot as number));
    slot = [1, 2, 3].find((s) => !usedSlots.has(s)) ?? null;
    if (slot == null) return;
  }

  // Hoppa över löpare som redan har ett pass i samma datum+slot — samma
  // idempotens som rollout-motorn (existingKeys i lib/template-sync.ts), så
  // att en dubbelklickad knapp inte ger två pass samma morgon.
  const existing = await passRows(supabase, blockId, scheduledDate, slot);
  const taken = new Set(existing.map((r) => r.user_id));

  const rows = targets
    .filter((athleteId) => !taken.has(athleteId))
    .map((athleteId) => ({
      user_id: athleteId,
      scheduled_date: scheduledDate,
      slot,
      workout_type: workoutType,
      title: str(formData, "title"),
      description: str(formData, "description"),
      target_duration_seconds:
        num(formData, "target_duration_minutes") != null
          ? (num(formData, "target_duration_minutes") as number) * 60
          : null,
      training_factor: str(formData, "training_factor"),
      block_id: blockId,
      status: "planned",
    }));

  if (rows.length > 0) await supabase.from("planned_workouts").insert(rows);
  refresh();
}

/** Tar bort ett helt pass ur veckovyn — alla löpares rader för samma
 * (block, datum, slot). Komplementet till chipsens ×, som bara tar bort en
 * enskild löpare från passet.
 *
 * Rör bara `planned`: har någon redan genomfört passet är den raden
 * historik och blir kvar, och passet ligger då fortfarande i veckovyn för
 * henne. Det är avsiktligt — ett genomfört pass får inte försvinna ur
 * loggen för att tränaren städar i planen. Blockets veckomönster lämnas
 * också orört, så en framtida utrullning kan skapa passet igen; vill man bli
 * av med det permanent ändras standardveckan på /arsplan. */
export async function deletePlannedPass(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;

  const blockId = str(formData, "block_id");
  const scheduledDate = str(formData, "scheduled_date");
  const slot = num(formData, "slot") ?? 1;
  if (!blockId || !scheduledDate) return;

  // planned_rep_groups städas av on delete cascade.
  await supabase
    .from("planned_workouts")
    .delete()
    .eq("block_id", blockId)
    .eq("scheduled_date", scheduledDate)
    .eq("slot", slot)
    .eq("status", "planned");

  refresh();
}

// --- Repgrupper i veckomönstret (K1) -----------------------------------
// Samma modell som planned_rep_groups i calendar/[year]/[month]/[day]/actions.ts,
// men riktad mot en mönsterrad i stället för ett datumsatt pass. En ändring
// här slår bara igenom på FRAMTIDA utrullningar (nya datum som ännu inte har
// ett planned_workouts-pass för den slotten) — precis som addTemplateItem
// redan beter sig för titel/beskrivning, se existingKeys i
// lib/template-sync.ts. Redan utrullade pass rörs aldrig i efterhand.

/** Bygger insert/update-payloaden för en repgrupp ur formulärfälten. Delad
 * form mellan planerade pass och mönsterrader (samma kolumnnamn i båda
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
