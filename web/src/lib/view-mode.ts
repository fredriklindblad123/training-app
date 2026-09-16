import { cookies } from "next/headers";
import { cache } from "react";

/* Tränarläge eller löparläge, för den som är båda.
 *
 * Fredrik och Daniel coachar adepter OCH tränar själva. Fram till 2026-09-14
 * låg den egna träningen som en rad i löparväljaren ("Jag själv"), och därefter
 * kort som en menylänk ("Min träning"). Båda var otydliga av samma skäl: de
 * såg ut som ett VAL AV LÖPARE när det i själva verket är ett byte av roll.
 * Man klickar inte på sig själv i en lista över sina adepter.
 *
 * Nu ett läge i stället, med en synlig växel i sidhuvudet:
 *
 *   Tränare — hela menyn, löparväljaren, planering. Det man gör FÖR någon.
 *   Löpare  — exakt samma vy som en adept har: bara Logg, bara egen data,
 *             ingen väljare. Det man gör SJÄLV.
 *
 * Att planering saknas i löparläget är avsiktligt och inte en förlust: en
 * tränare som vill lägga upp sitt eget block gör det i tränarläget, där blocket
 * kan tilldelas "Jag själv" (se assignableAthletes i lib/auth-scope.ts). Lägena
 * delar alltså data men skiljer på arbetsuppgift — planera respektive utföra.
 *
 * Bärs av en cookie, inte av en query-parameter. Läget är en varaktig
 * inställning och ska överleva varje navigering utan att varje länk i appen
 * behöver skriva om sig — det är precis det `?athlete=` redan tvingar BottomNav
 * att göra, och det vill vi inte ha två av.
 */

export type ViewMode = "coach" | "runner";

export const VIEW_MODE_COOKIE = "traningsapp_lage";

/** Läget för den här requesten. Memoiserat av samma skäl som
 * getScopedProfile: layouten och sidan frågar båda. */
export const getViewMode = cache(async function getViewMode(): Promise<ViewMode> {
  const store = await cookies();
  // Tränarläge är standard. En coach som loggar in första gången ska se sina
  // adepter — det är därför hen har kontot.
  return store.get(VIEW_MODE_COOKIE)?.value === "runner" ? "runner" : "coach";
});
