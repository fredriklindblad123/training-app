import { createClient } from "@/lib/supabase/server";
import { generateFromTemplate, type RepGroupInput, type TemplateItem } from "@/lib/planning";

/* Rollout-motorn som håller ett blocks veckomönster och kalenderns
 * planned_workouts synkade — flyttad hit från sasongen/actions.ts
 * 2026-08-16, förenklad 2026-08-17 när "mall" (week_templates) togs bort
 * som eget återanvändbart objekt: ett block äger sitt eget veckomönster
 * direkt via week_template_items.block_id, ingen (ägare, fas)-matchning
 * mot andra block längre. */

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;
export type BlockRange = { id: string; start_date: string; end_date: string };

/** Vilka löpare ett block gäller för just nu — season_block_athletes, se
 * migration 20260816100000_shared_planning_and_readonly_athlete.sql. */
export async function athletesForBlock(
  supabase: SupabaseServerClient,
  blockId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("season_block_athletes")
    .select("athlete_id")
    .eq("block_id", blockId);
  return (data ?? []).map((r) => r.athlete_id as string);
}

/**
 * Rullar ut ett blocks eget veckomönster för EN löpare. Ersätter det
 * tidigare manuella "Rulla ut"-steget: så fort ett block finns, eller ett
 * pass läggs till i dess mönster, ska det synas i kalendern direkt.
 *
 * Hoppar över dagar som redan har ett planerat pass i samma slot, så att
 * körningen aldrig skriver över något som lagts in för hand och kan köras om
 * (t ex efter att ett blocks datum ändrats) utan att skapa dubbletter.
 */
async function syncItemsIntoBlock(
  supabase: SupabaseServerClient,
  userId: string,
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
      "weekday, slot, workout_type, title, description, target_distance_meters, target_duration_seconds, training_factor, " +
        "template_rep_groups(sort_order, reps, distance_meters, duration_seconds, target_pace_seconds_per_km, target_hr_low, target_hr_high, recovery_seconds, recovery_kind, note)",
    )
    .eq("block_id", block.id);
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
    training_factor: it.training_factor,
    rep_groups: it.template_rep_groups ?? [],
  }));

  const rows = generateFromTemplate({
    userId,
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
      training_factor: w.training_factor,
      block_id: w.block_id,
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

/** Synkar ett blocks eget veckomönster för VARJE löpare blocket gäller för
 * — anropas när blocket skapas eller ändras (nytt datumintervall, nya
 * löpare) och när ett pass läggs till/tas bort i mönstret. Det är
 * season_block_athletes (athletesForBlock) som avgör vilka löpares
 * kalendrar som faktiskt får passen. */
export async function syncBlockPattern(supabase: SupabaseServerClient, block: BlockRange) {
  const athleteIds = await athletesForBlock(supabase, block.id);
  for (const athleteId of athleteIds) {
    await syncItemsIntoBlock(supabase, athleteId, block);
  }
}
