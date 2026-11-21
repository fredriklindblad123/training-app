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
  variant = "card",
  value,
  children,
}: {
  /** "row" är en rad i ett gemensamt kort (de tre växlarna på Form, ny UX
   * 2026-11-21): ingen egen ram, skiljelinje ovanför i stället. */
  variant?: "card" | "row";
  /** Ett tal till höger i rubrikraden, t.ex. växelns medianpuls. */
  value?: ReactNode;
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
      className={
        variant === "row"
          ? "group border-t border-[var(--line)] first:border-t-0"
          : "group rounded-[14px] border border-[var(--line)] bg-[var(--surface)]"
      }
      open={defaultOpen}
    >
      <summary className={`flex cursor-pointer list-none items-start gap-3 ${variant === "row" ? "px-3.5 py-3" : "p-4"}`}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 className={`display flex items-center gap-2 leading-tight font-semibold text-[var(--foreground)] ${variant === "row" ? "text-base" : "text-xl"}`}>
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
        {value != null && (
          <span className="display tabular self-center text-[1.375rem] font-bold text-[var(--foreground)]">{value}</span>
        )}
        {/* Pilen säger att det finns mer att fälla ut — samma mönster som
            korten i KpiRing och DailyStatus redan använder. */}
        <span
          aria-hidden
          className="mt-2 inline-block h-2 w-2 shrink-0 rotate-45 border-r border-b border-[var(--ink-3)] transition-transform group-open:-rotate-135"
        />
      </summary>
      <div className={`flex flex-col gap-6 border-t border-[var(--line)] ${variant === "row" ? "px-3.5 py-4" : "p-4"}`}>{children}</div>
    </details>
  );
}
