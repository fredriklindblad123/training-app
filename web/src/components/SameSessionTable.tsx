import type { SameSessionGroup } from "@/lib/same-session";
import { formatDateShort, formatPace } from "@/lib/format";
import { DataTable } from "@/components/ui/DataTable";

/* Samma upplägg, gång för gång (2026-11-21). En rad per del (t.ex. 3×3 min),
 * en kolumn per gång passet körts, nyast först. Varje cell: medianfart och
 * median slutpuls för delens rep. Inget mer — ingen pil, ingen färg, ingen
 * slutsats om form (se lib/same-session.ts för varför). */

export function SameSessionTable({ group }: { group: SameSessionGroup }) {
  const parts = group.times[0].parts;
  return (
    <div className="flex flex-col gap-1.5 rounded-[14px] border border-[var(--line)] p-3.5">
      <span className="font-semibold text-[var(--foreground)]">{group.name}</span>
      <DataTable
        emphasis={1}
        head={[
          "Del",
          ...group.times.map((t) => (
            <span key={t.activityId} className="flex flex-col items-end">
              <span>
                {formatDateShort(t.date)} {t.date.slice(2, 4) !== new Date().getFullYear().toString().slice(2) ? t.date.slice(0, 4) : ""}
              </span>
              <span className="font-normal text-[var(--ink-3)]">{t.treadmill ? "löpband" : "ute"}</span>
            </span>
          )),
        ]}
        rows={parts.map((p) => ({
          key: p.label,
          cells: [
            `${p.reps}×${p.label}`,
            ...group.times.map((t) => {
              // Delarna matchas på replängd, inte på ordning: klockan kan ha
              // räknat ett rep mer eller mindre en av gångerna.
              const q = t.parts.find((x) => x.label === p.label) ;
              if (!q) return "–";
              return (
                <span key={t.activityId} className="flex flex-col items-end leading-tight">
                  <span>{formatPace(q.pace).replace(" /km", "")}</span>
                  <span className="text-xs font-normal text-[var(--ink-3)]">{q.endHr != null ? `puls ${Math.round(q.endHr)}` : "–"}</span>
                </span>
              );
            }),
          ],
        }))}
      />
    </div>
  );
}
