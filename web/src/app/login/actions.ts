"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSyncTargets, triggerGarminSyncForAll } from "@/lib/garmin-sync";

/** Garmin-synk vid inloggning (uttrycklig begäran 2026-08-27): en löpare får
 * sin egen data uppdaterad, en tränare får sin egen OCH alla länkade adepters
 * — se resolveSyncTargets.
 *
 * Två saker är avgörande för att det inte ska märkas:
 *
 * 1. Vilka som ska synkas räknas ut FÖRE `after()`, medan
 *    request-kontexten och Supabase-klienten fortfarande lever. Inuti
 *    `after()` görs bara HTTP-anropen.
 * 2. Själva synken skjuts upp med `after()` och blockerar aldrig
 *    redirecten. Ett Garmin-anrop tar flera sekunder (inloggning +
 *    aktiviteter + varv + sömn), och att invänta fem sådana vid en
 *    tränarinloggning skulle göra inloggningen oanvändbart trög. Vercel
 *    håller funktionen vid liv tills bakgrundsarbetet är klart.
 *
 * Synken stryps dessutom i Python (AUTO_SYNC_MIN_INTERVAL_MINUTES) så att
 * upprepade inloggningar inom kvarten inte ger upprepade Garmin-anrop. */
async function syncGarminInBackground(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
) {
  let targets: string[];
  try {
    targets = await resolveSyncTargets(supabase, userId);
  } catch {
    targets = [userId];
  }
  after(async () => {
    try {
      await triggerGarminSyncForAll(targets);
    } catch {
      // Synkas ändå på schemat (05:00 UTC, se vercel.json) eller vid nästa
      // inloggning. En misslyckad bakgrundssynk får aldrig synas för den som
      // just loggat in.
    }
  });
}

export async function login(formData: FormData) {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  if (data.user) {
    await syncGarminInBackground(supabase, data.user.id);
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

export async function signup(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signUp({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
  }

  redirect(
    `/login?message=${encodeURIComponent("Kolla din e-post för att bekräfta kontot.")}`,
  );
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
