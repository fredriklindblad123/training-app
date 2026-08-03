/* K1 (docs/tranarperspektiv.md): en rad per repgrupp — "antal × distans @
 * pace, vila". Delas mellan dagvyns planerade pass (planned_rep_groups) och
 * veckomallarnas passrader (template_rep_groups): tabellerna har identisk
 * form (se supabase/migrations/20260801100000_planned_rep_groups.sql), och
 * skillnaden mellan de två sidorna är bara vilket kolumnnamn den nya raden
 * ska peka med (`parentIdField`) och vilka server actions som ska köras —
 * själva formuläret är annars identiskt.
 *
 * Ingen "use client" — det här är vanliga <form action={...}>, precis som
 * resten av planerings-UI:t. Ta bort/spara är två submit-knappar i SAMMA
 * formulär (React 19: en <button formAction={...}> kan peka på en annan
 * server action än <form>s egen), så en rad slipper vara två separata
 * formulär bara för att den har två knappar.
 *
 * Medvetet inga fält för target_hr_low/high i UI:t — se K1 fallgrop 2:
 * pulsstyrning är meningslös tills K8 (tröskeltest) har fyllt i ett
 * personligt tröskelband. Kolumnerna finns i databasen för den dagen, men
 * ska inte visas som ett huvudspår förrän det finns ett facit att styra mot.
 */

const smallInput =
  "rounded border border-zinc-300 px-1.5 py-1 text-xs dark:border-zinc-700 dark:bg-zinc-900";
const smallLabel = "pb-1.5 text-xs text-zinc-400 dark:text-zinc-600";

export type RepGroupRow = {
  id: string;
  sort_order: number;
  reps: number;
  distance_meters: number | null;
  duration_seconds: number | null;
  target_pace_seconds_per_km: number | null;
  recovery_seconds: number | null;
  recovery_kind: string | null;
  note: string | null;
};

function minSek(totalSeconds: number | null): { min: string; sek: string } {
  if (totalSeconds == null) return { min: "", sek: "" };
  return {
    min: String(Math.floor(totalSeconds / 60)),
    sek: String(totalSeconds % 60).padStart(2, "0"),
  };
}

function NumberField({
  name,
  defaultValue,
  ariaLabel,
  width,
  step,
}: {
  name: string;
  defaultValue: number | string;
  ariaLabel: string;
  width: string;
  step?: string;
}) {
  return (
    <input
      type="number"
      name={name}
      defaultValue={defaultValue}
      step={step}
      min="0"
      aria-label={ariaLabel}
      title={ariaLabel}
      className={`${smallInput} ${width}`}
    />
  );
}

function RecoveryKindSelect({ defaultValue }: { defaultValue: string }) {
  return (
    <select
      name="recovery_kind"
      defaultValue={defaultValue}
      aria-label="Vilans art"
      title="Vilans art"
      className={smallInput}
    >
      <option value="">–</option>
      <option value="jogg">jogg</option>
      <option value="stående">stående</option>
      <option value="gång">gång</option>
    </select>
  );
}

export function RepGroupEditor({
  groups,
  parentIdField,
  parentId,
  addAction,
  updateAction,
  deleteAction,
}: {
  groups: RepGroupRow[];
  /** "planned_workout_id" i dagvyn, "template_item_id" i veckomallarna. */
  parentIdField: "planned_workout_id" | "template_item_id";
  parentId: string;
  addAction: (formData: FormData) => void;
  updateAction: (formData: FormData) => void;
  deleteAction: (formData: FormData) => void;
}) {
  const sorted = [...groups].sort((a, b) => a.sort_order - b.sort_order);

  return (
    <div className="flex flex-col gap-1.5">
      {sorted.map((g) => {
        const pace = minSek(g.target_pace_seconds_per_km);
        return (
          <form
            key={g.id}
            action={updateAction}
            className="flex flex-wrap items-end gap-1.5"
          >
            <input type="hidden" name="id" value={g.id} />
            <input type="hidden" name={parentIdField} value={parentId} />
            <NumberField name="reps" defaultValue={g.reps} ariaLabel="Antal repetitioner" width="w-12" />
            <span className={smallLabel}>×</span>
            <NumberField
              name="distance_meters"
              defaultValue={g.distance_meters ?? ""}
              ariaLabel="Distans i meter"
              width="w-16"
            />
            <span className={smallLabel}>m — eller</span>
            <NumberField
              name="duration_minutes"
              defaultValue={g.duration_seconds != null ? g.duration_seconds / 60 : ""}
              ariaLabel="Tid i minuter, om repetitionen mäts i tid i stället för distans"
              width="w-14"
              step="0.5"
            />
            <span className={smallLabel}>min @</span>
            <NumberField name="pace_min" defaultValue={pace.min} ariaLabel="Målfart, minuter per km" width="w-10" />
            <span className={smallLabel}>:</span>
            <NumberField name="pace_sek" defaultValue={pace.sek} ariaLabel="Målfart, sekunder per km" width="w-10" />
            <span className={smallLabel}>/km, vila</span>
            <NumberField
              name="recovery_minutes"
              defaultValue={g.recovery_seconds != null ? g.recovery_seconds / 60 : ""}
              ariaLabel="Vila i minuter"
              width="w-12"
              step="0.5"
            />
            <span className={smallLabel}>min</span>
            <RecoveryKindSelect defaultValue={g.recovery_kind ?? ""} />
            <input
              name="note"
              defaultValue={g.note ?? ""}
              placeholder="anteckning"
              aria-label="Anteckning om repgruppen"
              className={`${smallInput} w-28`}
            />
            <button
              type="submit"
              className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Spara
            </button>
            <button
              type="submit"
              formAction={deleteAction}
              className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
            >
              Ta bort
            </button>
          </form>
        );
      })}

      <form action={addAction} className="flex flex-wrap items-end gap-1.5">
        <input type="hidden" name={parentIdField} value={parentId} />
        <NumberField name="reps" defaultValue={1} ariaLabel="Antal repetitioner" width="w-12" />
        <span className={smallLabel}>×</span>
        <NumberField name="distance_meters" defaultValue="" ariaLabel="Distans i meter" width="w-16" />
        <span className={smallLabel}>m — eller</span>
        <NumberField
          name="duration_minutes"
          defaultValue=""
          ariaLabel="Tid i minuter, om repetitionen mäts i tid i stället för distans"
          width="w-14"
          step="0.5"
        />
        <span className={smallLabel}>min @</span>
        <NumberField name="pace_min" defaultValue="" ariaLabel="Målfart, minuter per km" width="w-10" />
        <span className={smallLabel}>:</span>
        <NumberField name="pace_sek" defaultValue="" ariaLabel="Målfart, sekunder per km" width="w-10" />
        <span className={smallLabel}>/km, vila</span>
        <NumberField name="recovery_minutes" defaultValue="" ariaLabel="Vila i minuter" width="w-12" step="0.5" />
        <span className={smallLabel}>min</span>
        <RecoveryKindSelect defaultValue="" />
        <input
          name="note"
          placeholder="anteckning"
          aria-label="Anteckning om repgruppen"
          className={`${smallInput} w-28`}
        />
        <button
          type="submit"
          className="rounded border border-zinc-300 px-2 py-1 text-xs hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
        >
          Lägg till grupp
        </button>
      </form>
    </div>
  );
}
