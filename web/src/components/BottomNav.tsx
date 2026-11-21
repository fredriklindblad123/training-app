"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/* Hela navigeringen, längst ned (2026-09-16).
 *
 * Ersätter menyn i sidhuvudet helt. Den låg längst bort från tummen, och på
 * telefon var den dessutom hopfälld — ett klick för att öppna, ett för att
 * välja, före varje byte av vy.
 *
 * TVÅ NIVÅER, och det är nödvändigt. En tränare har åtta vyer. Åtta flikar på
 * en telefon ger fem millimeter breda träffytor, och att låta raden rulla i
 * sidled gör att hälften aldrig syns — man vet inte ens att de finns. Därför
 * en smal gruppväxel överst och gruppens vyer under: man ser alltid att båda
 * grupperna finns, och vilken man står i.
 *
 * Gruppen HÄRLEDS ur adressen i stället för att sparas som tillstånd. Står man
 * på en planeringssida visas planeringsgruppen. Det betyder att raden alltid
 * stämmer med sidan — även efter en omladdning, en delad länk eller ett
 * bakåtsteg, vilket sparat tillstånd inte klarar utan att kunna hamna i otakt.
 *
 * En löpare med tränare ser ingen växel alls, bara sina loggvyer: hon äger
 * inte planeringen (se canEditPlanning), och en grupp med fyra sidor där varje
 * knapp är borttagen är mest förvirrande.
 *
 * Ikonerna är SVG och inte emoji — emoji renderas olika i varje operativsystem,
 * och en rad där en ikon är platt och nästa är en färgglad figur ser trasig ut.
 *
 * Bara navigering. Adepterna, lägesväxeln, uppdateringen och utloggningen bor
 * i toppraden (TopBar) — uppdelningen är att man uppe ändrar SAMMANHANG och
 * nere byter VY. De låg en kort stund allihop här nere, och raden blev då en
 * samling knappar utan inbördes ordning.
 */


type Tab = { href: string; label: string; icon: string };

/* Löparens fem vyer (2026-11-21, A3): Alice är den som använder appen mest,
 * och hennes rad ska bara innehålla det hon själv läser. "Lopp" i stället
 * för "Resultat": sidan visar nu nästa lopp och personbästa överst, inte
 * bara en resultatlista. "Blocket" i stället för "Analys": sidan börjar med
 * blockets bokslut och är blocket i siffror. */
