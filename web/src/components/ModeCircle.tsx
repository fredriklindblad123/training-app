import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { VIEW_MODE_COOKIE, type ViewMode } from "@/lib/view-mode";
import { circleButtonClass } from "@/components/ui/CircleButton";

/* Läget tränare/löpare som EN cirkel, i samma form som adepternas avatarer.
 *
 * Var tidigare två namngivna knappar i en sammanhållen kontroll, med
 * motiveringen att en av/på-switch kräver att man vet vad "på" betyder. Den
 * invändningen gäller fortfarande — och lösningen här är att cirkeln visar
 * det läge man ÄR i, med bokstav, precis som en adepts avatar visar vem som
 * är vald. Vad ett klick gör står i title.
 *
 * Server action och inte klientkod: att byta läge ÄR en serveråtgärd (cookie
 * + omrendering), och en form gör det utan en enda rad klientkod. Det gör
 * också att växeln fungerar innan JavaScript laddat.
 */
async function toggleMode(next: ViewMode) {
  "use server";
  const store = await cookies();
  store.set(VIEW_MODE_COOKIE, next, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Ett år: läget är en arbetsvana, inte en session.
    maxAge: 60 * 60 * 24 * 365,
  });
  // "layout" — hela trädet beror på läget: navigeringen, löparväljaren och
  // vilken användares data sidan hämtar.
  revalidatePath("/", "layout");
}

export function ModeCircle({ mode }: { mode: ViewMode }) {
  const isCoach = mode === "coach";
  const next: ViewMode = isCoach ? "runner" : "coach";

  return (
    <form action={toggleMode.bind(null, next)} className="flex">
      <button
        type="submit"
        title={
          isCoach
            ? "Tränarläge. Klicka för att se appen som löpare."
            : "Löparläge. Klicka för att gå tillbaka till tränarläget."
        }
        aria-label={isCoach ? "Tränarläge, växla till löparläge" : "Löparläge, växla till tränarläge"}
        className={`${circleButtonClass} text-sm font-bold ${
          isCoach ? "" : "border-[var(--foreground)] text-[var(--foreground)]"
        }`}
      >
        {isCoach ? "T" : "L"}
      </button>
    </form>
  );
}
