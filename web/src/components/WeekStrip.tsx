import Link from "next/link";
import { PassMarker } from "@/components/PassMarker";
import { SV_WEEKDAYS_SHORT } from "@/lib/calendar-utils";

/* Veckan i en remsa, direkt under dagens pass.
 *
 * Veckan fanns bara som en textlänk längst ner på dashboarden — efter status,
 * form och belastning. Men frågan "hur ser resten av veckan ut" kommer direkt
 * efter "vad gör jag idag", inte sist av allt. Remsan svarar på den utan att
 * ta plats: sju prickar och en rad tal.
 *
 * Markörerna följer appens språk (PassMarker): fylld prick = genomfört,
 * ihålig ring = planerat men inte gjort. Bakåt i tiden visas bara det som
 * faktiskt blev av — en ring på onsdag som var i förrgår säger inget man kan
 * göra något åt, den påminner bara om ett missat pass. Framåt är ringen
 * däremot hela poängen.
 */

export type WeekStripDay = {
  /** YYYY-MM-DD */
  date: string;
  /** Genomförda passkategorier, i ordning. */
  done: string[];
  /** Planerade passtyper. Visas bara när dagen saknar genomfört pass. */
  planned: string[];
  isToday: boolean;
  isPast: boolean;
};

export function WeekStrip({
  days,
  doneCount,
  plannedCount,
  kilometres,
  href,
}: {
  days: WeekStripDay[];
  doneCount: number;
  plannedCount: number;
  kilometres: number;
  href: string;
}) {
  const summary =
    plannedCount > 0
      ? `${doneCount} av ${plannedCount} planerade pass`
      : `${doneCount} ${doneCount === 1 ? "pass" : "pass"}`;

  return (
    <Link
      href={href}
      className="flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--ink-3)] hover:bg-[var(--surface-raised)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
          Veckan
        </span>
        <span className="flex items-center gap-1 text-xs text-[var(--ink-3)]">
          Öppna veckan
          <span
            aria-hidden
            className="inline-block h-1.5 w-1.5 -rotate-45 border-t border-r border-current"
          />
        </span>
      </div>

      <div className="flex gap-1">
        {days.map((day, i) => {
          // Bakåt i tiden: bara det som blev av. Framåt: planen.
          const markers = day.done.length > 0 ? day.done : day.isPast ? [] : day.planned;
          const isPlanned = day.done.length === 0 && markers.length > 0;

          return (
            <span
              key={day.date}
              className={`flex min-w-0 flex-1 flex-col items-center gap-1 rounded py-1 ${
                day.isToday ? "bg-[var(--surface-raised)]" : ""
              }`}
            >
              <span
                className={`text-[0.65rem] ${
                  day.isToday
                    ? "font-semibold text-[var(--foreground)]"
                    : "text-[var(--ink-3)]"
                }`}
              >
                {SV_WEEKDAYS_SHORT[i]}
              </span>
              {/* Fast höjd även när dagen är tom, så raden inte hoppar. */}
              <span className="flex h-3 items-center gap-0.5">
                {markers.slice(0, 2).map((type, mi) => (
                  <PassMarker key={`${day.date}-${mi}`} type={type} planned={isPlanned} />
                ))}
              </span>
            </span>
          );
        })}
      </div>

      <p className="text-sm text-[var(--ink-2)]">
        {summary}
        {kilometres > 0 && (
          <>
            {" · "}
            <span className="tabular">{kilometres.toFixed(0)} km</span>
          </>
        )}
      </p>
    </Link>
  );
}
