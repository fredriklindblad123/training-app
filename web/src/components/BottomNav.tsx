"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LinkPending } from "@/components/ui/LinkPending";
import { Dropdown } from "@/components/ui/Dropdown";

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
 * ALLT bor här sedan 2026-09-16: navigering, vilken adept man tittar på, och
 * kontot med lägesväxel, Garmin-uppdatering och utloggning. Sidhuvudet är
 * borttaget helt. Det bar till slut bara identitet, och att hålla en klistrad
 * rad högst upp för tre kontroller man rör några gånger om dagen kostade
 * skärmhöjd på varje sida.
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
const NO_ATHLETE_PICKER = ["/blockoversikt", "/blockplan", "/detaljplan", "/uppfoljning"];

type Tab = { href: string; label: string; icon: string };

const LOGG: Tab[] = [
  { href: "/dashboard", label: "Idag", icon: "M4 13h5v7H4zM10 4h4v16h-4zM15 9h5v11h-5z" },
  { href: "/calendar", label: "Kalender", icon: "M4 6h16v14H4zM4 10h16M8 3v4M16 3v4" },
  { href: "/trender", label: "Form", icon: "M4 17l5-6 4 4 7-8" },
  { href: "/tavlingsresultat", label: "Lopp", icon: "M7 4v16M7 4h10l-2.5 3.5L17 11H7" },
];

/* Kortast horisont först, samma ordning som menyn hade: veckan man är i
 * öppnas dagligen, blocköversikten några gånger per säsong. */
const PLAN: Tab[] = [
  { href: "/detaljplan", label: "Vecka", icon: "M4 6h16v14H4zM4 10h16M9 14h6" },
  { href: "/blockplan", label: "Block", icon: "M4 5h16v4H4zM4 11h16v4H4zM4 17h10v3H4z" },
  { href: "/blockoversikt", label: "År", icon: "M4 19V5M4 19h16M8 15v-4M12 15V8M16 15v-6" },
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
  athletes,
  defaultAthleteId,
  account,
}: {
  isCoach: boolean;
  /** Adept med länkad tränare — då ägs planeringen av någon annan. */
  planOwnedByCoach: boolean;
  /** Coachen tittar på sin EGEN träning och ska se exakt samma vyer som en
   * adept. */
  runnerMode: boolean;
  /** Adepterna en tränare kan växla mellan. Tom för en löpare. */
  athletes: { id: string; fullName: string | null }[];
  /** Vilken löpare sidorna faller tillbaka på utan `?athlete=`. Räknas fram
   * på servern (resolveScopedUserId) — klienten kan inte känna till regeln. */
  defaultAthleteId: string;
  /* Kontots innehåll: adress, lägesväxel, Garmin-uppdatering och utloggning.
   *
   * Skickas in som färdig markup i stället för att byggas här, eftersom två av
   * delarna är serverkomponenter med egna serveråtgärder — uppdateringen
   * hämtar dessutom senaste synktidpunkt. Bara den utfällbara ramen behöver
   * vara klient. */
  account: ReactNode;
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

  /* Löparvalet följer med mellan vyerna. Utan det skulle en tränare som
     tittar på Alices kalender och trycker "Form" landa på sin egen. */
  const athlete = params.get("athlete");
  const suffix = athlete ? `?athlete=${athlete}` : "";

  const groupPill = (on: boolean) =>
    `display rounded-full px-3 py-0.5 text-[0.65rem] font-bold tracking-[0.1em] uppercase transition-colors ${
      on
        ? "bg-[var(--foreground)] text-[var(--background)]"
        : "text-[var(--ink-3)] hover:text-[var(--foreground)]"
    }`;

  const activeAthlete = params.get("athlete") ?? defaultAthleteId;
  const showAthletes =
    athletes.length > 0 &&
    !NO_ATHLETE_PICKER.some((p) => pathname === p || pathname.startsWith(`${p}/`));

  /** Samma sida, samma filter, annan löpare. */
  const athleteHref = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("athlete", id);
    return `${pathname}?${next.toString()}`;
  };

  return (
    <div
      className="sticky bottom-0 z-40 flex flex-col items-center gap-1 border-t border-[var(--line)] bg-[var(--background)]/95 px-2 pt-1.5 backdrop-blur sm:border-0 sm:bg-transparent sm:pb-4 sm:backdrop-blur-none"
      /* Marginal för iPhones hemindikator. Utan den hamnar nedersta raden
         text under systemets streck. */
      style={{ paddingBottom: "calc(0.375rem + env(safe-area-inset-bottom))" }}
    >
      {/* Översta raden: VEM du tittar på, och VILKEN grupp du är i. Två frågor
          av samma sort — de ändrar sammanhanget, inte vilken vy du står i —
          och de hör därför ihop, skilda från flikarna nedanför. */}
      <div className="flex w-full items-center justify-center gap-2 sm:w-auto">
        {showAthletes && (
          <div role="group" aria-label="Välj löpare" className="flex items-center gap-1">
            {athletes.map((a) => {
              const on = activeAthlete === a.id;
              return (
                <Link
                  key={a.id}
                  href={athleteHref(a.id)}
                  aria-current={on ? "page" : undefined}
                  title={a.fullName ?? "Namnlös"}
                  className="relative flex"
                >
                  <span
                    className={`display flex h-7 w-7 items-center justify-center rounded-full text-xs font-bold text-[#17191c] transition-all ${
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

        {showPlan && (
        <div
          role="group"
          aria-label="Välj grupp"
          className="flex items-center gap-1 rounded-full border border-[var(--line)] bg-[var(--surface)] p-0.5"
        >
          {/* Växeln navigerar till gruppens första vy i stället för att sätta
              ett läge. Ingen växel utan mål: man ser direkt vad man fick. */}
          <Link href={`${LOGG[0].href}${suffix}`} className={groupPill(!isPlanPath)}>
            Logg
          </Link>
          <Link href={`${PLAN[0].href}${suffix}`} className={groupPill(isPlanPath)}>
            Plan
          </Link>
        </div>
        )}

        {/* Kontot sist på raden, öppnar uppåt. Lägesväxel, Garmin-uppdatering
            och utloggning rör man några gånger om dagen — de ska vara nåbara,
            inte framme. */}
        <Dropdown
          openUp
          align="right"
          width="w-60"
          label={
            <span
              aria-hidden
              className="display flex h-6 w-6 items-center justify-center rounded-full bg-[var(--surface-raised)] text-[0.7rem] font-bold text-[var(--foreground)]"
            >
              ···
            </span>
          }
        >
          {account}
        </Dropdown>
      </div>

      <nav
        aria-label={showPlan && isPlanPath ? "Planering" : "Logg"}
        className="flex w-full sm:mx-auto sm:w-fit sm:gap-1 sm:rounded-full sm:border sm:border-[var(--line)] sm:bg-[var(--background)]/95 sm:px-2 sm:py-0.5 sm:shadow-lg sm:backdrop-blur"
      >
        {tabs.map((t) => {
          const on = pathname === t.href || pathname.startsWith(`${t.href}/`);
          return (
            <Link
              key={t.href}
              href={`${t.href}${suffix}`}
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
