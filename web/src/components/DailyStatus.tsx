import {
  MIN_BASELINE_DAYS,
  type DailyStatus as DailyStatusData,
  type MarkerStatus,
} from "@/lib/daily-status";
import { ringFillAndStatus, type RingStatus } from "@/lib/kpi-ring";

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

/* Färgen per status, som inline-variabel av samma skäl som --cat-* används så
 * i resten av appen: Tailwinds färgklasser kan inte peka på en CSS-variabel
 * utan att gå via arbiträr syntax på varje ställe. */
const TONE_VAR: Record<RingStatus, string> = {
  good: "var(--status-good)",
  watch: "var(--status-watch)",
  concern: "var(--status-concern)",
  neutral: "var(--status-neutral)",
  unknown: "var(--status-unknown)",
};

/* En markör som kort, utan ring (uttrycklig begäran 2026-09-15).
 *
 * Ringen visade hur nära baslinjen man låg som en fyllnadsgrad — snyggt, men
 * den tvingade in ett tal med riktning i en form som bara kan visa "mycket
 * eller lite". För HRV är högre bättre, för vilopuls lägre, och en halvfylld
 * ring sa inget om vilket. Samma information ryms i tre rader text, och då
 * kan avvikelsen få både ett TECKEN och en färg.
 *
 * Pilen bär riktningen bokstavligt (över eller under baslinjen), färgen bär
 * bedömningen (bra eller inte). De två är skilda med flit: en vilopuls under
 * baslinjen är en pil NEDÅT och samtidigt grön, och att låta färgen ensam
 * betyda "uppåt" hade gjort just den markören obegriplig.
 */
function MarkerCard({ marker }: { marker: MarkerStatus }) {
  const { status } = ringFillAndStatus(marker.current, marker.baseline, marker.spec.direction);
  const effectiveStatus: RingStatus = marker.baseline == null ? "unknown" : status;
  const tone = TONE_VAR[effectiveStatus];

  const dev = marker.deviation;
  const arrow = dev == null ? "" : dev > 0.05 ? "↑" : dev < -0.05 ? "↓" : "→";
  const devText =
    dev == null ? null : `${arrow} ${dev > 0 ? "+" : ""}${dev.toFixed(1).replace(".", ",")} SD`;

  return (
    <div className="flex flex-col gap-2 bg-[var(--surface)] px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
          {marker.spec.label}
        </span>
        {devText && (
          <span className="display tabular text-xs font-semibold" style={{ color: tone }}>
            {devText}
          </span>
        )}
      </div>

      <div className="display tabular text-2xl leading-none font-bold text-[var(--foreground)]">
        {formatValue(marker)}
        {marker.spec.unit && (
          <span className="ml-1 text-[0.5em] font-medium text-[var(--ink-3)]">
            {marker.spec.unit}
          </span>
        )}
      </div>

      {/* Baslinjen står alltid utskriven. Utan den är "+0,8 SD" ett tal utan
          referens — man vet att man avviker men inte från vad. */}
      <div className="tabular text-xs text-[var(--ink-3)]">
        {marker.baseline != null
          ? `Baslinje ${formatBaseline(marker)} · ${marker.baselineDays} dagar`
          : `Bygger baslinje — ${marker.baselineDays} av ${MIN_BASELINE_DAYS} dagar`}
      </div>

    </div>
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
    headlineClass = "text-[var(--ink-3)]";
  } else if (shouldEaseOff) {
    headline = `${concerning.length} markörer under ditt normala`;
    headlineClass = "text-amber-700 dark:text-amber-400";
  } else if (concerning.length === 1) {
    headline = `${concerning[0].spec.label} avviker`;
    headlineClass = "text-[var(--ink-2)]";
  } else {
    headline = "Allt inom ditt normala";
    headlineClass = "text-emerald-700 dark:text-emerald-400";
  }

  return (
    /* Sektion och inte kort: innehållet ÄR kort numera, och ett kort runt kort
       ger dubbla ramar och två ytnivåer som inte betyder något. Samma val som
       nyckeltalsringarnas sektioner på dashboarden. */
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">Status</h2>
          {periodLabel && (
            <p className="text-xs text-[var(--ink-3)]">{periodLabel}</p>
          )}
        </div>
        <span className={`text-sm font-semibold ${headlineClass}`}>{headline}</span>
      </div>

      {/* ETT kort med hårfina skiljelinjer mellan markörerna, inte tre fristående
          kort. Linjerna är gap på en linjefärgad bakgrund — samma form som
          StatRow — vilket gör att ytterkanterna inte får dubbla streck när
          raden bryts på smal skärm.
          Sömntimmarna filtreras bort: sömnpoängen säger samma sak fast bättre
          (den väger in djupsömn och avbrott), och två sömnmarkörer av fyra gav
          sömnen halva raden. Markören finns kvar i STATUS_MARKERS — den ingår
          fortfarande i shouldEaseOff-bedömningen, som ska väga allt som mätts,
          inte bara det som visas. */}
      <div className="grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
        {markers
          .filter((m) => m.spec.key !== "sleepHours")
          .map((m) => (
            <MarkerCard key={m.spec.key} marker={m} />
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
        <p className="text-sm text-[var(--ink-2)]">
          En markör avviker. Det är information, inte en varning — det är först när
          flera rör sig åt samma håll som det brukar betyda något.
        </p>
      )}
    </section>
  );
}
