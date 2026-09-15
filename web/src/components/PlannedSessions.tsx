import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";
import {
  QUALITY_WORKOUT_TYPES,
  SLOT_LABELS,
  WORKOUT_LABELS,
  WORKOUT_TYPES,
  type WorkoutType,
} from "@/lib/planning";
import {
  TRAINING_FACTORS,
  TRAINING_FACTOR_GROUP_LABELS,
  type TrainingFactorGroup,
} from "@/lib/training-factors";
import { formatDuration, formatKm } from "@/lib/format";
import { plannedSignatureLabel, type PlannedRepGroup } from "@/lib/session-signature";
import { RepGroupEditor, type RepGroupRow } from "@/components/RepGroupEditor";
import { primaryButtonClass, fieldClass } from "@/components/ui/controls";

/* Planerade pass för en dag — en ren översiktsvy av planerat vs. genomfört.
 *
 * Alla pass skapas i /blockplan (veckomallar, en fas i taget) — kalendern
 * är sedan 2026-08-17 medvetet inte längre en plats att lägga upp NYA pass
 * på, varken för coach eller adept (uttrycklig begäran). Ett redan
 * utrullat pass går fortfarande att justera i efterhand härifrån (formuläret
 * nedan), t.ex. om dagens tempo behöver ändras sist på morgonen. */

export type PlannedRow = {
  id: string;
  slot: number | null;
  workout_type: string;
  title: string | null;
  description: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  training_factor: string | null;
  season_blocks?: { name: string } | null;
  /** K1: repgrupperna på passet. `?? []` överallt den här läses — en saknad
   * tabell (migrationen inte körd) ska inte krascha dagvyn, bara visa passet
   * utan repgrupper, precis som innan K1. */
  planned_rep_groups?: RepGroupRow[] | null;
};

const inputClass =
  fieldClass;

function label(type: string): string {
  if (isActivityCategory(type)) return CATEGORY_LABELS[type];
  return WORKOUT_LABELS[type as WorkoutType] ?? type;
}

function factorLabel(key: string | null): string | null {
  if (!key) return null;
  return TRAINING_FACTORS.find((f) => f.key === key)?.label ?? key;
}

/** Vilken Årsplan-rad (lib/training-factors.ts) passet räknas mot —
 * planeringen sker per pass, inte som en klumpsumma för blocket (se
 * motiveringen i sasongen/page.tsx:s motsvarande fält). Frivilligt. */
function TrainingFactorField({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      Träningsfaktor
      <select name="training_factor" defaultValue={defaultValue ?? ""} className={inputClass}>
        <option value="">— Ingen —</option>
        {(Object.keys(TRAINING_FACTOR_GROUP_LABELS) as TrainingFactorGroup[]).map((group) => (
          <optgroup key={group} label={TRAINING_FACTOR_GROUP_LABELS[group]}>
            {TRAINING_FACTORS.filter((f) => f.group === group).map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}

export function PlannedSessions({
  planned,
  updateAction,
  deleteAction,
  addRepGroupAction,
  updateRepGroupAction,
  deleteRepGroupAction,
}: {
  planned: PlannedRow[];
  updateAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
  /** K1: repgrupper på ett enskilt planerat pass. */
  addRepGroupAction: (formData: FormData) => void;
  updateRepGroupAction: (formData: FormData) => void;
  deleteRepGroupAction: (formData: FormData) => void;
}) {
  const sorted = [...planned].sort((a, b) => (a.slot ?? 1) - (b.slot ?? 1));

  return (
    <div className="flex flex-col gap-2">
      {sorted.length === 0 && (
        <p className="text-sm text-[var(--ink-3)]">
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
        <details key={p.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
          {/* Raden följer prototypens listrad: färgstapel i full höjd till
              vänster, passets namn överst och detaljerna under i dämpad text,
              etiketterna högerställda. Låg tidigare som allt på EN baslinje
              med en 10 px prick — typ, titel, distans och två etiketter i
              samma storlek, vilket gjorde raden till en ordremsa man fick
              läsa i stället för skumma.

              Stapeln bär kategorin i full höjd i stället för en prick, av
              samma skäl som i Swatch: en prick vid en tvåradig rad svävar vid
              den översta raden och ser ut att höra till bara den. */}
          <summary className="flex cursor-pointer items-stretch gap-3 p-3 text-sm">
            <span
              className="w-[3px] shrink-0 self-stretch rounded-full"
              style={{
                // 'rest' och 'test' har ingen kategorifärg — vila är ingen
                // träning, ett test är ett testtillfälle, inte en kategori
                // (se workoutTypeColorVar i lib/planning.ts). Båda får linjens
                // färg i stället för en osynlig, genomskinlig stapel.
                backgroundColor: isActivityCategory(p.workout_type)
                  ? categoryColorVar(p.workout_type)
                  : "var(--line)",
                minHeight: "1.75rem",
              }}
              aria-hidden="true"
            />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex flex-wrap items-baseline gap-x-2">
                <span className="display font-semibold text-[var(--foreground)]">
                  {label(p.workout_type)}
                </span>
                {p.title && <span className="text-[var(--ink-2)]">{p.title}</span>}
                {sigLabel && <span className="text-[var(--ink-2)]">{sigLabel}</span>}
              </span>
              <span className="flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--ink-3)]">
                {(p.slot ?? 1) > 1 && (
                  <span>{SLOT_LABELS[p.slot as number] ?? `Pass ${p.slot}`}</span>
                )}
                <span className="tabular">
                  {[
                    p.target_distance_meters ? formatKm(p.target_distance_meters) : null,
                    p.target_duration_seconds ? formatDuration(p.target_duration_seconds) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </span>
              </span>
            </span>
            {factorLabel(p.training_factor) && (
              <span className="display self-center rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--ink-2)]">
                {factorLabel(p.training_factor)}
              </span>
            )}
            {p.season_blocks?.name && (
              <span className="display self-center rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--ink-2)]">
                {p.season_blocks.name}
              </span>
            )}
          </summary>

          {/* Tränarens text till löparen, synlig utan att fälla ut
              redigeringsformuläret (2026-09-15).
              Fältet fanns redan — det är samma "Beskrivning" som formuläret
              nedan skriver — men stod ingenstans i läsläget. En kommentar som
              bara syns för den som öppnar ett formulär och tittar i en
              textruta når inte löparen, vilket är hela syftet med att skriva
              den. */}
          {(p.description ?? "").trim() && (
            <p className="border-t border-[var(--line)] px-3 py-2 text-sm whitespace-pre-line text-[var(--ink-2)]">
              {p.description}
            </p>
          )}

          <form
            action={updateAction}
            className="flex flex-wrap items-end gap-3 border-t border-[var(--line)] p-3"
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
            <TrainingFactorField defaultValue={p.training_factor} />
            <button
              type="submit"
              className={primaryButtonClass}
            >
              Spara
            </button>
          </form>

          {showRepGroups && (
            <div className="border-t border-[var(--line)] p-3">
              <div className="mb-1.5 text-xs font-medium text-[var(--ink-3)]">
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
              className="text-xs text-[var(--ink-3)] hover:text-red-600 dark:hover:text-red-400"
            >
              Ta bort
            </button>
          </form>
        </details>
        );
      })}
    </div>
  );
}
