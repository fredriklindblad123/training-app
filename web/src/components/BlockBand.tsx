import { PHASE_COLOR_VARS, PHASE_LABELS, PERIOD_LABELS, type PeriodType, type PhaseType } from "@/lib/planning";

/* Vilket block och vilken fas perioden ligger i — en rad överst i kalendern.
 *
 * Fram till 2026-09-14 fanns blockkontext bara i årsvyn (YearGrid har en egen
 * Block-växlare). Månad, vecka och dag visade passen men aldrig VARFÖR de såg
 * ut som de gjorde. För en adept som numera inte har Plan-gruppen alls är det
 * skillnaden mellan "tre intervallpass den här veckan" och "tre intervallpass
 * för att jag är i tävlingsförberedande fas".
 *
 * `CalendarHorizon` hade redan en `BandBlock`-typ utan komponent — någon hade
 * påbörjat det här och aldrig byggt klart. Typen bor nu här, hos det som
 * faktiskt använder den.
 *
 * Bandet visar bara block som ÖVERLAPPAR perioden. Flera kan göra det: en
 * månad kan spänna ett blockskifte, och då är just skiftet det viktigaste att
 * se — därför ritas alla överlappande, inte bara det som täcker mest.
 */

export type BandBlock = {
  id: string;
  name: string;
  period: PeriodType;
  phase: PhaseType;
  start_date: string;
  end_date: string;
};

/** Block som överlappar [from, to]. Rena datumsträngar, ingen Date-aritmetik:
 * YYYY-MM-DD sorterar och jämförs korrekt som text, och slipper därmed hela
 * tidszonsfrågan. */
export function blocksOverlapping(blocks: BandBlock[], from: string, to: string): BandBlock[] {
  return blocks
    .filter((b) => b.start_date <= to && b.end_date >= from)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));
}

export function BlockBand({
  blocks,
  from,
  to,
}: {
  blocks: BandBlock[];
  /** Periodens första dag, YYYY-MM-DD. */
  from: string;
  /** Periodens sista dag, YYYY-MM-DD. */
  to: string;
}) {
  const relevant = blocksOverlapping(blocks, from, to);

  /* Inget block är ett normalt tillstånd, inte ett fel — mellan två block, i
     september efter säsongen, eller innan planeringen börjat. Raden visas
     ändå: att den försvinner helt hade gjort att kalendern hoppar i höjd när
     man bläddrar över en blockgräns. */
  if (relevant.length === 0) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-dashed border-[var(--line)] px-3 py-2">
        <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
          Block
        </span>
        <span className="text-sm text-[var(--ink-3)]">Ingen period täcker de här dagarna</span>
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2">
      <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
        Block
      </span>
      {relevant.map((b) => (
        <span key={b.id} className="flex items-baseline gap-2">
          {/* Fasfärgen som en stapel, samma färger och samma grepp som
              blockkorten och tidslinjen — ett block ser likadant ut var man än
              möter det. */}
          <span
            aria-hidden
            className="h-3 w-[3px] shrink-0 self-center rounded-full"
            style={{ backgroundColor: PHASE_COLOR_VARS[b.phase] }}
          />
          <span className="display text-sm font-semibold text-[var(--foreground)]">{b.name}</span>
          <span className="text-xs text-[var(--ink-3)]">
            {PERIOD_LABELS[b.period]} · {PHASE_LABELS[b.phase]}
          </span>
        </span>
      ))}
    </div>
  );
}
