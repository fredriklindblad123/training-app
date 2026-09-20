"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { parseGoalSeconds } from "@/lib/race-pace";
import { createClient } from "@/lib/supabase/server";
import { triggerGarminSync } from "@/lib/garmin-sync";

function apiBase(): string {
  // VERCEL_URL pekar på den deploy-specifika adressen, som Vercel skyddar
  // bakom en inloggningssida (SSO) per default — interna server-till-server-
  // anrop dit studsar tyst mot den sidan istället för att nå vår endpoint.
  // VERCEL_PROJECT_PRODUCTION_URL är den publika produktionsdomänen och är
  // inte skyddad på samma sätt.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export async function connectGarmin(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const email = formData.get("garmin_email") as string;
  const password = formData.get("garmin_password") as string;
  if (!email || !password) return;

  const res = await fetch(`${apiBase()}/api/garmin/login`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
    },
    body: JSON.stringify({ user_id: user.id, email, password }),
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}) as { error?: string });
    redirect(
      `/settings?error=${encodeURIComponent(body.error ?? "Kunde inte ansluta Garmin-kontot")}`,
    );
  }

  revalidatePath("/settings");
}

export async function syncGarminNow() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  await triggerGarminSync(user.id);

  revalidatePath("/settings");
  revalidatePath("/calendar", "layout");
  revalidatePath("/dashboard", "layout");
}

// P0.3b: personligt kalibrerat tröskelband (Almgren: 167–178 slag/min för
// tröskelarbete) istället för klockans gissade autozoner. Fälten är
// nullable — de flesta har inget laktattest att kalibrera mot ännu.
function parseIntOrNull(raw: FormDataEntryValue | null): number | null {
  const value = raw as string;
  return value ? Math.round(Number(value)) : null;
}

export async function saveThresholds(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const lt2Hr = parseIntOrNull(formData.get("lt2_hr"));

  // Har LT2-fältet faktiskt ändrats sedan sist? Formuläret har bara ett
  // fält för alla trösklar, så ett sparat värde som kom från
  // tröskeltestkortet (test_field, med testdagens datum) skulle annars
  // tappa sin källa och sitt datum varje gång den här sidan sparas av någon
  // annan anledning — t.ex. att bara uppdatera tröskelbandet.
  const { data: current } = await supabase
    .from("profiles")
    .select("lt2_hr")
    .eq("id", user.id)
    .maybeSingle();
  const lt2Changed = lt2Hr !== (current?.lt2_hr ?? null);

  // K8 (docs/tranarperspektiv.md): ett LT2 som skrivs in här har ingen känd
  // testdag och inget känt testsätt. 'manuell' gör det synligt att det inte
  // är ett kalibrerat fälttest eller laktattest, bara ett tal någon skrivit
  // in. Ett tomt fält nollar källa och datum tillsammans med värdet, så de
  // tre aldrig hamnar i otakt (ett sparat lt2_source utan ett lt2_hr).
  await supabase
    .from("profiles")
    .update({
      lt1_hr: parseIntOrNull(formData.get("lt1_hr")),
      lt2_hr: lt2Hr,
      ...(lt2Changed
        ? { lt2_source: lt2Hr != null ? "manuell" : null, lt2_measured_on: null }
        : {}),
      threshold_hr_low: parseIntOrNull(formData.get("threshold_hr_low")),
      threshold_hr_high: parseIntOrNull(formData.get("threshold_hr_high")),
      max_hr: parseIntOrNull(formData.get("max_hr")),
    })
    .eq("id", user.id);

  revalidatePath("/settings");
  revalidatePath("/trender");
}

// --- Fas 0: coach lägger till löpare ----------------------------------------
// Se supabase/migrations/20260814140000_coach_add_athlete.sql för RLS-/
// funktionssidan. Två utfall: e-posten har redan ett konto -> länkas direkt
// (coach_athletes); annars bara inbjuden (allowed_signup_emails) — länken
// skapas nästa gång formuläret körs efter att personen har signat upp,
// eftersom coach_athletes.athlete_id måste peka på en riktig profilrad.
export async function saveGoal(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const event = (formData.get("goal_event") as string | null)?.trim() || null;
  const seconds = parseGoalSeconds((formData.get("goal_time") as string | null) ?? "");

  // Databasen kräver att båda är satta eller båda tomma
  // (profiles_goal_pair_check). Ett halvt ifyllt formulär nollar därför
  // hellre målet än att kastas tillbaka som ett fel.
  const complete = event != null && seconds != null;

  await supabase
    .from("profiles")
    .update({
      goal_event: complete ? event : null,
      goal_seconds: complete ? seconds : null,
    })
    .eq("id", user.id);

  revalidatePath("/settings");
  revalidatePath("/trender");
}

export async function addAthlete(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const email = (formData.get("athlete_email") as string | null)?.trim().toLowerCase();
  if (!email) return;

  // Idempotent — harmlöst om e-posten redan finns i allowlistan sedan innan.
  await supabase
    .from("allowed_signup_emails")
    .upsert({ email, note: "löpare" }, { onConflict: "email", ignoreDuplicates: true });

  const { data: athleteId } = await supabase.rpc("find_user_id_by_email", {
    lookup_email: email,
  });

  if (athleteId) {
    await supabase
      .from("coach_athletes")
      .upsert(
        { coach_id: user.id, athlete_id: athleteId },
        { onConflict: "coach_id,athlete_id", ignoreDuplicates: true },
      );
    revalidatePath("/settings");
    revalidatePath("/sasongsoversikt");
    revalidatePath("/blockplan");
    revalidatePath("/flerarsplan");
    redirect("/settings?athleteAdded=linked");
  }

  revalidatePath("/settings");
  redirect("/settings?athleteAdded=invited");
}

export async function removeAthlete(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const athleteId = formData.get("athlete_id") as string | null;
  if (!user || !athleteId) return;

  await supabase
    .from("coach_athletes")
    .delete()
    .eq("coach_id", user.id)
    .eq("athlete_id", athleteId);

  revalidatePath("/settings");
  revalidatePath("/sasongsoversikt");
  revalidatePath("/blockplan");
  revalidatePath("/flerarsplan");
}

/* Godkänner eller avvisar en kontoförfrågan.
 *
 * Ett godkännande gör två saker: lägger adressen i allowed_signup_emails —
 * det är den listan auth-hooken hook_restrict_signup_by_email släpper igenom
 * — och märker förfrågan som hanterad. Kontot skapar personen själv efteråt,
 * med sitt eget lösenord; appen skapar aldrig inloggningar åt någon.
 */
export async function handleSignupRequest(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const id = formData.get("request_id") as string | null;
  const decision = formData.get("decision") as string | null;
  if (!id || (decision !== "godkand" && decision !== "avvisad")) return;

  const { data: request } = await supabase
    .from("signup_requests")
    .select("email, full_name")
    .eq("id", id)
    .maybeSingle();
  if (!request) return;

  if (decision === "godkand") {
    await supabase.from("allowed_signup_emails").upsert(
      {
        email: (request.email as string).toLowerCase(),
        note: `Godkänd förfrågan: ${request.full_name as string}`,
      },
      { onConflict: "email" },
    );
  }

  await supabase
    .from("signup_requests")
    .update({ status: decision, handled_at: new Date().toISOString(), handled_by: user.id })
    .eq("id", id);

  revalidatePath("/settings");
}
