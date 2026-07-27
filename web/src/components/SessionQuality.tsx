import type { SignatureOccurrence, SignatureGroupResult } from "@/lib/session-signature";
import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";

/* P2.1: passkvalitet för återkommande nyckelpass.
 *
 * Medvetet en tabell och inte ett diagram. Det som ska jämföras är enskilda
 * varvtider mellan ett tiotal genomföranden — läsaren vill se de faktiska
 * sekunderna ("290,4 mot 302,0"), inte uppskatta dem ur en kurva. Ett
 * diagram hade dolt precis den precisionen som är hela poängen. */

export type SignatureGroup = SignatureGroupResult;

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}`;
}

function OccurrenceRow({
  occurrence,
  bestSeconds,
  isBest,
}: {
  occurrence: SignatureOccurrence;
  bestSeconds: number;
  isBest: boolean;
}) {
  const delta = occurrence.meanRepSeconds - bestSeconds;
  const times = occurrence.signature.groups.flatMap((g) => g.times);

  return (
    <tr className="border-t border-zinc-100 dark:border-zinc-800">
      <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
        {occurrence.date}
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-700 dark:text-zinc-300">
        {occurrence.signature.label}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums font-medium text-zinc-900 dark:text-zinc-100">
        {fmtTime(occurrence.meanRepSeconds)}
        {isBest && (
          <span className="ml-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">
            bäst
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
        {delta <= 0.05 ? "—" : `+${delta.toFixed(1)}s`}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-zinc-600 dark:text-zinc-400">
        {occurrence.meanRepHr ? Math.round(occurrence.meanRepHr) : "—"}
      </td>
      <td className="py-1.5 tabular-nums text-xs text-zinc-500 dark:text-zinc-400">
        {times.map((t) => fmtTime(t)).join("  ")}
      </td>
    </tr>
  );
}

function SignatureCard({ group }: { group: SignatureGroup }) {
  const { category, distanceMeters, occurrences } = group;
  const best = occurrences.reduce((a, b) => (a.meanRepSeconds <= b.meanRepSeconds ? a : b));
  // Nyast först — den senaste körningen är den man vill se direkt.
  const shown = [...occurrences].reverse().slice(0, 8);

  const latest = occurrences[occurrences.length - 1];
  const first = occurrences[0];
  const changePct =
    ((latest.meanRepSeconds - first.meanRepSeconds) / first.meanRepSeconds) * 100;

  return (
    <details className="rounded border border-zinc-200 p-4 dark:border-zinc-800" open={false}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
            {isActivityCategory(category ?? "") && (
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: categoryColorVar(category as never) }}
                aria-hidden="true"
              />
            )}
            {isActivityCategory(category ?? "")
              ? `${CATEGORY_LABELS[category as never]} · ${distanceMeters} m`
              : `${distanceMeters} m`}
          </span>
          <span className="text-sm text-zinc-500 dark:text-zinc-400">
            {occurrences.length} genomföranden · bäst {fmtTime(best.meanRepSeconds)}{" "}
            {best.meanRepHr ? `vid puls ${Math.round(best.meanRepHr)}` : ""}
          </span>
        </div>
        <div className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
          {first.date} → {latest.date}:{" "}
          <span
            className={
              changePct < -0.5
                ? "text-emerald-600 dark:text-emerald-400"
                : changePct > 0.5
                  ? "text-amber-600 dark:text-amber-400"
                  : ""
            }
          >
            {changePct > 0 ? "+" : ""}
            {changePct.toFixed(1)} % i snittid
          </span>
        </div>
      </summary>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
              <th className="pb-1 font-normal">Datum</th>
              <th className="pb-1 font-normal">Upplägg</th>
              <th className="pb-1 text-right font-normal">Snitt/rep</th>
              <th className="pb-1 text-right font-normal">Mot bäst</th>
              <th className="pb-1 text-right font-normal">Puls</th>
              <th className="pb-1 font-normal">Varvtider</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <OccurrenceRow
                key={`${o.activityId}`}
                occurrence={o}
                bestSeconds={best.meanRepSeconds}
                isBest={o.activityId === best.activityId}
              />
            ))}
          </tbody>
        </table>
      </div>
      {occurrences.length > shown.length && (
        <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
          Visar de {shown.length} senaste av {occurrences.length}.
        </p>
      )}
    </details>
  );
}

export function SessionQuality({ groups }: { groups: SignatureGroup[] }) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Inga återkommande nyckelpass i perioden. Vyn kräver varvdata, som hämtas med{" "}
        <code className="text-xs">scripts/backfill_activity_splits.py</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Pass grupperas på passtyp och på den repdistans som dominerar
        kvalitetsarbetet — inte på passets namn, som varierar för samma session, och inte
        på exakt upplägg: av 106 intervallpass fanns 102 olika upplägg, så exakta
        upprepningar finns nästan inte. Ett tröskelpass på 400 m och ett intervallpass på
        400 m hålls isär, eftersom de springs på helt olika fart.
        {" "}En 400:a ur 15×400 är inte fullt jämförbar med en ur 5×400 — därför visas
        upplägget per rad, så du kan väga in det själv.
      </p>
      {groups.map((g) => (
        <SignatureCard key={`${g.category ?? "okänd"}|${g.distanceMeters}`} group={g} />
      ))}
    </div>
  );
}
