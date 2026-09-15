import type { ReactNode } from "react";

/* De delade delarna av ett utfällbart kort: fotraden med pilen och panelen
 * som fälls ut.
 *
 * Bruten ur KpiRing när statuskorten skulle få samma utfällning (begärd
 * 2026-09-15). Markupen var identisk på båda ställena, och två kopior av en
 * pil som roterar på group-open hade garanterat glidit isär vid första
 * justeringen.
 *
 * Båda förutsätter en <details className="group"> som förälder — pilens
 * rotation hänger på group-open. */

export type DetailRow = { label: string; value: string };

/** Kortets nedersta rad: en referenstext till vänster, utfällningspilen till
 * höger. Texten är alltid med — ett kort utan referens säger var man ligger
 * men inte i förhållande till vad. Saknas den ritas ett hårt mellanslag så
 * att korten i samma rad behåller samma höjd. */
export function DetailsFooter({ text }: { text?: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 text-xs text-[var(--ink-3)]">
      <span className="tabular">{text ?? "\u00a0"}</span>
      {/* Pilen säger att det finns mer att fälla ut. Utan den är panelen inte
          upptäckbar alls — ett kort utan affordans ser bara statiskt ut. */}
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 shrink-0 rotate-45 border-r border-b border-current transition-transform group-open:-rotate-135"
      />
    </div>
  );
}

/** Det utfällda innehållet: tal i tabell, förklaring sist. */
export function DetailPanel({ rows, hint }: { rows: DetailRow[]; hint?: string }) {
  return (
    <div className="overflow-hidden rounded-lg border border-[var(--line)] text-left text-xs">
      <table className="w-full">
        <tbody>
          {rows.map((row) => (
            <tr key={row.label} className="border-b border-[var(--line)] last:border-b-0">
              <th scope="row" className="px-2 py-1.5 font-normal text-[var(--ink-3)]">
                {row.label}
              </th>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--foreground)]">
                {row.value}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {hint && <p className="border-t border-[var(--line)] p-2 text-[var(--ink-3)]">{hint}</p>}
    </div>
  );
}
