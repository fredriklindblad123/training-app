import type { PlanGap } from "@/lib/plan-gap";

/* Plan mot utfall (2026-11-24): en liten tabell under det genomförda passet.
 * Grå rakt igenom (B4) — skillnaden är en observation, inget betyg. Se
 * lib/plan-gap.ts för vad som jämförs och varför. */
export function PlanGapTable({ gap }: { gap: PlanGap }) {
  return (
    <div className="flex flex-col gap-1">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-xs text-[var(--ink-3)]">
            <th className="py-1 pr-2 text-left font-normal">Plan mot utfall</th>
            <th className="py-1 pr-2 text-right font-normal">Plan</th>
            <th className="py-1 pr-2 text-right font-normal">Gjort</th>
            <th className="py-1 text-right font-normal">Skillnad</th>
          </tr>
        </thead>
        <tbody>
          {gap.rows.map((r) => (
            <tr key={r.label} className="border-t border-[var(--line)]">
              <td className="py-1.5 pr-2 text-[var(--ink-2)]">{r.label}</td>
              <td className="tabular py-1.5 pr-2 text-right text-[var(--ink-2)]">{r.plan}</td>
              <td className="tabular py-1.5 pr-2 text-right font-semibold text-[var(--foreground)]">{r.done}</td>
              <td className="tabular py-1.5 text-right text-xs text-[var(--ink-2)]">{r.diff}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {gap.note && <p className="text-xs text-[var(--ink-3)]">{gap.note}</p>}
    </div>
  );
}
