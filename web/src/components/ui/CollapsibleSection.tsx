import type { ReactNode } from "react";

/* En hopfällbar sektion med domen i rubriken.
 *
 * Poängen med utfällningen är att korta ner sidan, men en dropdown som bara
 * säger "Tröskel" gör läsaren tvungen att öppna alla tre för att veta var
 * problemet sitter — då har man bytt scrollande mot klickande. Därför bär
 * rubriken alltid sektionens slutsats, så att hopfällt läge ger hela bilden
 * och utfällt läge ger underlaget.
 */
export function CollapsibleSection({
  title,
  headline,
  meta,
  accent,
  defaultOpen = false,
  children,
}: {
  title: string;
  /** Sektionens dom — syns även när sektionen är stängd. */
  headline?: ReactNode;
  /** Kort etikett till höger om rubriken, t.ex. växelns syfte. */
  meta?: ReactNode;
  /** CSS-färg för en prick före rubriken. Används av de tre växlarna, så
   * att sektionen bär samma märke som sitt band i laktatkurvan och i
   * växeldiagrammet — färgen är den enda tråd som håller ihop de tre
   * ställena där samma träningsform beskrivs. */
  accent?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details
      className="group rounded-lg border border-[var(--line)] bg-[var(--surface)]"
      open={defaultOpen}
    >
      <summary className="flex cursor-pointer list-none items-start gap-3 p-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className="display flex items-center gap-2 text-xl leading-tight font-semibold text-[var(--foreground)]">
              {accent && (
                <span
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: accent }}
                  aria-hidden="true"
                />
              )}
              {title}
            </h2>
            {meta && <span className="text-xs text-[var(--ink-3)]">{meta}</span>}
          </div>
          {headline && <div className="mt-1">{headline}</div>}
        </div>
        {/* Pilen säger att det finns mer att fälla ut — samma mönster som
            korten i KpiRing och DailyStatus redan använder. */}
        <span
          aria-hidden
          className="mt-2 inline-block h-2 w-2 shrink-0 rotate-45 border-r border-b border-[var(--ink-3)] transition-transform group-open:-rotate-135"
        />
      </summary>
      <div className="flex flex-col gap-6 border-t border-[var(--line)] p-4">{children}</div>
    </details>
  );
}
