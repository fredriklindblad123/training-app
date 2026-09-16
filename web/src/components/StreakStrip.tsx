/* Kontinuiteten som rutor i stället för en siffra.
 *
 * "12 veckor" är ett faktum man läser och glömmer. Tolv rutor är något man
 * ser att man håller på att bygga — och rutorna gör synligt vad som skulle gå
 * förlorat, vilket siffran inte gör.
 *
 * Bara de senaste veckorna ritas, inte hela sviten. En svit på sextio veckor
 * (vilket finns i datan) hade gett sextio streck som inte går att räkna ändå;
 * poängen är att se det senaste och att sviten lever.
 */

export type StreakWeek = {
  /** Måndagens datum, till etiketten. */
  weekStart: string;
  /** Genomförda pass den veckan. Noll ritar en tom ruta. */
  sessions: number;
  /** Veckan innehöll ett kvalitetspass — tröskel, intervall eller tävling. */
  quality: boolean;
};

const MAX_DOTS = 14;

export function StreakStrip({
  currentWeeks,
  bestWeeks,
  weeks,
}: {
  currentWeeks: number;
  bestWeeks: number;
  weeks: StreakWeek[];
}) {
  const shown = weeks.slice(-MAX_DOTS);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
        Din svit
      </h2>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-baseline gap-2">
          <span className="display text-3xl leading-none font-bold text-[var(--foreground)]">
            {currentWeeks}
          </span>
          <span className="text-sm text-[var(--ink-2)]">
            {currentWeeks === 1 ? "vecka i rad" : "veckor i rad"}
          </span>
        </div>

        {/* Rutorna sist på raden så att talet läses först. Kvalitetsveckor får
            passfärgen för intervall, vanliga veckor tröskelns — samma två
            färger som resten av appen använder för hårt och lugnt. */}
        <div className="flex flex-wrap items-center gap-1" aria-hidden>
          {shown.map((w) => (
            <span
              key={w.weekStart}
              title={`${w.weekStart}: ${w.sessions} pass`}
              className="h-3.5 w-3.5 rounded-[3px]"
              style={{
                backgroundColor:
                  w.sessions === 0
                    ? "var(--line)"
                    : w.quality
                      ? "var(--cat-interval)"
                      : "var(--cat-threshold)",
              }}
            />
          ))}
        </div>

        {bestWeeks > 0 && (
          <span className="tabular ml-auto text-xs text-[var(--ink-3)]">
            Bästa {bestWeeks} v
          </span>
        )}
      </div>

      {/* Rutorna är dekorativa; samma besked i text för den som inte ser dem. */}
      <span className="sr-only">
        {`Nuvarande svit ${currentWeeks} veckor, personbästa ${bestWeeks} veckor.`}
      </span>
    </section>
  );
}
