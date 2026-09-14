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
    /* Kompakt rad i stället för ett eget kort.
     *
     * Låg tidigare som ett fullbrett kort med en egen rubrikrad ovanför
     * knapparna — upprepat på tio sidor kostade det en hel skärmrad varje
     * gång, utan att säga mer än vilken knapp som är vald. Nu en rad:
     * etiketten är en eyebrow till vänster, valen är pills i samma språk som
     * huvudmenyn, så "vilken sida" och "vilken löpare" ser likadana ut.
     *
     * Den blå tonen när man tittar på NÅGON ANNAN är kvar och är själva
     * poängen: en tränare ska aldrig råka skriva i fel löpares plan för att
     * hen glömt vem som var vald. Egen träning och översikt är neutrala. */
    <div className="display flex flex-wrap items-center gap-x-3 gap-y-2 text-sm">
      <span
        className={`text-[0.6875rem] font-semibold tracking-[0.09em] uppercase ${
          !isOverview && !isSelf ? "text-sky-700 dark:text-sky-400" : "text-[var(--ink-3)]"
        }`}
      >
        {isOverview ? "Alla löpare" : isSelf ? "Din träning" : `Coachar ${active?.fullName ?? "okänd"}`}
      </span>

      <div className="flex flex-wrap items-center gap-1.5">
        {overviewHref && (
          <Link
            href={overviewHref}
            aria-current={isOverview ? "page" : undefined}
            className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
              isOverview
                ? "bg-[var(--foreground)] text-[var(--background)]"
                : "text-[var(--ink-2)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
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
              /* Den egna raden är streckad även när den inte är vald — det är
                 den enda knappen som inte är en adept, och den skillnaden ska
                 synas utan att man läser namnet. */
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                isActive
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : self
                    ? "border border-dashed border-[var(--line)] text-[var(--ink-2)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
                    : "text-[var(--ink-2)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
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
