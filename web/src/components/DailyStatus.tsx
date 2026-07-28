import {
  MIN_BASELINE_DAYS,
  type DailyStatus as DailyStatusData,
  type MarkerStatus,
} from "@/lib/daily-status";
import { ringFillAndStatus, type RingStatus } from "@/lib/kpi-ring";
import { KpiRing } from "@/components/KpiRing";

/* Presentationen av P1.2. Språkkravet ur roadmapen är styrande: appen ska
 * aldrig ställa diagnos eller säga "du är övertränad". Den säger vilken
 * markör som avviker och överlåter slutsatsen.
 *
 * Ringens fyllnad är hur nära din egen baslinje du ligger (se lib/kpi-ring),
 * inte SD-avvikelsen rakt av — SD-talet finns kvar i detaljtabellen för den
 * som klickar, men förstaintrycket är samma "hur nära riktvärdet"-språk som
 * resten av dashboardens KPI:er. */

function formatValue(marker: MarkerStatus): string {
  if (marker.current == null) return "—";
  const v = marker.current;
  const decimals = marker.spec.key === "sleepHours" || marker.spec.key === "feeling" ? 1 : 0;
  return v.toFixed(decimals);
}

function formatBaseline(marker: MarkerStatus): string {
  if (marker.baseline == null) return "–";
  const decimals = marker.spec.key === "sleepHours" || marker.spec.key === "feeling" ? 1 : 0;
  return `${marker.baseline.toFixed(decimals)}${marker.spec.unit ? ` ${marker.spec.unit}` : ""}`;
}

function MarkerRing({ marker }: { marker: MarkerStatus }) {
  const { fill, status } = ringFillAndStatus(marker.current, marker.baseline, marker.spec.direction);
  const effectiveStatus: RingStatus = marker.baseline == null ? "unknown" : status;

  return (
    <KpiRing
      label={marker.spec.label}
      valueText={formatValue(marker)}
      unit={marker.spec.unit || undefined}
      fill={fill}
      status={effectiveStatus}
      detailRows={[
        {
          label: "Senaste veckan",
          value: `${formatValue(marker)}${marker.spec.unit ? ` ${marker.spec.unit}` : ""}`,
        },
        { label: `Baslinje (${marker.baselineDays} dagar)`, value: formatBaseline(marker) },
        {
          label: "Avvikelse",
          value:
            marker.deviation != null
              ? `${marker.deviation > 0 ? "+" : ""}${marker.deviation.toFixed(1)} SD`
              : "–",
        },
      ]}
      hint={
        marker.baseline == null
          ? `Bygger baslinje — ${marker.baselineDays} av ${MIN_BASELINE_DAYS} dagar. ${marker.spec.hint}`
          : marker.spec.hint
      }
    />
  );
}

export function DailyStatus({
  status,
  periodLabel,
}: {
  status: DailyStatusData;
  /** Kort text om vilket "nu"-fönster ringarna visar, t.ex. "Senaste 7
   * dagarna mot din 60-dagars baslinje". Utelämnas på /trends, som alltid
   * visar samma fasta veckofönster. */
  periodLabel?: string;
}) {
  const { markers, concerning, shouldEaseOff, evaluated } = status;

  let headline: string;
  let headlineClass: string;

  if (evaluated === 0) {
    headline = "Bygger baslinje";
    headlineClass = "text-zinc-500 dark:text-zinc-400";
  } else if (shouldEaseOff) {
    headline = `${concerning.length} markörer under ditt normala`;
    headlineClass = "text-amber-700 dark:text-amber-400";
  } else if (concerning.length === 1) {
    headline = `${concerning[0].spec.label} avviker`;
    headlineClass = "text-zinc-700 dark:text-zinc-300";
  } else {
    headline = "Allt inom ditt normala";
    headlineClass = "text-emerald-700 dark:text-emerald-400";
  }

  return (
    <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Status</h2>
          {periodLabel && (
            <p className="text-xs text-zinc-500 dark:text-zinc-400">{periodLabel}</p>
          )}
        </div>
        <span className={`text-sm font-semibold ${headlineClass}`}>{headline}</span>
      </div>

      <div className="flex flex-wrap justify-center gap-1 sm:justify-start">
        {markers.map((m) => (
          <MarkerRing key={m.spec.key} marker={m} />
        ))}
      </div>

      {shouldEaseOff && (
        <p className="rounded border border-amber-400/60 bg-amber-50/60 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-200">
          Två eller fler av dina markörer ligger utanför det normala den här veckan. I
          studier på elitlöpare är det den punkt där tränaren sänker belastningen i
          nästa pass — värt att väga in inför morgondagen, tillsammans med hur du
          faktiskt känner dig.
        </p>
      )}

      {evaluated > 0 && !shouldEaseOff && concerning.length === 1 && (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          En markör avviker. Det är information, inte en varning — det är först när
          flera rör sig åt samma håll som det brukar betyda något.
        </p>
      )}
    </div>
  );
}
