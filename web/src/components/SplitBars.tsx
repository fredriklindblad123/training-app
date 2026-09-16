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
  /** Sträckan varvet räknas som, eller null när det inte är en riktig sträcka
   * utan bara hur långt man hann. Kommer från databasen, se migrationen
   * record_only_for_real_distances. */
  canonicalDistance: number | null;
};

/* Vilka varv som faktiskt ÄR repetitionerna, och vad de ska kallas.
 *
 * Ett Garmin-pass är inte en ren lista repetitioner. Ett verkligt pass såg ut
 * så här: tre kilometer uppvärmning, ett varv på 63 m, sex varv på exakt 181
 * sekunder, fem joggvilor på 90 sekunder — alla märkta "active" av klockan —
 * och sedan nedjogg. Att rita alla sjutton som likvärdiga staplar och kalla
 * dem "17 varv" säger inget om vad passet var.
 *
 * Regeln: hitta den största gruppen varv som hör ihop, och visa bara den.
 *
 *   TID först. Ligger flera varv på samma sekund är passet tidsbaserat —
 *   "6×3 min" — och distansen är ett utfall, inte ett mål. Det var precis den
 *   feltolkningen som rapporterades: appen påstod personbästa på 750 m när
 *   målet var tre minuter och tiden per definition inte kunde bli bättre.
 *
 *   DISTANS annars, och bara på en riktig sträcka (canonicalDistance från
 *   databasen). 757 m är ingen sträcka, det är hur långt man hann.
 *
 * Hittas ingen grupp visas alla varv och etiketten säger bara antalet — ett
 * ärligt "det här är vad klockan spelade in".
 */

/** Grupperar på ett värde med 2% tolerans och returnerar den största gruppen. */
function largestCluster(
  splits: SplitRow[],
  valueOf: (s: SplitRow) => number | null,
): SplitRow[] {
  let best: SplitRow[] = [];
  for (const anchor of splits) {
    const v = valueOf(anchor);
    if (v == null || v <= 0) continue;
    const group = splits.filter((s) => {
      const w = valueOf(s);
      return w != null && Math.abs(w - v) <= v * 0.02;
    });
    if (group.length > best.length) best = group;
  }
  return best;
}

function minutesLabel(seconds: number): string {
  const m = seconds / 60;
  // Hela minuter är det normala (3 min, 90 sek skrivs som 1,5 min).
  return Number.isInteger(Math.round(m * 10) / 10) && Math.abs(m - Math.round(m)) < 0.02
    ? `${Math.round(m)} min`
    : `${(Math.round(m * 10) / 10).toFixed(1).replace(".", ",")} min`;
}

function selectReps(splits: SplitRow[]): { reps: SplitRow[]; label: string } {
  const byTime = largestCluster(splits, (s) => s.durationSeconds);
  if (byTime.length >= 3) {
    const secs = byTime[0].durationSeconds as number;
    return { reps: byTime, label: `${byTime.length}×${minutesLabel(secs)}` };
  }

  const byDistance = largestCluster(splits, (s) => s.canonicalDistance ?? null);
  if (byDistance.length >= 2) {
    const d = byDistance[0].canonicalDistance as number;
    return {
      reps: byDistance,
      label:
        d >= 2000
          ? `${byDistance.length}×${(d / 1000).toFixed(1).replace(".", ",")} km`
          : `${byDistance.length}×${d} m`,
    };
  }

  return { reps: splits, label: `${splits.length} varv` };
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
  const all = splits.filter((s) => (s.durationSeconds ?? 0) > 0);
  if (all.length < 2) return null;

  const { reps: timed, label: repsText } = selectReps(all);
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

      <div className="day-surface flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
          {repsText}
        </div>

        {timed.map((s) => {
          const secs = s.durationSeconds as number;
          const best = secs === fastest;
          return (
            <div key={s.splitIndex} className="flex items-center gap-2">
              {/* Garmin numrerar varven från noll. Att visa "0, 1, 2" för det
                  som en löpare räknar som första, andra, tredje varvet är
                  bara förvirrande — numret är en etikett, inte ett index. */}
              <span className="tabular w-5 shrink-0 text-xs text-[var(--ink-3)]">
                {timed.indexOf(s) + 1}
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
