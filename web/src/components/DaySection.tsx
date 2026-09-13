/* Hopfällbar sektion i dagvyn.
 *
 * Dagen har fem områden — plan, genomförda pass, egna pass, dagbok och sömn —
 * och alla utfällda samtidigt blev en sida man måste scrolla igenom för att
 * hitta något. Varje sektion visar därför en sammanfattningsrad som räcker för
 * att veta om man behöver öppna den.
 *
 * Byggd på <details>/<summary> och inte på klientstate: sektionerna sitter i
 * en server-komponent, native-elementen fungerar utan JavaScript, och de
 * behåller webbläsarens sök- och tangentbordsbeteende. Samma mönster används
 * redan i planerings- och passkvalitetsvyerna. */

export function DaySection({
  title,
  summary,
  hasData,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Kort text till höger om rubriken — det som gör att man slipper öppna. */
  summary?: React.ReactNode;
  /** Om sektionen har något innehåll värt att öppna — styr kantfärgen så att
   * det syns vilka sektioner som faktiskt har information utan att öppna
   * dem alla. Utelämnad = neutral (t.ex. sektioner som alltid har innehåll
   * när de visas alls). */
  hasData?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const borderClass =
    hasData === true
      ? "border-emerald-300/70 dark:border-emerald-800/70"
      : hasData === false
        ? "border-[var(--line)] dark:border-zinc-800/60"
        : "border-[var(--line)]";
  const titleClass =
    hasData === false
      ? "font-medium text-[var(--ink-3)]"
      : "font-medium text-[var(--foreground)]";

  return (
    <details open={defaultOpen} className={`group rounded border ${borderClass}`}>
      <summary className="flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 hover:bg-[var(--surface-raised)]">
        <span
          className="text-[var(--ink-3)] transition-transform group-open:rotate-90"
          aria-hidden="true"
        >
          ▸
        </span>
        <span className={titleClass}>{title}</span>
        {summary != null && (
          <span className="text-sm text-[var(--ink-3)]">{summary}</span>
        )}
      </summary>
      <div className="flex flex-col gap-3 border-t border-[var(--line)] px-4 py-4">
        {children}
      </div>
    </details>
  );
}
