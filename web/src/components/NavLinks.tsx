"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";

/* Huvudmenyn, utbruten till en klientkomponent av ett enda skäl: en coach som
 * växlat löpare via ?athlete=-parametern (se lib/auth-scope.ts) ska inte
 * tappa det valet så fort hen klickar sig vidare till en annan sida i menyn
 * — layouten själv får aldrig searchParams (bara page.tsx gör det i App
 * Router), så det kräver antingen en klientkomponent eller en cookie. Detta
 * är det enklaste alternativet: samma URL-param-drivna mönster som redan
 * finns i /arsplan, bara återanvänt av menyn också. Sidor utan
 * löparväljare (en vanlig löpare, eller ingen coach) berörs inte — utan
 * `athlete` i URL:en blir länkarna identiska med innan.
 *
 * ---------------------------------------------------------------------------
 * Gruppering efter roll (2026-08-27, uttrycklig begäran)
 *
 * Menyn låg tidigare som en enda rad av åtta jämnstora länkar. Problemet var
 * inte att någon sida var överflödig — det utreddes och avfärdades med data:
 * 94 % av aktiviteterna och 96 % av dagboksinläggen ligger utanför varje
 * säsongsblock, och eftersom /arsplan och /detaljplan bara spänner blockens
 * datum kan de strukturellt inte nå den historiken. Kalendern är alltså inte
 * en dubblett av planeringen.
 *
 * Problemet var att menyn inte sa VILKEN sorts fråga varje sida svarar på.
 * Därför två namngivna grupper:
 *
 *   LOGG  — vad hände. Lever på `activities` (Garmin-synkade) och
 *           `diary_entries`, täcker alla datum oavsett planering.
 *   PLAN  — vad ska hända. Lever på `planned_workouts`/`season_blocks`,
 *           avgränsat till blocken, och ägs av coachen (se canEditPlanning).
 *
 * Grupperna följer rollerna utan att låsa dem: en adept med tränare ser hela
 * PLAN-gruppen, men skrivskyddad — se kommentaren vid canEditPlanning i
 * lib/auth-scope.ts och motiveringen i arsplan/page.tsx (löparen ska se vad
 * som väntar). Att dölja gruppen för adepten vore alltså fel; att märka den
 * som tränarens är rätt. Det är vad `planOwnedByCoach` gör: gruppen heter
 * "Plan · från din tränare" för en adept som har en coach, så att
 * skrivskyddet är förklarat INNAN hon klickar sig in och undrar var
 * knapparna tog vägen. En självcoachad löpare (ingen coach länkad) äger sin
 * egen planering och ska inte få suffixet — därför speglar propen
 * `canEditPlanning()` exakt, inte `role`.
 *
 * Suffixet är medvetet gemener mitt i en versal gruppetikett: det är en
 * upplysning, inte en till rubrik, och docs/tranarloopen.md avsnitt 6 är
 * styrande för tonen — appen säger "det här är tränarens plan", aldrig "du
 * får inte redigera".
 *
 * Inställningar står utanför båda grupperna med flit — den är kontoadmin,
 * inte en fråga om träningen. */

type NavItem = { href: string; label: string };

const LOGG: NavItem[] = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/calendar", label: "Träningskalender" },
  { href: "/trender", label: "Trender" },
  { href: "/tavlingsresultat", label: "Tävlingsresultat" },
];

/** Längst horisont först — flerårsplanen sätter ramen som säsongen bryts ner
 * i, som i sin tur bryts ner i veckornas innehåll. Låg tidigare i ordningen
 * Årsplan · Detaljplan · Flerårsplan, vilket läste som att flerårsplanen var
 * en detalj av detaljplanen. */
const PLAN: NavItem[] = [
  { href: "/flerarsplan", label: "Flerårsplan" },
  { href: "/arsplan", label: "Årsplan" },
  { href: "/detaljplan", label: "Detaljplan" },
];

/** "Uppföljning" (2026-08-27): tränarens statistiksida — alla löpare sida
 * vid sida, per block/månad/vecka/dag. Hör bara hemma i menyn för en coach;
 * en löpare har inga adepter att följa upp, och /uppfoljning redirectar
 * därför bort en sådan besökare.
 *
 * Ligger sist i PLAN och inte i LOGG trots att den mest visar utfall:
 * frågan den svarar på är "höll planen?", vilket är planeringens egen
 * uppföljning. Den ersatte samma dag "Översikt" (/oversikt, 2026-08-16),
 * som visade ett kort per löpare med bara dagens pass — det är den här
 * sidans "Dag"-läge, med tre grovare kadenser och efterlevnad därtill. */
const COACH_FOLLOWUP: NavItem = { href: "/uppfoljning", label: "Uppföljning" };

const SETTINGS: NavItem = { href: "/settings", label: "Inställningar" };

export function NavLinks({
  isCoach,
  planOwnedByCoach,
}: {
  isCoach: boolean;
  /** Adept med en länkad tränare — dvs. `!canEditPlanning(scoped)`. */
  planOwnedByCoach: boolean;
}) {
  const pathname = usePathname();
  const athlete = useSearchParams().get("athlete");

  const plan = isCoach ? [...PLAN, COACH_FOLLOWUP] : PLAN;

  const renderLink = (link: NavItem) => {
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
  };

  /* Gruppetiketten är både synlig och den tillgängliga etiketten — samma
   * text, ett id, ingen dubblering via aria-label. */
  const renderGroup = (id: string, label: string, items: NavItem[], note?: string) => (
    <div role="group" aria-labelledby={id} className="flex items-baseline gap-3">
      <span
        id={id}
        className="text-[0.6875rem] font-semibold tracking-wider text-zinc-400 uppercase dark:text-zinc-500"
      >
        {label}
        {note && (
          <span className="font-normal normal-case tracking-normal"> · {note}</span>
        )}
      </span>
      {items.map(renderLink)}
    </div>
  );

  return (
    <nav className="flex flex-wrap items-baseline gap-x-5 gap-y-2 text-sm font-medium">
      {renderGroup("nav-logg", "Logg", LOGG)}

      {/* Avdelaren är dekor — grupperna bär redan sin gräns semantiskt via
          role="group", så den ska inte läsas upp. */}
      <span aria-hidden className="hidden h-4 w-px bg-zinc-200 sm:block dark:bg-zinc-700" />

      {renderGroup(
        "nav-plan",
        "Plan",
        plan,
        planOwnedByCoach ? "från din tränare" : undefined,
      )}

      <span aria-hidden className="hidden h-4 w-px bg-zinc-200 sm:block dark:bg-zinc-700" />

      {renderLink(SETTINGS)}
    </nav>
  );
}
