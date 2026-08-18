import {
  TRAINING_FACTORS,
  TRAINING_FACTOR_GROUP_LABELS,
  TRAINING_FACTOR_SUBGROUP_LABELS,
  type TrainingFactorGroup,
} from "@/lib/training-factors";

const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";

/** Träningsfaktor-väljare — grupperad precis som Excel-mallens Detaljplan-
 * flik (grupp via optgroup, undergrupp som ett prefix på radens text eftersom
 * HTML inte tillåter nästlade optgroup). Delad mellan Detaljplans pass-
 * formulär och Årsplans veckomönster vid blockskapande (uttrycklig begäran
 * 2026-08-19: varje pass ska taggas med sin träningsfaktor direkt, inte bara
 * i efterhand på Detaljplan) — en enda plats definierar hur listan ser ut,
 * så de två formulären aldrig kan glida isär. Fritt att lämna tom; inte alla
 * pass (vila, ett obestämt lugnt pass) hör till en specifik faktor. */
export function TrainingFactorSelect({
  name = "training_factor",
  defaultValue,
  label = "Träningsfaktor",
}: {
  name?: string;
  defaultValue?: string | null;
  /** `null` = ingen egen <label>, bara själva <select>:en — för lägen där en
   * omgivande rubrik redan finns (t.ex. veckodagens egen etikett i
   * DayPatternFields). */
  label?: string | null;
}) {
  const select = (
    <select name={name} defaultValue={defaultValue ?? ""} className={input}>
      <option value="">— Ingen —</option>
      {(Object.keys(TRAINING_FACTOR_GROUP_LABELS) as TrainingFactorGroup[]).map((group) => (
        <optgroup key={group} label={TRAINING_FACTOR_GROUP_LABELS[group]}>
          {TRAINING_FACTORS.filter((f) => f.group === group).map((f) => (
            <option key={f.key} value={f.key}>
              {f.subgroup ? `${TRAINING_FACTOR_SUBGROUP_LABELS[f.subgroup]} – ${f.label}` : f.label}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );

  if (label === null) return select;

  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      {select}
    </label>
  );
}
