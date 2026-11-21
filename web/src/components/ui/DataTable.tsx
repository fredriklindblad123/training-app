import type { ReactNode } from "react";

/* Tabellen (B2, 2026-11-21): siffror högerställda och lika breda, nuet först
 * och i fetstil, jämförelsen grå. Breda tabeller rullar i sin egen ram —
 * sidan själv scrollar aldrig i sidled på 390 px.
 *
 * `emphasis` pekar ut kolumnen som är "nu" (oftast index 1, efter
 * etikettkolumnen). Rader med `total` får en tjockare linje ovanför och
 * fetstil hela vägen. */

export type DataRow = { cells: ReactNode[]; total?: boolean; key?: string };

export function DataTable({
  head,
  rows,
  emphasis = 1,
  minWidth,
}: {
  head: ReactNode[];
  rows: DataRow[];
  emphasis?: number | null;
  /** Sätt när kolumnerna inte ryms på 390 px — då rullar tabellen i ramen. */
  minWidth?: string;
}) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <table className="w-full border-collapse text-sm" style={minWidth ? { minWidth } : undefined}>
        <thead>
          <tr className="border-b border-[var(--line)] text-xs text-[var(--ink-3)]">
            {head.map((h, i) => (
              <th
                key={i}
                className={`py-2 font-normal ${i === 0 ? "pr-2 text-left" : "pl-2 text-right"} ${
                  i === emphasis ? "font-semibold text-[var(--foreground)]" : ""
                }`}
              >
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => (
            <tr
              key={r.key ?? ri}
              className={r.total ? "border-t-2 border-[var(--ink-3)]" : "border-b border-[var(--line)]"}
            >
              {r.cells.map((c, i) => (
                <td
                  key={i}
                  className={`tabular py-2 ${i === 0 ? "pr-2 text-left" : "pl-2 text-right"} ${
                    r.total
                      ? "font-semibold text-[var(--foreground)]"
                      : i === emphasis
                        ? "font-semibold text-[var(--foreground)]"
                        : i === 0
                          ? "text-[var(--ink-2)]"
                          : "text-[var(--ink-2)]"
                  }`}
                >
                  {c}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
