"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";

/* Tävlingar: lägga till, prioritera och logga resultat — flyttat hit från
 * /sasongen 2026-08-16 (uttrycklig begäran). Att logga ETT RESULTAT efter
 * ett lopp är retrospektivt, inte säsongsplanering, och hörde inte hemma på
 * en framåtblickande sida. /sasongen behåller bara en läsande
 * "Nästa A-tävling"-rad och tävlingsmarkörer i tidslinjen — all redigering
 * (den här filen) hör nu ihop med analysen av samma data på den här sidan. */

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
  revalidatePath("/sasongen");
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
  await auth.supabase
    .from("competition_events")
    .update({
      actual_result: str(formData, "actual_result"),
      placement: num(formData, "placement"),
    })
    .eq("id", id);
  refresh();
}
