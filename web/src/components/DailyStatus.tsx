import {
  MIN_BASELINE_DAYS,
  type DailyStatus as DailyStatusData,
  type MarkerStatus,
} from "@/lib/daily-status";
import { ringFillAndStatus, type RingStatus } from "@/lib/kpi-ring";
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
function MarkerCard({ marker }: { marker: MarkerStatus }) {
  const { status } = ringFillAndStatus(marker.current, marker.baseline, marker.spec.direction);
  const effectiveStatus: RingStatus = marker.baseline == null ? "unknown" : status;

  /* Pilen visar läget mot baslinjen, inte en trend över tid. Underlaget
   * (MarkerStatus) har senaste veckans median och baslinjens median — men
   * inget föregående fönster, så en riktig tidstrend går inte att räkna fram
   * här utan att hitta på den. Pilen säger därför "över/under ditt vanliga".
   *
   * Procent och inte standardavvikelser (ändrat 2026-09-15 på begäran): de
   * andra korten på dashboarden visar procentuell förändring, och "+0,8 SD"
   * krävde att man kunde begreppet för att läsa kortet alls.
   *
   * Bytet gör kortet mer konsekvent även inuti sig självt. FÄRGEN har hela
   * tiden räknats på kvoten current/baseline (ringFillAndStatus), inte på
   * SD — så kortet visade ett SD-tal bredvid en färg som kom från en kvot.
   * Nu kommer båda ur samma tal.
   *
   * Priset: SD-talet fanns ingen annanstans i gränssnittet, och det är
   * SD-tröskeln (DEVIATION_THRESHOLD) som avgör om markören räknas in i
   * "två eller fler utanför det normala". Den regeln syns fortfarande — men
   * som eget stycke under rutnätet, inte som ett tal man kan följa här. */
  const pct =
    marker.current != null && marker.baseline != null && marker.baseline !== 0
      ? (marker.current - marker.baseline) / marker.baseline
      : null;

  // Strecket är knutet till det VISADE talet, inte till en egen tröskel: det
  // kommer alltid och bara när kortet skriver 0.0%. En pil bredvid en nolla
  // hade sett ut som ett fel.
  const direction: TrendDirection =
    pct == null || Math.abs(pct * 100) < 0.05 ? "flat" : pct > 0 ? "up" : "down";
  const devText =
    pct == null ? null : `${pct > 0 ? "+" : ""}${(pct * 100).toFixed(1)}%`;

  return (
    <div className="flex flex-col gap-2 bg-[var(--surface)] px-3 py-3">
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
            status={effectiveStatus}
            direction={direction}
            text={devText}
            srLabel={`${devText} ${direction === "up" ? "över" : direction === "down" ? "under" : "vid"} baslinjen`}
          />
        )}
      </div>

      {/* Baslinjen står alltid utskriven. Utan den är "+6,7%" ett tal utan
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
