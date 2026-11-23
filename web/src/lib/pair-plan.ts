/* Planerat och genomfört pass för pass (2026-11-21).
 *
 * Idag och dagvyn visade först alla planerade pass och sedan alla
 * genomförda — med två pass samma dag fick man själv para ihop dem. Här
 * paras de: först på samma typ (distans med distans), sedan det som är kvar
 * i tur och ordning, så att ett planerat intervallpass som blev tröskel ändå
 * hamnar på samma rad. Ett planerat styrkepass paras inte med ett löppass —
 * styrka loggas sällan med klockan, och en sådan rad hade sett ut som att
 * styrkepasset blev ett distanspass. Det som blir över får en egen rad med
 * tom plan- eller utfallssida. */

const SAME: Record<string, string[]> = {
  test: ["test", "threshold_test", "threshold"],
  long_run: ["long_run", "easy"],
  easy: ["easy", "long_run"],
};

function matches(plannedType: string, doneType: string): boolean {
  return plannedType === doneType || (SAME[plannedType] ?? []).includes(doneType);
}

export function pairPlanDone<P, D>(
  planned: P[],
  done: D[],
  pType: (p: P) => string,
  dType: (d: D) => string,
): { plan: P | null; done: D | null }[] {
  const out: { plan: P | null; done: D | null }[] = planned.map((p) => ({ plan: p, done: null }));
  const left = [...done];
  // 1. Samma typ.
  for (const row of out) {
    const i = left.findIndex((d) => matches(pType(row.plan as P), dType(d)));
    if (i >= 0) row.done = left.splice(i, 1)[0];
  }
  // 2. Det som är kvar, i ordning — utom mot planerad styrka och vila.
  for (const row of out) {
    if (row.done || left.length === 0) continue;
    const t = pType(row.plan as P);
    if (t === "strength" || t === "rest") continue;
    const i = left.findIndex((d) => dType(d) !== "strength" && dType(d) !== "cross_training");
    if (i >= 0) row.done = left.splice(i, 1)[0];
  }
  // 3. Oplanerade pass på egna rader.
  for (const d of left) out.push({ plan: null, done: d });
  return out;
}
