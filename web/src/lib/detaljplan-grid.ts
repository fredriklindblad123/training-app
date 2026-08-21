import {
  TRAINING_FACTORS,
  factorGroupOf,
  factorSubgroupOf,
  type TrainingFactorGroup,
  type TrainingFactorSubgroup,
} from "./training-factors";

/* Delad mellan Detaljplans in-app-rutnät (detaljplan/page.tsx) och
 * Excel-exporten (flerarsplan/export/route.ts) — samma "en datamodul, aldrig
 * olika siffror för samma data"-princip som lib/arsplan-grid.ts redan
 * etablerade för Årsplan-fliken. */

export type DetaljplanItemInput = {
  weekday: number;
  slot: number;
  workout_type: string;
  title: string | null;
  training_factor: string | null;
};

export type DetaljplanFactorRow = { group: TrainingFactorGroup; subgroup: TrainingFactorSubgroup | null };

/** Vilka (grupp, undergrupp)-rader som faktiskt har minst ett pass bland
 * items, i TRAINING_FACTORS-ordning — bara det som används blir en rad,
 * samma "visa bara det som används"-princip som styr vilka faser som visas. */
export function usedDetaljplanFactorRows(items: DetaljplanItemInput[]): DetaljplanFactorRow[] {
  const seen = new Set<string>();
  const rows: DetaljplanFactorRow[] = [];
  for (const factor of TRAINING_FACTORS) {
    const subgroup = factor.subgroup ?? null;
    const id = `${factor.group}::${subgroup ?? "_"}`;
    if (seen.has(id)) continue;
    const used = items.some(
      (it) =>
        factorGroupOf(it.training_factor) === factor.group &&
        factorSubgroupOf(it.training_factor) === subgroup,
    );
    if (used) {
      seen.add(id);
      rows.push({ group: factor.group, subgroup });
    }
  }
  return rows;
}

export function hasUngroupedDetaljplanItems(items: DetaljplanItemInput[]): boolean {
  return items.some((it) => factorGroupOf(it.training_factor) === null);
}

/** En grupp bryts ut i sina undergrupper (Anaerob alaktisk & laktisk /
 * Aerob) bara när mer än en undergrupp faktiskt används i just detta
 * blocks pass — annars blir gruppnamnet en tom rubrikrad ovanför en enda
 * datarad. */
export function detaljplanRowCountByGroup(
  rows: DetaljplanFactorRow[],
): Partial<Record<TrainingFactorGroup, number>> {
  return rows.reduce<Partial<Record<TrainingFactorGroup, number>>>((acc, r) => {
    acc[r.group] = (acc[r.group] ?? 0) + 1;
    return acc;
  }, {});
}

export function detaljplanItemsFor<T extends DetaljplanItemInput>(
  items: T[],
  weekday: number,
  row: DetaljplanFactorRow | { group: null },
): T[] {
  return items
    .filter(
      (it) =>
        it.weekday === weekday &&
        factorGroupOf(it.training_factor) === row.group &&
        (row.group === null || factorSubgroupOf(it.training_factor) === row.subgroup),
    )
    .sort((a, b) => a.slot - b.slot);
}
