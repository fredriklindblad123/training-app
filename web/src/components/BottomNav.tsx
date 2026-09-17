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

const LOGG: Tab[] = [
  { href: "/dashboard", label: "Idag", icon: "M4 13h5v7H4zM10 4h4v16h-4zM15 9h5v11h-5z" },
  { href: "/calendar", label: "Kalender", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { href: "/trender", label: "Form", icon: "M4 17l5-6 4 4 7-8" },
  /* "Resultat", inte "Lopp" (2026-09-17). Vyn är dit man går för att fylla i
   * vad det BLEV — själva loppen läggs upp av tränaren under Tävling. */
  { href: "/tavlingsresultat", label: "Resultat", icon: "M7 4v16M7 4h10l-2.5 3.5L17 11H7" },
];

/* Kortast horisont först, samma ordning som menyn hade: veckan man är i
 * öppnas dagligen, blocköversikten några gånger per säsong. */
const PLAN: Tab[] = [
  { href: "/detaljplan", label: "Vecka", icon: "M4 6h16v14H4zM4 10h16M9 14h6" },
  { href: "/blockplan", label: "Block", icon: "M4 5h16v4H4zM4 11h16v4H4zM4 17h10v3H4z" },
  { href: "/sasongsoversikt", label: "Säsong", icon: "M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6" },
  /* Tävlingarna är planering, inte logg: här bestämmer man VAD som ska
   * springas och av vem. Resultaten fylls i under Lopp i loggruppen. */
  { href: "/tavlingar", label: "Tävling", icon: "M8 21h8M12 17v4M6 4h12v4a6 6 0 0 1-12 0zM6 6H3v2a3 3 0 0 0 3 3M18 6h3v2a3 3 0 0 1-3 3" },
];

const UPPFOLJNING: Tab = {
  href: "/uppfoljning",
  label: "Uppföljn",
  icon: "M12 20a8 8 0 1 1 8-8M12 12l5-3",
};

const INSTALLNINGAR: Tab = {
  href: "/settings",
  label: "Inställn",
  icon: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM4 12h2M18 12h2M12 4v2M12 18v2",
};

export function BottomNav({
  isCoach,
  planOwnedByCoach,
  runnerMode,
}: {
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

  const planTabs = [...PLAN, ...(coaching ? [UPPFOLJNING] : []), INSTALLNINGAR];
  const loggTabs = showPlan ? LOGG : [...LOGG, INSTALLNINGAR];

  const isPlanPath = planTabs.some(
    (t) => pathname === t.href || pathname.startsWith(`${t.href}/`),
  );
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
    PLAN.some((p) => href === p.href) || href === UPPFOLJNING.href ? "" : loggSuffix;

  const groupPill = (on: boolean) =>
    `display rounded-full px-3 py-0.5 text-[0.65rem] font-bold tracking-[0.1em] uppercase transition-colors ${
      on
        ? "bg-[var(--foreground)] text-[var(--background)]"
        : "text-[var(--ink-3)] hover:text-[var(--foreground)]"
    }`;

  return (
    <div
      className="sticky bottom-0 z-40 flex flex-col items-center gap-1 border-t border-[var(--line)] bg-[var(--background)]/95 px-2 pt-1.5 backdrop-blur sm:border-0 sm:bg-transparent sm:pb-4 sm:backdrop-blur-none"
      /* Marginal för iPhones hemindikator. Utan den hamnar nedersta raden
         text under systemets streck. */
      style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
    >
      {showPlan && (
        <div
          role="group"
          aria-label="Välj grupp"
          className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-0.5"
        >
          {/* Växeln navigerar till gruppens första vy i stället för att sätta
              ett läge. Ingen växel utan mål: man ser direkt vad man fick. */}
          <Link href={`${LOGG[0].href}${loggSuffix}`} className={groupPill(!isPlanPath)}>
            Logg
          </Link>
          <Link href={PLAN[0].href} className={groupPill(isPlanPath)}>
            Plan
          </Link>
        </div>
      )}

      <nav
        aria-label={showPlan && isPlanPath ? "Planering" : "Logg"}
        className="flex w-full sm:mx-auto sm:w-fit sm:gap-1 sm:rounded-full sm:border sm:border-[var(--line)] sm:bg-[var(--background)]/95 sm:px-2 sm:py-0.5 sm:shadow-lg sm:backdrop-blur"
      >
        {tabs.map((t) => {
          const on = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={`${t.href}${suffixFor(t.href)}`}
              aria-current={on ? "page" : undefined}
              className={`flex flex-1 flex-col items-center gap-0.5 rounded-lg py-1 transition-colors sm:min-w-20 sm:flex-none ${
                on
                  ? "bg-[var(--surface-raised)] text-[var(--foreground)] sm:rounded-full"
                  : "text-[var(--ink-3)] hover:text-[var(--foreground)]"
              }`}
            >
              <svg
                viewBox="0 0 24 24"
                className="h-5 w-5"
                fill="none"
                stroke="currentColor"
                strokeWidth={on ? 2.2 : 1.7}
                strokeLinecap="round"
                strokeLinejoin="round"
                aria-hidden
              >
                <path d={t.icon} />
              </svg>
              <span className="display text-[0.65rem] font-semibold tracking-[0.06em] uppercase">
                {t.label}
              </span>
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
