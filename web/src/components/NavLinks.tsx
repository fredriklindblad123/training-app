"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LinkPending } from "@/components/ui/LinkPending";
import { Dropdown } from "@/components/ui/Dropdown";

/* Huvudmenyn, utbruten till en klientkomponent av ett enda skäl: en coach som
 * växlat löpare via ?athlete=-parametern (se lib/auth-scope.ts) ska inte
 * tappa det valet så fort hen klickar sig vidare till en annan sida i menyn
 * — layouten själv får aldrig searchParams (bara page.tsx gör det i App
 * Router), så det kräver antingen en klientkomponent eller en cookie. Detta
 * är det enklaste alternativet: samma URL-param-drivna mönster som redan
 * finns i /blockplan, bara återanvänt av menyn också. Sidor utan
 * löparväljare (en vanlig löpare, eller ingen coach) berörs inte — utan
 * `athlete` i URL:en blir länkarna identiska med innan.
 *
 * ---------------------------------------------------------------------------
 * Gruppering efter roll (2026-08-27, uttrycklig begäran)
 *
 * Menyn låg tidigare som en enda rad av åtta jämnstora länkar. Problemet var
 * inte att någon sida var överflödig — det utreddes och avfärdades med data:
 * 94 % av aktiviteterna och 96 % av dagboksinläggen ligger utanför varje
 * säsongsblock, och eftersom /blockplan och /detaljplan bara spänner blockens
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
  { href: "/blockplan", label: "Blockplan" },
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

type NavProps = {
  isCoach: boolean;
  /** Adept med en länkad tränare — dvs. `!canEditPlanning(scoped)`. Styr om
   * Plan-gruppen visas alls. */
  planOwnedByCoach: boolean;
  /** Löparläge: coachen tittar på sin EGEN träning och ska se exakt samma vy
   * som en adept — bara Logg, ingen väljare. Se lib/view-mode.ts. */
  runnerMode: boolean;
};

/**
 * Menyn utan beroende på query-strängen.
 *
 * Utbruten från NavLinks för att Suspense-fallbacken ska kunna rendera EN
 * FÄRDIG MENY i stället för en laddtext. useSearchParams() är det enda som
 * suspendar här; usePathname gör det inte. Tidigare stod det "Laddar meny…"
 * under tiden, vilket fick menyn att försvinna och komma tillbaka vid varje
 * navigering — det såg ut som att appen laddade om sig själv, och var en stor
 * del av upplevelsen att den var långsam.
 *
 * Fallbacken tappar bara ?athlete= i länkarna under den korta stunden innan
 * den riktiga versionen tar över. En coach som hunnit klicka exakt då landar
 * på sin egen vy i stället för adeptens — mätbart bättre än att menyn blinkar
 * bort på varje navigering.
 */
