"use client";

import { useMemo, useRef, useState } from "react";

/* ------------------------------------------------------------------------ *
 * RaceProgressionChart — K5 i docs/tranarperspektiv.md: "hur har 1500m
 * utvecklats?", en kurva per vald gren, en punkt per lopp på en datumaxel.
 *
 * ── Flera grenar samtidigt (2026-08-13) ──────────────────────────────────
 * Sekunder är inte jämförbart mellan grenar (800m ligger runt 2 min, 5000m
 * runt 17) — att rita flera grenars råtider på samma axel hade antingen
 * krävt en axel per gren (svårläst) eller gjort skalan meningslös för alla
 * utom en. Y-axeln är i stället "andel av grenens eget personbästa" (100 % =
 * PB, lägre är aldrig möjligt) — varje kurva mäts mot sig själv, så flera
 * grenar delar samma axel utan att bli jämförda mot varandra. Exakt tid
 * finns kvar i hovertooltipen och detaljtabellen under grafen.
 *
 * ── Geometrin vänds ALDRIG (för tävlingsresultat) ─────────────────────────
 * Trots normaliseringen: lägre än 100 % är fortfarande omöjligt för en
 * tävlingskurva, och ett lägre värde är fortfarande bättre.
 *
 * ── Träningslager (2026-08-16, uttrycklig begäran) ────────────────────────
 * Valfria kurvor (Formkurva/EF, VO2max, LT2 m.fl.) för att visuellt jämföra
 * "vad hände i träningen" med "vad hände i tävling" på samma tidsaxel.
 * Samma "andel av eget bästa"-princip återanvänds — men här är 100 % alltid
 * DET BÄSTA UPPMÄTTA VÄRDET (`higherIsBetter` avgör om bäst är max eller
 * min), så en tränings- och en tävlingskurva båda närmar sig samma 100 %-
 * linje när formen är som bäst, om än från varsitt håll (tävlingstiden
 * uppifrån, träningsmåttet underifrån). Ren visuell jämförelse, ingen
 * statistisk korrelation räknas — det är upp till ögat, se motiveringen i
 * konversationen (för få tävlingar per säsong för att en riktig
 * korrelationskoefficient skulle vara meningsfull).
 * ------------------------------------------------------------------------ */

export type RaceProgressionVenue = "indoor" | "outdoor" | null;

export type RaceProgressionPoint = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  competitionName: string;
  /** actual_result i fritext — källan för visning, se fallgropen i
   * docs/tranarperspektiv.md K5/K9. */
  resultLabel: string;
  /** Tolkat vid import (competition_events.result_seconds) — bara det
   * numret som ritas, aldrig fritexten. */
  resultSeconds: number;
  venue: RaceProgressionVenue;
};

export type RaceProgressionSeries = {
  event: string;
  /** CSS-färgvärde (t.ex. `var(--cat-easy)`) — en per vald gren, stabil
   * oavsett vilka andra grenar som råkar vara valda samtidigt. */
  color: string;
  points: RaceProgressionPoint[];
};

export type TrainingSeriesPoint = { date: string; value: number };

export type TrainingSeries = {
  id: string;
  label: string;
  /** För tooltip-texten, t.ex. "m/slag", "VO2max", "slag/min". */
  unit: string;
  color: string;
  points: TrainingSeriesPoint[];
  /** Styr bara vilket värde som räknas som "bäst" (100 %) och tooltip-
   * fraseringen — påverkar aldrig var linjen faktiskt ritas. */
  higherIsBetter: boolean;
  /** Visas i stället för en kurva när lagret har för få punkter (t.ex. LT2
   * med bara en sparad mätning) — ärligare än att låtsas en trend finns. */
  insufficientDataNote?: string;
};

const WIDTH = 800;
const HEIGHT = 280;
const PAD_TOP = 14;
const PAD_LEFT = 46;
const PAD_RIGHT = 16;
const X_AXIS_H = 20;
const PLOT_H = HEIGHT - PAD_TOP - X_AXIS_H;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const DAY_MS = 24 * 3600 * 1000;

