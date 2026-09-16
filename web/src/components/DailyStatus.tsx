import {
  BASELINE_WINDOW_DAYS,
  CURRENT_WINDOW_DAYS,
  MIN_BASELINE_DAYS,
  type DailyStatus as DailyStatusData,
  type MarkerBand,
  type MarkerStatus,
} from "@/lib/daily-status";
import type { RingStatus } from "@/lib/kpi-ring";
import { DetailPanel, DetailsFooter } from "@/components/ui/CardDetails";
import { TrendMark, type TrendDirection } from "@/components/ui/TrendMark";

/* Presentationen av P1.2. Språkkravet ur roadmapen är styrande: appen ska
 * aldrig ställa diagnos eller säga "du är övertränad". Den säger vilken
 * markör som avviker och överlåter slutsatsen.
 *
 * Färgen kommer ur kvoten mellan nuläget och din egen baslinje (se
 * lib/kpi-ring), inte ur SD-avvikelsen. Riktningen per markör kommer ur
 * spec.direction i lib/daily-status: HRV och sömnpoäng är higher_is_better,
 * vilopuls är lower_is_better. En vilopuls UNDER baslinjen är alltså grön
 * och samtidigt en pil nedåt — det är avsiktligt, och skälet till att pil
 * och färg är skilda i TrendMark. */

function formatValue(marker: MarkerStatus): string {
  if (marker.current == null) return "—";
  const v = marker.current;
  const decimals = marker.spec.key === "sleepHours" || marker.spec.key === "feeling" ? 1 : 0;
  return v.toFixed(decimals);
}

/** Ett godtyckligt tal i markörens egen skala och enhet — används för
 * bandgränserna, som ligger i samma enhet som mätvärdet. */
function formatWithUnit(marker: MarkerStatus, v: number | null): string {
  if (v == null) return "–";
  const decimals = marker.spec.key === "sleepHours" || marker.spec.key === "feeling" ? 1 : 0;
  return `${v.toFixed(decimals)}${marker.spec.unit ? ` ${marker.spec.unit}` : ""}`;
}

function formatBaseline(marker: MarkerStatus): string {
  if (marker.baseline == null) return "–";
  const decimals = marker.spec.key === "sleepHours" || marker.spec.key === "feeling" ? 1 : 0;
  return `${marker.baseline.toFixed(decimals)}${marker.spec.unit ? ` ${marker.spec.unit}` : ""}`;
}

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
/** Bandet översatt till den gemensamma statusfärgen. */
const BAND_STATUS: Record<MarkerBand, RingStatus> = {
  good: "good",
  watch: "watch",
  concern: "concern",
};

const BAND_LABEL: Record<MarkerBand, string> = {
  good: "Inom ditt normala",
  watch: "Håll koll",
  concern: "Utanför ditt normala",
};