export function NavLinksView({
  isCoach,
  planOwnedByCoach,
  runnerMode,
  athlete,
}: NavProps & { athlete: string | null }) {
  const pathname = usePathname();

  /* I löparläge är en coach en löpare, punkt. Samma meny som en adept får,
     så att den som växlar dit vet exakt vad hen tittar på. */
  const coaching = isCoach && !runnerMode;
  const plan = coaching ? [...PLAN, COACH_FOLLOWUP] : PLAN;

  /* En adept med tränare ser INTE Plan-gruppen (uttrycklig begäran
     2026-09-14). Tidigare visades den skrivskyddad med motiveringen att
     löparen ska se vad som väntar — men fyra länkar till sidor där varje
     knapp är borttagen är mest förvirrande, och sedan samma dag bär
     kalendern blockbandet i månad, vecka och dag. Planen syns alltså där hon
     ändå tittar, i stället för på sidor hon inte får röra.
     En SJÄLVCOACHAD löpare äger sin egen planering och behåller gruppen. */
  const showPlan = coaching || (!isCoach && !planOwnedByCoach);


  const renderLink = (link: NavItem) => {
    const href = athlete ? `${link.href}?athlete=${athlete}` : link.href;
    const active = pathname === link.href || pathname.startsWith(`${link.href}/`);
    return (
      <Link
        key={link.href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`rounded-md px-2 py-1 transition-colors ${
          active
            ? "bg-[var(--surface-raised)] text-[var(--foreground)]"
            : "text-[var(--ink-2)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
        }`}
      >
        {link.label}
        <LinkPending />
      </Link>
    );
  };

  /* Gruppetiketten är både synlig och den tillgängliga etiketten — samma
   * text, ett id, ingen dubblering via aria-label. */
  const renderGroup = (id: string, label: string, items: NavItem[], note?: string) => (
    <div role="group" aria-labelledby={id} className="flex items-center gap-2">
      <span
        id={id}
        className="text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase"
      >
        {label}
        {note && (
          <span className="font-normal normal-case tracking-normal"> · {note}</span>
        )}
      </span>
      {items.map(renderLink)}
    </div>
  );

  /* Alla länkar i en platt lista — mobilmenyn visar dem staplade och behöver
     inte grupperingens vågräta avdelare. */
  const flat: { group: string; items: NavItem[] }[] = [
    { group: "Logg", items: LOGG },
    ...(showPlan ? [{ group: "Plan", items: plan }] : []),
    { group: "", items: [SETTINGS] },
  ];
  const current =
    flat.flatMap((g) => g.items).find((l) => pathname === l.href || pathname.startsWith(`${l.href}/`))
      ?.label ?? "Meny";

  return (
    <>
      {/* ---- Bred skärm: allt utskrivet ---- */}
      <nav className="display hidden flex-wrap items-center gap-x-4 gap-y-2 text-sm font-medium sm:flex">
        {renderGroup("nav-logg", "Logg", LOGG)}

        {/* Avdelaren är dekor — grupperna bär redan sin gräns semantiskt via
            role="group", så den ska inte läsas upp. */}
        <span aria-hidden className="h-4 w-px bg-[var(--line)]" />

        {showPlan && (
          <>
            {renderGroup("nav-plan", "Plan", plan)}
            <span aria-hidden className="h-4 w-px bg-[var(--line)]" />
          </>
        )}

        {renderLink(SETTINGS)}
      </nav>

      {/* ---- Smal skärm: en hopfälld meny ----
          Nio länkar får inte plats på en telefon, och att låta dem scrolla i
          sidled gör att hälften aldrig syns — man vet inte ens att de finns.
          Sammanfattningen visar var man ÄR, så den hopfällda menyn fortfarande
          svarar på frågan den öppna gav gratis.
          Dropdown sköter stängningen vid val: <details> gör det inte själv,
          och en klientnavigering nollställer den inte — vilket jag felaktigt
          antog när den här byggdes. */}
      <Dropdown label={current} width="w-56" className="sm:hidden">
        {flat.map((g, i) => {
          const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
          return (
            <div key={g.group || `x${i}`} className="flex flex-col gap-1">
              {g.group && (
                <span className="px-2.5 pt-1 text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
                  {g.group}
                </span>
              )}
              {g.items.map((link) => (
                <Link
                  key={link.href}
                  href={athlete ? `${link.href}?athlete=${athlete}` : link.href}
                  aria-current={isActive(link.href) ? "page" : undefined}
                  className={`block rounded-md px-2.5 py-1.5 font-medium transition-colors ${
                    isActive(link.href)
                      ? "bg-[var(--surface-raised)] text-[var(--foreground)]"
                      : "text-[var(--ink-2)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {link.label}
                </Link>
              ))}
            </div>
          );
        })}
      </Dropdown>
    </>
  );
}

/** Menyn med löparvalet från URL:en. Wrappas i Suspense av layouten, som ger
 * NavLinksView som fallback — se motiveringen där. */
export function NavLinks(props: NavProps) {
  const athlete = useSearchParams().get("athlete");
  return <NavLinksView {...props} athlete={athlete} />;
}
