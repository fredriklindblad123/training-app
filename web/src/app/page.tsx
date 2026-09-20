import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

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

  redirect(user ? "/dashboard" : "/login");
}
