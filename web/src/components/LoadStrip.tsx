import type { ReactNode } from "react";
import { Stat, StatRow, StatCell } from "@/components/ui/Stat";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { RAMP_WARN, type LoadRamp } from "@/lib/load-ramp";
import { weekRangeLabel } from "@/lib/week-series";

/* ------------------------------------------------------------------------ *
 * LoadStrip — "Håller jag ihop?"
 *
 * Ersätter det gamla avsnittet "Belastning och återhämtning": ett 380 px
 * diagram med staplad belastning per kategori *plus* fyra SD-normerade
 * återhämtningslinjer, och 150 ord bildtext som förklarade varför dess
 * formkurve-linje pekade åt andra hållet än formkurve-diagrammet längre ner.
 *
 * Tre skäl till att det diagrammet är borta:
 *
 *  1. Absolut belastning är ett Garmin-internt tal utan jämförbarhet. Nivån
 *     säger ingenting; steget säger något. Därför ramp i stället för staplar.
 *  2. Staplar i absoluta enheter och linjer i SD-enheter är två storheter med
 *     olika skala i samma ruta — det är dubbelaxeln, och den är just varför de
 *     två formkurvorna på sidan verkade motsäga varandra.
 *  3. HRV, vilopuls och sömn visas redan på /dashboard som percentilband. Att
 *     visa samma mätvärden här i ett annat statistiskt ramverk gav två facit
 *     för samma fråga. De bor på dashboarden nu, på ett ställe.
 *
 * Kvar blir det som faktiskt går att agera på: blev steget rimligt, var
 * veckorna jämna, och — via efterlevnadskortet som ligger i `children` —
 * vilka planerade pass som inte blev av. Efterlevnaden låg tidigare både som
 * eget kort och som nyckeltal på samma skärm; nu finns den en gång, här.
 * ------------------------------------------------------------------------ */

function rampTone(change: number): "neutral" | "watch" {
  return Math.abs(change) > RAMP_WARN ? "watch" : "neutral";
}

/** Notis när steget är stort — åt båda hållen. En kraftig ökning är den
 * klassiska skaderisken, men ett kraftigt fall är minst lika värt att se:
 * det är där återupptagningen efter ett uppehåll börjar, och den är lätt att
 * ta för fort. Texten namnger vad som hänt och avstår från att diagnosticera
 * varför — appen vet inte om veckan var planerad vila, sjukdom eller ett
 * avbrott. */
function rampNote(ramp: LoadRamp): string | null {
  if (ramp.change > RAMP_WARN) {
    return (
      `Veckan ${weekRangeLabel(ramp.week)} låg ${signed(ramp.change)} över de ${ramp.baseWeeks} ` +
      `föregående. Över ungefär 15 % brukar rekommendationen vara en lugnare vecka innan nästa ` +
      `ökning — tumregeln är ingen gräns, men ett medvetet val är bättre än ett omedvetet.`
    );
  }
  if (ramp.change < -RAMP_WARN) {
    return (
      `Veckan ${weekRangeLabel(ramp.week)} låg ${signed(ramp.change)} under de ${ramp.baseWeeks} ` +
      `föregående. Var det planerad vila är allt som det ska; var det ett avbrott är det ` +
      `upptrappningen efteråt som är värd att hålla igen på.`
    );
  }
  return null;
}

function signed(change: number): string {
  const pct = Math.round(change * 100);
  return `${pct > 0 ? "+" : ""}${pct} %`;
}

export function LoadStrip({
  ramp,
  loadCv,
  headline,
  children,
}: {
  ramp: LoadRamp | null;
  loadCv: number | null;
  /** Aggregatet som syns när sektionen är hopfälld. */
  headline?: string;
  /** Efterlevnadskortet, när ett block är valt. */
  children?: ReactNode;
}) {
  // Inget att visa → sektionen ritas inte alls. En rad med streck är sämre
  // än ingen rad.
  if (ramp == null && loadCv == null && children == null) return null;

  return (
    <CollapsibleSection
      title="Håller jag ihop?"
      meta="Steget mellan veckorna, jämnheten, och om planen blev gjord"
      headline={headline ? <span className="text-sm text-[var(--ink-2)]">{headline}</span> : undefined}
    >
      <p className="max-w-3xl text-sm text-[var(--ink-2)]">
        Belastningens <em>nivå</em> är ett Garmin-internt tal utan jämförbarhet — det som betyder
        något är steget mellan veckorna, jämnheten, och om planen blev gjord.
      </p>

      <StatRow columns={2}>
        <StatCell>
          <Stat
            label="Ramp"
            value={ramp ? signed(ramp.change) : "—"}
            tone={ramp ? rampTone(ramp.change) : "neutral"}
            /* Veckan skrivs ut i etiketten. Rampen mäter den senast
               *avslutade* veckan, inte den pågående — utan datum läses talet
               som "nu", vilket det inte är. */
            sub={
              ramp
                ? `${weekRangeLabel(ramp.week)} mot ${ramp.baseWeeks} föregående`
                : "för få veckor med belastning"
            }
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Konsekvens"
            value={loadCv != null ? loadCv.toFixed(2) : "—"}
            sub={loadCv != null ? "lägre = jämnare vecka för vecka" : "bara i blockvy"}
          />
        </StatCell>
      </StatRow>

      {ramp && rampNote(ramp) && (
        <p className="max-w-3xl text-sm text-[var(--ink-2)]">
          <strong className="font-medium text-[var(--foreground)]">
            {ramp.change > 0 ? "Steget är större än tumregeln." : "Veckan bröt mönstret."}
          </strong>{" "}
          {rampNote(ramp)}
        </p>
      )}

      {children}

      <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
        <summary className="cursor-pointer text-[var(--ink-2)]">
          Var tog HRV, vilopuls och sömn vägen?
        </summary>
        <p className="mt-2 text-[var(--ink-2)]">
          De ligger på startsidans statuskort, som percentilband mot din egen baslinje. Tidigare
          visades de även här, som SD-avvikelse mot ett rullande åttaveckorsfönster — samma
          mätvärden i två olika statistiska ramverk, vilket gav två svar på samma fråga. Nu finns
          ett facit, på det ställe där man tittar på dagsformen.
        </p>
      </details>
    </CollapsibleSection>
  );
}
