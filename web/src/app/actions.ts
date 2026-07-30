"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { triggerGarminSync } from "@/lib/garmin-sync";

/** Klick på "Till appen" på startsidan. Synken körs schemalagt varje natt
 * (05:00 UTC, se vercel.json), men det gör datan upp till ett dygn gammal
 * när man öppnar appen efter ett pass — därför en synk till, best-effort,
 * innan dashboarden visas. Misslyckas den (inget Garmin-konto anslutet,
 * behöver återautentiseras, nätverksfel) ska det aldrig blockera vägen in i
 * appen, bara lämna datan som den var — felet syns redan på /settings. */
export async function enterApp() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  try {
    await triggerGarminSync(user.id);
  } catch {
    // Synkas ändå på schemat, eller vid nästa klick.
  }

  redirect("/dashboard");
}
