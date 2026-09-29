import { BAND_LABELS, ZONE_LABELS, type BandKey } from "@/lib/intensity";
import {
  garminZoneRanges,
  labSourceName,
  labZoneRanges,
  type LabZoneSet,
  type ZoneSource,
} from "@/lib/zone-sources";

/* Märkningen av en zonsiffras källa, samma överallt (lib/zone-sources.ts).
 *
 * Labbet: grön text, "rätt" i betydelsen mätt mot hennes fysiologi.
 * Klockan: amber, "missvisande" — det är ett omdöme om datakällan, aldrig om
 * något löparen gjort, och det står bara när det finns en mätning att
 * jämföra mot. Utan uppmätt zonuppsättning märks ingenting: då är klockan
 * det enda som finns, precis som förut.
 *
 * Tonad platta + -ink-varianten av statusfärgen: grundtonerna klarar inte
 * 4,5:1 som liten text (se --status-good-ink i globals.css).
 *
 * Allt här ska rymmas på 390 px. Tabellerna är därför byggda på höjden (en
 * rad per zon, en rad per källa) i stället för på bredden — den första
 * versionen hade källorna som kolumner, och på mobil föll klockans kolumn
 * utanför bild, alltså precis den jämförelse komponenterna finns för. */

/** Klockans överstrukna värden. --ink-2, inte --ink-3: de ska gå att läsa,
 * det är dem man jämför med. */
const MISLEADING_VALUE =
  "text-[var(--ink-2)] line-through decoration-[var(--status-watch)] decoration-2";

export function ZoneSourceTag({
  source,
  labSet,
  short = false,
}: {
  source: ZoneSource;
  labSet: LabZoneSet;
  /** Bara källans namn, för smala kolumnrubriker. Hela texten i title. */
  short?: boolean;
}) {
  const lab = source === "lab";
  const color = lab ? "var(--status-good-ink)" : "var(--status-watch-ink)";
  const plate = lab ? "var(--status-good)" : "var(--status-watch)";
  const full = lab ? labSourceName(labSet) : "Klockans zoner · missvisande";
  return (
    <span
      title={short ? full : undefined}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={{ color, backgroundColor: `color-mix(in srgb, ${plate} 14%, transparent)` }}
    >
      <span aria-hidden>{lab ? "✓" : "!"}</span>
      {short ? (lab ? "Laktattest" : "Klockan") : full}
    </span>
  );
}

/** Förklaringen till varför klockans siffror är missvisande, med båda
 * källornas gränser utskrivna. Gränserna är själva beviset — utan dem är
 * "missvisande" bara ett påstående. En rad per zon. */
