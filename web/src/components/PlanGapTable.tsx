import { dirOf, type GapDir, type PlanGap } from "@/lib/plan-gap";

/* Över/under/på planen som ett litet märke (2026-11-27). Grått som resten —
 * en avvikelse är en iakttagelse, inget betyg (B4). Ordet står bredvid för
 * skärmläsare och för den som inte känner igen symbolen. */
const DIR_MARK: Record<GapDir, { sym: string; label: string }> = {
  over: { sym: "▲", label: "över planen" },
  under: { sym: "▼", label: "under planen" },
  on: { sym: "●", label: "på planen" },
};

function DirMark({ dir }: { dir: GapDir }) {
  const m = DIR_MARK[dir];
  return (
    <span title={m.label} aria-label={m.label} className="text-[0.625rem] text-[var(--ink-3)]">
      {m.sym}
    </span>
  );
}

/* Plan mot utfall (2026-11-24): en liten tabell under det genomförda passet.
 * Grå rakt igenom (B4) — skillnaden är en observation, inget betyg. Se
 * lib/plan-gap.ts för vad som jämförs och varför. */
export function PlanGapTable({ gap, title = "Plan mot utfall" }: { gap: PlanGap; title?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="text-xs text-[var(--ink-3)]">
            <th className="py-1 pr-2 text-left font-normal">{title}</th>
            <th className="py-1 pr-2 text-right font-normal">Plan</th>
            <th className="py-1 pr-2 text-right font-normal">Gjort</th>
            <th className="py-1 text-right font-normal">Skillnad</th>
          </tr>
        </thead>
        <tbody>
          {gap.rows.map((r) => (
            <tr key={r.label} className="border-t border-[var(--line)]">
              <td className="py-1.5 pr-2 text-[var(--ink-2)]">{r.label}</td>
              <td className="tabular py-1.5 pr-2 text-right whitespace-nowrap text-[var(--ink-2)]">{r.plan}</td>
              <td className="tabular py-1.5 pr-2 text-right font-semibold whitespace-nowrap text-[var(--foreground)]">{r.done}</td>
              <td className="tabular py-1.5 text-right text-xs text-[var(--ink-2)]">
                <span className="inline-flex items-center gap-1">
                  <DirMark dir={dirOf(r)} />
                  {r.diff}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {gap.note && <p className="text-xs text-[var(--ink-3)]">{gap.note}</p>}
    </div>
  );
}

/* Samma jämförelse som rutor (2026-11-27, begärt: veckan mot planen var
 * "för busy på telefonen"). Det gjorda står stort; planen och skillnaden på
 * en rad under. Två i bredd på telefon, tre på bred skärm. */
export function PlanGapTiles({ gap }: { gap: PlanGap }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[10px] bg-[var(--line)] sm:grid-cols-3">
        {gap.rows.map((r) => (
          <div key={r.label} className="flex flex-col gap-0.5 bg-[var(--surface)] p-2.5">
            <span className="text-xs text-[var(--ink-3)]">{r.label}</span>
            <span className="display tabular text-xl leading-tight font-bold text-[var(--foreground)]">{r.done}</span>
            <span className="tabular text-xs text-[var(--ink-3)]">plan {r.plan}</span>
            <span className="tabular flex items-center gap-1 text-xs text-[var(--ink-2)]">
              <DirMark dir={dirOf(r)} />
              {r.diff}
            </span>
          </div>
        ))}
      </div>
      {gap.note && <p className="text-xs text-[var(--ink-3)]">{gap.note}</p>}
    </div>
  );
}