const MONTHS_SHORT = [
  "jan", "feb", "mar", "apr", "maj", "jun",
  "jul", "aug", "sep", "okt", "nov", "dec",
];

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function formatShortDate(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  return `${d.getUTCDate()} ${MONTHS_SHORT[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Sekunder → "2:21,99". Medeldistans räcker aldrig till timmar, så bara
 * minuter:sekunder,hundradelar behövs. */
export function formatRaceTime(seconds: number): string {
  const totalCentiseconds = Math.round(seconds * 100);
  const cs = totalCentiseconds % 100;
  const totalSeconds = Math.floor(totalCentiseconds / 100);
  const s = totalSeconds % 60;
  const m = Math.floor(totalSeconds / 60);
  return `${m}:${String(s).padStart(2, "0")},${String(cs).padStart(2, "0")}`;
}

function venueLabel(venue: RaceProgressionVenue): string {
  return venue === "indoor" ? "Inomhus" : venue === "outdoor" ? "Utomhus" : "Bana okänd";
}

/** En etikett per årsskifte inom fönstret — resultathistoriken spänner över
 * flera säsonger, så en axel med månadsetiketter (som EfficiencyChart) hade
 * blivit oläsligt tät. */
function yearTicks(fromMs: number, toMs: number): { ms: number; label: string }[] {
  const out: { ms: number; label: string }[] = [];
  const cursor = new Date(fromMs);
  cursor.setUTCMonth(0, 1);
  cursor.setUTCHours(0, 0, 0, 0);
  if (cursor.getTime() < fromMs) cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  while (cursor.getTime() <= toMs) {
    out.push({ ms: cursor.getTime(), label: String(cursor.getUTCFullYear()) });
    cursor.setUTCFullYear(cursor.getUTCFullYear() + 1);
  }
  return out;
}

type PlottedPoint = RaceProgressionPoint & {
  seriesEvent: string;
  color: string;
  pctOfPb: number;
  isPb: boolean;
};

type PlottedTrainingPoint = TrainingSeriesPoint & {
  seriesId: string;
  label: string;
  unit: string;
  color: string;
  pct: number;
};

/** "Andel av eget bästa" för ett träningslager — 100 % är alltid det bästa
 * uppmätta värdet, `higherIsBetter` avgör bara om bäst är max eller min. */
function toTrainingPct(series: TrainingSeries): PlottedTrainingPoint[] {
  if (series.points.length === 0) return [];
  const best = series.higherIsBetter
    ? Math.max(...series.points.map((p) => p.value))
    : Math.min(...series.points.map((p) => p.value));
  if (best === 0) return [];
  return series.points.map((p) => ({
    ...p,
    seriesId: series.id,
    label: series.label,
    unit: series.unit,
    color: series.color,
    pct: series.higherIsBetter ? (p.value / best) * 100 : (best / p.value) * 100,
  }));
}

export function RaceProgressionChart({
  series,
  trainingSeries = [],
  emptyLabel = "Inga lopp i den valda grenen med det här filtret.",
}: {
  series: RaceProgressionSeries[];
  /** Valfria träningskurvor (Formkurva/EF, VO2max, LT2, ...) — växlas på/av
   * via kryssrutorna under grafen, avstängda som standard utom den första. */
  trainingSeries?: TrainingSeries[];
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<
    | { kind: "race"; id: string }
    | { kind: "training"; seriesId: string; date: string }
    | null
  >(null);
  const [visibleTraining, setVisibleTraining] = useState<Set<string>>(
    () => new Set(trainingSeries[0] ? [trainingSeries[0].id] : []),
  );
  // Tidsfönster för VISNINGEN — påverkar aldrig vad som räknas som
  // personbästa (den räknas alltid ur hela historiken, se allPoints/
  // toTrainingPct nedan), bara vilka punkter som faktiskt ritas. `cutoffMs`
  // räknas ut i klick-hanteraren (inte under render, där Date.now() räknas
  // som en otillåten sidoeffekt) och sparas färdigräknad i state.
  const [period, setPeriod] = useState<{ years: number | null; cutoffMs: number }>({
    years: null,
    cutoffMs: -Infinity,
  });
  const svgRef = useRef<SVGSVGElement | null>(null);

  const hasAnyRaceData = series.some((s) => s.points.length > 0);

  const allPoints = useMemo(() => {
    const out: PlottedPoint[] = [];
    for (const s of series) {
      if (s.points.length === 0) continue;
      // Personbästa räknas alltid ur hela grenens historik, inte bara det
      // som råkar visas — annars skulle "senaste året" kunna få ett lopp
      // att se ut som personbästa fast det inte är det.
      const pb = Math.min(...s.points.map((p) => p.resultSeconds));
      for (const p of s.points) {
        if (dayMs(p.date) < period.cutoffMs) continue;
        out.push({
          ...p,
          seriesEvent: s.event,
          color: s.color,
          pctOfPb: (p.resultSeconds / pb) * 100,
          isPb: p.resultSeconds === pb,
        });
      }
    }
    return out.sort((a, b) => dayMs(a.date) - dayMs(b.date));
  }, [series, period]);

  const activeTrainingSeries = trainingSeries.filter((s) => visibleTraining.has(s.id));
  const trainingPctBySeriesId = useMemo(() => {
    const map = new Map<string, PlottedTrainingPoint[]>();
    for (const s of trainingSeries) {
      if (!visibleTraining.has(s.id)) continue;
      const visible = toTrainingPct(s).filter((p) => dayMs(p.date) >= period.cutoffMs);
      map.set(s.id, visible.sort((a, b) => dayMs(a.date) - dayMs(b.date)));
    }
    return map;
  }, [trainingSeries, visibleTraining, period]);

  const periodOptions: { years: number | null; label: string }[] = [
    { years: null, label: "Alla" },
    { years: 1, label: "Senaste året" },
    { years: 2, label: "Senaste 2 åren" },
    { years: 3, label: "Senaste 3 åren" },
  ];

  const periodSelector = (
    <div className="flex flex-wrap items-center gap-2 text-sm" role="group" aria-label="Tidsperiod">
      {periodOptions.map((opt) => (
        <button
          key={opt.label}
          type="button"
          onClick={() =>
            setPeriod(
              opt.years != null
                ? { years: opt.years, cutoffMs: Date.now() - opt.years * 365 * DAY_MS }
                : { years: null, cutoffMs: -Infinity },
            )
          }
          aria-pressed={period.years === opt.years}
          className={`rounded px-3 py-1 ${
            period.years === opt.years
              ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
              : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          }`}
        >
          {opt.label}
        </button>
      ))}
    </div>
  );

  if (!hasAnyRaceData) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>;
  }

  if (allPoints.length === 0) {
    return (
      <div className="flex flex-col gap-3">
        {periodSelector}
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Inga lopp i den valda perioden — testa ett bredare tidsfönster.
        </p>
      </div>
    );
  }

  /* ------------------------------- skalor -------------------------------- */

  const allTrainingPoints = [...trainingPctBySeriesId.values()].flat();
  const allDates = [
    ...allPoints.map((p) => p.date),
    ...allTrainingPoints.map((p) => p.date),
  ];
  const rawFromMs = Math.min(...allDates.map(dayMs));
  const rawToMs = Math.max(Math.max(...allDates.map(dayMs)), rawFromMs + DAY_MS);
  const span = rawToMs - rawFromMs;
  // Padding så att första/sista punkten inte hamnar exakt på plotkanten.
  const xPad = Math.max(span * 0.06, 20 * DAY_MS);
  const fromMs = rawFromMs - xPad;
  const toMs = rawToMs + xPad;
  const xFor = (date: string) => PAD_LEFT + ((dayMs(date) - fromMs) / (toMs - fromMs)) * PLOT_W;

  const pctValues = [...allPoints.map((p) => p.pctOfPb), ...allTrainingPoints.map((p) => p.pct)];
  const rawMin = Math.min(100, ...pctValues);
  const rawMax = Math.max(...pctValues);
  const pad = Math.max((rawMax - rawMin) * 0.15, 1);
  const yMin = Math.max(0, rawMin - pad);
  const yMax = rawMax + pad;
  const yFor = (pct: number) => PAD_TOP + PLOT_H - ((pct - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) / 4) * i);

  const hoveredRacePoint =
    hovered?.kind === "race" ? (allPoints.find((p) => p.id === hovered.id) ?? null) : null;
  const hoveredTrainingPoint =
    hovered?.kind === "training"
      ? ((trainingPctBySeriesId.get(hovered.seriesId) ?? []).find(
          (p) => p.date === hovered.date,
        ) ?? null)
      : null;

  /** Samma "hela plotytan är träffyta"-mönster som EfficiencyChart — med ett
   * fåtal punkter utspridda över flera år är en prick i sig en omöjlig
   * träffyta. Söker bland både tävlings- och synliga träningspunkter. */
  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = rect.width / WIDTH;
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;

    let best: typeof hovered = null;
    let bestDistance = Infinity;
    for (const p of allPoints) {
      const dx = xFor(p.date) - x;
      const dy = yFor(p.pctOfPb) - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { kind: "race", id: p.id };
      }
    }
    for (const points of trainingPctBySeriesId.values()) {
      for (const p of points) {
        const dx = xFor(p.date) - x;
        const dy = yFor(p.pct) - y;
        const distance = dx * dx + dy * dy;
        if (distance < bestDistance) {
          bestDistance = distance;
          best = { kind: "training", seriesId: p.seriesId, date: p.date };
        }
      }
    }
    setHovered(bestDistance <= 50 * 50 ? best : null);
  };

  return (
    <div className="flex w-full max-w-full flex-col gap-3">
      {periodSelector}
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Resultat per lopp över tid för de valda grenarna, som andel av respektive grens personbästa, med valfria träningskurvor. Lägre tävlingsresultat är bättre; för träningskurvorna är närmare 100 % alltid bäst uppmätta värde."
        onPointerMove={handlePointer}
        onPointerLeave={() => setHovered(null)}
      >
        {yTicks.map((v, i) => (
          <g key={`y-${i}`}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(v)}
              y2={yFor(v)}
              className="stroke-zinc-200 dark:stroke-zinc-800"
              strokeWidth={1}
            />
            <text
              x={PAD_LEFT - 6}
              y={yFor(v)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-zinc-500 tabular-nums dark:fill-zinc-400"
              style={{ fontSize: 10 }}
            >
              {v.toFixed(0)}%
            </text>
          </g>
        ))}
        <text
          x={PAD_LEFT}
          y={PAD_TOP - 2}
          className="fill-zinc-500 dark:fill-zinc-400"
          style={{ fontSize: 10 }}
        >
          Andel av eget personbästa — tävling: lägre bättre, träning: närmare 100 % bättre
        </text>

        {/* --- personbästa: en hjälplinje för alla kurvor, alltid vid 100 % --- */}
        <line
          x1={PAD_LEFT}
          x2={WIDTH - PAD_RIGHT}
          y1={yFor(100)}
          y2={yFor(100)}
          strokeWidth={1.5}
          strokeDasharray="4 3"
          className="stroke-zinc-900 dark:stroke-zinc-100"
          opacity={0.35}
        />

        {/* --- en linje per gren, kronologisk ordning inom grenen --- */}
        {series.map((s) => {
          if (s.points.length === 0) return null;
          const pb = Math.min(...s.points.map((p) => p.resultSeconds));
          const sorted = [...s.points].sort((a, b) => dayMs(a.date) - dayMs(b.date));
          const path = sorted
            .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.date)} ${yFor((p.resultSeconds / pb) * 100)}`)
            .join(" ");
          return (
            <path
              key={s.event}
              d={path}
              fill="none"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ stroke: s.color }}
              opacity={0.55}
            />
          );
        })}

        {/* --- träningslager: streckad linje, skild stil från tävlingskurvorna --- */}
        {[...trainingPctBySeriesId.entries()].map(([seriesId, points]) => {
          if (points.length < 2) return null;
          const path = points
            .map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.date)} ${yFor(p.pct)}`)
            .join(" ");
          return (
            <path
              key={seriesId}
              d={path}
              fill="none"
              strokeWidth={1.75}
              strokeDasharray="6 4"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ stroke: points[0].color }}
              opacity={0.7}
            />
          );
        })}

        {[...trainingPctBySeriesId.values()].flat().map((p) => {
          const isHovered = hovered?.kind === "training" && hovered.seriesId === p.seriesId && hovered.date === p.date;
          const cx = xFor(p.date);
          const cy = yFor(p.pct);
          const r = isHovered ? 4.5 : 3;
          return (
            <rect
              key={`${p.seriesId}-${p.date}`}
              x={cx - r}
              y={cy - r}
              width={r * 2}
              height={r * 2}
              style={{ fill: p.color }}
              className="stroke-white dark:stroke-zinc-950"
              strokeWidth={1.5}
              paintOrder="stroke"
            />
          );
        })}

        {allPoints.map((p) => {
          const isHovered = hovered?.kind === "race" && hovered.id === p.id;
          const isIndoor = p.venue === "indoor";
          const cx = xFor(p.date);
          const cy = yFor(p.pctOfPb);
          const r = isHovered ? 6 : 4.5;
          return (
            <g key={p.id}>
              {p.isPb && (
                <circle
                  cx={cx}
                  cy={cy}
                  r={r + 4}
                  fill="none"
                  strokeWidth={2}
                  className="stroke-zinc-900 dark:stroke-zinc-100"
                />
              )}
              <circle
                cx={cx}
                cy={cy}
                r={r}
                style={
                  isIndoor
                    ? { fill: "transparent", stroke: p.color }
                    : { fill: p.color }
                }
                strokeWidth={2}
                className={isIndoor ? "" : "stroke-white dark:stroke-zinc-950"}
                paintOrder="stroke"
                tabIndex={0}
                onFocus={() => setHovered({ kind: "race", id: p.id })}
                onBlur={() => setHovered(null)}
              >
                <title>{`${p.seriesEvent} — ${formatShortDate(p.date)} — ${p.competitionName}: ${p.resultLabel} (${venueLabel(p.venue)})${p.isPb ? " — personbästa" : ""}`}</title>
              </circle>
            </g>
          );
        })}

        {yearTicks(fromMs, toMs).map((tick) => (
          <text
            key={tick.ms}
            x={PAD_LEFT + ((tick.ms - fromMs) / (toMs - fromMs)) * PLOT_W}
            y={HEIGHT - 5}
            textAnchor="middle"
            className="fill-zinc-500 dark:fill-zinc-400"
            style={{ fontSize: 10 }}
          >
            {tick.label}
          </text>
        ))}
      </svg>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
        {series.map((s) => (
          <span key={s.event} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: s.color }}
            />
            {s.event}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-zinc-400 dark:bg-zinc-500" />
          Utomhus
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full border-2 border-zinc-400 dark:border-zinc-500" />
          Inomhus
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width={14} height={14} aria-hidden="true" className="shrink-0">
            <circle
              cx={7}
              cy={7}
              r={6}
              fill="none"
              strokeWidth={1.5}
              className="stroke-zinc-900 dark:stroke-zinc-100"
            />
          </svg>
          Personbästa (100 %)
        </span>
      </div>

      {/* --- Träningslager: kryssrutor, av som standard utom den första --- */}
      {trainingSeries.length > 0 && (
        <fieldset className="flex flex-wrap items-center gap-x-4 gap-y-1.5 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <legend className="px-1 text-xs font-medium text-zinc-500 dark:text-zinc-400">
            Träningskurvor (streckade)
          </legend>
          {trainingSeries.map((s) => {
            const on = visibleTraining.has(s.id);
            const tooFewPoints = s.points.length < 2 && s.insufficientDataNote;
            return (
              <label key={s.id} className="flex items-center gap-1.5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={() =>
                    setVisibleTraining((prev) => {
                      const next = new Set(prev);
                      if (next.has(s.id)) next.delete(s.id);
                      else next.add(s.id);
                      return next;
                    })
                  }
                />
                <span
                  className="h-2.5 w-2.5 shrink-0"
                  style={{ backgroundColor: s.color }}
                  aria-hidden="true"
                />
                {s.label}
                {on && tooFewPoints && (
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">
                    ({s.insufficientDataNote})
                  </span>
                )}
              </label>
            );
          })}
          {activeTrainingSeries.length > 0 &&
            renderSparseDataNote(activeTrainingSeries, trainingPctBySeriesId)}
        </fieldset>
      )}

      {(hoveredRacePoint || hoveredTrainingPoint) && (
        <div className="flex flex-col gap-1 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          {hoveredRacePoint && (
            <>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {hoveredRacePoint.seriesEvent} — {formatShortDate(hoveredRacePoint.date)} —{" "}
                {hoveredRacePoint.competitionName}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="tabular-nums">
                  {hoveredRacePoint.resultLabel} ({formatRaceTime(hoveredRacePoint.resultSeconds)})
                </span>
                <span>{venueLabel(hoveredRacePoint.venue)}</span>
                <span className="tabular-nums">{hoveredRacePoint.pctOfPb.toFixed(1)}% av PB</span>
                {hoveredRacePoint.isPb && (
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">Personbästa</span>
                )}
              </div>
            </>
          )}
          {hoveredTrainingPoint && (
            <>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {hoveredTrainingPoint.label} — {formatShortDate(hoveredTrainingPoint.date)}
              </div>
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="tabular-nums">
                  {hoveredTrainingPoint.value.toFixed(2)} {hoveredTrainingPoint.unit}
                </span>
                <span className="tabular-nums">
                  {hoveredTrainingPoint.pct.toFixed(1)}% av bästa uppmätta
                </span>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

/** Kort not under kryssrutorna om något aktivt lager saknar riktig historik
 * — ärligare än att bara rita en enda prick utan förklaring. */
function renderSparseDataNote(
  active: TrainingSeries[],
  bySeriesId: Map<string, PlottedTrainingPoint[]>,
) {
  const sparse = active.filter((s) => (bySeriesId.get(s.id) ?? []).length < 2 && s.insufficientDataNote);
  if (sparse.length === 0) return null;
  return (
    <span className="w-full text-xs text-zinc-400 dark:text-zinc-600">
      {sparse.map((s) => s.insufficientDataNote).join(" ")}
    </span>
  );
}
