import { QUALITY_WORKOUT_TYPES } from "@/lib/planning";
import { formatMinutes, formatNumber } from "@/lib/format";
import type { Compliance } from "@/lib/plan-matching";
import { trainingSeconds, type TrainingSession } from "@/lib/sessions";

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

/* Målet ("av 5") är alltid grått sedan 2026-11-21 (B4). Det färgades förr
 * grönt eller gult efter hur nära planen man låg — men talet är genomförda
 * pass, alltså något en människa gjort eller inte gjort. */
function statTile({
  label,
  valueText,
  target,
}: {
  label: string;
  valueText: string;
  target: string | null;
}): { label: string; valueText: string; targetText: string | null } {
  return { label, valueText, targetText: target == null ? null : `av ${target}` };
}

export function PeriodStatTiles({
  sessions,
  compliance,
}: {
  sessions: TrainingSession[];
  compliance: Compliance;
}) {
  const totalKm = sessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;

  const qualityCount = sessions.filter((s) =>
    (QUALITY_WORKOUT_TYPES as readonly string[]).includes(s.category),
  ).length;
  const distanceSessionCount = sessions.length - qualityCount;
  const distancePlanned =
    compliance.plannedCount > 0 ? compliance.plannedCount - compliance.qualityPlanned : null;

  // Tid enligt samma regel som Idag och Blocket: hela passet, styrka inte
  // med (trainingSeconds). Belastningen (Garmins tal) togs bort 2026-11-21 —
  // den står inte heller på Idag längre, och fem rutor lämnade en tom ruta
  // på mobil.
  const minutes = sessions.reduce((sum, s) => sum + trainingSeconds(s), 0) / 60;
  const tiles = [
    statTile({
      label: "Distanspass",
      valueText: String(distanceSessionCount),
      target: distancePlanned == null ? null : String(distancePlanned),
    }),
    statTile({
      label: "Kvalitetspass",
      valueText: String(qualityCount),
      target: compliance.plannedCount > 0 ? String(compliance.qualityPlanned) : null,
    }),
    statTile({
      label: "Distans",
      valueText: totalKm > 0 ? `${formatNumber(totalKm, 1)} km` : "—",
      target: compliance.plannedKm == null ? null : formatNumber(compliance.plannedKm, 1),
    }),
    statTile({
      label: "Tid",
      valueText: minutes > 0 ? formatMinutes(minutes) : "—",
      target: null,
    }),
  ];

  /* Formen följer StatRow/Stat (components/ui): hårfina skiljelinjer som gap
     på en linjefärgad bakgrund i stället för en ram per ruta, versal etikett
     och tabellsiffror. Egen komponent ändå — den bär ett målvärde med
     statusfärg som Stat medvetet inte modellerar, och dl/dt/dd-semantiken är
     rätt här och ska inte tappas för enhetlighetens skull. */
  return (
    <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.label} className="bg-[var(--surface)] px-3 py-3">
          <dt className="text-[0.6875rem] font-semibold tracking-wider text-[var(--ink-3)] uppercase">
            {t.label}
          </dt>
          <dd className="mt-1 flex items-baseline gap-1.5">
            <span className="tabular text-2xl leading-none font-semibold text-[var(--foreground)]">
              {t.valueText}
            </span>
            {t.targetText && <span className="text-xs text-[var(--ink-3)]">{t.targetText}</span>}
          </dd>
        </div>
      ))}
    </dl>
  );
}
