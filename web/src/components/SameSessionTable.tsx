import type { SameSessionGroup } from "@/lib/same-session";
import { formatDateShort, formatPace } from "@/lib/format";
import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";

/* Samma pass igen — ett pass mot förra gången samma upplägg kördes
 * (omgjord 2026-11-21 efter "extremt svårtolkat").
 *
 * Kortet säger först VAD det är (passtyp och hennes eget namn på passet),
 * sedan i en mening vad som skiljer, och först därefter tabellen: en rad per
 * del av passet, kolumnerna Nu, Förra gången och Skillnad, med enheter
 * utskrivna. Skillnaden är grå och utan pilar — ett lägre tal är inte "bättre"
 * eller "sämre" i sig (se lib/same-session.ts för varför det inte är ett
 * formmått). */

const TOL_PACE = 3; // s/km — under det räknas farten som densamma
const TOL_HR = 2; // slag

function paceText(sec: number): string {
  return `${formatPace(sec).replace(" /km", "")}/km`;
}

function diffPace(now: number, before: number): string {
  const d = Math.round(now - before);
  if (Math.abs(d) < TOL_PACE) return "samma fart";
  return `${Math.abs(d)} s/km ${d < 0 ? "snabbare" : "långsammare"}`;
}

function diffHr(now: number | null, before: number | null): string | null {
  if (now == null || before == null) return null;
  const d = Math.round(now - before);
  if (Math.abs(d) < TOL_HR) return "samma puls";
  return `${Math.abs(d)} slag ${d < 0 ? "lägre" : "högre"}`;
}

function dateText(d: string): string {
  const thisYear = new Date().getFullYear().toString();
  return `${formatDateShort(d)}${d.startsWith(thisYear) ? "" : ` ${d.slice(0, 4)}`}`;
}

/** En mening om hela passet: farten och pulsen, del för del sammanvägt. */
function summary(group: SameSessionGroup): string | null {
  const [now, before] = group.times;
  if (!before) return null;
  const pairs = now.parts
    .map((p) => ({ p, q: before.parts.find((x) => x.label === p.label) }))
    .filter((x): x is { p: (typeof now.parts)[number]; q: (typeof now.parts)[number] } => !!x.q);
  if (pairs.length === 0) return null;
  const dp = pairs.map(({ p, q }) => p.pace - q.pace);
  const dh = pairs.filter(({ p, q }) => p.endHr != null && q.endHr != null).map(({ p, q }) => (p.endHr as number) - (q.endHr as number));
  const samePace = dp.every((d) => Math.abs(d) < TOL_PACE);
  const faster = dp.every((d) => d <= -TOL_PACE);
  const slower = dp.every((d) => d >= TOL_PACE);
  const pace = samePace
    ? "Samma fart på alla delar"
    : faster
      ? "Snabbare på alla delar"
      : slower
        ? "Långsammare på alla delar"
        : Math.max(...dp.map(Math.abs)) <= 10
          ? `Ungefär samma fart, högst ${Math.round(Math.max(...dp.map(Math.abs)))} s/km skillnad på någon del`
          : "Farten skiljer mellan delarna";
  if (dh.length === 0) return `${pace}.`;
  const lo = Math.round(Math.min(...dh));
  const hi = Math.round(Math.max(...dh));
  const hr =
    dh.every((d) => Math.abs(d) < TOL_HR)
      ? "samma slutpuls"
      : dh.every((d) => d < 0)
        ? `slutpulsen ${Math.abs(hi) === Math.abs(lo) ? Math.abs(lo) : `${Math.abs(hi)}–${Math.abs(lo)}`} slag lägre`
        : dh.every((d) => d > 0)
          ? `slutpulsen ${lo === hi ? lo : `${lo}–${hi}`} slag högre`
          : "slutpulsen högre på vissa delar, lägre på andra";
  const venue =
    now.treadmill !== before.treadmill ? " Ena gången på löpband, andra ute — fart och puls är inte helt jämförbara." : "";
  return `${pace}, ${hr}.${venue}`;
}

export function SameSessionTable({ group }: { group: SameSessionGroup }) {
  const [now, before] = group.times;
  const cat = now.category && isActivityCategory(now.category) ? now.category : null;
  const sentence = summary(group);
  const head = "py-2 text-right text-xs font-normal text-[var(--ink-3)]";
  return (
    <article className="flex flex-col gap-3 rounded-[14px] border border-[var(--line)] p-3.5">
      <header className="flex flex-col gap-0.5">
        <span className="flex items-center gap-2">
          {cat && <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: categoryColorVar(cat) }} />}
          <span className="display text-xs font-semibold tracking-[0.06em] text-[var(--ink-3)] uppercase">
            {cat ? CATEGORY_LABELS[cat] : "Pass"} · {group.name}
          </span>
        </span>
        {now.title && <span className="font-semibold text-[var(--foreground)]">{now.title}</span>}
      </header>

      {sentence && <p className="text-[0.9375rem] leading-snug text-[var(--foreground)]">{sentence}</p>}

      <div className="-mx-1 overflow-x-auto px-1">
        <table className="w-full min-w-[19rem] border-collapse text-sm">
          <thead>
            <tr className="border-b border-[var(--line)]">
              <th className="py-2 pr-2 text-left text-xs font-normal text-[var(--ink-3)]">Del</th>
              <th className={head}>
                <span className="block font-semibold text-[var(--foreground)]">Nu</span>
                {dateText(now.date)} · {now.treadmill ? "löpband" : "ute"}
              </th>
              {before && (
                <th className={`${head} pl-2`}>
                  <span className="block">Förra gången</span>
                  {dateText(before.date)} · {before.treadmill ? "löpband" : "ute"}
                </th>
              )}
              {before && <th className={`${head} pl-2`}>Skillnad</th>}
            </tr>
          </thead>
          <tbody>
            {now.parts.map((p) => {
              const q = before?.parts.find((x) => x.label === p.label);
              const hrDiff = q ? diffHr(p.endHr, q.endHr) : null;
              return (
                <tr key={p.label} className="border-b border-[var(--line)] align-top last:border-b-0">
                  <td className="py-2 pr-2 text-[var(--ink-2)]">
                    {p.reps} × {p.label}
                  </td>
                  <td className="tabular py-2 text-right">
                    <span className="block font-semibold text-[var(--foreground)]">{paceText(p.pace)}</span>
                    <span className="block text-xs text-[var(--ink-3)]">{p.endHr != null ? `puls ${Math.round(p.endHr)}` : "–"}</span>
                  </td>
                  {before && (
                    <td className="tabular py-2 pl-2 text-right">
                      {q ? (
                        <>
                          <span className="block text-[var(--ink-2)]">{paceText(q.pace)}</span>
                          <span className="block text-xs text-[var(--ink-3)]">{q.endHr != null ? `puls ${Math.round(q.endHr)}` : "–"}</span>
                        </>
                      ) : (
                        <span className="text-[var(--ink-3)]">–</span>
                      )}
                    </td>
                  )}
                  {before && (
                    <td className="py-2 pl-2 text-right text-xs text-[var(--ink-2)]">
                      {q ? (
                        <>
                          <span className="block">{diffPace(p.pace, q.pace)}</span>
                          {hrDiff && <span className="block">{hrDiff}</span>}
                        </>
                      ) : (
                        "–"
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {group.times.length > 2 && (
        <p className="text-xs text-[var(--ink-3)]">
          Även körd {group.times.slice(2).map((t) => dateText(t.date)).join(", ")}.
        </p>
      )}
    </article>
  );
}
