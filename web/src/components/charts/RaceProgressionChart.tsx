"use client";

import { useMemo, useRef, useState } from "react";
import { categoryColorVar } from "@/lib/categories";

/* ------------------------------------------------------------------------ *
 * RaceProgressionChart — K5 i docs/tranarperspektiv.md: "hur har 1500m
 * utvecklats?" för en vald gren, en punkt per lopp på en datumaxel.
 *
 * ── Geometrin vänds ALDRIG ───────────────────────────────────────────────
 * Löptid mäts i sekunder där lägre är bättre. Precis som ComboChartens
 * kommentar säger om vilopuls ("Geometrin vänds aldrig efter bra/dåligt")
 * ritas tiden stigande uppåt som vanligt — en snabbare tid hamnar alltså
 * lägre i diagrammet, inte högre. Det är axeletiketten ("Tid — lägre är
 * bättre") som bär den tolkningen, inte en spegling av skalan. Att tyst
 * vända en axel gör grafen omöjlig att lita på.
 *
 * ── Inne/ute ──────────────────────────────────────────────────────────────
 * Alla punkter är tävlingar och bär därför samma färg (kategoripalettens
 * "race", samma gröna nyans som tävlingsmarkören i EfficiencyChart). Inne
 * och ute skiljs i stället åt med form — fylld prick för utomhus, ihålig
 * ring för inomhus — samma princip som veckovyns `Marker` använder för
 * genomfört/planerat (calendar/vecka/[date]/page.tsx). En tävling utan känt
 * `venue` (importluckor) ritas fylld, som utomhus, hellre än en tredje form
 * som sällan förekommer.
 *
 * ── Personbästa ───────────────────────────────────────────────────────────
 * Markeras med en extra ring i bläck (inte kategorifärg — det är ett
 * bläckelement, inte en tredje kategori, se EfficiencyChartens trendlinje)
 * plus en vågrät hjälplinje genom hela plotytan.
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

const WIDTH = 800;
const HEIGHT = 260;
const PAD_TOP = 14;
const PAD_LEFT = 58;
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

export function RaceProgressionChart({
  points,
  bestLabel = "Personbästa",
  emptyLabel = "Inga lopp i den valda grenen med det här filtret.",
}: {
  points: RaceProgressionPoint[];
  /** Vad den snabbaste tiden i urvalet ska kallas. Måste följa bana-filtret:
   * inne och ute är skilda rekord i friidrott, och att kalla den bästa
   * inomhustiden "personbästa" är fel så snart ett utomhuslopp gått fortare
   * (Alices 800m-PB 2:21,99 sattes utomhus i juni). */
  bestLabel?: string;
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const sorted = useMemo(
    () => [...points].sort((a, b) => dayMs(a.date) - dayMs(b.date)),
    [points],
  );

  if (sorted.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>;
  }

  /* ------------------------------- skalor -------------------------------- */

  const rawFromMs = dayMs(sorted[0].date);
  const rawToMs = Math.max(dayMs(sorted[sorted.length - 1].date), rawFromMs + DAY_MS);
  const span = rawToMs - rawFromMs;
  // Padding så att första/sista loppet inte hamnar exakt på plotkanten.
  const xPad = Math.max(span * 0.06, 20 * DAY_MS);
  const fromMs = rawFromMs - xPad;
  const toMs = rawToMs + xPad;
  const xFor = (date: string) => PAD_LEFT + ((dayMs(date) - fromMs) / (toMs - fromMs)) * PLOT_W;

  const values = sorted.map((p) => p.resultSeconds);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin || rawMin * 0.05 || 1) * 0.15;
  const yMin = Math.max(0, rawMin - pad);
  const yMax = rawMax + pad;
  const yFor = (seconds: number) =>
    PAD_TOP + PLOT_H - ((seconds - yMin) / (yMax - yMin || 1)) * PLOT_H;

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) / 4) * i);

  const linePath = sorted.map((p, i) => `${i === 0 ? "M" : "L"} ${xFor(p.date)} ${yFor(p.resultSeconds)}`).join(" ");

  const pbSeconds = Math.min(...values);
  const pbPoint = sorted.find((p) => p.resultSeconds === pbSeconds) ?? null;

  const hoveredPoint = sorted.find((p) => p.id === hovered) ?? null;

  /** Samma "hela plotytan är träffyta"-mönster som EfficiencyChart — med
   * 6–16 punkter utspridda över flera år är en prick i sig en omöjlig
   * träffyta. */
  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = rect.width / WIDTH;
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;

    let best: RaceProgressionPoint | null = null;
    let bestDistance = Infinity;
    for (const p of sorted) {
      const dx = xFor(p.date) - x;
      const dy = yFor(p.resultSeconds) - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = p;
      }
    }
    setHovered(best && bestDistance <= 50 * 50 ? best.id : null);
  };

  return (
    <div className="flex w-full max-w-full flex-col gap-3">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Resultat per lopp över tid för den valda grenen. Lägre är bättre."
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
              {formatRaceTime(v)}
            </text>
          </g>
        ))}
        <text
          x={PAD_LEFT}
          y={PAD_TOP - 2}
          className="fill-zinc-500 dark:fill-zinc-400"
          style={{ fontSize: 10 }}
        >
          Tid — lägre är bättre
        </text>

        {/* --- personbästa: hjälplinje genom hela plotytan --- */}
        {pbPoint && (
          <line
            x1={PAD_LEFT}
            x2={WIDTH - PAD_RIGHT}
            y1={yFor(pbSeconds)}
            y2={yFor(pbSeconds)}
            strokeWidth={1.5}
            strokeDasharray="4 3"
            className="stroke-zinc-900 dark:stroke-zinc-100"
            opacity={0.45}
          />
        )}

        {/* --- linje mellan loppen, kronologisk ordning --- */}
        <path
          d={linePath}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ stroke: categoryColorVar("race") }}
          opacity={0.55}
        />

        {sorted.map((p) => {
          const isHovered = p.id === hovered;
          const isPb = p.id === pbPoint?.id;
          const isIndoor = p.venue === "indoor";
          const cx = xFor(p.date);
          const cy = yFor(p.resultSeconds);
          const r = isHovered ? 6 : 4.5;
          return (
            <g key={p.id}>
              {isPb && (
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
                    ? { fill: "transparent", stroke: categoryColorVar("race") }
                    : { fill: categoryColorVar("race") }
                }
                strokeWidth={2}
                className={isIndoor ? "" : "stroke-white dark:stroke-zinc-950"}
                paintOrder="stroke"
                tabIndex={0}
                onFocus={() => setHovered(p.id)}
                onBlur={() => setHovered(null)}
              >
                <title>{`${formatShortDate(p.date)} — ${p.competitionName}: ${p.resultLabel} (${venueLabel(p.venue)})${isPb ? ` — ${bestLabel.toLowerCase()}` : ""}`}</title>
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
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: categoryColorVar("race") }}
          />
          Utomhus
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span
            className="h-2.5 w-2.5 shrink-0 rounded-full border-2"
            style={{ borderColor: categoryColorVar("race") }}
          />
          Inomhus
        </span>
        {pbPoint && (
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
            {bestLabel} ({formatRaceTime(pbSeconds)})
          </span>
        )}
      </div>

      {hoveredPoint && (
        <div className="flex flex-col gap-1 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatShortDate(hoveredPoint.date)} — {hoveredPoint.competitionName}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="tabular-nums">
              {hoveredPoint.resultLabel} ({formatRaceTime(hoveredPoint.resultSeconds)})
            </span>
            <span>{venueLabel(hoveredPoint.venue)}</span>
            {hoveredPoint.id === pbPoint?.id && (
              <span className="font-medium text-zinc-900 dark:text-zinc-100">{bestLabel}</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
