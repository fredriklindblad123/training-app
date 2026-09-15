import type { RingStatus } from "@/lib/kpi-ring";
import { TrendMark, type TrendDirection } from "@/components/ui/TrendMark";

/* Generisk KPI-ring: en siffra i mitten, en ring runt som visar hur nära
 * riktvärdet man ligger (fyllnad) och hur det ska tolkas (färg). Text bär
 * aldrig statusfärgen själv — bara ringen gör, plus ett litet statusord, så
 * att färg aldrig är den enda bäraren av information. Klick öppnar detaljer
 * i tabellformat — det är däråt "detaljerad analys" hör hemma, inte i
 * förstaintrycket. Används av både /dashboard och DailyStatus. */

// CSS-variabler (globals.css), applicerade via inline style i stället för
// Tailwinds stroke-*-klasser — samma mönster som --cat-* (lib/categories.ts)
// använder för stapelfärgerna i ComboChart, som är det beprövade sättet att
// färglägga en SVG-stroke korrekt i båda teman i den här appen.
const RING_STROKE_VAR: Record<RingStatus, string> = {
  good: "var(--status-good)",
  watch: "var(--status-watch)",
  concern: "var(--status-concern)",
  neutral: "var(--status-neutral)",
  unknown: "var(--status-unknown)",
};

/** Exporterad för kompakta statuslägen som inte ritar en hel ring (t.ex.
 * /veckans stat-rad) men vill samma färgkodning på statustexten. */
export const RING_STATUS_TEXT: Record<RingStatus, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  watch: "text-amber-700 dark:text-amber-400",
  concern: "text-red-700 dark:text-red-400",
  neutral: "text-indigo-700 dark:text-indigo-400",
  unknown: "text-[var(--ink-3)]",
};

const RING_STATUS_LABEL: Record<RingStatus, string> = {
  good: "Bra",
  watch: "Håll koll",
  concern: "Avviker",
  neutral: "",
  unknown: "Väntar på data",
};


export type KpiDetailRow = { label: string; value: string };

export function KpiRing({
  label,
  valueText,
  unit,
  status,
  statusLabel,
  trend,
  targetText,
  detailRows,
  hint,
}: {
  label: string;
  valueText: string;
  unit?: string;
  /** 0–1. Ritas inte längre — ringen togs bort 2026-09-15 till förmån för
   * statusordet, som säger entydigt vad en fyllnadsgrad bara kunde antyda.
   * Propen står kvar därför att ringFillAndStatus (lib/kpi-ring.ts) returnerar
   * fill och status tillsammans, och samtliga anropare skickar hela objektet
   * vidare med spread. Att ta bort den hade betytt åtta ändringar utan någon
   * vinst — och fyllnaden är fortfarande rätt uträknad om ringen någon gång
   * ska tillbaka. */
  fill?: number;
  status: RingStatus;
  /** Åsidosätter standardordet för statusen, t.ex. "Måttlig" för en
   * neutral markör som inte är bra/dålig utan bara beskrivande. */
  statusLabel?: string;
  /** Den färgsatta symbolen uppe till höger: riktning + förändring.
   *
   * Skickas explicit i stället för att härledas ur targetText — riktningen är
   * inte alltid talets tecken, och kontinuitetskorten har medvetet ingen
   * riktning alls (se continuityRing). Att gissa den ur en formaterad sträng
   * hade gjort presentationen beroende av hur texten råkar vara skriven. */
  trend?: { direction: TrendDirection; text: string } | null;
  /** Samma siffra som ringens färg räknas mot, t.ex. "Riktvärde 12,4 km" —
   * visas direkt i förstaintrycket, inte bara i detaljtabellen, så att
   * grön/gul/röd aldrig är den enda förklaringen till var man ligger till. */
  targetText?: string;
  detailRows: KpiDetailRow[];
  hint?: string;
}) {
  /* Varje ring är ett EGET kort sedan 2026-09-15. De låg tidigare löst i en
   * flexrad inuti ett gemensamt kort, vilket gjorde att tre mätvärden läste
   * som en enda lång rad — man såg gruppen, inte de enskilda talen. Med egen
   * yta och ram blir varje ring ett avgränsat objekt att vila blicken på, och
   * uppfällningen får någonstans att öppna sig inuti.
   *
   * h-fit i klasslistan: utan den sträcker rutnätet en uppfälld rings grannar
   * till samma höjd, så att ett klick på en ring tomväxer tre andra kort. */
  const label_ = statusLabel ?? RING_STATUS_LABEL[status];

  return (
    /* Cell i ett kort med skiljelinjer, inte ett fristående kort och inte en
     * ring (uttrycklig begäran 2026-09-15, samma form som Status fick).
     *
     * Ringen är borta av samma skäl som i Status: en fyllnadsgrad kan bara
     * visa "mycket eller lite", och för hälften av måtten här är lägre bättre.
     * Statusordet med färg säger vad fyllnaden försökte säga, och gör det
     * entydigt.
     *
     * Egen yta utan ram — ramen bor på behållaren, och gap-px mellan cellerna
     * ritar linjerna. Ytterkanterna får därmed aldrig dubbla streck när raden
     * bryts på smal skärm. */
    <details className="group flex flex-col gap-2 bg-[var(--surface)] px-3 py-3">
      <summary className="flex cursor-pointer list-none flex-col gap-2 [&::-webkit-details-marker]:hidden">
        <div className="flex items-baseline justify-between gap-2">
          <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
            {label}
          </span>
          {trend ? (
            <TrendMark
              status={status}
              direction={trend.direction}
              text={trend.text}
              srLabel={label_ || "ingen bedömning"}
            />
          ) : (
            label_ && (
              <span
                className="display text-xs font-semibold"
                style={{ color: RING_STROKE_VAR[status] }}
              >
                {label_}
              </span>
            )
          )}
        </div>

        <div className="display tabular text-2xl leading-none font-bold text-[var(--foreground)]">
          {valueText}
          {unit && (
            <span className="ml-1 text-[0.5em] font-medium text-[var(--ink-3)]">{unit}</span>
          )}
        </div>

        {/* Riktvärdet står alltid framme. Utan det är statusordet den enda
            förklaringen till var man ligger, och "Håll koll" utan referens går
            inte att göra något åt. Pilen längst till höger visar att det finns
            mer att fälla ut — tabellen nedanför är inte uppenbar annars. */}
        <div className="flex items-baseline justify-between gap-2 text-xs text-[var(--ink-3)]">
          <span className="tabular">{targetText ?? "\u00a0"}</span>
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 shrink-0 rotate-45 border-r border-b border-current transition-transform group-open:-rotate-135"
          />
        </div>
      </summary>

      <div className="overflow-hidden rounded-lg border border-[var(--line)] text-left text-xs">
        <table className="w-full">
          <tbody>
            {detailRows.map((row) => (
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
        {hint && (
          <p className="border-t border-[var(--line)] p-2 text-[var(--ink-3)]">{hint}</p>
        )}
      </div>
    </details>
  );
}
