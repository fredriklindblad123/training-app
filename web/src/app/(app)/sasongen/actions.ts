"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getScopedProfile,
  planningOwnerId,
  resolveScopedUserId,
  type ScopedProfile,
} from "@/lib/auth-scope";
import { TRAINING_FACTORS } from "@/lib/training-factors";
import {
  datesForWeekday,
  generateFromTemplate,
  suggestBlocks,
  toDateKey,
  type AvailabilityKind,
  type PeriodType,
  type PhaseType,
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

/** Standardveckan (Årsplan-parametrarna) för ett block — gäller för varje
 * kalendervecka inom blockets datumintervall, i stället för att fyllas i en
 * gång per vecka (den tidigare season_week_plans-modellen, se migration
 * 20260815100000_block_period_redesign.sql). Delad mellan createBlock och
 * updateBlock, som repGroupFieldsFromForm är delad mellan rep-actionerna
 * nedan. */
function standardWeekFieldsFromForm(formData: FormData) {
  const trainingFactors: Record<string, string> = {};
  for (const factor of TRAINING_FACTORS) {
    const v = str(formData, `factor_${factor.key}`);
    if (v) trainingFactors[factor.key] = v;
  }
  return {
    sessions_count: num(formData, "sessions_count"),
    days_count: num(formData, "days_count"),
    starts_count: num(formData, "starts_count"),
    hours_count: num(formData, "hours_count"),
    has_test: formData.get("has_test") === "on",
    training_factors: trainingFactors,
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
 * i en delmängd av sina länkade löpare (formulärfältet `athletes`, ett värde
 * per ikryssad löpare); en löpare utan coach gäller alltid bara sig själv,
 * det finns ingen väljare att visa. Ogiltiga id:n (inte en faktiskt länkad
 * löpare) filtreras bort — säkerheten ligger ändå i RLS på
 * season_block_athletes, det här är bara att inte spara skräp. */
function targetAthletesFromForm(scoped: ScopedProfile, formData: FormData): string[] {
  if (scoped.role !== "coach") return [scoped.userId];
  return formData
    .getAll("athletes")
    .map(String)
    .filter((id) => scoped.linkedAthletes.some((a) => a.id === id));
}

/** Vilka löpare ett block gäller för just nu — season_block_athletes, se
 * migration 20260816100000_shared_planning_and_readonly_athlete.sql. */
async function athletesForBlock(supabase: SupabaseServerClient, blockId: string): Promise<string[]> {
  const { data } = await supabase
    .from("season_block_athletes")
    .select("athlete_id")
    .eq("block_id", blockId);
  return (data ?? []).map((r) => r.athlete_id as string);
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

/** Synkar alla mallar för ett blocks ägare+fas in i blocket, för VARJE
 * löpare blocket gäller för — anropas när ett block skapas eller ändras
 * (nytt datumintervall, ny fas, eller nya löpare). `ownerId` är vem som äger
 * blocket och mallarna (coachen för ett delat block, löparen själv för ett
 * självcoachat) — INTE nödvändigtvis samma person passen skrivs in på. Det
 * är season_block_athletes (athletesForBlock) som avgör vilka löpares
 * kalendrar som faktiskt får passen. */
async function syncBlockWithTemplates(
  supabase: SupabaseServerClient,
  ownerId: string,
  block: BlockRange & { phase: string },
) {
  const { data: templates } = await supabase
    .from("week_templates")
    .select("id")
    .eq("user_id", ownerId)
    .eq("phase", block.phase);
  if (!templates || templates.length === 0) return;

  const athleteIds = await athletesForBlock(supabase, block.id);
  for (const t of templates) {
    for (const athleteId of athleteIds) {
      await syncTemplateIntoBlock(supabase, athleteId, t.id as string, block);
    }
  }
}

/** Synkar en mall in i alla befintliga block av dess fas, för varje löpare
 * respektive block gäller för — anropas när ett pass läggs till i mallen.
 * Härleder ägaren ur mallen själv (inte klienten) — mallen finns redan och
 * RLS avgör om anroparen får nå den. */
async function syncTemplateAcrossBlocks(supabase: SupabaseServerClient, templateId: string) {
  const { data: template } = await supabase
    .from("week_templates")
    .select("user_id, phase")
    .eq("id", templateId)
    .maybeSingle();
  if (!template?.phase) return;

  const { data: blocks } = await supabase
    .from("season_blocks")
    .select("id, start_date, end_date")
    .eq("user_id", template.user_id)
    .eq("phase", template.phase);
  for (const b of (blocks ?? []) as BlockRange[]) {
    const athleteIds = await athletesForBlock(supabase, b.id);
    for (const athleteId of athleteIds) {
      await syncTemplateIntoBlock(supabase, athleteId, templateId, b);
    }
  }
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

/**
 * Skapar en hel periodisering bakåt från en A-tävling.
 *
 * Det här är den funktion som gör att man slipper lägga in fyra block för
 * hand varje säsong. Förslaget är en utgångspunkt — blocken går att flytta
 * och byta namn på efteråt.
 */
export async function suggestPeriodisation(formData: FormData) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return;

  const competitionDate = str(formData, "competition_date");
  const startFrom = str(formData, "start_from") ?? toDateKey(new Date());
  const season = str(formData, "season") as SeasonKind | null;
  if (!competitionDate) return;

  const athleteIds = targetAthletesFromForm(scoped, formData);
  if (athleteIds.length === 0) return;

  const blocks = suggestBlocks(competitionDate, season, startFrom);
  if (blocks.length === 0) return;

  const { data: inserted } = await supabase
    .from("season_blocks")
    .insert(blocks.map((b) => ({ ...b, user_id: scoped.userId })))
    .select("id");

  for (const row of inserted ?? []) {
    await supabase
      .from("season_block_athletes")
      .insert(athleteIds.map((athlete_id) => ({ block_id: row.id, athlete_id })));
  }

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

