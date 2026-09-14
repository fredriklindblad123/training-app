import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile } from "@/lib/auth-scope";
import {
  clearSyncGate,
  syncTargetsFromScope,
  triggerGarminSync,
} from "@/lib/garmin-sync";
import { RefreshGarminButton } from "@/components/RefreshGarminButton";

/* Manuell Garmin-uppdatering i sidhuvudet, med klockslag.
 *
 * Den automatiska synken går på varje sidvisning men är strypt till femton
 * minuter — rätt mot ett inofficiellt API, fel när man just kommit hem från
 * ett pass och vill se det nu. Då behövs en knapp som faktiskt gör det man
 * ber om.
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

export async function RefreshGarmin() {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);

  /* Klockslaget kommer från den SENASTE synken bland dem knappen ansvarar för.
   *
   * Senaste och inte äldsta, trots att äldsta vore det strängare måttet på
   * hur gammal datan kan vara: raden svarar på "hände något när jag tryckte",
   * och då måste den ändra sig direkt efter ett klick. Ett äldsta-värde hade
   * kunnat stå stilla när en adept saknar koppling helt, vilket får knappen
   * att se trasig ut av fel anledning.
   *
   * Bara tid, inte datum: står det ett klockslag betyder det i praktiken
   * alltid idag, och den som varit borta en vecka behöver inte veta minuten. */
  let lastSynced: string | null = null;
  if (scoped) {
    const { data } = await supabase
      .from("garmin_connections")
      .select("last_synced_at")
      .in("user_id", syncTargetsFromScope(scoped))
      .order("last_synced_at", { ascending: false, nullsFirst: false })
      .limit(1)
      .maybeSingle();
    lastSynced = (data?.last_synced_at as string | null) ?? null;
  }

  /* Tidszonen sätts explicit. Utan den formaterar servern i SIN zon — UTC på
     Vercel — så en synk 22:34 svensk tid hade visats som 20:34. Felet är
     lömskt eftersom det ser helt rimligt ut och stämmer på utvecklarens
     maskin, som kör lokal tid.
     Hårdkodad Europe/Stockholm och inte användarens zon: appen är byggd för en
     svensk träningsgrupp, och ett klockslag ska stämma med klockan på väggen
     där passet faktiskt sprangs. */
  const label = lastSynced
    ? new Date(lastSynced).toLocaleTimeString("sv-SE", {
        hour: "2-digit",
        minute: "2-digit",
        timeZone: "Europe/Stockholm",
      })
    : null;

  return (
    <form action={refresh} className="flex items-center gap-2">
      <RefreshGarminButton />
      {/* Tomt tillstånd får inte en platshållare: "aldrig synkad" är ett
          faktum värt att se, inte ett streck att tolka. */}
      <span className="tabular hidden text-xs text-[var(--ink-3)] sm:inline">
        {label ? `kl ${label}` : "aldrig synkad"}
      </span>
    </form>
  );
}
