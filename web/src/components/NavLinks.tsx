"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/* Huvudmenyn, utbruten till en klientkomponent av ett enda skäl: en coach som
 * växlat löpare via ?athlete=-parametern (se lib/auth-scope.ts) ska inte
 * tappa det valet så fort hen klickar sig vidare till en annan sida i menyn
 * — layouten själv får aldrig searchParams (bara page.tsx gör det i App
 * Router), så det kräver antingen en klientkomponent eller en cookie. Detta
 * är det enklaste alternativet: samma URL-param-drivna mönster som redan
 * finns i /sasongen, bara återanvänt av menyn också. Sidor utan
 * löparväljare (en vanlig löpare, eller ingen coach) berörs inte — utan
 * `athlete` i URL:en blir länkarna identiska med innan. */

const navLinks = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/calendar", label: "Träningskalender" },
  { href: "/trender", label: "Trender" },
  { href: "/sasongen", label: "Säsongsplanering" },
  { href: "/flerarsplan", label: "Flerårsplan" },
  { href: "/tavlingsresultat", label: "Tävlingsresultat" },
  { href: "/settings", label: "Inställningar" },
];

/** "Översikt" (alla adepter sida vid sida, 2026-08-16 på uttrycklig begäran
 * — jobbigt att scrolla mellan varje löpares dashboard en och en) hör bara
 * hemma i menyn för en coach; en löpare har ingen adept att se en översikt
 * av. Ligger direkt efter Dashboard — det är precis det den ersätter för en
 * coach med flera löpare. */
const coachNavLink = { href: "/oversikt", label: "Översikt" };

export function NavLinks({ isCoach }: { isCoach: boolean }) {
  const pathname = usePathname();
  const athlete = useSearchParams().get("athlete");
  const links = isCoach ? [navLinks[0], coachNavLink, ...navLinks.slice(1)] : navLinks;

  return (
    <nav className="flex gap-4 text-sm font-medium">
      {links.map((link) => {
        const href = athlete ? `${link.href}?athlete=${athlete}` : link.href;
        const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={
              active
                ? "text-zinc-950 dark:text-zinc-50"
                : "text-zinc-700 hover:text-zinc-950 dark:text-zinc-300 dark:hover:text-zinc-50"
            }
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}
