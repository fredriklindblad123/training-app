import { formatDuration } from "@/lib/format";

/* Rekordkortet: det enda stället i appen där en animering förtjänar sin plats.
 *
 * Spelas när senaste passets snabbaste varv slår årets bästa på samma
 * sträcka. Det är med flit sällsynt — en animering som spelas varje gång är
 * bakgrundsbrus på tredje dagen, en som spelas några gånger per termin är
 * något man väntar på.
 *
 * Ritat i CSS, inte med bild eller video: det väger noll extra kilobyte, och
 * appen har redan ett laddtidsproblem som inte ska betalas med dekoration.
 *
 * prefers-reduced-motion respekteras via Tailwinds motion-reduce — den som
 * bett systemet om mindre rörelse får kortet direkt, utan svep.
 */
export function RecordCard({
  distanceMeters,
  durationSeconds,
  previousBest,
}: {
  /** Sträckan varvet RÄKNAS SOM, från databasen — inte den uppmätta.
   *
   * Kortet avrundade tidigare den uppmätta distansen själv, vilket är hur
   * felet uppstod: ett tidsintervall på 757 m blev "750 m" och påstods vara
   * ett personbästa, trots att målet var tre minuter och tiden per definition
   * inte kunde bli bättre. Nu utlöses kortet bara på sträckor databasen
   * godkänt som riktiga, och etiketten skriver ut just den sträckan. */
  distanceMeters: number;
  durationSeconds: number;
  previousBest: number;
}) {
  const gain = previousBest - durationSeconds;
  const label =
    distanceMeters >= 2000
      ? `Snabbaste ${(distanceMeters / 1000).toFixed(1).replace(".", ",")} km i år`
      : `Snabbaste ${distanceMeters} m i år`;

  return (
    <section
      className="flex flex-col items-center gap-1 rounded-lg border p-5 text-center motion-safe:animate-[record_0.6s_cubic-bezier(0.2,0.7,0.3,1)_both]"
      style={{
        borderColor: "color-mix(in oklab, var(--status-watch) 55%, var(--line))",
        background:
          "linear-gradient(150deg, color-mix(in oklab, var(--status-watch) 16%, var(--surface)), color-mix(in oklab, var(--cat-interval) 10%, var(--surface)))",
      }}
    >
      <span className="display text-[0.6875rem] font-bold tracking-[0.2em] text-[var(--status-watch-ink)] uppercase">
        {label}
      </span>
      <span className="display tabular text-[2.75rem] leading-none font-bold text-[var(--foreground)]">
        {formatDuration(durationSeconds)}
      </span>
      <span className="tabular text-sm font-medium text-[var(--status-watch-ink)]">
        {`−${gain < 10 ? gain.toFixed(1).replace(".", ",") : Math.round(gain)} s mot ditt förra bästa`}
      </span>
    </section>
  );
}
