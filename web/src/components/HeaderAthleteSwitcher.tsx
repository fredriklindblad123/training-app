"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LinkPending } from "@/components/ui/LinkPending";
import { Dropdown } from "@/components/ui/Dropdown";

/* Löparväljaren i sidhuvudet.
 *
 * Låg fram till 2026-09-14 inuti varje sida, och hamnade därför på olika djup
 * överallt: direkt under rubriken på kalendersidorna, efter rubrik och text på
 * Dashboard, och tre element in på Blockplan — bakom både rubrik och
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

/** Sidor där "Alla" betyder något: planeringsvyer som kan visa hela rostern
 * sida vid sida. En logg är per person och har ingen sådan vy. */
const OVERVIEW_PATHS = ["/blockplan", "/detaljplan"];

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

  const raw = params.get("athlete");
  const active = raw ?? defaultAthleteId;
  const showOverview = OVERVIEW_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));

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

  const activeName =
    active === "alla"
      ? "Alla"
      : (athletes.find((a) => a.id === active)?.fullName ?? "Löpare");

  return (
    <>
      {/* ---- Bred skärm: alla löpare utskrivna ---- */}
      <div
        role="group"
        aria-label="Välj löpare"
        className="display hidden flex-wrap items-center gap-1.5 text-sm lg:flex"
      >
        {showOverview && (
          <Link
            href={hrefFor("alla")}
            aria-current={active === "alla" ? "page" : undefined}
            className={pill(active === "alla")}
          >
            Alla
            <LinkPending />
          </Link>
        )}
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
      <Dropdown label={activeName} align="right" width="w-48" className="lg:hidden">
        {showOverview && (
          <Link href={hrefFor("alla")} className={`${pill(active === "alla")} block`}>
            Alla
          </Link>
        )}
        {athletes.map((a) => (
          <Link key={a.id} href={hrefFor(a.id)} className={`${pill(active === a.id)} block`}>
            {a.fullName ?? "Namnlös"}
          </Link>
        ))}
      </Dropdown>
    </>
  );
}
