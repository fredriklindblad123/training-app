"use server";

import { createClient } from "@/lib/supabase/server";
import { getScopedProfile } from "@/lib/auth-scope";
import { garminSyncState, syncTargetsFromScope } from "@/lib/garmin-sync";

/** Senaste synktidpunkten bland den inloggades synkansvar (sig själv, och
 * för en tränare även adepterna). Frågas av GarminSyncWatcher medan en
 * bakgrundssynk pågår. Vilka användare som räknas avgörs här på servern, ur
 * den inloggades egen behörighet — klienten skickar ingenting. */
export async function latestGarminSync(): Promise<string | null> {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  return (await garminSyncState(supabase, syncTargetsFromScope(scoped))).latest;
}
