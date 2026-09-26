import { formatPace } from "@/lib/format";
import { LACTATE_CONTEXT_LABELS, type LactateReading } from "@/components/LactateLog";

/* Loggade laktatvärden över tid, i Form-vyn.
 *
 * Följden till formuläret i dagvyn (begäran 2026-09-26). Medvetet en tabell
 * och inget diagram: gruppen har inte börjat mäta, och ett diagram med tre
 * punkter säger mindre än tre rader gör. När det finns ett verkligt
 * testtillfälle med fem–sex stick vid stigande fart är det rätt läge att
 * rita kurvan — då finns det en kurva att rita.
 *
 * Mätningarna grupperas per DAG, för så går ett tröskeltest till: man
 * sticker flera gånger samma pass vid stigande fart, och det är serien som
 * betyder något, inte det enskilda talet.
 *
 * Tröskelvärdena i profilen är självskattade tills ett riktigt test finns
 * (profiles.lt2_source). Det här är ytan där de kan bli mätta i stället, och
 * därför står jämförelsen mot dem utskriven.
 */

const LT2_MMOL = 4;

export function LactateHistory({
  readings,
  lt2Hr,
}: {
  readings: (LactateReading & { measured_at: string })[];
  lt2Hr: number | null;
}) {
  if (readings.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-2)]">
        Inga laktatvärden loggade än. Har du en mätare kan du skriva in sticken på passets dag
        i kalendern — fyll i fart och puls också, så går de att jämföra med din tröskelpuls.
      </p>
    );
  }

  const byDay = new Map<string, typeof readings>();
  for (const r of readings) {
    const day = r.measured_at.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), r]);
  }
  const days = [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));

  return (
    <div className="flex flex-col gap-4">
      {days.map(([day, list]) => {
        /* Det stick som ligger närmast 4 mmol är det som säger var tröskeln
           låg den dagen — 4 mmol är den klassiska referenspunkten för LT2.
           Bara när något stick faktiskt ligger i närheten, annars påstår vi
           en tröskel ur ett enda lågt värde. */
        const near = list
          .filter((r) => Math.abs(Number(r.lactate_mmol) - LT2_MMOL) <= 1.5 && r.heart_rate != null)
          .sort(
            (a, b) =>
              Math.abs(Number(a.lactate_mmol) - LT2_MMOL) -
              Math.abs(Number(b.lactate_mmol) - LT2_MMOL),
          )[0];

        return (
          <div key={day} className="flex flex-col gap-2">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="display text-sm font-semibold text-[var(--foreground)]">{day}</span>
              <span className="text-xs text-[var(--ink-3)]">
                {list.length} {list.length === 1 ? "stick" : "stick"}
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full min-w-md border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[var(--line)] text-left text-[0.6875rem] tracking-wider text-[var(--ink-3)] uppercase">
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Laktat</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Fart</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Puls</th>
                    <th scope="col" className="py-1.5 font-semibold">Sammanhang</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.id} className="border-b border-[var(--line)] last:border-0">
                      <td className="tabular py-1.5 pr-3 font-medium text-[var(--foreground)]">
                        {Number(r.lactate_mmol).toFixed(1)}
                      </td>
                      <td className="tabular py-1.5 pr-3 text-[var(--ink-2)]">
                        {r.pace_seconds_per_km != null ? formatPace(r.pace_seconds_per_km) : "–"}
                      </td>
                      <td className="tabular py-1.5 pr-3 text-[var(--ink-2)]">
                        {r.heart_rate ?? "–"}
                      </td>
                      <td className="py-1.5 text-[var(--ink-3)]">
                        {r.context ? (LACTATE_CONTEXT_LABELS[r.context] ?? r.context) : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {near && (
              <p className="text-xs text-[var(--ink-2)]">
                Sticket närmast 4 mmol låg på {Number(near.lactate_mmol).toFixed(1)} vid puls{" "}
                {near.heart_rate}
                {lt2Hr != null && (
                  <>
                    , mot din inlagda tröskelpuls {lt2Hr}
                    {Math.abs((near.heart_rate ?? 0) - lt2Hr) >= 5 && (
                      <> — värt att se över värdet i Inställningar</>
                    )}
                  </>
                )}
                .
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}
