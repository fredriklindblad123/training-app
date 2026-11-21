import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile } from "@/lib/auth-scope";
import { getViewMode } from "@/lib/view-mode";

/* Roten är bara en vägvisare.
 *
 * Här låg tidigare en landningssida med rubriken "Träningsapp" och en knapp
 * in i appen. Den fyllde ingen funktion: den inloggade fick klicka en extra
 * gång för att komma dit hen redan var på väg, och den utloggade fick en
 * mellansida före inloggningen som inte sa mer än inloggningssidan själv
 * gör. Appen är inte publik — det finns ingen besökare att välkomna, bara
 * användare på väg någonstans.
 *
 * Garmin-synken som låg på knappen behövdes inte heller. Den körs sedan
 * 2026-09-14 vid VARJE sidvisning i (app)/layout.tsx, alltså även för den
 * redirecten nedan landar på.
 */
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  /* Coachen startar på Gruppen, löparen på Idag (A3, 2026-11-21). Läget
   * "egen träning" gör coachen till löpare även här. */
  const scoped = await getScopedProfile(supabase);
  const runnerMode = (await getViewMode()) === "runner";
  redirect(scoped?.role === "coach" && !runnerMode ? "/gruppen" : "/dashboard");
}
