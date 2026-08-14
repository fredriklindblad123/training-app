"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import {
  datesForWeekday,
  generateFromTemplate,
  suggestBlocks,
  toDateKey,
  type AvailabilityKind,
  type BlockType,
  type RepGroupInput,
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
  revalidatePath("/sasongen");
  revalidatePath("/calendar", "layout");
}

/** Bara "är någon inloggad" — för actions som opererar på en rad via `id`.
 * RLS (season_blocks/competitions/... `coach_athletes`-policyerna, se
 * migration 20260814100000) avgör redan om raden faktiskt går att nå; den
 * här funktionen behöver aldrig veta VILKEN löpare raden tillhör. Där en
 * action ändå behöver ägarens user_id (t.ex. för att synka veckomallar mot
 * rätt löpares block) hämtas det ur raden själv — se updateBlock/
 * deleteTemplateItem/syncTemplateAcrossBlocks nedan — aldrig från klienten. */
async function requireUser(): Promise<{ supabase: SupabaseServerClient } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase } : null;
}

/** För actions som skapar en helt ny toppnivårad (inget existerande block/
 * mall/tävling att härleda ägaren ur) — vilken löpares rad det blir. En
 * löpare får alltid sitt eget id; en coach växlar via det dolda
 * `athlete`-fältet formuläret skickar med (samma `athlete`-param som sidans
 * URL, se page.tsx). Säkerheten ligger i RLS, inte här — ett manipulerat
 * fält ger på sin höjd en nekad insert om avsändaren inte faktiskt coachar
 * den löparen. */