export function ZoneBoundsLegend({
  labSet,
  garminBounds,
}: {
  labSet: LabZoneSet;
  garminBounds: number[] | null;
}) {
  const lab = labZoneRanges(labSet);
  const garmin = garminBounds ? garminZoneRanges(garminBounds) : null;
  return (
    <table className="text-xs tabular">
      <caption className="pb-1 text-left text-[var(--ink-3)]">Puls, slag/min</caption>
      <thead>
        <tr className="text-left">
          <th className="py-1 pr-3 font-medium text-[var(--ink-3)]" />
          <th className="py-1 pr-3">
            <ZoneSourceTag source="lab" labSet={labSet} short />
          </th>
          {garmin && (
            <th className="py-1">
              <ZoneSourceTag source="garmin" labSet={labSet} short />
            </th>
          )}
        </tr>
      </thead>
      <tbody>
        {ZONE_LABELS.map((z, i) => (
          <tr key={z} className="border-t border-[var(--line)]">
            <th scope="row" className="py-1 pr-3 text-left font-medium whitespace-nowrap text-[var(--ink-3)]">
              {z}
            </th>
            <td className="py-1 pr-3 whitespace-nowrap text-[var(--foreground)]">{lab[i]}</td>
            {garmin && <td className={`py-1 whitespace-nowrap ${MISLEADING_VALUE}`}>{garmin[i]}</td>}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function pct(v: number | undefined | null): string {
  return v == null ? "–" : `${Math.round(v * 100)} %`;
}

/** Bandens namn uppdelat, så att kolumnrubriken bryts där den ska. */
const BAND_SHORT: Record<BandKey, [string, string]> = {
  easy: ["Lugnt", "zon 1–2"],
  middle: ["Mitten", "zon 3"],
  threshold: ["Tröskel och över", "zon 4–5"],
};

/** Tre band, två källor. En rad per källa, labbet först: det är den som
 * stämmer, klockans står under för att man ska se hur fel den var. */
export function ZoneBandCompare({
  labSet,
  lab,
  garmin,
  coverage,
}: {
  labSet: LabZoneSet;
  lab: Record<BandKey, number> | null;
  garmin: Record<BandKey, number> | null;
  /** "12 av 14 pass" när labbsiffran inte bygger på alla pass. */
  coverage?: string | null;
}) {
  const bands: BandKey[] = ["easy", "middle", "threshold"];
  return (
    <div className="flex flex-col gap-1">
      <table className="w-full max-w-md table-fixed text-sm tabular">
        <thead>
          <tr className="text-left align-bottom">
            {bands.map((b) => (
              <th key={b} className="py-1 pr-3 text-xs font-medium text-[var(--ink-2)]">
                {BAND_SHORT[b][0]}
                <span className="block font-normal text-[var(--ink-3)]">{BAND_SHORT[b][1]}</span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr className="border-t border-[var(--line)]">
            <td colSpan={3} className="pt-2">
              <ZoneSourceTag source="lab" labSet={labSet} />
            </td>
          </tr>
          <tr>
            {bands.map((b) => (
              <td key={b} className="py-1 pr-3 text-base font-semibold text-[var(--foreground)]">
                {pct(lab?.[b])}
              </td>
            ))}
          </tr>
          <tr>
            <td colSpan={3} className="pt-2">
              <ZoneSourceTag source="garmin" labSet={labSet} />
            </td>
          </tr>
          <tr>
            {bands.map((b) => (
              <td key={b} className={`py-1 pr-3 ${MISLEADING_VALUE}`}>
                {pct(garmin?.[b])}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
      {coverage && (
        <p className="text-xs text-[var(--ink-3)]">
          Raden {labSourceName(labSet)} bygger på {coverage}.
        </p>
      )}
    </div>
  );
}

/** En rad i en tvåkolumnig jämförelsetabell (block mot block, lopp mot
 * lopp). `source` märker rader vars värde kommer ur pulszoner. */
export type ComparisonRow = { label: string; a: string; b: string; source?: ZoneSource };

export function ComparisonTableRow({
  row,
  labSet,
}: {
  row: ComparisonRow;
  labSet: LabZoneSet | null;
}) {
  const misleading = row.source === "garmin" && labSet != null;
  const valueClass = misleading
    ? `py-1.5 pr-4 tabular-nums ${MISLEADING_VALUE}`
    : "py-1.5 pr-4 tabular-nums";
  return (
    <tr>
      <th scope="row" className="py-1.5 pr-4 font-normal text-[var(--ink-2)]">
        {/* Taggen på egen rad under etiketten: bredvid gjorde den första
            kolumnen ~450 px bred, och tabellerna här är min-w-max. */}
        <span className="flex flex-col items-start gap-1">
          {row.label.trim()}
          {row.source && labSet && <ZoneSourceTag source={row.source} labSet={labSet} />}
        </span>
      </th>
      <td className={valueClass}>{row.a}</td>
      <td className={valueClass.replace(" pr-4", "")}>{row.b}</td>
    </tr>
  );
}

/** Zonbanden som rader i en jämförelsetabell. Med uppmätt zonuppsättning två
 * rader: först mätningen, sedan klockans siffra märkt som missvisande. Utan
 * uppsättning en rad med klockans siffra, som förut. Etiketterna skiljer sig
 * på ett mellanslag bara för att vara unika React-nycklar; det trimmas vid
 * utskrift. */
export function zoneBandRows(
  a: { bandPct: Record<BandKey, number>; labBandPct: Record<BandKey, number> | null },
  b: { bandPct: Record<BandKey, number>; labBandPct: Record<BandKey, number> | null },
  labSet: LabZoneSet | null,
): ComparisonRow[] {
  const label = `${BAND_LABELS.easy} / ${BAND_LABELS.threshold}`;
  const fmt = (p: Record<BandKey, number> | null) =>
    p ? `${Math.round(p.easy * 100)}% / ${Math.round(p.threshold * 100)}%` : "ingen pulskurva";
  const garmin = { label, a: fmt(a.bandPct), b: fmt(b.bandPct) };
  if (!labSet) return [garmin];
  return [
    { label, a: fmt(a.labBandPct), b: fmt(b.labBandPct), source: "lab" },
    { ...garmin, label: `${label} `, source: "garmin" },
  ];
}
