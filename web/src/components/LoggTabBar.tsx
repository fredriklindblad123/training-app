"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/* Tabbrad i botten, bara på telefon.
 *
 * Menyn låg i sidhuvudet, alltså längst bort från tummen. Det är därför i
 * princip varje app den här målgruppen använder dagligen har sina flikar
 * nedtill — man ska kunna byta vy med handen där den redan är.
 *
 * Bara loggvyerna. Planeringen är tränarens arbete och görs sittande vid en
 * skärm; att lägga sex vyer i en tabbrad hade gett fem millimeter breda
 * träffytor. Plan-gruppen ligger kvar i sidhuvudet, som fortsätter finnas.
 *
 * Dold från lg och uppåt: på en bred skärm är sidhuvudets meny bättre, och
 * två menyer samtidigt är en meny för mycket.
 *
 * Ikonerna är ritade som SVG och inte som emoji — emoji renderas olika i
 * varje operativsystem, och en rad där en ikon är platt och nästa är en
 * färgglad 3D-figur ser trasig ut.
 */

const TABS = [
  { href: "/dashboard", label: "Idag", icon: "M4 13h5v7H4zM10 4h4v16h-4zM15 9h5v11h-5z" },
  { href: "/calendar", label: "Kalender", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { href: "/trender", label: "Form", icon: "M4 17l5-6 4 4 7-8" },
  { href: "/tavlingsresultat", label: "Lopp", icon: "M7 4v16M7 4h10l-2.5 3.5L17 11H7" },
];

export function LoggTabBar() {
  const pathname = usePathname();
  const params = useSearchParams();

  /* Löparvalet följer med mellan flikarna. Utan det skulle en tränare som
     tittar på Alices kalender och trycker "Form" landa på sin egen. Samma
     regel som NavLinks redan följer. */
  const athlete = params.get("athlete");
  const suffix = athlete ? `?athlete=${athlete}` : "";

  return (
    <nav
      aria-label="Logg"
      className="sticky bottom-0 z-40 flex border-t border-[var(--line)] bg-[var(--background)]/95 px-2 pt-1.5 backdrop-blur lg:hidden"
      /* Marginal för iPhones hemindikator. Utan den hamnar den nedersta
         raden text under systemets streck. */
      style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
    >
      {TABS.map((t) => {
        const on = pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link
            key={t.href}
            href={`${t.href}${suffix}`}
            aria-current={on ? "page" : undefined}
            className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 transition-colors ${
              on ? "text-[var(--foreground)]" : "text-[var(--ink-3)]"
            }`}
          >
            <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor"
              strokeWidth={on ? 2.2 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={t.icon} />
            </svg>
            <span className="display text-[0.65rem] font-semibold tracking-[0.06em] uppercase">
              {t.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
