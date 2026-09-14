"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

/* Ingen Garmin-synk här längre.
 *
 * Låg tidigare i den här funktionen, men flyttades 2026-09-14 till
 * app/(app)/layout.tsx där den triggas av VARJE sidvisning i stället för bara
 * inloggningen — en tränare som stannar inloggad hela dagen fick annars data
 * som var upp till ett dygn gammal. Redirecten nedan renderar layouten, så
 * inloggning ger fortfarande en synk; den behöver bara inte stå här också. */
export async function login(formData: FormData) {
  const supabase = await createClient();

  const { error } = await supabase.auth.signInWithPassword({
    email: formData.get("email") as string,
    password: formData.get("password") as string,
  });

  if (error) {
    redirect(`/login?error=${encodeURIComponent(error.message)}`);
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
