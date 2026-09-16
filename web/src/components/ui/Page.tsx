import type { ReactNode } from "react";

/* Sidans skelett: yttre behållare, sidrubrik och sektionsrubrik.
 *
 * Fanns inte som komponenter fram till 2026-09-13, och sidorna hade därför
 * glidit isär trots att de såg likadana ut i koden vid en snabb blick:
 * ytterbehållarens `gap` var 6, 8 eller 10 beroende på sida, och h2 fanns i
 * både font-medium och font-semibold. Det är den sortens avvikelse som inte
 * syns när man läser en fil i taget men känns direkt när man klickar mellan
 * sidorna — vilket var precis vad som rapporterades.
 *
 * Poängen med att göra skelettet till kod är att avvikelsen inte kan
 * återuppstå av slarv: det finns inget värde att råka skriva fel.
 */

/** Sidans yttre behållare. Ett enda avstånd mellan sektioner i hela appen. */
export function Page({ children }: { children: ReactNode }) {
  return <div className="flex flex-1 flex-col gap-8 px-6 py-8">{children}</div>;
}

/**
 * Sidrubriken: namn plus en mening om vad sidan svarar på.
 *
 * `lead` är inte dekoration. Varje sida i appen svarar på en fråga, och den
 * som öppnar Säsongsöversikt för första gången ska slippa gissa vilken. Texten hålls
 * under ~65 tecken per rad (max-w-3xl) eftersom längre rader är mätbart
 * långsammare att läsa.
 */
export function PageHeader({
  title,
  lead,
  actions,
}: {
  title: ReactNode;
  lead?: ReactNode;
  /** Knappar eller länkar som hör till hela sidan, högerställda på bred skärm. */
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
      <div>
        <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">{title}</h1>
        {lead && <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">{lead}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * En sektion med rubrik och valfri förklaring.
 *
 * Rubriken är `font-semibold`, inte `font-medium`: den ska kunna skiljas från
 * fet brödtext inuti ett kort, annars läser sidan som en enda lång lista utan
 * nivåer. Förklaringen står mellan rubrik och innehåll — inte efter — så att
 * den hinner läsas innan man tittar på siffrorna den beskriver.
 */
export function Section({
  title,
  description,
  actions,
  children,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-2">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">{title}</h2>
          {description && (
            <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">{description}</p>
          )}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {children}
    </section>
  );
}
