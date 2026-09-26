import { formatPace } from "@/lib/format";

/* Laktatmätningar på ett pass.
 *
 * Tabellen lactate_readings och server-actions för att spara och ta bort har
 * funnits sedan migration 20260726110000, men utan gränssnitt — noll rader
 * loggade. Det här är formuläret som saknades (begäran 2026-09-26).
 *
 * Medvetet minimalt. Gruppen har inte börjat mäta än, och ett formulär med
 * tio fält blir aldrig ifyllt vid banans kant med en laktatmätare i handen
 * och en frusen adept bredvid. Bara mmol krävs; fart och puls är frivilliga
 * och fyller man i dem blir mätningen användbar i tröskelkurvan i stället
 * för bara ett tal i en lista.
 *
 * measured_at sätts av servern vid insättning, inte som ett fält: sticken
 * tas i ordning under passet, och den ordningen är det som betyder något.
 */

export const LACTATE_CONTEXT_LABELS: Record<string, string> = {
  test: "Tröskeltest",
  workout: "Under passet",
  race: "Tävling",
};

export type LactateReading = {
  id: string;
  lactate_mmol: number;
  pace_seconds_per_km: number | null;
  heart_rate: number | null;
  context: string | null;
  note: string | null;
  measured_at: string;
};

const field =
  "rounded border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-sm";

export function LactateLog({
  readings,
  activityId,
  entryDate,
  athleteId,
  addAction,
  deleteAction,
}: {
  readings: LactateReading[];
  /** Passet mätningen hör till. Null när dagen saknar loggat pass. */
  activityId: string | null;
  /** Dagen sticket hör till (YYYY-MM-DD) — inte dagen man skriver in det. */
  entryDate: string;
  /** Adepten sticket hör till — en tränare loggar åt någon annan. */
  athleteId: string;
  addAction: (formData: FormData) => Promise<void>;
  deleteAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
        Laktat
      </h2>

      {readings.length > 0 && (
        <ul className="flex flex-col gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)]">
          {readings.map((r, i) => (
            <li
              key={r.id}
              className="flex flex-wrap items-baseline gap-x-3 gap-y-1 bg-[var(--surface)] px-3 py-2 text-sm"
            >
              <span className="text-[var(--ink-3)]">Stick {i + 1}</span>
              <span className="display tabular text-lg font-bold text-[var(--foreground)]">
                {Number(r.lactate_mmol).toFixed(1)}
                <span className="ml-1 text-xs font-normal text-[var(--ink-3)]">mmol/l</span>
              </span>
              {r.pace_seconds_per_km != null && (
                <span className="tabular text-[var(--ink-2)]">
                  {formatPace(r.pace_seconds_per_km)}
                </span>
              )}
              {r.heart_rate != null && (
                <span className="tabular text-[var(--ink-2)]">{r.heart_rate} slag</span>
              )}
              {r.context && (
                <span className="text-xs text-[var(--ink-3)]">
                  {LACTATE_CONTEXT_LABELS[r.context] ?? r.context}
                </span>
              )}
              {r.note && <span className="text-xs text-[var(--ink-3)]">{r.note}</span>}
              <form action={deleteAction} className="ml-auto">
                <input type="hidden" name="reading_id" value={r.id} />
                <input type="hidden" name="athlete" value={athleteId} />
                <button
                  type="submit"
                  className="text-xs text-[var(--ink-3)] underline hover:text-[var(--foreground)]"
                >
                  ta bort
                </button>
              </form>
            </li>
          ))}
        </ul>
      )}

      {/* Ett stick per rad, mmol först. Fart och puls hör ihop med sticket —
          utan dem går mätningen inte att placera på tröskelkurvan, men de
          ska inte stoppa någon från att spara talet. */}
      <form
        action={addAction}
        className="flex flex-wrap items-end gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3"
      >
        <input type="hidden" name="entry_date" value={entryDate} />
        <input type="hidden" name="athlete" value={athleteId} />
        {activityId && <input type="hidden" name="activity_id" value={activityId} />}

        <label className="flex flex-col gap-1 text-xs text-[var(--ink-3)]">
          Laktat (mmol/l)
          <input
            name="lactate_mmol"
            type="number"
            step="0.1"
            min="0"
            max="30"
            required
            placeholder="3.2"
            className={`${field} w-24`}
          />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[var(--ink-3)]">
          Fart (min/km)
          <span className="flex items-center gap-1">
            <input name="pace_min" type="number" min="0" max="20" placeholder="3" className={`${field} w-14`} />
            <span className="text-[var(--ink-3)]">:</span>
            <input name="pace_sek" type="number" min="0" max="59" placeholder="50" className={`${field} w-14`} />
          </span>
        </label>

        <label className="flex flex-col gap-1 text-xs text-[var(--ink-3)]">
          Puls
          <input name="heart_rate" type="number" min="60" max="240" placeholder="178" className={`${field} w-20`} />
        </label>

        <label className="flex flex-col gap-1 text-xs text-[var(--ink-3)]">
          Sammanhang
          <select name="context" defaultValue="test" className={field}>
            {Object.entries(LACTATE_CONTEXT_LABELS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
        </label>

        <label className="flex min-w-32 flex-1 flex-col gap-1 text-xs text-[var(--ink-3)]">
          Kommentar
          <input name="note" type="text" className={field} />
        </label>

        <button
          type="submit"
          className="rounded bg-[var(--foreground)] px-3 py-1.5 text-sm text-[var(--background)] hover:opacity-90"
        >
          Spara stick
        </button>
      </form>

      <p className="text-xs text-[var(--ink-3)]">
        Fyll i fart och puls när du kan — det är de som gör att sticket går att placera på
        tröskelkurvan under Form. Bara mmol räcker för att spara.
      </p>
    </section>
  );
}
