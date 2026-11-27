"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { type RepGroupInput } from "@/lib/planning";
import { athletesForBlock } from "@/lib/template-sync";

/* Ett blocks eget veckomönster — flyttat hit ur sasongen/actions.ts
 * 2026-08-17, förenklat samma dag när "mall" (week_templates) togs bort:
 * ett block äger sitt mönster direkt (week_template_items.block_id), inget
 * separat namngivet objekt att skapa/radera/matcha mot andra block. Block/
 * tillgänglighet hör till /sasongsoversikt, se den filens actions.ts. */

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
  revalidatePath("/blockplan");
  revalidatePath("/sasongsoversikt");
  // Detaljplanen läser samma planerade pass, en vecka i taget. Utan den här
  // raden ser ett pass tillagt därifrån ut att inte hända förrän cachen
  // råkar gå ut.
  revalidatePath("/detaljplan");
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
// Uttrycklig begäran 2026-08-21: Blockplan visar riktiga veckor, och det
// ska gå att tagga på/av en enskild löpare per PASS samt öppna passet och
// fylla på detaljer. Ingen ny tabell behövs — planned_workouts har redan en
// rad per löpare och datum, se lib/plan-weeks.ts.

/** Alla rader som utgör "samma pass" (block + datum + slot). */
async function passRows(
  supabase: SupabaseServerClient,
  blockId: string,
  scheduledDate: string,
  slot: number,
  /** Passtypen kortet gäller — två löpare kan ha olika pass på samma plats
   * (se groupPasses i lib/plan-weeks.ts). Utan den gäller alla typer. */
  workoutType?: string | null,
) {
  let q = supabase
    .from("planned_workouts")
    .select(
      "id, user_id, workout_type, title, description, target_distance_meters, target_duration_seconds, target_pace_seconds_per_km, training_factor, status",
    )
    .eq("block_id", blockId)
    .eq("scheduled_date", scheduledDate)
    .eq("slot", slot);
  if (workoutType) q = q.eq("workout_type", workoutType);
  const { data } = await q;
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

  // Har hon redan ett pass på den platsen (av vilken typ som helst) läggs
  // inget till — en löpare har ett pass per dag och plats.
  const all = await passRows(supabase, blockId, scheduledDate, slot);
  if (all.some((r) => r.user_id === athleteId)) return;
  const rows = await passRows(supabase, blockId, scheduledDate, slot, str(formData, "workout_type"));
  if (rows.length === 0) return;

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
 * mönstret självt görs det på /sasongsoversikt där blocket bor.) */
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
 * av med det permanent ändras standardveckan på /sasongsoversikt. */
