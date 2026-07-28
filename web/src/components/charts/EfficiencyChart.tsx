"use client";

import { useMemo, useRef, useState } from "react";
import { CATEGORY_LABELS, categoryColorVar, type ActivityCategory } from "@/lib/categories";
import { median } from "@/lib/stats-utils";

/* ------------------------------------------------------------------------ *
 * EfficiencyChart — formkurva / Efficiency Factor (P1.4 i
 * docs/insikter-roadmap.md)
 *
 * ── Enheten ───────────────────────────────────────────────────────────────
 * Roadmapens formel är EF = (distans_m / duration_s) / avg_hr, alltså m/s per
 * slag — ett tal runt 0,019 som ingen kan hålla i huvudet. Multiplicerat med
 * 60 blir samma tal **meter per hjärtslag**, vilket är exakt samma storhet i
 * en enhet som går att förstå: "hon kommer 1,16 m längre per hjärtslag än
 * förra månaden". Diagrammet visar meter per slag; råvärdet enligt formeln
 * står i tabellen och i detaljraden, så inget döljs.
 *
 * ── Trendlinjen ───────────────────────────────────────────────────────────
 * Rullande 4-veckorsmedian, inte medelvärde: ett enda pass i motvind eller
 * med tappat pulsband ska inte kunna dra kurvan. Median över ett bakåtblickande
 * 28-dagarsfönster, och bara där fönstret innehåller minst tre pass — annars
 * ritas ingenting alls hellre än en trend byggd på två punkter.
 *
 * ── Färg ──────────────────────────────────────────────────────────────────
 * Punkterna bär passkategori (lugn distans / långpass) och tar därför
 * kategoripalettens slot 1 och 2 — samma två färger som i huvudgrafen, samma
 * betydelse. Trendlinjen ritas i bläck: den är inte en tredje kategori.
 * ------------------------------------------------------------------------ */

export type EfficiencyPoint = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** (distans_m / duration_s) / avg_hr — råvärdet enligt roadmapens formel. */
  ef: number;
  label: string;
  category: Extract<ActivityCategory, "easy" | "long_run">;
  durationSeconds: number;
  distanceMeters: number;
  avgHr: number;
};

export type EfficiencyRace = { date: string; label: string };

/** m/s per slag → meter per hjärtslag. */
const METERS_PER_BEAT = 60;

const WIDTH = 800;
const HEIGHT = 270;
const PAD_TOP = 12;
const PAD_LEFT = 46;
const PAD_RIGHT = 12;
const X_AXIS_H = 20;
const RACE_RAIL_H = 20;
const PLOT_H = HEIGHT - PAD_TOP - X_AXIS_H - RACE_RAIL_H;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;

const TREND_WINDOW_DAYS = 28;
const TREND_MIN_POINTS = 3;
const DAY_MS = 24 * 3600 * 1000;

