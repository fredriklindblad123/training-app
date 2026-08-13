import { RING_STATUS_TEXT } from "@/components/KpiRing";
import { ringFillAndStatus } from "@/lib/kpi-ring";
import { QUALITY_WORKOUT_TYPES } from "@/lib/planning";
import { formatDuration } from "@/lib/format";
import type { Compliance } from "@/lib/plan-matching";
import type { TrainingSession } from "@/lib/sessions";

/* Nyckeltalsraden — Distanspass, Kvalitetspass, Distans, Tid, Belastning —
 * delad av kalenderns dag-, vecko-, månads- och årsvy (2026-08-14). Fanns
 * först bara på /veckan, sedan bara i veckovyn; nu samma rad överallt i
 * kalendern så att "hur låg den här perioden till" alltid ser likadant ut
 * oavsett tidshorisont.
 *
 * Pass splittas i distans- och kvalitetspass (QUALITY_WORKOUT_TYPES, samma
 * definition som K6:s kvalitetsveckor i lib/continuity.ts) — en enda
 * "Pass"-summa säger inget om vilken sorts period det varit. Där perioden
 * hade en plan jämförs talet mot det planerade, i samma statusfärg som
 * KpiRing (RING_STATUS_TEXT) — grönt/gult/rött betyder samma sak här som på
 * /dashboard. Utan plan visas bara talet. */

function statTile({
  label,
  value,
  valueText,
  target,
  targetLabel,
}: {
  label: string;
  value: number;
  valueText: string;
  target: number | null;
  targetLabel: string;
}): { label: string; valueText: string; targetText: string | null; statusClass: string } {
  if (target == null) {
    return { label, valueText, targetText: null, statusClass: "" };
  }
  const { status } = ringFillAndStatus(value, target, "higher_is_better");
  return {
    label,
    valueText,
    targetText: `${targetLabel} ${target}`,
    statusClass: RING_STATUS_TEXT[status],
  };
}

export function PeriodStatTiles({
  sessions,
  compliance,
}: {
  sessions: TrainingSession[];
  compliance: Compliance;
}) {
  const totalKm = sessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;
  const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const totalLoad = sessions.reduce((sum, s) => sum + s.trainingLoad, 0);

  const qualityCount = sessions.filter((s) =>
    (QUALITY_WORKOUT_TYPES as readonly string[]).includes(s.category),
  ).length;
  const distanceSessionCount = sessions.length - qualityCount;
  const distancePlanned =
    compliance.plannedCount > 0 ? compliance.plannedCount - compliance.qualityPlanned : null;

  const tiles = [
    statTile({
      label: "Distanspass",
      value: distanceSessionCount,
      valueText: String(distanceSessionCount),
      target: distancePlanned,
      targetLabel: "av",
    }),
    statTile({
      label: "Kvalitetspass",
      value: qualityCount,
      valueText: String(qualityCount),
      target: compliance.plannedCount > 0 ? compliance.qualityPlanned : null,
      targetLabel: "av",
    }),
    statTile({
      label: "Distans",
      value: totalKm,
      valueText: totalKm > 0 ? `${totalKm.toFixed(1)} km` : "—",
      target: compliance.plannedKm,
      targetLabel: "av",
    }),
    statTile({
      label: "Tid",
      value: totalSeconds,
      valueText: totalSeconds > 0 ? formatDuration(totalSeconds) : "—",
      target: null,
      targetLabel: "av",
    }),
    statTile({
      label: "Belastning",
      value: totalLoad,
      valueText: totalLoad > 0 ? String(Math.round(totalLoad)) : "—",
      target: null,
      targetLabel: "av",
    }),
  ];

  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-5">
      {tiles.map((t) => (
        <div key={t.label} className="rounded border border-zinc-200 px-3 py-2 dark:border-zinc-800">
          <dt className="text-xs text-zinc-500 dark:text-zinc-400">{t.label}</dt>
          <dd className="mt-0.5 flex items-baseline gap-1.5">
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
              {t.valueText}
            </span>
            {t.targetText && <span className={`text-xs ${t.statusClass}`}>{t.targetText}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
