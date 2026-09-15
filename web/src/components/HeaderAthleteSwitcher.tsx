"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LinkPending } from "@/components/ui/LinkPending";
import { Dropdown } from "@/components/ui/Dropdown";

/* Löparväljaren i sidhuvudet.
 *
 * Låg fram till 2026-09-14 inuti varje sida, och hamnade därför på olika djup
 * överallt: direkt under rubriken på kalendersidorna, efter rubrik och text på
 * Dashboard, och tre element in på Årsplan — bakom både rubrik och
 * nyckeltalsrad. Att den flyttade sig när man bytte sida gjorde att man fick
 * leta efter den, trots att den är det man använder oftast.
 *
 * Nu en enda placering, bredvid lägesväxeln: valen som ändrar VEM och VAD DU
 * ÄR står tillsammans, skilda från navigeringen som ändrar VAR du är.
 *
 * Klientkomponent av nödvändighet — en layout får aldrig searchParams i App
 * Router, så den som ska bevara sidans övriga parametrar måste läsa dem på
 * klienten. Det är också vad som gör `buildHref` överflödig: länken byggs ur
 * nuvarande pathname plus nuvarande parametrar med `athlete` utbytt, vilket
 * bevarar sidans egna filter utan att varje sida behöver beskriva hur.
 *
 * Bara serialiserbara props (strängar och en array av strängar) — se
 * scripts/check-client-boundary.mjs för varför det är viktigt.
 */

type Athlete = { id: string; fullName: string | null };

/* Sidor som INTE har någon löparväljare alls (2026-09-15).
 *
 * Planeringsvyerna visar redan alla löpare sida vid sida — varje pass bär
 * sina egna löparchips, och veckorutnätet är byggt för att läsas på tvären
 * över hela gruppen. Väljaren erbjöd då att smalna av till en löpare, vilket
 * gör vyn sämre på det den finns för, och den kostade ett omladdat sidbygge
 * per klick.
 *
 * Löparen själv ser aldrig väljaren ändå (viewableAthletes ger bara en
 * coach mer än sig själv), så det här rör bara tränarens vy. */
const NO_SWITCHER_PATHS = ["/arsplan", "/blockplan", "/detaljplan", "/uppfoljning"];

export function HeaderAthleteSwitcher({
  athletes,
  defaultAthleteId,
}: {
  athletes: Athlete[];
  /** Vilken löpare sidan faller tillbaka på utan `?athlete=`. Räknas fram på
   * servern (resolveScopedUserId) — klienten kan inte känna till regeln. */
  defaultAthleteId: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  if (athletes.length === 0) return null;

  if (NO_SWITCHER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const raw = params.get("athlete");
  const active = raw ?? defaultAthleteId;

  /** Samma sida, samma filter, annan löpare. */
  const hrefFor = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("athlete", id);
    return `${pathname}?${next.toString()}`;
  };

  const pill = (on: boolean) =>
    `rounded-md px-2.5 py-1 font-medium transition-colors ${
      on
        ? "bg-[var(--foreground)] text-[var(--background)]"
        : "text-[var(--ink-2)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
    }`;

  // "Alla" fanns bara för planeringsvyerna, som inte har någon väljare kvar.
  const activeName = athletes.find((a) => a.id === active)?.fullName ?? "Löpare";

  return (
    <>
      {/* ---- Bred skärm: alla löpare utskrivna ---- */}
      <div
        role="group"
        aria-label="Välj löpare"
        className="display hidden flex-wrap items-center gap-1.5 text-sm lg:flex"
      >
        {athletes.map((a) => (
          <Link
            key={a.id}
            href={hrefFor(a.id)}
            aria-current={active === a.id ? "page" : undefined}
            className={pill(active === a.id)}
          >
            {a.fullName ?? "Namnlös"}
            <LinkPending />
          </Link>
        ))}
      </div>

      {/* ---- Smalare skärm: hopfälld, med den valda löparen i knappen ----
          Fem namnpills bredvid meny, uppdatering och lägesväxel spränger
          bredden långt före telefonstorlek. Hopfälld visar den ändå det enda
          man behöver veta i vilostadiet: VEM man tittar på.
          Dropdown sköter stängningen vid val — <details> gör det inte själv,
          och en klientnavigering nollställer den inte. */}
      <Dropdown label={activeName} align="left" width="w-48" className="lg:hidden">
        {athletes.map((a) => (
          <Link key={a.id} href={hrefFor(a.id)} className={`${pill(active === a.id)} block`}>
            {a.fullName ?? "Namnlös"}
          </Link>
        ))}
      </Dropdown>
    </>
  );
}