const CATEGORIES: EfficiencyPoint["category"][] = ["easy", "long_run"];

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function formatShortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)}/${Number(m)}`;
}

function formatDuration(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

/** Månadsetiketter på tidsaxeln — en per månadsskifte inom fönstret. */
function monthTicks(fromMs: number, toMs: number): { ms: number; label: string }[] {
  const out: { ms: number; label: string }[] = [];
  const names = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
  const cursor = new Date(fromMs);
  cursor.setUTCDate(1);
  cursor.setUTCHours(0, 0, 0, 0);
  if (cursor.getTime() < fromMs) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= toMs) {
    out.push({ ms: cursor.getTime(), label: names[cursor.getUTCMonth()] });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export function EfficiencyChart({
  points,
  races,
  fromDate,
  toDate,
  emptyLabel = "Inga pass i perioden klarar filtret.",
}: {
  points: EfficiencyPoint[];
  races: EfficiencyRace[];
  /** Tidsaxelns fönster (YYYY-MM-DD) — samma som resten av sidan. */
  fromDate: string;
  toDate: string;
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const [showTable, setShowTable] = useState(false);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const sorted = useMemo(
    () => [...points].sort((a, b) => dayMs(a.date) - dayMs(b.date)),
    [points],
  );

  /** Rullande 28-dagarsmedian, en punkt per pass. `null` där fönstret är för
   * tunt — linjen bryts där i stället för att gissa. */
  const trend = useMemo(
    () =>
      sorted.map((p) => {
        const to = dayMs(p.date);
        const from = to - (TREND_WINDOW_DAYS - 1) * DAY_MS;
        const window = sorted.filter((q) => {
          const t = dayMs(q.date);
          return t >= from && t <= to;
        });
        if (window.length < TREND_MIN_POINTS) return null;
        return median(window.map((q) => q.ef));
      }),
    [sorted],
  );

  if (sorted.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>;
  }

  /* ------------------------------- skalor -------------------------------- */

  const fromMs = dayMs(fromDate);
  const toMs = Math.max(dayMs(toDate), fromMs + DAY_MS);
  const xFor = (date: string) =>
    PAD_LEFT + ((dayMs(date) - fromMs) / (toMs - fromMs)) * PLOT_W;

  const values = sorted.map((p) => p.ef * METERS_PER_BEAT);
  const rawMin = Math.min(...values);
  const rawMax = Math.max(...values);
  const pad = (rawMax - rawMin || 0.1) * 0.12;
  const yMin = Math.max(0, rawMin - pad);
  const yMax = rawMax + pad;
  const yFor = (metersPerBeat: number) =>
    PAD_TOP + PLOT_H - ((metersPerBeat - yMin) / (yMax - yMin)) * PLOT_H;

  const yTicks = Array.from({ length: 5 }, (_, i) => yMin + ((yMax - yMin) / 4) * i);

  let trendPath = "";
  let penDown = false;
  trend.forEach((v, i) => {
    if (v == null) {
      penDown = false;
      return;
    }
    trendPath += `${penDown ? "L" : "M"} ${xFor(sorted[i].date)} ${yFor(v * METERS_PER_BEAT)} `;
    penDown = true;
  });

  const raceRailY = PAD_TOP + PLOT_H + RACE_RAIL_H / 2;
  const hoveredPoint = sorted.find((p) => p.id === hovered) ?? null;

  /** Närmaste punkt i viewBox-koordinater. En 8 px prick är omöjlig att
   * pricka; hela plotytan är därför träffyta och närmaste punkt vinner. */
  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const scale = rect.width / WIDTH;
    const x = (event.clientX - rect.left) / scale;
    const y = (event.clientY - rect.top) / scale;

    let best: EfficiencyPoint | null = null;
    let bestDistance = Infinity;
    for (const p of sorted) {
      const dx = xFor(p.date) - x;
      const dy = yFor(p.ef * METERS_PER_BEAT) - y;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = p;
      }
    }
    setHovered(best && bestDistance <= 45 * 45 ? best.id : null);
  };

  return (
    <div className="flex w-full max-w-full flex-col gap-3">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full"
        role="img"
        aria-label="Efficiency Factor per pass över tid"
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
              {v.toFixed(2)}
            </text>
          </g>
        ))}
        <text
          x={PAD_LEFT}
          y={PAD_TOP - 2}
          className="fill-zinc-500 dark:fill-zinc-400"
          style={{ fontSize: 10 }}
        >
          Meter per hjärtslag
        </text>

        {/* --- tävlingar: hårlinje genom plotytan + markör på egen rail --- */}
        {races.map((race) => (
          <g key={`race-${race.date}-${race.label}`}>
            <line
              x1={xFor(race.date)}
              x2={xFor(race.date)}
              y1={PAD_TOP}
              y2={PAD_TOP + PLOT_H}
              className="stroke-zinc-200 dark:stroke-zinc-800"
              strokeWidth={1}
            />
            <path
              d={`M ${xFor(race.date)} ${raceRailY - 5} L ${xFor(race.date) + 5} ${raceRailY + 4} L ${xFor(race.date) - 5} ${raceRailY + 4} Z`}
              style={{ fill: categoryColorVar("race") }}
              className="stroke-white dark:stroke-zinc-950"
              strokeWidth={1.5}
              paintOrder="stroke"
            >
              <title>{`Tävling ${formatShortDate(race.date)}: ${race.label}`}</title>
            </path>
          </g>
        ))}

        {/* --- trendlinje under punkterna: den är kontext, inte data --- */}
        <path
          d={trendPath}
          fill="none"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          className="stroke-zinc-900 dark:stroke-zinc-100"
          opacity={0.55}
        />

        {sorted.map((p) => {
          const isHovered = p.id === hovered;
          return (
            <circle
              key={p.id}
              cx={xFor(p.date)}
              cy={yFor(p.ef * METERS_PER_BEAT)}
              r={isHovered ? 6 : 4}
              style={{ fill: categoryColorVar(p.category) }}
              className="stroke-white dark:stroke-zinc-950"
              strokeWidth={2}
              paintOrder="stroke"
              tabIndex={0}
              onFocus={() => setHovered(p.id)}
              onBlur={() => setHovered(null)}
            >
              <title>{`${formatShortDate(p.date)} ${p.label}: ${(p.ef * METERS_PER_BEAT).toFixed(2)} m/slag`}</title>
            </circle>
          );
        })}

        {monthTicks(fromMs, toMs).map((tick) => (
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
        {CATEGORIES.filter((c) => sorted.some((p) => p.category === c)).map((c) => (
          <span key={c} className="inline-flex items-center gap-1.5">
            <span
              className="h-2.5 w-2.5 shrink-0 rounded-full"
              style={{ backgroundColor: categoryColorVar(c) }}
            />
            {CATEGORY_LABELS[c]}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5">
          <svg width={22} height={10} aria-hidden="true" className="shrink-0">
            <line
              x1={1}
              y1={5}
              x2={21}
              y2={5}
              strokeWidth={2}
              strokeLinecap="round"
              className="stroke-zinc-900 dark:stroke-zinc-100"
              opacity={0.55}
            />
          </svg>
          4-veckorsmedian
        </span>
        {races.length > 0 && (
          <span className="inline-flex items-center gap-1.5">
            <svg width={10} height={10} aria-hidden="true" className="shrink-0">
              <path d="M 5 1 L 9.5 9 L 0.5 9 Z" style={{ fill: categoryColorVar("race") }} />
            </svg>
            Tävling
          </span>
        )}
      </div>

      {hoveredPoint && (
        <div className="flex flex-col gap-1 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatShortDate(hoveredPoint.date)} — {hoveredPoint.label}
          </div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            <span className="tabular-nums">
              {(hoveredPoint.ef * METERS_PER_BEAT).toFixed(2)} m per hjärtslag (EF{" "}
              {hoveredPoint.ef.toFixed(4)})
            </span>
            <span className="tabular-nums">
              {(hoveredPoint.distanceMeters / 1000).toFixed(2)} km
            </span>
            <span className="tabular-nums">{formatDuration(hoveredPoint.durationSeconds)}</span>
            <span className="tabular-nums">{hoveredPoint.avgHr} slag/min</span>
            <span>{CATEGORY_LABELS[hoveredPoint.category]}</span>
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="w-fit text-xs text-zinc-500 underline hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        {showTable ? "Dölj tabell" : `Visa som tabell (${sorted.length} pass)`}
      </button>

      {showTable && (
        <div className="max-h-96 w-full max-w-full overflow-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                <th scope="col" className="py-1 pr-4 font-normal">
                  Datum
                </th>
                <th scope="col" className="py-1 pr-4 font-normal">
                  Pass
                </th>
                <th scope="col" className="py-1 pr-4 font-normal">
                  Kategori
                </th>
                <th scope="col" className="py-1 pr-4 font-normal">
                  Distans
                </th>
                <th scope="col" className="py-1 pr-4 font-normal">
                  Tid
                </th>
                <th scope="col" className="py-1 pr-4 font-normal">
                  Snittpuls
                </th>
                <th scope="col" className="py-1 pr-4 font-normal">
                  m/slag
                </th>
                <th scope="col" className="py-1 font-normal">
                  EF
                </th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p) => (
                <tr key={p.id} className="border-t border-zinc-100 dark:border-zinc-800">
                  <th scope="row" className="py-1 pr-4 font-normal tabular-nums">
                    {p.date}
                  </th>
                  <td className="py-1 pr-4">{p.label}</td>
                  <td className="py-1 pr-4">{CATEGORY_LABELS[p.category]}</td>
                  <td className="py-1 pr-4 tabular-nums">
                    {(p.distanceMeters / 1000).toFixed(2)} km
                  </td>
                  <td className="py-1 pr-4 tabular-nums">{formatDuration(p.durationSeconds)}</td>
                  <td className="py-1 pr-4 tabular-nums">{p.avgHr}</td>
                  <td className="py-1 pr-4 tabular-nums">
                    {(p.ef * METERS_PER_BEAT).toFixed(2)}
                  </td>
                  <td className="py-1 tabular-nums">{p.ef.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
