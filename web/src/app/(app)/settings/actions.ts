"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
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

  await supabase
    .from("profiles")
    .update({
      lt1_hr: parseIntOrNull(formData.get("lt1_hr")),
      lt2_hr: parseIntOrNull(formData.get("lt2_hr")),
      threshold_hr_low: parseIntOrNull(formData.get("threshold_hr_low")),
      threshold_hr_high: parseIntOrNull(formData.get("threshold_hr_high")),
      max_hr: parseIntOrNull(formData.get("max_hr")),
    })
    .eq("id", user.id);

  revalidatePath("/settings");
}
