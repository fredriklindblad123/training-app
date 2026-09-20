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

/* Kontoförfrågan från inloggningssidan.
 *
 * Registrering är spärrad av auth-hooken hook_restrict_signup_by_email: bara
 * adresser i allowed_signup_emails släpps igenom. Den som hittar appen själv
 * har alltså ingen väg in utan att en coach först lagt till adressen — förut
 * fick man bara ett obegripligt fel. Det här är vägen: förfrågan skrivs utan
 * inloggning, en coach godkänner under Inställningar.
 *
 * Samtycket kontrolleras även i databasens INSERT-policy. En kryssruta som
 * går att kringgå genom att posta formuläret direkt är inget samtycke, och
 * adepterna är 15–18 år.
 */
export async function requestAccount(formData: FormData) {
  const supabase = await createClient();

  const fullName = ((formData.get("full_name") as string | null) ?? "").trim();
  const email = ((formData.get("email") as string | null) ?? "").trim();
  const consent = formData.get("guardian_consent") === "on";

  if (!fullName || !email) {
    redirect(`/login?error=${encodeURIComponent("Fyll i namn och e-post.")}`);
  }
  if (!consent) {
    redirect(
      `/login?error=${encodeURIComponent("Målsmans samtycke krävs för att skicka en förfrågan.")}`,
    );
  }

  const birthYearRaw = ((formData.get("birth_year") as string | null) ?? "").trim();
  const birthYear = birthYearRaw ? Number(birthYearRaw) : null;

  const { error } = await supabase.from("signup_requests").insert({
    full_name: fullName,
    email,
    birth_year: Number.isFinite(birthYear) ? birthYear : null,
    guardian_name: ((formData.get("guardian_name") as string | null) ?? "").trim() || null,
    guardian_email: ((formData.get("guardian_email") as string | null) ?? "").trim() || null,
    guardian_consent: true,
    note: ((formData.get("note") as string | null) ?? "").trim() || null,
    status: "vantar",
  });

  if (error) {
    // Unikindexet på väntande adress ger 23505. Att säga "du har redan
    // skickat" är mer användbart än databasens text.
    const message = error.code === "23505"
      ? "Det finns redan en förfrågan för den adressen. Den väntar på svar."
      : "Kunde inte skicka förfrågan just nu. Försök igen om en stund.";
    redirect(`/login?error=${encodeURIComponent(message)}`);
  }

  redirect(
    `/login?message=${encodeURIComponent(
      "Tack! Din förfrågan har skickats. Du får besked per e-post när den behandlats.",
    )}`,
  );
}
