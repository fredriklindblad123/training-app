"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, assignableAthletes } from "@/lib/auth-scope";

/* Serveråtgärder för tävlingsplaneringen.
 *
 * En tävling som flera löpare springer är FLERA RADER i `competitions` med
 * samma namn och datum — det finns ingen kopplingstabell. Allt här arbetar
 * därför på gruppen (namn + datum) och inte på ett enskilt id, till skillnad
 * från tavlingsresultat/actions.ts som redigerar en löpares rad i taget.
 */

function str(formData: FormData, key: string): string | null {
  const v = formData.get(key);
  if (typeof v !== "string") return null;
  const trimmed = v.trim();
  return trimmed === "" ? null : trimmed;
}

/* Tävlingar visas på FEM ställen, och en ändring måste slå igenom på alla.
 * Att missa ett av dem ger den värsta sortens fel: sidan ser ut att fungera,
 * men visar en tävling som är borttagen eller saknar en som just lagts in.
 * Kalendern tar "layout" eftersom tävlingar ritas i år-, månads-, vecko- och
 * dagvyn, som alla är egna segment. */
function refresh() {
  revalidatePath("/tavlingar");
  revalidatePath("/tavlingsresultat");
  revalidatePath("/sasongsoversikt");
  revalidatePath("/blockplan");
  revalidatePath("/detaljplan");
  revalidatePath("/calendar", "layout");
}

/** Löpare den inloggade får lägga tävlingar på. Coachen själv ingår — hen
 * tävlar också. */
async function allowedAthleteIds(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<string[]> {
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return [];
  return assignableAthletes(scoped).map((a) => a.id);
}

export async function createPlannedCompetition(formData: FormData) {
  const supabase = await createClient();
  const allowed = await allowedAthleteIds(supabase);
  if (allowed.length === 0) return;

  const name = str(formData, "name");
  const date = str(formData, "competition_date");
  if (!name || !date) return;

  // Kryssrutorna. Bara id:n den inloggade faktiskt får skriva på släpps
  // igenom — RLS är den riktiga spärren, men ett filter här gör att en
  // manipulerad post tyst blir tom i stället för att halvt lyckas.
  const picked = formData.getAll("athletes").filter((v): v is string => typeof v === "string");
  const targets = picked.filter((id) => allowed.includes(id));
  if (targets.length === 0) return;

  await supabase.from("competitions").insert(
    targets.map((userId) => ({
      user_id: userId,
      name,
      competition_date: date,
      location: str(formData, "location"),
      venue: str(formData, "venue"),
      priority: str(formData, "priority") ?? "C",
    })),
  );
  refresh();
}

/** Tar bort HELA tävlingen — alla löpares rader med samma namn och datum. */
export async function deletePlannedCompetition(formData: FormData) {
  const supabase = await createClient();
  const allowed = await allowedAthleteIds(supabase);
  const name = str(formData, "name");
  const date = str(formData, "competition_date");
  if (!name || !date || allowed.length === 0) return;

  await supabase
    .from("competitions")
    .delete()
    .eq("name", name)
    .eq("competition_date", date)
    .in("user_id", allowed);
  refresh();
}

/** Kopplar på eller av EN löpare från en tävling. */
export async function toggleCompetitionAthlete(formData: FormData) {
  const supabase = await createClient();
  const allowed = await allowedAthleteIds(supabase);
  const name = str(formData, "name");
  const date = str(formData, "competition_date");
  const athleteId = str(formData, "athlete_id");
  if (!name || !date || !athleteId || !allowed.includes(athleteId)) return;

  const { data: existing } = await supabase
    .from("competitions")
    .select("id")
    .eq("name", name)
    .eq("competition_date", date)
    .eq("user_id", athleteId)
    .maybeSingle();

  if (existing) {
    await supabase.from("competitions").delete().eq("id", existing.id);
  } else {
    /* Den nya raden ärver prioritet, plats och bana från en befintlig rad i
     * gruppen. Utan det hade en påkopplad löpare fått C-lopp på en tävling som
     * är A-lopp för alla andra — samma tävling med två olika prioriteter. */
    const { data: sibling } = await supabase
      .from("competitions")
      .select("priority, location, venue")
      .eq("name", name)
      .eq("competition_date", date)
      .in("user_id", allowed)
      .limit(1)
      .maybeSingle();

    await supabase.from("competitions").insert({
      user_id: athleteId,
      name,
      competition_date: date,
      priority: (sibling?.priority as string) ?? "C",
      location: (sibling?.location as string | null) ?? null,
      venue: (sibling?.venue as string | null) ?? null,
    });
  }
  refresh();
}
