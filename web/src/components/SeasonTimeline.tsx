import {
  PHASE_COLOR_VARS,
  PHASE_LABELS,
  PRIORITY_SHORT,
  SEASON_LABELS,
  type PeriodType,
  type PhaseType,
  type Priority,
  type SeasonKind,
} from "@/lib/planning";

/* Säsongsöversikt: block som ett band över tiden, med tävlingar som markörer.
 *
 * Poängen är att se periodiseringen mot tävlingarna i ett svep — ligger
 * nedtrappningen verkligen före A-tävlingen, och finns det en lucka i
 * planeringen mitt i säsongen? Det är svårt att se i en lista och lätt att se
 * i ett band. */

export type TimelineBlock = {
  id: string;
  name: string;
  period: PeriodType;
  phase: PhaseType;
  season: SeasonKind | null;
  start_date: string;
  end_date: string;
  sessions_count: number | null;
  days_count: number | null;
  starts_count: number | null;
  hours_count: number | null;
  has_test: boolean;
};

export type TimelineCompetition = {
  id: string;
  name: string;
  competition_date: string;
  priority: Priority;
  venue: SeasonKind | null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function dayNumber(dateKey: string): number {
  return Math.floor(new Date(`${dateKey}T00:00:00`).getTime() / 864e5);
}

function shortDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

export function SeasonTimeline({
  blocks,
  competitions,
}: {
  blocks: TimelineBlock[];
  competitions: TimelineCompetition[];
}) {
  if (blocks.length === 0 && competitions.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Ingen planering ännu. Lägg till en A-tävling och låt appen föreslå en periodisering,
        eller skapa block för hand nedan.
      </p>
    );
  }

  const allDates = [
    ...blocks.flatMap((b) => [b.start_date, b.end_date]),
    ...competitions.map((c) => c.competition_date),
  ];
  const min = dayNumber(allDates.reduce((a, b) => (a < b ? a : b)));
  const max = dayNumber(allDates.reduce((a, b) => (a > b ? a : b)));
  const span = Math.max(1, max - min);

  const pct = (dateKey: string) => ((dayNumber(dateKey) - min) / span) * 100;
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayPct = pct(todayKey);
  const todayVisible = todayPct >= 0 && todayPct <= 100;

  // Sorterade så att banden ritas i kronologisk ordning.
  const sortedBlocks = [...blocks].sort((a, b) => a.start_date.localeCompare(b.start_date));

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-x-auto">
        <div className="min-w-[32rem]">
          {/* Blockband */}
          <div className="relative h-12 rounded bg-zinc-100 dark:bg-zinc-900">
            {sortedBlocks.map((b) => {
              const left = pct(b.start_date);
              const width = Math.max(1.5, pct(b.end_date) - left);
              return (
                <div
                  key={b.id}
                  className="absolute top-0 flex h-12 items-center overflow-hidden rounded px-2"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: PHASE_COLOR_VARS[b.phase],
                  }}
                  title={`${b.name} — ${PHASE_LABELS[b.phase]}, ${shortDate(b.start_date)}–${shortDate(b.end_date)}`}
                >
                  <span className="truncate text-xs font-medium text-white drop-shadow-sm">
                    {b.name}
                  </span>
                </div>
              );
            })}

            {todayVisible && (
              <div
                className="absolute top-0 h-12 w-0.5 bg-zinc-900 dark:bg-zinc-50"
                style={{ left: `${todayPct}%` }}
                title={`Idag ${todayKey}`}
              />
            )}
          </div>

          {/* Tävlingsmarkörer */}
          <div className="relative mt-1 h-10">
            {competitions.map((c) => (
              <div
                key={c.id}
                className="absolute flex -translate-x-1/2 flex-col items-center"
                style={{ left: `${pct(c.competition_date)}%` }}
                title={`${c.name} — ${shortDate(c.competition_date)}${c.venue ? ` (${SEASON_LABELS[c.venue]})` : ""}`}
              >
                <div
                  className={`h-3 w-3 rotate-45 ${
                    c.priority === "A"
                      ? "bg-red-600"
                      : c.priority === "B"
                        ? "bg-amber-500"
                        : "bg-zinc-400"
                  }`}
                />
                <span className="mt-0.5 whitespace-nowrap text-[10px] text-zinc-500 dark:text-zinc-400">
                  {PRIORITY_SHORT[c.priority]} {shortDate(c.competition_date)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
        {[...new Set(sortedBlocks.map((b) => b.phase))].map((t) => (
          <span key={t} className="flex items-center gap-1.5">
            <span
              className="inline-block h-2.5 w-2.5 rounded-sm"
              style={{ backgroundColor: PHASE_COLOR_VARS[t] }}
            />
            {PHASE_LABELS[t]}
          </span>
        ))}
        {competitions.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-red-600" />
            A-tävling
          </span>
        )}
      </div>
    </div>
  );
}
