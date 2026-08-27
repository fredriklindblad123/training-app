import Link from "next/link";

/* Löparväljare, samma knapprads-stil som redan fanns inline i /sasongen och
 * /flerarsplan — utbruten hit så att de coach-medvetna sidorna (dashboard,
 * kalender, trender, tävlingsresultat, /blockplan, /detaljplan) inte behöver
 * upprepa samma markup. `buildHref` låter varje sida bestämma exakt hur
 * länken ser ut (vilka egna filter/parametrar som ska bevaras).
 *
 * 2026-08-16 (uttrycklig begäran): en coach som också tränar själv utan egen
 * tränare (Fredrik) behöver kunna växla till SIN EGEN vy också, inte bara
 * mellan de löpare hen coachar — annars är enda utvägen en andra inloggning,
 * vilket bara flyttar problemet. `athletes` kommer numera från
 * viewableAthletes() (lib/auth-scope.ts), som lägger till "Jag själv" först
 * i listan för en coach. Etiketten ovanför knapparna gör det tydligt vilket
 * läge man är i — det var själva klagomålet: för otydlig skillnad mellan
 * coach-vy och adept-vy.
 *
 * 2026-08-18 (uttrycklig begäran): Blockplan/Detaljplan fick en "Alla"-knapp
 * (`overviewHref`) — en coach med flera löpare ska kunna se dem sida vid
 * sida i stället för att klicka igenom en i taget. Valfri prop, ingen annan
 * sida (dashboard, kalender, trender, tävlingsresultat, flerårsplan) har
 * någon översiktsvy att länka till och skickar därför inte med den. */
export function AthleteSwitcher({
  athletes,
  activeId,
  viewerUserId,
  buildHref,
  overviewHref,
}: {
  athletes: { id: string; fullName: string | null }[];
  activeId: string;
  /** Den inloggade personens eget id — avgör om det aktiva valet är "mig
   * själv" eller en coachad löpare, för etiketten ovanför knapparna. */
  viewerUserId: string;
  buildHref: (athleteId: string) => string;
  /** Länk till en "Alla löpare"-översikt. Utelämnad = ingen "Alla"-knapp. */
  overviewHref?: string;
}) {
  const isOverview = activeId === "alla";
  const isSelf = activeId === viewerUserId;
  const active = athletes.find((a) => a.id === activeId);

  return (
    <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div
        className={`text-sm font-medium ${
          !isOverview && !isSelf ? "text-sky-700 dark:text-sky-400" : "text-zinc-700 dark:text-zinc-300"
        }`}
      >
        {isOverview
          ? "Översikt: alla löpare"
          : isSelf
            ? "Din egen träning"
            : `Du coachar: ${active?.fullName ?? "okänd löpare"}`}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {overviewHref && (
          <Link
            href={overviewHref}
            aria-current={isOverview ? "page" : undefined}
            className={`rounded px-3 py-1 ${
              isOverview
                ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            Alla
          </Link>
        )}
        {athletes.map((a) => {
          const self = a.id === viewerUserId;
          const isActive = !isOverview && a.id === activeId;
          return (
            <Link
              key={a.id}
              href={buildHref(a.id)}
              aria-current={isActive ? "page" : undefined}
              className={`rounded px-3 py-1 ${
                isActive
                  ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                  : self
                    ? "border border-dashed border-zinc-400 hover:bg-zinc-100 dark:border-zinc-600 dark:hover:bg-zinc-900"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              {a.fullName ?? "Namnlös löpare"}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
