import { BAND_LABELS, ZONE_LABELS, type BandKey } from "@/lib/intensity";
import { labSourceName, labZoneRanges, type LabZoneSet } from "@/lib/zone-sources";

/* Märkningen av zonsiffror som räknats mot uppmätta zoner, samma överallt
 * (lib/zone-sources.ts). Taggen talar om vilket test siffran bygger på.
 * Utan uppmätt zonuppsättning märks ingenting: då är klockans zoner det
 * enda som finns, precis som förut.
 *
 * Tonad platta + -ink-varianten av statusfärgen: grundtonen klarar inte
 * 4,5:1 som liten text (se --status-good-ink i globals.css).
 *
 * Allt här ska rymmas på 390 px. */

export function LabZoneTag({
  labSet,
  short = false,
}: {
  labSet: LabZoneSet;
  /** Bara "Laktattest", för smala rubriker. Hela texten i title. */
  short?: boolean;
}) {
  const full = labSourceName(labSet);
  return (
    <span
      title={short ? full : undefined}
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-semibold whitespace-nowrap"
      style={{
        color: "var(--status-good-ink)",
        backgroundColor: "color-mix(in srgb, var(--status-good) 14%, transparent)",
      }}
    >
      <span aria-hidden>✓</span>
      {short ? full.split(" ")[0] : full}
    </span>
  );
}

/** Zonernas pulsgränser, en rad per zon. */
export function ZoneBoundsLegend({ labSet }: { labSet: LabZoneSet }) {
  const lab = labZoneRanges(labSet);
  return (
    <table className="text-xs tabular">
      <caption className="pb-1 text-left text-[var(--ink-3)]">Puls, slag/min</caption>
      <tbody>
        {ZONE_LABELS.map((z, i) => (
          <tr key={z} className="border-t border-[var(--line)]">
            <th scope="row" className="py-1 pr-3 text-left font-medium whitespace-nowrap text-[var(--ink-3)]">
              {z}
            </th>
            <td className="py-1 whitespace-nowrap text-[var(--foreground)]">{lab[i]}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** En rad i en tvåkolumnig jämförelsetabell (block mot block, lopp mot
 * lopp). `lab` märker rader vars värde räknats mot uppmätta zoner. */
export type ComparisonRow = { label: string; a: string; b: string; lab?: boolean };

export function ComparisonTableRow({
  row,
  labSet,
}: {
  row: ComparisonRow;
  labSet: LabZoneSet | null;
}) {
  return (
    <tr>
      <th scope="row" className="py-1.5 pr-4 font-normal text-[var(--ink-2)]">
        {/* Taggen på egen rad under etiketten: bredvid gjorde den första
            kolumnen ~450 px bred, och tabellerna här är min-w-max. */}
        <span className="flex flex-col items-start gap-1">
          {row.label}
          {row.lab && labSet && <LabZoneTag labSet={labSet} />}
        </span>
      </th>
      <td className="py-1.5 pr-4 tabular-nums">{row.a}</td>
      <td className="py-1.5 tabular-nums">{row.b}</td>
    </tr>
  );
}

/** Zonbanden som rad i en jämförelsetabell: mot uppmätta zoner när löparen
 * har en uppsättning, annars klockans zoner som förut. */
export function zoneBandRows(
  a: { bandPct: Record<BandKey, number>; labBandPct: Record<BandKey, number> | null },
  b: { bandPct: Record<BandKey, number>; labBandPct: Record<BandKey, number> | null },
  labSet: LabZoneSet | null,
): ComparisonRow[] {
  const label = `${BAND_LABELS.easy} / ${BAND_LABELS.threshold}`;
  const fmt = (p: Record<BandKey, number> | null) =>
    p ? `${Math.round(p.easy * 100)}% / ${Math.round(p.threshold * 100)}%` : "ingen pulskurva";
  if (!labSet) return [{ label, a: fmt(a.bandPct), b: fmt(b.bandPct) }];
  return [{ label, a: fmt(a.labBandPct), b: fmt(b.labBandPct), lab: true }];
}
