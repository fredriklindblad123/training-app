import { formatDuration } from "@/lib/format";

/* Mellantiderna från senaste passet, som staplar.
 *
 * Datan har funnits i activity_splits hela tiden — 2 475 aktiva varv över 289
 * pass — och visades ingenstans i appen. För en medeldistanslöpare är
 * varvtiderna det mest intressanta som finns: ett intervallpass ÄR sina varv,
 * och "8,2 km på 41 min" säger ingenting om hur det gick.
 *
 * Bara `active`-varven. Vilorna finns också i tabellen, men de är inte det man
 * jämför — och att blanda in dem hade gjort det snabbaste varvet svårt att
 * hitta bland dubbelt så många staplar.
 *
 * Stapelns längd är TIDEN, inte prestationen, och skalan går från noll. Ett
 * kort varv är en kort stapel. Att i stället skala mot "bästa varvet = full
 * längd" hade förstorat skillnader på någon sekund till dramatiska hopp,
 * vilket är precis vad en 16-åring inte behöver läsa in i ett vardagspass.
 */

export type SplitRow = {
  splitIndex: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
};

/** "1000 m" eller "5×" när distansen saknas — rubriken över staplarna. */
function repsLabel(splits: SplitRow[]): string {
  const dists = splits.map((s) => Math.round((s.distanceMeters ?? 0) / 10) * 10).filter((d) => d > 0);
  if (dists.length === 0) return `${splits.length} varv`;
  // Alla lika långa är det vanliga fallet (5×1000). Skiljer de sig åt visar vi
  // bara antalet — "5×1000/800/600" är sant men oläsligt i en rubrik.
  const same = dists.every((d) => Math.abs(d - dists[0]) <= 20);
  if (!same) return `${splits.length} varv`;
  return dists[0] >= 2000
    ? `${splits.length}×${(dists[0] / 1000).toFixed(1).replace(".", ",")} km`
    : `${splits.length}×${dists[0]} m`;
}

export function SplitBars({
  splits,
  title,
  dateLabel,
}: {
  splits: SplitRow[];
  /** Passets namn, t.ex. "Intervaller". */
  title: string;
  dateLabel: string;
}) {
  const timed = splits.filter((s) => (s.durationSeconds ?? 0) > 0);
  if (timed.length < 2) return null;

  const max = Math.max(...timed.map((s) => s.durationSeconds as number));
  const fastest = Math.min(...timed.map((s) => s.durationSeconds as number));

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Senaste varven
        </h2>
        <span className="text-xs text-[var(--ink-3)]">
          {title} · {dateLabel}
        </span>
      </div>

      <div className="flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
          {repsLabel(timed)}
        </div>

        {timed.map((s) => {
          const secs = s.durationSeconds as number;
          const best = secs === fastest;
          return (
            <div key={s.splitIndex} className="flex items-center gap-2">
              <span className="tabular w-5 shrink-0 text-xs text-[var(--ink-3)]">
                {s.splitIndex}
              </span>
              {/* Stapeln ligger i ett EGET spår som får resten av bredden.
                  Procenten räknades först direkt på stapeln, men den satt då i
                  samma flexrad som varvnumret och tiden — 100% av raden PLUS
                  två textkolumner blev bredare än kortet, och staplarna gick
                  utanför. Spåret äger bredden, stapeln äger sin andel av
                  spåret. */}
              <span className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-[var(--surface-raised)]">
                <span
                  className="h-full rounded-sm"
                  style={{
                    // Minst 6% så att även det snabbaste varvet syns som en
                    // stapel och inte som ett streck.
                    width: `${Math.max(6, (secs / max) * 100)}%`,
                    backgroundColor: best ? "var(--status-watch)" : "var(--cat-interval)",
                  }}
                />
              </span>
              <span
                className={`tabular w-12 shrink-0 text-right text-xs ${
                  best
                    ? "font-semibold text-[var(--status-watch-ink)]"
                    : "text-[var(--ink-2)]"
                }`}
              >
                {formatDuration(secs)}
              </span>
            </div>
          );
        })}
      </div>
    </section>
  );
}
