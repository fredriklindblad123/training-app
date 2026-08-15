import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";
import {
  QUALITY_WORKOUT_TYPES,
  SLOT_LABELS,
  WORKOUT_LABELS,
  WORKOUT_TYPES,
  type WorkoutType,
} from "@/lib/planning";
import { formatDuration, formatKm } from "@/lib/format";
import { plannedSignatureLabel, type PlannedRepGroup } from "@/lib/session-signature";
import { RepGroupEditor, type RepGroupRow } from "@/components/RepGroupEditor";

/* Planerade pass för en dag.
 *
 * De flesta pass skapas via veckomallar på /planering. Ett enskilt extra
 * pass går att lägga till härifrån, men bara i det block som är aktivt för
 * dagen — utan ett block finns ingenstans att lägga passet, så formuläret
 * visas inte alls då (se addAction i actions.ts: block_id sätts av sidan,
 * aldrig av ett formulärfält, så ett pass aldrig kan hamna utan block). */

export type PlannedRow = {
  id: string;
  slot: number | null;
  workout_type: string;
  title: string | null;
  description: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  season_blocks?: { name: string } | null;
  /** K1: repgrupperna på passet. `?? []` överallt den här läses — en saknad
   * tabell (migrationen inte körd) ska inte krascha dagvyn, bara visa passet
   * utan repgrupper, precis som innan K1. */
  planned_rep_groups?: RepGroupRow[] | null;
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
  activeBlock,
  createAction,
  updateAction,
  deleteAction,
  addRepGroupAction,
  updateRepGroupAction,
  deleteRepGroupAction,
  athleteId,
}: {
  dateStr: string;
  planned: PlannedRow[];
  /** Blocket vars datumintervall täcker `dateStr`, om något. */
  activeBlock: { id: string; name: string } | null;
  createAction: (formData: FormData) => void;
  updateAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
  /** K1: repgrupper på ett enskilt planerat pass. */
  addRepGroupAction: (formData: FormData) => void;
  updateRepGroupAction: (formData: FormData) => void;
  deleteRepGroupAction: (formData: FormData) => void;
  /** Fas 0-uppföljning: vilken löpare ett för hand tillagt pass ska skrivas
   * på — se resolvedAthleteId i actions.ts. */
  athleteId: string;
}) {
  const sorted = [...planned].sort((a, b) => (a.slot ?? 1) - (b.slot ?? 1));

  return (
    <div className="flex flex-col gap-2">
      {sorted.length === 0 && (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">
          Inget planerat pass den här dagen.
        </p>
      )}

      {sorted.map((p) => {
        const repGroups = p.planned_rep_groups ?? [];
        // Samma nyckelformat som utfallets buildSessionSignature (se
        // lib/session-signature.ts) — så "5×1000 m" syns i sammanfattningen
        // utan att man öppnar passet, precis som ett genomfört pass visar
        // sin signatur på /trends.
        const sigLabel = plannedSignatureLabel(
          repGroups.map(
            (g): PlannedRepGroup => ({
              reps: g.reps,
              distanceMeters: g.distance_meters,
              durationSeconds: g.duration_seconds,
              sortOrder: g.sort_order,
            }),
          ),
        );
        // Fallgrop 1 (K1): repgrupps-redigeraren ska inte skrika efter
        // uppmärksamhet på ett lugnt distanspass. Visas som standard bara
        // för kvalitetstyper, men aldrig hårt blockerad — finns det redan
        // grupper (t.ex. efter ett typbyte) visas de oavsett.
        const showRepGroups =
          QUALITY_WORKOUT_TYPES.includes(p.workout_type as WorkoutType) || repGroups.length > 0;

        return (
        <details key={p.id} className="rounded border border-zinc-200 dark:border-zinc-800">
          <summary className="flex cursor-pointer flex-wrap items-baseline gap-3 p-3 text-sm">
            <span
              className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
              style={{
                // 'rest' och 'test' har ingen kategorifärg — vila är ingen
                // träning, ett test är ett testtillfälle, inte en kategori
                // (se workoutTypeColorVar i lib/planning.ts). Båda får samma
                // streckade ring i stället för en osynlig, genomskinlig prick.
                backgroundColor: isActivityCategory(p.workout_type)
                  ? categoryColorVar(p.workout_type)
                  : "transparent",
                border:
                  p.workout_type === "rest" || p.workout_type === "test"
                    ? "1.5px dashed currentColor"
                    : undefined,
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
            {sigLabel && (
              <span className="text-zinc-700 dark:text-zinc-300">{sigLabel}</span>
            )}
            <span className="text-zinc-500 dark:text-zinc-400">
              {[
                p.target_distance_meters ? formatKm(p.target_distance_meters) : null,
                p.target_duration_seconds ? formatDuration(p.target_duration_seconds) : null,
              ]
                .filter(Boolean)
                .join(" · ")}
            </span>
            {p.season_blocks?.name && (
              <span className="ml-auto rounded bg-zinc-100 px-1.5 py-0.5 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                {p.season_blocks.name}
              </span>
            )}
          </summary>

          <form
            action={updateAction}
            className="flex flex-wrap items-end gap-3 border-t border-zinc-100 p-3 dark:border-zinc-800"
          >
            <input type="hidden" name="workout_id" value={p.id} />
            <label className="flex flex-col gap-1 text-sm">
              Typ
              <select name="workout_type" defaultValue={p.workout_type} className={inputClass}>
                {WORKOUT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {label(t)}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Pass
              <select name="slot" defaultValue={String(p.slot ?? 1)} className={inputClass}>
                {[1, 2, 3].map((s) => (
                  <option key={s} value={s}>
                    {SLOT_LABELS[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Rubrik
              <input
                name="title"
                defaultValue={p.title ?? ""}
                placeholder="10x400m"
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Mål-distans (km)
              <input
                type="number"
                step="0.1"
                min="0"
                name="target_distance_km"
                defaultValue={p.target_distance_meters ? p.target_distance_meters / 1000 : ""}
                className={`${inputClass} w-28`}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Mål-tid (min)
              <input
                type="number"
                min="0"
                name="target_duration_min"
                defaultValue={
                  p.target_duration_seconds ? Math.round(p.target_duration_seconds / 60) : ""
                }
                className={`${inputClass} w-28`}
              />
            </label>
            <label className="flex w-full flex-col gap-1 text-sm">
              Beskrivning
              <textarea
                name="description"
                rows={2}
                defaultValue={p.description ?? ""}
                className={inputClass}
              />
            </label>
            <button
              type="submit"
              className="w-fit rounded bg-zinc-950 px-4 py-1.5 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Spara
            </button>
          </form>

          {showRepGroups && (
            <div className="border-t border-zinc-100 p-3 dark:border-zinc-800">
              <div className="mb-1.5 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                Repgrupper
              </div>
              <RepGroupEditor
                groups={repGroups}
                parentIdField="planned_workout_id"
                parentId={p.id}
                addAction={addRepGroupAction}
                updateAction={updateRepGroupAction}
                deleteAction={deleteRepGroupAction}
              />
            </div>
          )}

          <form action={deleteAction} className="px-3 pb-3">
            <input type="hidden" name="workout_id" value={p.id} />
            <button
              type="submit"
              className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
            >
              Ta bort
            </button>
          </form>
        </details>
        );
      })}

      {activeBlock ? (
        <details className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Lägg till ett enskilt pass i {activeBlock.name}
          </summary>
          <form action={createAction} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="scheduled_date" value={dateStr} />
            <input type="hidden" name="block_id" value={activeBlock.id} />
            <input type="hidden" name="athlete" value={athleteId} />
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
              <select
                name="slot"
                defaultValue={String((sorted.at(-1)?.slot ?? 0) + 1)}
                className={inputClass}
              >
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
      ) : (
        <p className="text-xs text-zinc-400 dark:text-zinc-600">
          Inget aktivt block den här dagen — lägg upp ett block på Planering för att kunna lägga
          in ett enskilt pass.
        </p>
      )}
    </div>
  );
}
