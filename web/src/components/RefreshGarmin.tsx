import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile } from "@/lib/auth-scope";
import {
  clearSyncGate,
  syncTargetsFromScope,
  triggerGarminSync,
} from "@/lib/garmin-sync";

/* Manuell Garmin-uppdatering i sidhuvudet.
 *
 * Den automatiska synken går på varje sidvisning men är strypt till femton
 * minuter — vilket är rätt för att skydda ett inofficiellt API, men fel när
 * man just kommit hem från ett pass och vill se det NU. Då behövs en knapp
 * som faktiskt gör det man ber om.
 *
 * Skillnaden mot automatiken är att den här struntar i strypningen helt:
 * användaren har uttryckligen bett om färsk data. Samma val som "Synka nu" på
 * Inställningar redan gjorde — men den knappen synkar bara den inloggade, och
 * en tränare som klickar den för att se Alices pass blir förvånad. Den här
 * synkar hela ens ansvar: sig själv och sina adepter.
 *
 * Till skillnad från automatiken VÄNTAR den här in synken innan sidan laddas
 * om. Det är avsiktligt: trycker man på en uppdatera-knapp vill man se
 * resultatet, inte få tillbaka samma siffror och undra om det hände något.
 */

async function refresh() {
  "use server";
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return;

  const targets = syncTargetsFromScope(scoped);
  // Grinden i minnet skulle annars kunna hoppa över en användare som nyss
  // synkades automatiskt — och då hade knappen känts trasig.
  clearSyncGate(targets);

  // Inget minIntervalMinutes: manuell begäran stryps aldrig.
  await Promise.allSettled(targets.map((id) => triggerGarminSync(id)));
  revalidatePath("/", "layout");
}

export function RefreshGarmin() {
  return (
    <form action={refresh}>
      <button
        type="submit"
        title="Hämta senaste träningsdata från Garmin för dig och dina adepter"
        className="display rounded-md border border-[var(--line)] px-2.5 py-1 text-sm font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
      >
        Uppdatera
      </button>
    </form>
  );
}
