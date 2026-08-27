"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId, viewableAthletes } from "@/lib/auth-scope";
import { parseResultSeconds } from "@/lib/race-results";

/* Tävlingar: lägga till, prioritera och logga resultat — flyttat hit från
 * /sasongen 2026-08-16 (uttrycklig begäran). Att logga ETT RESULTAT efter
 * ett lopp är retrospektivt, inte säsongsplanering, och hörde inte hemma på
 * en framåtblickande sida. /blockplan (tidigare /sasongen) behåller bara en
 * läsande "Nästa A-tävling"-rad, Blockplans veckorutnäts tävlingsrad och
 * tävlingsmarkörer i tidslinjen — all redigering (den här filen) hör nu
 * ihop med analysen av samma data på den här sidan. */

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
  revalidatePath("/tavlingsresultat");
  revalidatePath("/blockplan");
  // Tävlingarna visas numera i Detaljplans veckovy (med deltagarna), så en
  // ny/borttagen tävling måste slå igenom där också.
  revalidatePath("/detaljplan");
}

/** Bara "är någon inloggad" — RLS avgör om raden faktiskt går att nå. Samma
 * mönster som requireUser i sasongen/actions.ts. */
async function requireUser(): Promise<{ supabase: SupabaseServerClient } | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ? { supabase } : null;
}

/** Vilken löpares rad en ny tävling ska skrivas på — en löpare får alltid
 * sitt eget id, en coach växlar via det dolda `athlete`-fältet. Samma
 * mönster som resolvedAthleteId i sasongen/actions.ts. */
async function resolvedAthleteId(
  supabase: SupabaseServerClient,
  formData: FormData,
): Promise<string | null> {
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  return resolveScopedUserId(scoped, str(formData, "athlete") ?? undefined);
}

/** Vilka löpare tävlingen ska läggas in för. `competitions` har ingen
 * junction-tabell — en tävling flera löpare kör är flera rader med samma
 * namn och datum (det är också så veckovyn på /detaljplan grupperar dem, se
 * lib/detaljplan-weeks.ts). En coach kryssar i en delmängd via fältet
 * `athletes`; en löpare utan coach får alltid bara sin egen rad. Ogiltiga
 * id:n filtreras bort — säkerheten ligger i RLS, det här är att inte spara
 * skräp. Samma mönster som targetAthletesFromForm i arsplan/actions.ts. */
async function targetAthleteIds(
  supabase: SupabaseServerClient,
  formData: FormData,
): Promise<string[]> {
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return [];
  if (scoped.role !== "coach") return [scoped.userId];

  const valid = viewableAthletes(scoped);
  const checked = formData
    .getAll("athletes")
    .map(String)
    .filter((id) => valid.some((a) => a.id === id));
  if (checked.length > 0) return checked;

  // Inga kryssrutor med i formuläret (äldre formulär, eller ingen ikryssad)
  // — falla tillbaka på den löpare vyn är scopad till, som tidigare.
  const fallback = await resolvedAthleteId(supabase, formData);
  return fallback ? [fallback] : [];
}

export async function createCompetition(formData: FormData) {
  const supabase = await createClient();
  const athleteIds = await targetAthleteIds(supabase, formData);
  if (athleteIds.length === 0) return;

  const name = str(formData, "name");
  const date = str(formData, "competition_date");
  if (!name || !date) return;
  const venue = str(formData, "venue");

  const { data: created } = await supabase
    .from("competitions")
    .insert(
      athleteIds.map((userId) => ({
        user_id: userId,
        name,
        competition_date: date,
        location: str(formData, "location"),
        venue,
        priority: str(formData, "priority") ?? "C",
        notes: str(formData, "notes"),
      })),
    )
    .select("id");

  // Grenarna kommer som en kommaseparerad rad ("1500m, 800m") för att hålla
  // formuläret till ett fält — de flesta tävlingar har en eller två grenar.
  // Varje löpares rad får sin egen uppsättning grenar: competition_events
  // pekar på en competition, och varje löpare har en egen sådan.
  const eventsRaw = str(formData, "events");
  if (created && created.length > 0 && eventsRaw) {
    const events = eventsRaw
      .split(",")
      .map((e) => e.trim())
      .filter(Boolean);
    if (events.length > 0) {
      await supabase.from("competition_events").insert(
        created.flatMap((competition) =>
          events.map((event, i) => ({
            competition_id: competition.id,
            event,
            target_result: i === 0 ? str(formData, "target_result") : null,
            sort_order: i,
          })),
        ),
      );
    }
  }

  refresh();

  // Listan är filtrerad på år/bana (se tavlingsresultat/page.tsx) — hamnar
  // den nya tävlingen utanför det filtret man just stod i skulle den se ut
  // att ha försvunnit. Formuläret skickar med det aktiva filtret i två
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
    redirect(`/tavlingsresultat?tavlingsAr=${createdYear}&tavlingsBana=${banaForCreated}#tavlingar`);
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

  const actualResult = str(formData, "actual_result");

  /* Grennamnet hämtas ur raden i stället för att skickas med i formuläret:
   * parseResultSeconds behöver det för att avgöra om ett värde utan kolon är
   * sekunder eller meter, och den bedömningen ska inte gå att påverka genom
   * att posta ett annat grennamn än radens.
   *
   * result_seconds skrivs ALLTID, även som null. Ett resultat som rättas från
   * en tid till "DNF" måste tappa sitt gamla sekundvärde — annars ligger
   * loppet kvar i progressionsgrafen med en tid som inte längre står i
   * listan. */
  const { data: row } = await auth.supabase
    .from("competition_events")
    .select("event")
    .eq("id", id)
    .single();

  await auth.supabase
    .from("competition_events")
    .update({
      actual_result: actualResult,
      placement: num(formData, "placement"),
      result_seconds: parseResultSeconds(actualResult, row?.event as string | undefined),
    })
    .eq("id", id);
  refresh();
}