export async function deletePlannedPass(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;

  const blockId = str(formData, "block_id");
  const scheduledDate = str(formData, "scheduled_date");
  const slot = num(formData, "slot") ?? 1;
  const workoutType = str(formData, "workout_type");
  if (!blockId || !scheduledDate) return;

  // planned_rep_groups städas av on delete cascade. Bara kortets passtyp —
  // en annan löpares annorlunda pass på samma plats ska ligga kvar.
  let del = supabase
    .from("planned_workouts")
    .delete()
    .eq("block_id", blockId)
    .eq("scheduled_date", scheduledDate)
    .eq("slot", slot)
    .eq("status", "planned");
  if (workoutType) del = del.eq("workout_type", workoutType);
  await del;

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

/* ---------------- Veckomönstret i ett befintligt block (2026-11-21) -------
 *
 * Fram till nu gick ett blocks veckomönster bara att sätta när blocket
 * skapades. Ville tränaren lägga till ett styrkepass varje vecka fick hon
 * lägga in det dag för dag, tolv gånger i ett tolvveckorsblock.
 *
 * addPatternItem lägger ett pass i mönstret och rullar ut det på den
 * veckodagen från ett valt datum till blockets slut, för alla löpare i
 * blocket. Pass som redan ligger på samma datum och plats rörs inte — samma
 * idempotens som utrullningen i lib/template-sync.ts. Dagar före startdatumet
 * får inget pass: det hade bara blivit planerade pass som "inte blev av". */

function weekdayOf(dateKey: string): number {
  return ((new Date(`${dateKey}T12:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export async function addPatternItem(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;

  const blockId = str(formData, "block_id");
  const weekday = num(formData, "weekday");
  const workoutType = str(formData, "workout_type");
  if (!blockId || !weekday || weekday < 1 || weekday > 7 || !workoutType) return;

  const { data: block } = await supabase
    .from("season_blocks")
    .select("id, start_date, end_date")
    .eq("id", blockId)
    .single();
  if (!block) return;

  // Första lediga plats den veckodagen i mönstret.
  const { data: items } = await supabase
    .from("week_template_items")
    .select("slot")
    .eq("block_id", blockId)
    .eq("weekday", weekday);
  const used = new Set((items ?? []).map((i) => i.slot as number));
  const slot = [1, 2, 3].find((s) => !used.has(s));
  if (slot == null) return;

  const minutes = num(formData, "target_duration_minutes");
  const item = {
    block_id: blockId,
    weekday,
    slot,
    workout_type: workoutType,
    title: str(formData, "title"),
    description: str(formData, "description"),
    target_duration_seconds: minutes != null ? minutes * 60 : null,
    target_distance_meters: null,
    training_factor: str(formData, "training_factor"),
    athlete_ids: null as string[] | null,
  };
  // Löparna passet gäller (2026-11-26). Alla ikryssade = null (alla, även
  // löpare som läggs till blocket senare).
  const blockAthletesAll = await athletesForBlock(supabase, blockId);
  const chosen = formData.getAll("athlete_ids").map(String).filter((a) => blockAthletesAll.includes(a));
  if (formData.has("athletes_chosen") && chosen.length < blockAthletesAll.length) item.athlete_ids = chosen;
  const { error } = await supabase.from("week_template_items").insert(item);
  if (error) return;

  // Utrullning från valt datum (förvalt idag) till blockets slut.
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const fromRaw = str(formData, "from_date") ?? today;
  const from = fromRaw > (block.start_date as string) ? fromRaw : (block.start_date as string);
  const dates: string[] = [];
  for (let d = from; d <= (block.end_date as string); d = addDaysKey(d, 1)) if (weekdayOf(d) === weekday) dates.push(d);
  const athletes = item.athlete_ids ?? blockAthletesAll;
  if (dates.length === 0 || athletes.length === 0) return refresh();

  const { data: existing } = await supabase
    .from("planned_workouts")
    .select("user_id, scheduled_date, slot")
    .in("user_id", athletes)
    .in("scheduled_date", dates)
    .eq("slot", slot);
  const taken = new Set((existing ?? []).map((r) => `${r.user_id}|${r.scheduled_date}`));
  const rows = athletes.flatMap((uid) =>
    dates
      .filter((d) => !taken.has(`${uid}|${d}`))
      .map((d) => ({
        user_id: uid,
        scheduled_date: d,
        slot,
        workout_type: workoutType,
        title: item.title,
        description: item.description,
        target_duration_seconds: item.target_duration_seconds,
        training_factor: item.training_factor,
        block_id: blockId,
        status: "planned",
      })),
  );
  for (let i = 0; i < rows.length; i += 200) await supabase.from("planned_workouts").insert(rows.slice(i, i + 200));
  refresh();
}

/** Tar bort ett pass ur veckomönstret och ur kommande veckor från valt datum.
 * Bara pass med status "planned" tas bort: ett pass som ändrats för hand
 * ("modified") eller redan genomförts får vara kvar. */
export async function removePatternItem(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;

  const itemId = str(formData, "item_id");
  if (!itemId) return;
  const { data: item } = await supabase
    .from("week_template_items")
    .select("id, block_id, weekday, slot, workout_type")
    .eq("id", itemId)
    .single();
  if (!item) return;

  await supabase.from("week_template_items").delete().eq("id", itemId);

  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const from = str(formData, "from_date") ?? today;
  const { data: future } = await supabase
    .from("planned_workouts")
    .select("id, scheduled_date")
    .eq("block_id", item.block_id)
    .eq("slot", item.slot)
    .eq("workout_type", item.workout_type)
    .eq("status", "planned")
    .gte("scheduled_date", from);
  const ids = (future ?? [])
    .filter((r) => weekdayOf(r.scheduled_date as string) === item.weekday)
    .map((r) => r.id as string);
  if (ids.length > 0) {
    await supabase.from("planned_rep_groups").delete().in("planned_workout_id", ids);
    await supabase.from("planned_workouts").delete().in("id", ids);
  }
  refresh();
}

/* --- Löpare och passtyp per pass i veckomönstret (2026-11-26, begärt) ----
 *
 * week_template_items.athlete_ids: null = alla löpare på blocket, annars
 * bara de uppräknade. Ändringar gäller från idag (eller blockets start) till
 * blockets slut.
 *
 * HANDJUSTERADE PASS RÖRS INTE AV SIG SJÄLVA. Ett pass med status
 * "modified" är ändrat för en enskild löpare — i höstblocket 2026 är alla
 * Alices kommande pass det, och på tisdagarna har hon tröskel där mönstret
 * säger intervall. Att ta bort en löpare eller ändra passtyp i mönstret tar
 * därför bort/ändrar bara "planned"; de handjusterade räknas upp på sidan och
 * tas med bara när tränaren uttryckligen väljer det. */

type ItemRow = {
  id: string;
  block_id: string;
  weekday: number;
  slot: number;
  workout_type: string;
  title: string | null;
  description: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  training_factor: string | null;
  athlete_ids: string[] | null;
};

const ITEM_COLUMNS =
  "id, block_id, weekday, slot, workout_type, title, description, target_distance_meters, target_duration_seconds, training_factor, athlete_ids";

function stockholmToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

/** Kommande pass för ett mönsterpass: samma block, slot och veckodag, från
 * idag. */
async function futureRowsForItem(
  supabase: SupabaseServerClient,
  item: ItemRow,
  statuses: string[],
  userIds?: string[],
) {
  let q = supabase
    .from("planned_workouts")
    .select("id, user_id, scheduled_date, status")
    .eq("block_id", item.block_id)
    .eq("slot", item.slot)
    .in("status", statuses)
    .gte("scheduled_date", stockholmToday());
  if (userIds) q = q.in("user_id", userIds);
  const { data } = await q;
  return (data ?? []).filter((r) => weekdayOf(r.scheduled_date as string) === item.weekday);
}

/** Rullar ut ETT mönsterpass för EN löpare, med repgrupperna. Hoppar över
 * datum där hon redan har ett pass i samma slot. */
async function rollOutItemForAthlete(supabase: SupabaseServerClient, item: ItemRow, userId: string) {
  const { data: block } = await supabase
    .from("season_blocks")
    .select("start_date, end_date")
    .eq("id", item.block_id)
    .single();
  if (!block) return;
  const today = stockholmToday();
  const from = today > (block.start_date as string) ? today : (block.start_date as string);
  const dates: string[] = [];
  for (let d = from; d <= (block.end_date as string); d = addDaysKey(d, 1)) if (weekdayOf(d) === item.weekday) dates.push(d);
  if (dates.length === 0) return;
  const { data: existing } = await supabase
    .from("planned_workouts")
    .select("scheduled_date")
    .eq("user_id", userId)
    .eq("slot", item.slot)
    .in("scheduled_date", dates);
  const taken = new Set((existing ?? []).map((r) => r.scheduled_date as string));
  const free = dates.filter((d) => !taken.has(d));
  if (free.length === 0) return;
  const { data: inserted } = await supabase
    .from("planned_workouts")
    .insert(
      free.map((d) => ({
        user_id: userId,
        scheduled_date: d,
        slot: item.slot,
        workout_type: item.workout_type,
        title: item.title,
        description: item.description,
        target_distance_meters: item.target_distance_meters,
        target_duration_seconds: item.target_duration_seconds,
        training_factor: item.training_factor,
        block_id: item.block_id,
        status: "planned",
      })),
    )
    .select("id");
  const { data: groups } = await supabase
    .from("template_rep_groups")
    .select(
      "sort_order, reps, distance_meters, duration_seconds, target_pace_seconds_per_km, target_hr_low, target_hr_high, recovery_seconds, recovery_kind, note",
    )
    .eq("template_item_id", item.id);
  if (inserted && groups && groups.length > 0) {
    await supabase
      .from("planned_rep_groups")
      .insert(inserted.flatMap((w) => groups.map((g) => ({ planned_workout_id: w.id as string, ...g }))));
  }
}

/** Tar med eller tar bort en löpare i ett pass i veckomönstret. */
export async function setPatternItemAthlete(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;
  const itemId = str(formData, "item_id");
  const athleteId = str(formData, "athlete_id");
  const include = str(formData, "include") === "1";
  if (!itemId || !athleteId) return;

  const { data } = await supabase.from("week_template_items").select(ITEM_COLUMNS).eq("id", itemId).single();
  const item = data as ItemRow | null;
  if (!item) return;
  const blockAthletes = await athletesForBlock(supabase, item.block_id);
  if (!blockAthletes.includes(athleteId)) return;

  const current = item.athlete_ids ?? blockAthletes;
  const next = include ? [...new Set([...current, athleteId])] : current.filter((a) => a !== athleteId);
  // Alla på blocket igen = null, så att löpare som läggs till blocket senare
  // också får passet.
  const value = blockAthletes.every((a) => next.includes(a)) ? null : next;
  const { error } = await supabase.from("week_template_items").update({ athlete_ids: value }).eq("id", itemId);
  if (error) return;

  if (include) {
    await rollOutItemForAthlete(supabase, { ...item, athlete_ids: value }, athleteId);
  } else {
    const rows = await futureRowsForItem(supabase, item, ["planned"], [athleteId]);
    const ids = rows.map((r) => r.id as string);
    if (ids.length > 0) {
      await supabase.from("planned_rep_groups").delete().in("planned_workout_id", ids);
      await supabase.from("planned_workouts").delete().in("id", ids);
    }
  }
  refresh();
}

/** Tar bort en löpares kvarvarande HANDJUSTERADE pass för ett mönsterpass —
 * bara på tränarens uttryckliga val, se HANDJUSTERADE PASS ovan. */
export async function removeAdjustedForAthlete(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;
  const itemId = str(formData, "item_id");
  const athleteId = str(formData, "athlete_id");
  if (!itemId || !athleteId) return;
  const { data } = await supabase.from("week_template_items").select(ITEM_COLUMNS).eq("id", itemId).single();
  const item = data as ItemRow | null;
  if (!item) return;
  const ids = (await futureRowsForItem(supabase, item, ["modified"], [athleteId])).map((r) => r.id as string);
  if (ids.length > 0) {
    await supabase.from("planned_rep_groups").delete().in("planned_workout_id", ids);
    await supabase.from("planned_workouts").delete().in("id", ids);
  }
  refresh();
}

/** Ändrar ett pass i veckomönstret — typ, rubrik, beskrivning och tid — och
 * samma sak i de kommande passen för löparna det gäller. Handjusterade pass
 * följer bara med om tränaren kryssat i det. */
export async function updatePatternItem(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;
  const itemId = str(formData, "item_id");
  const workoutType = str(formData, "workout_type");
  if (!itemId || !workoutType) return;
  const { data } = await supabase.from("week_template_items").select(ITEM_COLUMNS).eq("id", itemId).single();
  const item = data as ItemRow | null;
  if (!item) return;

  const minutes = num(formData, "target_duration_minutes");
  const fields = {
    workout_type: workoutType,
    title: str(formData, "title"),
    description: str(formData, "description"),
    target_duration_seconds: minutes != null ? Math.round(minutes * 60) : null,
  };
  const { error } = await supabase.from("week_template_items").update(fields).eq("id", itemId);
  if (error) return;

  const statuses = formData.get("include_adjusted") === "1" ? ["planned", "modified"] : ["planned"];
  const athletes = item.athlete_ids ?? (await athletesForBlock(supabase, item.block_id));
  const ids = (await futureRowsForItem(supabase, item, statuses, athletes)).map((r) => r.id as string);
  for (let i = 0; i < ids.length; i += 200)
    await supabase.from("planned_workouts").update(fields).in("id", ids.slice(i, i + 200));
  refresh();
}

/** Gör ett återkommande pass som ligger utanför veckomönstret till en del av
 * det (2026-11-27). Typfallet: Alices alternativträning på måndagar och
 * Nikes häck, inlagda direkt i deras kalendrar — de syntes inte i mönstret
 * och gick inte att styra därifrån. Passet blir ett mönsterpass för just de
 * löparna; befintliga pass rörs inte, saknade veckor fylls i. */
export async function adoptIntoPattern(formData: FormData) {
  const auth = await requireUser();
  if (!auth) return;
  const { supabase } = auth;
  const blockId = str(formData, "block_id");
  const weekday = num(formData, "weekday");
  const slot = num(formData, "slot");
  const workoutType = str(formData, "workout_type");
  if (!blockId || !weekday || !slot || !workoutType) return;
  const blockAthletes = await athletesForBlock(supabase, blockId);
  const athletes = formData.getAll("athlete_ids").map(String).filter((a) => blockAthletes.includes(a));
  if (athletes.length === 0) return;

  /* Mönstret har ett pass per dag och plats (unikt index). Är platsen tagen
     — Nikes häck och Alices alternativträning ligger båda på måndagens
     eftermiddag — läggs passet på nästa lediga plats, och löparnas kommande
     pass flyttas dit så att mönster och kalender stämmer. */
  const { data: dayItems } = await supabase
    .from("week_template_items")
    .select("slot, athlete_ids")
    .eq("block_id", blockId)
    .eq("weekday", weekday);
  const usedSlots = new Set((dayItems ?? []).map((r) => r.slot as number));
  const clash = (dayItems ?? []).find((r) => r.slot === slot);
  // Gäller mönsterpasset på platsen någon av löparna är det deras ordinarie
  // pass som ersatts — det ska inte bli ett eget mönsterpass.
  if (clash && (clash.athlete_ids == null || (clash.athlete_ids as string[]).some((a) => athletes.includes(a)))) return;
  const newSlot = clash ? [1, 2, 3].find((x) => !usedSlots.has(x)) : slot;
  if (newSlot == null) return;
  if (newSlot !== slot) {
    const { data: rows } = await supabase
      .from("planned_workouts")
      .select("id, user_id, scheduled_date")
      .eq("block_id", blockId)
      .eq("slot", slot)
      .eq("workout_type", workoutType)
      .in("user_id", athletes)
      .gte("scheduled_date", stockholmToday());
    for (const r of (rows ?? []).filter((x) => weekdayOf(x.scheduled_date as string) === weekday)) {
      const { data: occupied } = await supabase
        .from("planned_workouts")
        .select("id")
        .eq("user_id", r.user_id)
        .eq("scheduled_date", r.scheduled_date)
        .eq("slot", newSlot);
      if ((occupied ?? []).length === 0)
        await supabase.from("planned_workouts").update({ slot: newSlot }).eq("id", r.id);
    }
  }

  const minutes = num(formData, "target_duration_minutes");
  const { data: created } = await supabase
    .from("week_template_items")
    .insert({
      block_id: blockId,
      weekday,
      slot: newSlot,
      workout_type: workoutType,
      title: str(formData, "title"),
      description: null,
      target_duration_seconds: minutes != null ? Math.round(minutes * 60) : null,
      target_distance_meters: null,
      training_factor: null,
      athlete_ids: blockAthletes.every((a) => athletes.includes(a)) ? null : athletes,
    })
    .select(ITEM_COLUMNS)
    .single();
  if (created) for (const a of athletes) await rollOutItemForAthlete(supabase, created as ItemRow, a);
  refresh();
}