async function resolvedAthleteId(
  supabase: SupabaseServerClient,
  formData: FormData,
): Promise<string | null> {
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  return resolveScopedUserId(scoped, str(formData, "athlete") ?? undefined);
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
  // template_rep_groups hämtas nästlat (K1) så att repgrupperna följer med
  // ut i kalendern — se generateFromTemplate/RepGroupInput i lib/planning.ts.
  // En saknad tabell (migrationen inte körd än) ger bara items[i].template_rep_groups
  // === undefined här, aldrig ett kastat fel — därefter faller ?? [] tillbaka
  // till "inga repgrupper", precis som ett kvalitetspass utan grupper.
  const { data: items } = await supabase
    .from("week_template_items")
    .select(
      "weekday, slot, workout_type, title, description, target_distance_meters, target_duration_seconds, " +
        "template_rep_groups(sort_order, reps, distance_meters, duration_seconds, target_pace_seconds_per_km, target_hr_low, target_hr_high, recovery_seconds, recovery_kind, note)",
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

  const templateItems: TemplateItem[] = (
    items as unknown as (TemplateItem & { template_rep_groups: RepGroupInput[] | null })[]
  ).map((it) => ({
    weekday: it.weekday,
    slot: it.slot,
    workout_type: it.workout_type,
    title: it.title,
    description: it.description,
    target_distance_meters: it.target_distance_meters,
    target_duration_seconds: it.target_duration_seconds,
    rep_groups: it.template_rep_groups ?? [],
  }));

  const rows = generateFromTemplate({
    userId,
    templateId,
    blockId: block.id,
    items: templateItems,
    from: block.start_date,
    to: block.end_date,
    existingKeys,
  });

  // Repgrupperna kan inte följa med i samma insert som passet — de pekar på
  // planned_workouts.id, som inte finns förrän raden är skapad. Passen
  // skapas därför först (utan rep_groups-fältet, det finns ingen sådan
  // kolumn), och repgrupperna skapas i ett andra steg mot de id:n som kommer
  // tillbaka. Idempotensen ärvs från existingKeys ovan: ett pass som redan
  // finns för datum+slot hoppas över helt av generateFromTemplate, så den
  // här funktionen skapar aldrig repgrupper för ett pass som redan har dem.
  for (let i = 0; i < rows.length; i += 200) {
    const chunk = rows.slice(i, i + 200);
    // rep_groups är inte en kolumn på planned_workouts (egen tabell, se
    // migrationen) — bygg insert-payloaden explicit i stället för att bara
    // plocka bort fältet, så det inte går att av misstag skicka med det.
    const workoutRows = chunk.map((w) => ({
      user_id: w.user_id,
      scheduled_date: w.scheduled_date,
      slot: w.slot,
      workout_type: w.workout_type,
      title: w.title,
      description: w.description,
      target_distance_meters: w.target_distance_meters,
      target_duration_seconds: w.target_duration_seconds,
      block_id: w.block_id,
      template_id: w.template_id,
      status: w.status,
    }));
    const { data: inserted } = await supabase
      .from("planned_workouts")
      .insert(workoutRows)
      .select("id, scheduled_date, slot");
    if (!inserted) continue;

    // Paras ihop på datum+slot, inte på arrayindex. Postgres bevarar visserligen
    // ordningen för en rak INSERT ... VALUES ... RETURNING, men PostgREST
    // bygger sin batch-insert som INSERT ... SELECT ur en json-recordset, och
    // en SELECT utan ORDER BY har ingen garanterad radordning. Skulle den
    // ordningen någon gång avvika hamnar repgrupperna på fel pass — tyst, och
    // först synligt som att tisdagens lugna distans plötsligt har ett
    // 5×1000-upplägg. Datum+slot är unikt inom utrullningen (generateFromTemplate
    // hoppar över datum+slot som redan har ett pass), så det är en säker nyckel.
    const idByDateSlot = new Map(
      inserted.map((row) => [`${row.scheduled_date}|${row.slot}`, row.id as string]),
    );
    const repGroupRows = chunk.flatMap((w) => {
      const id = idByDateSlot.get(`${w.scheduled_date}|${w.slot}`);
      if (!id) return [];
      return (w.rep_groups ?? []).map((g) => ({ planned_workout_id: id, ...g }));
    });
    for (let j = 0; j < repGroupRows.length; j += 500) {
      await supabase.from("planned_rep_groups").insert(repGroupRows.slice(j, j + 500));
    }
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
 * pass läggs till i mallen. Härleder ägaren ur mallen själv (inte klienten)
 * — mallen finns redan och RLS avgör om anroparen får nå den. */
async function syncTemplateAcrossBlocks(supabase: SupabaseServerClient, templateId: string) {
  const { data: template } = await supabase
    .from("week_templates")
    .select("user_id, block_type")
    .eq("id", templateId)
    .maybeSingle();
  if (!template?.block_type) return;

  const { data: blocks } = await supabase
    .from("season_blocks")
    .select("id, start_date, end_date")
    .eq("user_id", template.user_id)
    .eq("block_type", template.block_type);
  for (const b of (blocks ?? []) as BlockRange[]) {
    await syncTemplateIntoBlock(supabase, template.user_id as string, templateId, b);
  }
}

// --- Säsongsblock ----------------------------------------------------------

export async function createBlock(formData: FormData) {
  const supabase = await createClient();
  const userId = await resolvedAthleteId(supabase, formData);
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
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;
  const { supabase } = auth;

  const name = str(formData, "name");
  const start = str(formData, "start_date");
  const end = str(formData, "end_date");
  const blockType = str(formData, "block_type") as BlockType | null;
  if (!name || !start || !end || !blockType) return;
  if (end < start) return;

  // Ägaren härleds ur den uppdaterade raden (RLS avgör om anroparen fick
  // uppdatera den alls) — inte ur klienten, precis som deleteTemplateItem.
  const { data: block } = await supabase
    .from("season_blocks")
    .update({
      name,
      block_type: blockType,
      season: str(formData, "season"),
      start_date: start,
      end_date: end,
      focus: str(formData, "focus"),
    })
    .eq("id", id)
    .select("user_id")
    .single();
  if (!block) return;

  // T ex ett förlängt slutdatum ska direkt ge fler pass i kalendern, utan
  // ett separat "rulla ut igen"-steg.
  await syncBlockWithTemplates(supabase, block.user_id as string, {
    id,
    start_date: start,
    end_date: end,
    block_type: blockType,
  });

  refresh();
}

export async function deleteBlock(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;
  await auth.supabase.from("season_blocks").delete().eq("id", id);
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
  const supabase = await createClient();
  const userId = await resolvedAthleteId(supabase, formData);
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
  const supabase = await createClient();
  const userId = await resolvedAthleteId(supabase, formData);
  if (!userId) return;

  const name = str(formData, "name");
  const date = str(formData, "competition_date");
  if (!name || !date) return;
  const venue = str(formData, "venue");

  const { data: competition } = await supabase
    .from("competitions")
    .insert({
      user_id: userId,
      name,
      competition_date: date,
      location: str(formData, "location"),
      venue,
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

  // Listan på /planering är filtrerad på år/bana (se planering/page.tsx) —
  // hamnar den nya tävlingen utanför det filtret man just stod i skulle den
  // se ut att ha försvunnit. Formuläret skickar med det aktiva filtret i två
  // dolda fält; bara om det filtret faktiskt döljer den nya raden navigerar
  // vi om, till precis det år/bana som visar den. I alla andra fall räcker
  // revalidatePath ovan — ingen navigering behövs.
  const currentYear = str(formData, "current_tavlingsAr");
  const currentBana = str(formData, "current_tavlingsBana");
  const createdYear = date.slice(0, 4);
  const banaForCreated = venue === "indoor" ? "inne" : venue === "outdoor" ? "ute" : "alla";

  const yearHidesIt = currentYear != null && currentYear !== "alla" && currentYear !== createdYear;
  const banaHidesIt = currentBana != null && currentBana !== "alla" && currentBana !== banaForCreated;

  if (yearHidesIt || banaHidesIt) {
    redirect(`/sasongen?tavlingsAr=${createdYear}&tavlingsBana=${banaForCreated}#tavlingar`);
  }
}

export async function deleteCompetition(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;
  await auth.supabase.from("competitions").delete().eq("id", id);
  refresh();
}

export async function saveEventResult(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "event_id");
  if (!auth || !id) return;
  await auth.supabase
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
  const supabase = await createClient();
  const userId = await resolvedAthleteId(supabase, formData);
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
    },
    { onConflict: "template_id,weekday,slot" },
  );

  // Passet ska synas i kalendern direkt, i varje block som redan finns för
  // mallens blocktyp — inget separat "rulla ut"-steg. Ägaren härleds ur
  // mallen själv, se syncTemplateAcrossBlocks.
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
  // status filtreras till "planned"), i alla block av mallens blocktyp.
  // Ägaren härleds ur mallen (inte klienten) — samma mönster som ovan.
  if (item) {
    const { data: template } = await supabase
      .from("week_templates")
      .select("user_id, block_type")
      .eq("id", item.template_id)
      .maybeSingle();
    if (template?.block_type) {
      const { data: blocks } = await supabase
        .from("season_blocks")
        .select("start_date, end_date")
        .eq("user_id", template.user_id)
        .eq("block_type", template.block_type);
      for (const b of blocks ?? []) {
        const dates = datesForWeekday(b.start_date, b.end_date, item.weekday);
        if (dates.length === 0) continue;
        // planned_rep_groups för de här raderna städas också av on delete
        // cascade — de pekar på planned_workouts.id, inte på mallraden.
        await supabase
          .from("planned_workouts")
          .delete()
          .eq("user_id", template.user_id)
          .eq("template_id", item.template_id)
          .eq("slot", item.slot)
          .eq("status", "planned")
          .in("scheduled_date", dates);
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
// beter sig för titel/beskrivning, se existingKeys i syncTemplateIntoBlock.
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

// --- Tillgänglighet: skola, läger, resor (K7) -------------------------------
// Medvetet det enklaste möjliga CRUD-paret i den här filen: inga kopplade
// barnrader att synka (jämför createCompetition/competition_events), ingen
// utrullning att trigga (jämför createBlock/syncBlockWithTemplates). Ett
// datumintervall och en etikett — se motiveringen i migrationen.

export async function createAvailabilityPeriod(formData: FormData) {
  const supabase = await createClient();
  const userId = await resolvedAthleteId(supabase, formData);
  if (!userId) return;

  const start = str(formData, "start_date");
  const end = str(formData, "end_date");
  const kind = str(formData, "kind") as AvailabilityKind | null;
  if (!start || !end || !kind) return;
  // Check-constrainten finns i databasen, men ett tyst avvisat formulär är
  // bättre än ett 500-fel när någon vänt på datumen (samma princip som
  // createBlock/updateBlock ovan).
  if (end < start) return;

  await supabase.from("availability_periods").insert({
    user_id: userId,
    start_date: start,
    end_date: end,
    kind,
    label: str(formData, "label"),
    note: str(formData, "note"),
  });

  refresh();
}

export async function deleteAvailabilityPeriod(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;
  await auth.supabase.from("availability_periods").delete().eq("id", id);
  refresh();
}
