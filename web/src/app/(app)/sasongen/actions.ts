"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getScopedProfile,
  planningOwnerId,
  resolveScopedUserId,
  viewableAthletes,
  type ScopedProfile,
} from "@/lib/auth-scope";
import {
  datesForWeekday,
  type AvailabilityKind,
  type PeriodType,
  type PhaseType,
  type RepGroupInput,
} from "@/lib/planning";
import { athletesForBlock, syncBlockWithTemplates, syncTemplateAcrossBlocks } from "@/lib/template-sync";

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
  revalidatePath("/sasongen");
  revalidatePath("/calendar", "layout");
}

/** Standardveckans aggregatsiffror (Årsplan-parametrarna pass/dagar/starter/
 * timmar/test) för ett block — gäller för varje kalendervecka inom blockets
 * datumintervall, se migration 20260815100000_block_period_redesign.sql.
 * Träningsfaktorerna (Snabbhet/Uthållighet/...) hör INTE hemma här — rättat
 * 2026-08-16: planeringen sker per pass, inte som en klumpsumma för hela
 * blocket, se training_factor på week_template_items/planned_workouts i
 * stället. Delad mellan createBlock och updateBlock, som
 * repGroupFieldsFromForm är delad mellan rep-actionerna nedan. */
function standardWeekFieldsFromForm(formData: FormData) {
  return {
    sessions_count: num(formData, "sessions_count"),
    days_count: num(formData, "days_count"),
    starts_count: num(formData, "starts_count"),
    hours_count: num(formData, "hours_count"),
    has_test: formData.get("has_test") === "on",
  };
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

/** Vilka löpare ett block/en periodisering ska gälla för — en coach kryssar
 * i en delmängd av sina "vyer" (formulärfältet `athletes`, ett värde per
 * ikryssad löpare) — sig själv (Fredrik tränar också, utan egen tränare) och
 * länkade löpare, se viewableAthletes; en löpare utan coach gäller alltid
 * bara sig själv, det finns ingen väljare att visa. Ogiltiga id:n filtreras
 * bort — säkerheten ligger ändå i RLS på season_block_athletes, det här är
 * bara att inte spara skräp. */
function targetAthletesFromForm(scoped: ScopedProfile, formData: FormData): string[] {
  if (scoped.role !== "coach") return [scoped.userId];
  const valid = viewableAthletes(scoped);
  return formData
    .getAll("athletes")
    .map(String)
    .filter((id) => valid.some((a) => a.id === id));
}

// --- Säsongsblock ----------------------------------------------------------

export async function createBlock(formData: FormData) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return;

  const name = str(formData, "name");
  const start = str(formData, "start_date");
  const end = str(formData, "end_date");
  const period = str(formData, "period") as PeriodType | null;
  const phase = str(formData, "phase") as PhaseType | null;
  if (!name || !start || !end || !period || !phase) return;
  // Databasen har en check-constraint, men ett tyst avvisat formulär är
  // bättre än ett 500-fel när någon vänt på datumen.
  if (end < start) return;

  const athleteIds = targetAthletesFromForm(scoped, formData);
  if (athleteIds.length === 0) return;

  // Ägaren (user_id) är vem som skapade/äger blocket — coachen för ett delat
  // block, löparen själv för ett självcoachat. Vilka löpare blocket faktiskt
  // gäller för avgörs separat av season_block_athletes nedan, inte user_id.
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
      ...standardWeekFieldsFromForm(formData),
    })
    .select("id, start_date, end_date, phase")
    .single();
  if (!block) return;

  await supabase
    .from("season_block_athletes")
    .insert(athleteIds.map((athlete_id) => ({ block_id: block.id, athlete_id })));

  await syncBlockWithTemplates(supabase, scoped.userId, block);

  refresh();
}

export async function updateBlock(formData: FormData) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  const id = str(formData, "id");
  if (!scoped || !id) return;

  const name = str(formData, "name");
  const start = str(formData, "start_date");
  const end = str(formData, "end_date");
  const period = str(formData, "period") as PeriodType | null;
  const phase = str(formData, "phase") as PhaseType | null;
  if (!name || !start || !end || !period || !phase) return;
  if (end < start) return;

  // Ägaren härleds ur den uppdaterade raden (RLS avgör om anroparen fick
  // uppdatera den alls) — inte ur klienten, precis som deleteTemplateItem.
  const { data: block } = await supabase
    .from("season_blocks")
    .update({
      name,
      period,
      phase,
      season: str(formData, "season"),
      start_date: start,
      end_date: end,
      focus: str(formData, "focus"),
      ...standardWeekFieldsFromForm(formData),
    })
    .eq("id", id)
    .select("user_id")
    .single();
  if (!block) return;

  // Bara en coach kan ändra vilka löpare ett block gäller för — en
  // självcoachad löpares block har ingen väljare i formuläret (bara sig
  // själv), och det fältet skickas då inte med alls.
  if (scoped.role === "coach") {
    const athleteIds = targetAthletesFromForm(scoped, formData);
    await supabase.from("season_block_athletes").delete().eq("block_id", id);
    if (athleteIds.length > 0) {
      await supabase
        .from("season_block_athletes")
        .insert(athleteIds.map((athlete_id) => ({ block_id: id, athlete_id })));
    }
  }

  // T ex ett förlängt slutdatum ska direkt ge fler pass i kalendern, utan
  // ett separat "rulla ut igen"-steg.
  await syncBlockWithTemplates(supabase, block.user_id as string, {
    id,
    start_date: start,
    end_date: end,
    phase,
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

