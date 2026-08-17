"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  getScopedProfile,
  resolveScopedUserId,
  viewableAthletes,
  type ScopedProfile,
} from "@/lib/auth-scope";
import { type AvailabilityKind, type PeriodType, type PhaseType } from "@/lib/planning";
import { syncBlockPattern } from "@/lib/template-sync";

/* Block och tillgänglighet (K7) — flyttat hit ur sasongen/actions.ts
 * 2026-08-17. Veckomallarnas dag-för-dag-innehåll (skapa/redigera mall,
 * pass, repgrupper) hör numera till /detaljplan, se den filens actions.ts. */

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
  revalidatePath("/arsplan");
  revalidatePath("/detaljplan");
  revalidatePath("/calendar", "layout");
}

/** Standardveckans aggregatsiffror (Årsplan-parametrarna pass/dagar/starter/
 * timmar/test) för ett block — gäller för varje kalendervecka inom blockets
 * datumintervall, se migration 20260815100000_block_period_redesign.sql.
 * Träningsfaktorerna (Snabbhet/Uthållighet/...) hör INTE hemma här — den
 * detaljnivån hör hemma per pass, se training_factor på
 * week_template_items/planned_workouts i stället. Delad mellan createBlock
 * och updateBlock. */
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
 * RLS (season_blocks/... `coach_athletes`-policyerna, se migration
 * 20260814100000) avgör redan om raden faktiskt går att nå. */
async function requireUser(): Promise<{ supabase: SupabaseServerClient } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase } : null;
}

/** För actions som skapar en helt ny toppnivårad — vilken löpares rad det
 * blir. En löpare får alltid sitt eget id; en coach växlar via det dolda
 * `athlete`-fältet formuläret skickar med (samma `athlete`-param som sidans
 * URL, se page.tsx). Säkerheten ligger i RLS, inte här. */
async function resolvedAthleteId(
  supabase: SupabaseServerClient,
  formData: FormData,
): Promise<string | null> {
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  return resolveScopedUserId(scoped, str(formData, "athlete") ?? undefined);
}

/** Vilka löpare ett block/en periodisering ska gälla för — en coach kryssar
 * i en delmängd av sina "vyer" (formulärfältet `athletes`) — sig själv
 * (Fredrik tränar också, utan egen tränare) och länkade löpare, se
 * viewableAthletes; en löpare utan coach gäller alltid bara sig själv.
 * Ogiltiga id:n filtreras bort — säkerheten ligger ändå i RLS på
 * season_block_athletes, det här är bara att inte spara skräp. */
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

  await syncBlockPattern(supabase, block);

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

  // RLS avgör om anroparen fick uppdatera raden alls — `block` är null (och
  // vi avbryter) om inte.
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
    .select("id")
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
  await syncBlockPattern(supabase, { id, start_date: start, end_date: end });

  refresh();
}

export async function deleteBlock(formData: FormData) {
  const auth = await requireUser();
  const id = str(formData, "id");
  if (!auth || !id) return;
  await auth.supabase.from("season_blocks").delete().eq("id", id);
  refresh();
}

// --- Tillgänglighet: skola, läger, resor (K7) -------------------------------
// Medvetet det enklaste möjliga CRUD-paret i den här filen: inga kopplade
// barnrader att synka, ingen utrullning att trigga. Ett datumintervall och
// en etikett — se motiveringen i migrationen.

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
