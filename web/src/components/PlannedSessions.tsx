import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";
import { SLOT_LABELS, WORKOUT_LABELS, WORKOUT_TYPES, type WorkoutType } from "@/lib/planning";
import { formatDuration, formatKm } from "@/lib/format";

/* Planerade pass för en dag. Flera per dag stöds via slot — dubbeltröskel
 * innebär två riktiga pass samma dag, och de ska kunna planeras var för sig
 * och jämföras mot sitt eget utfall. */

export type PlannedRow = {
  id: string;
  slot: number | null;
  workout_type: string;
  title: string | null;
  description: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
};

const inputClass =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

function label(type: string): string {
  if (isActivityCategory(type)) return CATEGORY_LABELS[type];
  return WORKOUT_LABELS[type as WorkoutType] ?? type;
}

export function PlannedSessions({
  dateStr,
  planned,
  blocks,
  addAction,
  deleteAction,
}: {
  dateStr: string;
  planned: PlannedRow[];
  blocks: { id: string; name: string }[];
  addAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
}) {
  const sorted = [...planned].sort((a, b) => (a.slot ?? 1) - (b.slot ?? 1));

  return (
    <div className="flex flex-col gap-2">
      {sorted.map((p) => (
        <div
          key={p.id}
          className="flex flex-wrap items-baseline gap-3 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800"
        >
          <span
            className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{
              backgroundColor:
                p.workout_type !== "rest" && isActivityCategory(p.workout_type)
                  ? categoryColorVar(p.workout_type)
                  : "transparent",
              border:
                p.workout_type === "rest" ? "1.5px dashed currentColor" : undefined,
            }}
            aria-hidden="true"
          />
          {(p.slot ?? 1) > 1 && (
            <span className="text-xs text-zinc-500 dark:text-zinc-400">
              {SLOT_LABELS[p.slot as number] ?? `Pass ${p.slot}`}
            </span>
          )}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {label(p.workout_type)}
          </span>
          {p.title && <span className="text-zinc-700 dark:text-zinc-300">{p.title}</span>}
          <span className="text-zinc-500 dark:text-zinc-400">
            {[
              p.target_distance_meters ? formatKm(p.target_distance_meters) : null,
              p.target_duration_seconds ? formatDuration(p.target_duration_seconds) : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
          <form action={deleteAction} className="ml-auto">
            <input type="hidden" name="workout_id" value={p.id} />
            <button
              type="submit"
              className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
            >
              Ta bort
            </button>
          </form>
          {p.description && (
            <div className="w-full text-xs whitespace-pre-wrap text-zinc-500 dark:text-zinc-400">
              {p.description}
            </div>
          )}
        </div>
      ))}

      <details className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
        <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
          Planera pass den här dagen
        </summary>
        <form action={addAction} className="mt-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="scheduled_date" value={dateStr} />
          <label className="flex flex-col gap-1 text-sm">
            Typ
            <select name="workout_type" defaultValue="easy" className={inputClass}>
              {WORKOUT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {label(t)}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Pass
            <select name="slot" defaultValue={String((sorted.at(-1)?.slot ?? 0) + 1)} className={inputClass}>
              {[1, 2, 3].map((s) => (
                <option key={s} value={s}>
                  {SLOT_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Rubrik
            <input name="title" placeholder="10x400m" className={inputClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Mål-distans (km)
            <input
              type="number"
              step="0.1"
              min="0"
              name="target_distance_km"
              className={`${inputClass} w-28`}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Mål-tid (min)
            <input
              type="number"
              min="0"
              name="target_duration_min"
              className={`${inputClass} w-28`}
            />
          </label>
          {blocks.length > 0 && (
            <label className="flex flex-col gap-1 text-sm">
              Block
              <select name="block_id" defaultValue={blocks[0]?.id ?? ""} className={inputClass}>
                <option value="">Inget</option>
                {blocks.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          <label className="flex w-full flex-col gap-1 text-sm">
            Beskrivning
            <textarea name="description" rows={2} className={inputClass} />
          </label>
          <button
            type="submit"
            className="w-fit rounded bg-zinc-950 px-4 py-1.5 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Lägg till
          </button>
        </form>
      </details>
    </div>
  );
}