const LOGG: Tab[] = [
  { href: "/dashboard", label: "Idag", icon: "M4 13h5v7H4zM10 4h4v16h-4zM15 9h5v11h-5z" },
  { href: "/calendar", label: "Kalender", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { href: "/trender", label: "Form", icon: "M4 17l5-6 4 4 7-8" },
  { href: "/tavlingsresultat", label: "Lopp", icon: "M7 4v16M7 4h10l-2.5 3.5L17 11H7" },
  { href: "/analys", label: "Blocket", icon: "M4 20h16M7 16v-5M12 16V7M17 16v-8" },
];

/* Kortast horisont först, samma ordning som menyn hade: veckan man är i
 * öppnas dagligen, blocköversikten några gånger per säsong. */
const GRUPPEN: Tab = {
  href: "/gruppen",
  label: "Gruppen",
  icon: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M17 11a2.5 2.5 0 1 0 0-5M21 20a5 5 0 0 0-4-4.9",
};

const PLAN: Tab[] = [
  { href: "/detaljplan", label: "Vecka", icon: "M4 6h16v14H4zM4 10h16M9 14h6" },
  { href: "/blockplan", label: "Block", icon: "M4 5h16v4H4zM4 11h16v4H4zM4 17h10v3H4z" },
  { href: "/sasongsoversikt", label: "Säsong", icon: "M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6" },
  /* Tävlingarna är planering, inte logg: här bestämmer man VAD som ska
   * springas och av vem. Resultaten fylls i under Lopp i loggruppen. */
  { href: "/tavlingar", label: "Tävling", icon: "M8 21h8M12 17v4M6 4h12v4a6 6 0 0 1-12 0zM6 6H3v2a3 3 0 0 0 3 3M18 6h3v2a3 3 0 0 1-3 3" },
];

/* Uppföljning är coachens egen flik (åter 2026-11-21, begärt): plan mot
 * utfall för alla löpare är en egen fråga, inte en länk från Gruppen.
 * Inställningar nås från toppraden men räknas till planeringsgruppen. */
const UPPFOLJNING: Tab = {
  href: "/uppfoljning",
  label: "Uppföljning",
  icon: "M12 20a8 8 0 1 1 8-8M12 12l5-3",
};
const PLAN_EXTRA = ["/settings", "/flerarsplan"];

export function BottomNav({
  isCoach,
  planOwnedByCoach,
  runnerMode,
  athletes = [],
}: {
  /** Coachens löpare — för namnet i raden "‹ Gruppen · Alice". */
  athletes?: { id: string; fullName: string | null }[];
  isCoach: boolean;
  /** Adept med länkad tränare — då ägs planeringen av någon annan. */
  planOwnedByCoach: boolean;
  /** Coachen tittar på sin EGEN träning och ska se exakt samma vyer som en
   * adept. */
  runnerMode: boolean;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  const coaching = isCoach && !runnerMode;
  const showPlan = coaching || (!isCoach && !planOwnedByCoach);

  const planTabs = coaching ? [GRUPPEN, ...PLAN, UPPFOLJNING] : PLAN;
  const loggTabs = LOGG;

  const isPlanPath =
    planTabs.some((t) => pathname === t.href || pathname.startsWith(`${t.href}/`)) ||
    (coaching && PLAN_EXTRA.some((h) => pathname === h || pathname.startsWith(`${h}/`)));
  const tabs = showPlan && isPlanPath ? planTabs : loggTabs;

  /* Löparvalet följer med mellan LOGGVYERNA, aldrig in i planeringen.
   *
   * Loggen är per person: tittar man på Alices kalender och trycker "Form"
   * ska man få Alices form, inte sin egen.
   *
   * Planeringen är tvärtom hela gruppens. Det är tränarens arbetsyta — han
   * lägger upp block och veckor för alla, även om inte varje pass gäller
   * alla. Vill han analysera EN löpare gör han det i loggen.
   *
   * Att bära med parametern hit var ett verkligt fel: valde man Alice i
   * loggen och tryckte "Block" landade man på /blockplan?athlete=<alice>,
   * som slog över till enskild-löpar-vyn. Passen tappade sina löparchips och
   * ett öppnat pass visade bara Alice. Rapporterat. */
  const athlete = params.get("athlete");
  const loggSuffix = athlete ? `?athlete=${athlete}` : "";
  const suffixFor = (href: string) =>
    PLAN.some((p) => href === p.href) || href === GRUPPEN.href || href === UPPFOLJNING.href ? "" : loggSuffix;

  /* Ingen Logg/Plan-växel sedan 2026-11-21 (ny UX). Coachen startar på
     Gruppen och öppnar en löpare därifrån; står hon på en löpares sida visas
     en rad med löparens namn och vägen tillbaka till Gruppen. En löpare som
     planerar själv (ingen tränare) får i stället en länk till planeringen. */
  const athleteName = athletes.find((a) => a.id === athlete)?.fullName ?? null;
  const tab = (t: Tab) => {
    const on = pathname === t.href || pathname.startsWith(`${t.href}/`);
    return (
      <Link
        key={t.href}
        href={`${t.href}${suffixFor(t.href)}`}
        aria-current={on ? "page" : undefined}
        className={`flex min-h-12 flex-1 flex-col items-center justify-center gap-0.5 rounded-[10px] py-1.5 transition-colors sm:min-w-24 sm:flex-none ${
          on ? "bg-[var(--surface-raised)] font-bold text-[var(--foreground)]" : "text-[var(--ink-2)] hover:text-[var(--foreground)]"
        }`}
      >
        <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={on ? 2.1 : 1.7} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <path d={t.icon} />
        </svg>
        <span className={tabs.length > 5 ? "text-[0.6875rem] leading-tight" : "text-xs"}>{t.label}</span>
      </Link>
    );
  };

  return (
    <div
      className="sticky bottom-0 z-40 border-t border-[var(--line)] bg-[var(--background)]"
      /* Marginal för iPhones hemindikator. */
      style={{ paddingBottom: "calc(0.5rem + env(safe-area-inset-bottom))" }}
    >
      {coaching && !isPlanPath && (
        <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-1.5 text-sm">
          <Link href="/gruppen" className="flex min-h-8 items-center text-[var(--ink-2)] hover:text-[var(--foreground)]">
            ‹ Gruppen
          </Link>
          {athleteName && <span className="font-semibold text-[var(--foreground)]">{athleteName}</span>}
        </div>
      )}
      {showPlan && !coaching && (
        <div className="flex justify-end border-b border-[var(--line)] px-4 py-1.5 text-sm">
          <Link href={isPlanPath ? LOGG[0].href : PLAN[0].href} className="flex min-h-8 items-center text-[var(--ink-2)] hover:text-[var(--foreground)]">
            {isPlanPath ? "‹ Min träning" : "Planering ›"}
          </Link>
        </div>
      )}
      <nav
        aria-label={isPlanPath ? "Planering" : "Träning"}
        className="mx-auto flex w-full max-w-3xl gap-1 px-1 pt-2"
      >
        {tabs.map(tab)}
      </nav>
    </div>
  );
}
