"use server";

import { redirect } from "next/navigation";
import { after } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { resolveSyncTargets, triggerGarminSyncForAll } from "@/lib/garmin-sync";

/** Klick på "Till appen" på startsidan. Synken körs schemalagt varje natt
 * (05:00 UTC, se vercel.json), men det gör datan upp till ett dygn gammal
 * när man öppnar appen efter ett pass — därför en synk till, best-effort,
 * på varje klick. Den får aldrig blockera vägen in i appen: ett Garmin-anrop
 * tar flera sekunder (inloggning + aktiviteter + varv + sömn mot Garmins
 * servrar), och att invänta det innan redirect gjorde appen märkbart trög
 * att öppna. `after()` skjuter i stället upp synken till efter att svaret
 * (redirecten) redan skickats — Vercel håller funktionen vid liv i
 * bakgrunden tills den är klar, utan att användaren väntar på den. */
export async function enterApp() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  // Samma målgrupp som vid inloggning (se app/login/actions.ts): en tränare
  // synkar sig själv och sina adepter, en löpare bara sig själv. Räknas ut
  // före after(), medan Supabase-klienten fortfarande lever.
  let targets: string[];
  try {
    targets = await resolveSyncTargets(supabase, user.id);
  } catch {
    targets = [user.id];
  }

  after(async () => {
    try {
      await triggerGarminSyncForAll(targets);
    } catch {
      // Synkas ändå på schemat, eller vid nästa klick.
    }
  });

  redirect("/dashboard");
}
