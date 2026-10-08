import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import { LactateTestChart } from "@/components/LactateTestChart";
import {
  labSourceName,
  paceFromKmh,
  type LabZoneSet,
  type LactateTestStep,
} from "@/lib/zone-sources";

/* Det senaste laktattestet på Form-sidan: diagrammet som i rapporten, och
 * under det de tre talen rapporten själv lyfter fram — aerob tröskel,
 * anaerob tröskel och maxpuls. Stegdata i lactate_test_steps, trösklarna på
 * hr_zone_sets (supabase/migrations/20260929180000_lactate_test_steps.sql). */

const kmh = (v: number) => v.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function LactateTestSection({ set, steps }: { set: LabZoneSet; steps: LactateTestStep[] }) {
  const peakHr = Math.max(...steps.map((s) => s.heartRate ?? 0));
  const thresholds = [
    { title: "Aerob tröskel (LT1)", hr: set.lt1Hr, speed: set.lt1SpeedKmh },
    { title: "Anaerob tröskel (LT2)", hr: set.lt2Hr, speed: set.lt2SpeedKmh },
  ];

  return (
    <CollapsibleSection
      title={labSourceName(set)}
      meta={set.label}
      headline={
        set.lt1Hr != null && set.lt2Hr != null ? (
          <span className="text-sm text-[var(--ink-2)]">
            Aerob tröskel vid puls {set.lt1Hr}
            {set.lt1SpeedKmh != null ? ` (${kmh(set.lt1SpeedKmh)} km/h)` : ""}, anaerob vid{" "}
            {set.lt2Hr}
            {set.lt2SpeedKmh != null ? ` (${kmh(set.lt2SpeedKmh)} km/h)` : ""}.
          </span>
        ) : undefined
      }
    >
      <p className="max-w-3xl text-sm text-[var(--ink-2)]">
        Stegtest på löpband: farten ökar varje steg, och puls, laktat och ansträngning mäts i
        slutet av steget. Ansträngningen (Borg 6–20) är <strong>självskattad</strong>.
      </p>

      <LactateTestChart set={set} steps={steps} />

      <div className="grid gap-3 sm:grid-cols-3">
        {thresholds.map((t) => (
          <div key={t.title} className="rounded-lg border border-[var(--line)] p-3">
            <p className="text-xs text-[var(--ink-3)]">{t.title}</p>
            <p className="tabular mt-1 text-lg font-semibold text-[var(--foreground)]">
              {t.hr ?? "–"} <span className="text-sm font-normal text-[var(--ink-3)]">slag/min</span>
            </p>
            {t.speed != null && (
              <p className="tabular text-sm text-[var(--ink-2)]">
                {kmh(t.speed)} km/h · {paceFromKmh(t.speed)}
              </p>
            )}
          </div>
        ))}
        <div className="rounded-lg border border-[var(--line)] p-3">
          <p className="text-xs text-[var(--ink-3)]">Maxpuls</p>
          <p className="tabular mt-1 text-lg font-semibold text-[var(--foreground)]">
            {peakHr} <span className="text-sm font-normal text-[var(--ink-3)]">högst på testet</span>
          </p>
          {set.maxHr != null && (
            <p className="tabular text-sm text-[var(--ink-2)]">{set.maxHr} estimerad</p>
          )}
        </div>
      </div>
    </CollapsibleSection>
  );
}
