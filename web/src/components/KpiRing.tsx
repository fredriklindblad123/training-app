import type { RingStatus } from "@/lib/kpi-ring";

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

const RING_STATUS_TEXT: Record<RingStatus, string> = {
  good: "text-emerald-700 dark:text-emerald-400",
  watch: "text-amber-700 dark:text-amber-400",
  concern: "text-red-700 dark:text-red-400",
  neutral: "text-indigo-700 dark:text-indigo-400",
  unknown: "text-zinc-400 dark:text-zinc-500",
};

const RING_STATUS_LABEL: Record<RingStatus, string> = {
  good: "Bra",
  watch: "Håll koll",
  concern: "Avviker",
  neutral: "",
  unknown: "Väntar på data",
};

const RING_SIZE = 88;
const STROKE_WIDTH = 8;
const RADIUS = (RING_SIZE - STROKE_WIDTH) / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

export type KpiDetailRow = { label: string; value: string };

export function KpiRing({
  label,
  valueText,
  unit,
  fill,
  status,
  statusLabel,
  targetText,
  detailRows,
  hint,
}: {
  label: string;
  valueText: string;
  unit?: string;
  /** 0–1. Hur stor andel av ringen som ska vara fylld. */
  fill: number;
  status: RingStatus;
  /** Åsidosätter standardordet för statusen, t.ex. "Måttlig" för en
   * neutral markör som inte är bra/dålig utan bara beskrivande. */
  statusLabel?: string;
  /** Samma siffra som ringens färg räknas mot, t.ex. "Riktvärde 12,4 km" —
   * visas direkt i förstaintrycket, inte bara i detaljtabellen, så att
   * grön/gul/röd aldrig är den enda förklaringen till var man ligger till. */
  targetText?: string;
  detailRows: KpiDetailRow[];
  hint?: string;
}) {
  const dashOffset = CIRCUMFERENCE * (1 - Math.min(Math.max(fill, 0), 1));
  const label_ = statusLabel ?? RING_STATUS_LABEL[status];

  return (
    <details className="group flex flex-col items-center gap-1.5 rounded-lg p-2 text-center hover:bg-zinc-50 dark:hover:bg-zinc-900">
      <summary className="flex cursor-pointer list-none flex-col items-center gap-1.5 [&::-webkit-details-marker]:hidden">
        <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{label}</span>
        <div className="relative flex shrink-0" style={{ width: RING_SIZE, height: RING_SIZE }}>
          <svg
            width={RING_SIZE}
            height={RING_SIZE}
            viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`}
            className="-rotate-90"
          >
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE_WIDTH}
              className="stroke-zinc-100 dark:stroke-zinc-800"
            />
            <circle
              cx={RING_SIZE / 2}
              cy={RING_SIZE / 2}
              r={RADIUS}
              fill="none"
              strokeWidth={STROKE_WIDTH}
              strokeLinecap="round"
              strokeDasharray={CIRCUMFERENCE}
              strokeDashoffset={dashOffset}
              className="transition-[stroke-dashoffset] duration-500"
              style={{ stroke: RING_STROKE_VAR[status] }}
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-50">
              {valueText}
            </span>
            {unit && (
              <span className="text-[10px] text-zinc-500 dark:text-zinc-400">{unit}</span>
            )}
          </div>
        </div>
        {label_ && (
          <span className={`text-xs font-medium ${RING_STATUS_TEXT[status]}`}>{label_}</span>
        )}
        {targetText && (
          <span className="text-[11px] font-medium text-cyan-700 dark:text-cyan-400">
            {targetText}
          </span>
        )}
      </summary>

      <div className="mt-2 w-full max-w-[14rem] overflow-hidden rounded border border-zinc-200 text-left text-xs dark:border-zinc-800">
        <table className="w-full">
          <tbody>
            {detailRows.map((row) => (
              <tr key={row.label} className="border-b border-zinc-100 last:border-b-0 dark:border-zinc-800">
                <th scope="row" className="px-2 py-1.5 font-normal text-zinc-500 dark:text-zinc-400">
                  {row.label}
                </th>
                <td className="px-2 py-1.5 text-right tabular-nums text-zinc-900 dark:text-zinc-100">
                  {row.value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {hint && (
          <p className="border-t border-zinc-100 p-2 text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            {hint}
          </p>
        )}
      </div>
    </details>
  );
}
