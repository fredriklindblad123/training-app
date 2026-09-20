"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LinkPending } from "@/components/ui/LinkPending";
import { ClubMark } from "@/components/ClubMark";

/* Raden högst upp: VEM du tittar på och VEM du är.
 *
 * Allt är cirklar av samma storlek — adepterna och de tre handlingarna
 * (läge, uppdatera, logga ut). Det var uttryckligen begärt, och det är också
 * varför raden håller ihop: en rad där fyra element är cirklar och tre är
 * knappar med text läser som två olika saker som råkat hamna bredvid
 * varandra.
 *
 * Navigeringen ligger kvar i botten (BottomNav). Uppdelningen är: uppe ändrar
 * man sammanhang, nere byter man vy.
 *
 * Handlingarna skickas in som färdig markup. Två av dem är serverkomponenter
 * med egna serveråtgärder, och uppdateringen hämtar dessutom senaste
 * synktidpunkt — bara avatarerna behöver vara klient, eftersom de läser
 * adressen för att veta vem som är vald och när de ska döljas.
 */

/* Adepternas färger. Härledda ur id:t och därmed STABILA — samma person har
 * samma färg i varje vy, varje dag. En indexbaserad färg hade flyttat sig när
 * rostern ändras, och då betyder färgen ingenting.
 *
 * Tonerna skiljer sig i ljushet lika mycket som i kulör, så de går isär även
 * för den som inte skiljer rött från grönt. Mörk text på ljus platta, så
 * initialen är läsbar i båda teman. */
const AVATAR_TONES = ["#d98b5f", "#7fa9d4", "#b48fd0", "#86bf9a", "#d4a35f", "#c98fa0"];

function toneFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

/** Planeringsvyerna visar redan alla löpare sida vid sida — där finns inget
 * att välja mellan, och väljaren hade bara kunnat göra vyn sämre. */
/* Planeringsvyerna har ingen löparväljare. De visar hela gruppen — det är
 * tränarens arbetsyta, och att smalna av till en person gör vyn sämre på det
 * den finns för. Vill man analysera EN löpare gör man det i loggen.
 * /tavlingar tillkom 2026-09-17 och saknades här. */
const NO_ATHLETE_PICKER = [
  "/sasongsoversikt",
  "/blockplan",
  "/detaljplan",
  "/tavlingar",
  "/uppfoljning",
];

export function TopBar({
  athletes,
  defaultAthleteId,
  actions,
}: {
  athletes: { id: string; fullName: string | null }[];
  /** Vilken löpare sidorna faller tillbaka på utan `?athlete=`. Räknas fram
   * på servern (resolveScopedUserId) — klienten kan inte känna till regeln. */
  defaultAthleteId: string;
  actions: ReactNode;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const active = params.get("athlete") ?? defaultAthleteId;
  const showAthletes =
    athletes.length > 0 &&
    !NO_ATHLETE_PICKER.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  /** Samma sida, samma filter, annan löpare. */
  const hrefFor = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("athlete", id);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <header className="sticky top-0 z-40 flex items-center gap-2 border-b border-[var(--line)] bg-[var(--background)]/90 px-4 py-1.5 backdrop-blur sm:px-6">
      {/* Avsändaren först. Namnet döljs på små skärmar — där konkurrerar det
          med adeptväljaren om plats, och skölden ensam räcker som märke. */}
      <span className="mr-1 shrink-0">
        <span className="hidden sm:inline-flex">
          <ClubMark />
        </span>
        <span className="inline-flex sm:hidden">
          <ClubMark showName={false} />
        </span>
      </span>

      {showAthletes && (
        <div role="group" aria-label="Välj löpare" className="flex items-center gap-1.5">
          {athletes.map((a) => {
            const on = active === a.id;
            return (
              <Link
                key={a.id}
                href={hrefFor(a.id)}
                aria-current={on ? "page" : undefined}
                title={a.fullName ?? "Namnlös"}
                className="relative flex"
              >
                <span
                  className={`display flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-[#17191c] transition-all ${
                    on
                      ? "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--background)]"
                      : "opacity-55 hover:opacity-90"
                  }`}
                  style={{ backgroundColor: toneFor(a.id) }}
                >
                  {(a.fullName ?? "?").trim().charAt(0).toUpperCase() || "?"}
                </span>
                {/* En initial i en cirkel säger inget utan sammanhang. */}
                <span className="sr-only">{a.fullName ?? "Namnlös löpare"}</span>
                <LinkPending />
              </Link>
            );
          })}
        </div>
      )}

      {/* Handlingarna längst till höger, skilda från adepterna med en
          hårfin linje: de ändrar VEM DU ÄR, inte vem du tittar på. */}
      <div className="ml-auto flex items-center gap-1.5 border-l border-[var(--line)] pl-2.5">
        {actions}
      </div>
    </header>
  );
}
