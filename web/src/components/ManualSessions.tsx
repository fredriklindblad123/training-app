import { CATEGORY_LABELS, CATEGORY_VALUES, categoryColorVar, isActivityCategory } from "@/lib/categories";
import { formatDuration, formatKm } from "@/lib/format";

/* Egna pass: träning som inte kommer från Garmin.
 *
 * Flera per dag är normalfallet, inte undantaget — ett styrkepass på kvällen
 * efter ett löppass på morgonen, eller ett cykelpass som komplement. Tidigare
 * låg det här inbakat i dagboksformuläret med datumet som external_id, vilket
 * via unik-constrainten tillät exakt ett eget pass per dag, och dessutom bara
 * på dagar utan Garmin-data. */

export type ManualActivity = {
  id: string;
  name: string | null;
  category: string | null;
  start_time: string;
  distance_meters: number | null;
  duration_seconds: number | null;
};

const inputClass =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Klockslag ur en tidsstämpel, i den form ett <input type="time"> vill ha. */
function timeValue(startTime: string): string {
  return startTime.slice(11, 16) || "12:00";
}

export function ManualSessions({
  dateStr,
  activities,
  saveAction,
  deleteAction,
  athleteId,
}: {
  dateStr: string;
  activities: ManualActivity[];
  saveAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
  /** Fas 0-uppföljning: vilken löpare ett nytt eget pass ska skrivas på — se
   * resolvedAthleteId i actions.ts. Bara relevant för "Lägg till"-formuläret
   * nedan, en uppdatering av ett befintligt pass rör aldrig ägaren. */
  athleteId: string;
}) {
  const sorted = [...activities].sort((a, b) => a.start_time.localeCompare(b.start_time));

  return (
    <div className="flex flex-col gap-3">
      {sorted.map((a) => (
        <form
          key={a.id}
          action={saveAction}
          className="flex flex-wrap items-end gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800"
        >
          <input type="hidden" name="activity_id" value={a.id} />
          <input type="hidden" name="entry_date" value={dateStr} />

          <span
            className="mb-2 inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor: isActivityCategory(a.category ?? "")
                ? categoryColorVar(a.category as never)
                : "transparent",
            }}
            aria-hidden="true"
          />

          <label className="flex flex-col gap-1 text-sm">
            Typ
            <select name="category" defaultValue={a.category ?? ""} className={inputClass}>
              {CATEGORY_VALUES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tid
            <input
              type="time"
              name="start_time"
              defaultValue={timeValue(a.start_time)}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Namn
            <input
              name="name"
              defaultValue={a.name ?? ""}
              placeholder="Styrka gym"
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Distans (km)
            <input
              type="number"
              step="0.1"
              min="0"
              name="distance_km"
              defaultValue={a.distance_meters ? (a.distance_meters / 1000).toFixed(1) : ""}
              className={`${inputClass} w-24`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tid (min)
            <input
              type="number"
              min="0"
              name="duration_min"
              defaultValue={
                a.duration_seconds ? String(Math.round(a.duration_seconds / 60)) : ""
              }
              className={`${inputClass} w-24`}
            />
          </label>

          <button
            type="submit"
            className="mb-0.5 w-fit rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Spara
          </button>
          <button
            type="submit"
            formAction={deleteAction}
            className="mb-1.5 text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
          >
            Ta bort
          </button>

          <div className="w-full text-xs text-zinc-500 dark:text-zinc-400">
            {[
              a.distance_meters ? formatKm(a.distance_meters) : null,
              a.duration_seconds ? formatDuration(a.duration_seconds) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </form>
      ))}

      <details className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Lägg till genomfört pass manuellt
        </summary>
        <form action={saveAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="entry_date" value={dateStr} />
          <input type="hidden" name="athlete" value={athleteId} />
          <label className="flex flex-col gap-1 text-sm">
            Typ
            <select name="category" defaultValue="strength" className={inputClass}>
              {CATEGORY_VALUES.map((c) => (
                <option key={c} value={c}>
                  {CATEGORY_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tid
            <input type="time" name="start_time" defaultValue="17:00" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Namn
            <input name="name" placeholder="Styrka gym" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Distans (km)
            <input
              type="number"
              step="0.1"
              min="0"
              name="distance_km"
              className={`${inputClass} w-24`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tid (min)
            <input type="number" min="0" name="duration_min" className={`${inputClass} w-24`} />
          </label>
          <button
            type="submit"
            className="mb-0.5 w-fit rounded bg-zinc-950 px-4 py-1.5 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Lägg till
          </button>
        </form>
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Klockslaget avgör om passet räknas som ett eget pass eller slås ihop med dagens
          övriga träning. Skiljer det mer än ett par timmar blir det två pass, vilket är rätt
          för morgonlöpning plus styrka på kvällen.
        </p>
      </details>
    </div>
  );
}
