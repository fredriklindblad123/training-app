import {
  AVAILABILITY_COLOR_VAR,
  AVAILABILITY_LABELS,
  type AvailabilityPeriod,
} from "@/lib/planning";

/* Tillgänglighetsband (K7 i docs/tranarperspektiv.md).
 *
 * Visar vilka perioder — tentavecka, läger, resa — som täcker den kalenderbit
 * man tittar på. Syftet är enbart att göra avvikelser förklarliga: en vecka
 * med halverad volym ser annars ut som antingen en medveten nedtrappning
 * eller ingenting alls.
 *
 * Medvetet återhållsam i uttrycket. Bandet ska gå att se när man letar efter
 * en förklaring, men aldrig konkurrera med passen om uppmärksamheten — det
 * är kontext, inte träningsdata. Därför en enda dämpad gråton för alla sorter
 * (se AVAILABILITY_COLOR_VAR) och etiketten som identitetsbärare. */

export function AvailabilityBand({
  periods,
  className = "",
}: {
  periods: AvailabilityPeriod[];
  className?: string;
}) {
  if (periods.length === 0) return null;

  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`}>
      {periods.map((p, i) => (
        <span
          key={`${p.start_date}-${p.kind}-${i}`}
          className="inline-flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[11px]"
          style={{
            // Bakgrunden hålls mycket svag och texten i vanlig dämpad ink —
            // en fylld färgruta i samma gråton hade läst som en passmarkering.
            backgroundColor: `color-mix(in srgb, ${AVAILABILITY_COLOR_VAR} 14%, transparent)`,
            color: AVAILABILITY_COLOR_VAR,
          }}
          title={`${AVAILABILITY_LABELS[p.kind]}: ${p.start_date} – ${p.end_date}`}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: AVAILABILITY_COLOR_VAR }}
            aria-hidden="true"
          />
          {p.label?.trim() || AVAILABILITY_LABELS[p.kind]}
        </span>
      ))}
    </div>
  );
}
