import {
  MIN_BASELINE_DAYS,
  type DailyStatus as DailyStatusData,
  type MarkerStatus,
} from "@/lib/daily-status";

/* Presentationen av P1.2. Språkkravet ur roadmapen är styrande: appen ska
 * aldrig ställa diagnos eller säga "du är övertränad". Den säger vilken
 * markör som avviker och överlåter slutsatsen. */

function formatValue(marker: MarkerStatus): string {
  if (marker.current == null) return "—";
  const v = marker.current;
  const decimals = marker.spec.key === "sleepHours" || marker.spec.key === "feeling" ? 1 : 0;
  return `${v.toFixed(decimals)}${marker.spec.unit ? ` ${marker.spec.unit}` : ""}`;
}

function MarkerRow({ marker }: { marker: MarkerStatus }) {
  const { spec, baseline, deviation, isConcerning, isFavourable, baselineDays } = marker;

  let symbol = "○";
  let symbolClass = "text-zinc-300 dark:text-zinc-600";
  let note: string;

  if (marker.current == null) {
    note = "ingen mätning den senaste veckan";
  } else if (baseline == null) {
    note = `bygger baslinje — ${baselineDays} av ${MIN_BASELINE_DAYS} dagar`;
  } else if (isConcerning) {
    symbol = spec.direction === "higher_is_better" ? "▼" : "▲";
    symbolClass = "text-amber-600 dark:text-amber-400";
    note = `utanför ditt normala (baslinje ${baseline.toFixed(baseline < 20 ? 1 : 0)})`;
  } else if (isFavourable) {
    symbol = spec.direction === "higher_is_better" ? "▲" : "▼";
    symbolClass = "text-emerald-600 dark:text-emerald-400";
    note = `över ditt normala (baslinje ${baseline.toFixed(baseline < 20 ? 1 : 0)})`;
  } else {
    symbol = "●";
    symbolClass = "text-zinc-400 dark:text-zinc-500";
    note = `normalt (baslinje ${baseline.toFixed(baseline < 20 ? 1 : 0)})`;
  }

  return (
    <div className="flex items-baseline gap-3 py-1.5 text-sm">
      <div className="w-24 shrink-0 font-medium text-zinc-900 dark:text-zinc-100">
        {spec.label}
      </div>
      <div className="w-20 shrink-0 tabular-nums text-zinc-900 dark:text-zinc-100">
        {formatValue(marker)}
      </div>
      <div className={`w-4 shrink-0 text-center ${symbolClass}`} aria-hidden="true">
        {symbol}
      </div>
      <div className="text-zinc-500 dark:text-zinc-400">
        {note}
        {deviation != null && Math.abs(deviation) >= 1 && (
          <span className="ml-1 tabular-nums text-zinc-400 dark:text-zinc-500">
            ({deviation > 0 ? "+" : ""}
            {deviation.toFixed(1)} SD)
          </span>
        )}
      </div>
    </div>
  );
}

export function DailyStatus({ status }: { status: DailyStatusData }) {
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
    <div className="flex flex-col gap-2 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Dagens status</h2>
        <span className={`text-sm font-medium ${headlineClass}`}>{headline}</span>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Jämför den senaste veckan mot din egen baslinje (median över{" "}
        {MIN_BASELINE_DAYS}+ dagar). Det är avvikelsen som betyder något, inte nivån — samma
        HRV-tal kan vara högt för en person och lågt för en annan.
      </p>

      <div className="mt-1 divide-y divide-zinc-100 dark:divide-zinc-800">
        {markers.map((m) => (
          <MarkerRow key={m.spec.key} marker={m} />
        ))}
      </div>

      {shouldEaseOff && (
        <p className="mt-1 rounded border border-amber-400/60 bg-amber-50/60 p-3 text-sm text-amber-900 dark:border-amber-500/40 dark:bg-amber-950/20 dark:text-amber-200">
          Två eller fler av dina markörer ligger utanför det normala den här veckan. I
          studier på elitlöpare är det den punkt där tränaren sänker belastningen i
          nästa pass — värt att väga in inför morgondagen, tillsammans med hur du
          faktiskt känner dig.
        </p>
      )}

      {evaluated > 0 && !shouldEaseOff && concerning.length === 1 && (
        <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
          En markör avviker. Det är information, inte en varning — det är först när
          flera rör sig åt samma håll som det brukar betyda något.
        </p>
      )}
    </div>
  );
}