function MarkerCard({ marker }: { marker: MarkerStatus }) {
  /* Färgen kommer ur percentilbandet, inte ur kvoten mot baslinjen.
   *
   * Den gamla regeln var "inom 10% av baslinjen är grönt", vilket blev fel åt
   * båda hållen på en gång: en sömnpoäng på löparens 25:e percentil räknades
   * som normal, medan vilopulsen — som varierar några få slag — hade behövt
   * stiga mer än tre standardavvikelser innan kortet ens blev gult. Se
   * WATCH_PERCENTILE i lib/daily-status för mätningarna. */
  const status: RingStatus = marker.band == null ? "unknown" : BAND_STATUS[marker.band];

  /* Procent mot baslinjen, som de andra korten på dashboarden. Pilen visar
   * läget mot baslinjen, inte en trend över tid: underlaget har nuläget och
   * baslinjen men inget föregående fönster, så en tidstrend går inte att
   * räkna fram här utan att hitta på den. */
  const pct =
    marker.current != null && marker.baseline != null && marker.baseline !== 0
      ? (marker.current - marker.baseline) / marker.baseline
      : null;

  // Strecket är knutet till det VISADE talet: det kommer alltid och bara när
  // kortet skriver 0.0%. En pil bredvid en nolla hade sett ut som ett fel.
  const direction: TrendDirection =
    pct == null || Math.abs(pct * 100) < 0.05 ? "flat" : pct > 0 ? "up" : "down";
  const devText = pct == null ? null : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`;

  const higher = marker.spec.direction === "higher_is_better";
  const riktning = higher ? "under" : "över";

  const rows = [
    { label: `Senaste ${CURRENT_WINDOW_DAYS} dagarna`, value: formatWithUnit(marker, marker.current) },
    { label: "Din baslinje (median)", value: formatWithUnit(marker, marker.baseline) },
    { label: `Håll koll ${riktning}`, value: formatWithUnit(marker, marker.watchThreshold) },
    { label: `Utanför normalt ${riktning}`, value: formatWithUnit(marker, marker.concernThreshold) },
    { label: "Mätdagar bakom baslinjen", value: `${marker.baselineDays}` },
  ];

  const hint =
    `${marker.spec.hint} ` +
    `Gränserna är percentiler av dina egna senaste ${BASELINE_WINDOW_DAYS} dagarna: gult när veckan ` +
    `är sämre än tre av fyra vanliga veckor, rött när den hör till den sämsta tiondelen. ` +
    `Percentiler och inte standardavvikelser — ett medelvärdesmått antar en jämn fördelning, och ` +
    `enstaka riktigt dåliga nätter gör annars normalintervallet så brett att nästan allt ryms i det.`;

  return (
    <details className="group flex flex-col gap-2 bg-[var(--surface)] px-3 py-3">
      <summary className="flex cursor-pointer list-none flex-col gap-2 [&::-webkit-details-marker]:hidden">
        <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
          {marker.spec.label}
        </span>

        {/* Avvikelsen står på mätvärdets rad — samma flytt som KPI-korten, av
            samma skäl: "48 ms, 6,7% över" är en avläsning, inte två. */}
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
          <span className="display tabular text-2xl leading-none font-bold text-[var(--foreground)]">
            {formatValue(marker)}
            {marker.spec.unit && (
              <span className="ml-1 text-[0.5em] font-medium text-[var(--ink-3)]">
                {marker.spec.unit}
              </span>
            )}
          </span>
          {devText && (
            <TrendMark
              status={status}
              direction={direction}
              text={devText}
              srLabel={`${devText} ${direction === "up" ? "över" : direction === "down" ? "under" : "vid"} baslinjen${marker.band ? `, ${BAND_LABEL[marker.band].toLowerCase()}` : ""}`}
            />
          )}
        </div>

        <DetailsFooter
          text={
            marker.baseline != null
              ? `Baslinje ${formatBaseline(marker)} · ${marker.baselineDays} dagar`
              : `Bygger baslinje — ${marker.baselineDays} av ${MIN_BASELINE_DAYS} dagar`
          }
        />
      </summary>

      <DetailPanel rows={rows} hint={hint} />
    </details>
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

  /* Sammanfattningen uppe till höger ("Allt inom ditt normala") är borttagen
   * 2026-09-15 på begäran: de andra sektionerna på dashboarden har bara en
   * rubrik, och den här stack ut.
   *
   * Inget går förlorat. Varje markör bär sin egen färg och avvikelse i
   * kortet, och det aggregerade beskedet — regeln ur 2.4 om att två eller
   * fler markörer åt samma håll är det som betyder något — har ett eget
   * stycke under rutnätet, plus beredskapsvarningen på dashboarden
   * (buildReadinessAlert). Raden sade alltså samma sak en tredje gång. */

  return (
    /* Sektion och inte kort: innehållet ÄR kort numera, och ett kort runt kort
       ger dubbla ramar och två ytnivåer som inte betyder något. Samma val som
       nyckeltalsringarnas sektioner på dashboarden. */
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">Status</h2>
        {periodLabel && <p className="text-xs text-[var(--ink-3)]">{periodLabel}</p>}
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
      <div className="day-grid grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-3">
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
