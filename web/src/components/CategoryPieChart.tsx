"use client";

import { useState } from "react";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  type ActivityCategory,
} from "@/lib/categories";
import { formatDuration } from "@/lib/format";

export type CategoryDatum = {
  category: ActivityCategory;
  km: number;
  seconds: number;
  count: number;
};

type Metric = "distance" | "time";

function metricValue(d: CategoryDatum, metric: Metric): number {
  return metric === "distance" ? d.km : d.seconds;
}

function formatMetric(value: number, metric: Metric): string {
  return metric === "distance" ? `${value.toFixed(1)} km` : formatDuration(value);
}

function polarToCartesian(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

function annulusSectorPath(
  cx: number,
  cy: number,
  rOuter: number,
  rInner: number,
  startAngle: number,
  endAngle: number,
) {
  const outerStart = polarToCartesian(cx, cy, rOuter, startAngle);
  const outerEnd = polarToCartesian(cx, cy, rOuter, endAngle);
  const innerStart = polarToCartesian(cx, cy, rInner, startAngle);
  const innerEnd = polarToCartesian(cx, cy, rInner, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return [
    `M ${outerStart.x} ${outerStart.y}`,
    `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${outerEnd.x} ${outerEnd.y}`,
    `L ${innerEnd.x} ${innerEnd.y}`,
    `A ${rInner} ${rInner} 0 ${largeArc} 0 ${innerStart.x} ${innerStart.y}`,
    "Z",
  ].join(" ");
}

export function CategoryPieChart({
  data,
  metric,
}: {
  data: CategoryDatum[];
  metric: Metric;
}) {
  const [hovered, setHovered] = useState<ActivityCategory | null>(null);
  const [tooltip, setTooltip] = useState<{ x: number; y: number } | null>(null);
  const [showTable, setShowTable] = useState(false);

  // Fast kategoriordning oavsett vilka som förekommer — identitet ska aldrig
  // hoppa mellan kategorier när urvalet ändras.
  const rows = CATEGORY_VALUES.map((category) =>
    data.find((d) => d.category === category),
  ).filter((d): d is CategoryDatum => !!d && metricValue(d, metric) > 0);

  const total = rows.reduce((sum, d) => sum + metricValue(d, metric), 0);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Inga kategoriserade pass i den här perioden.
      </p>
    );
  }

  const cx = 110;
  const cy = 110;
  const rOuter = 100;
  const rInner = 62;

  const slices = rows.reduce<
    Array<{
      d: CategoryDatum;
      value: number;
      share: number;
      startAngle: number;
      endAngle: number;
      midAngle: number;
    }>
  >((acc, d) => {
    const value = metricValue(d, metric);
    const share = value / total;
    const startAngle = acc.length > 0 ? acc[acc.length - 1].endAngle : 0;
    const endAngle = startAngle + share * 360;
    const midAngle = (startAngle + endAngle) / 2;
    acc.push({ d, value, share, startAngle, endAngle, midAngle });
    return acc;
  }, []);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-8">
        <div className="relative shrink-0">
          <svg
            viewBox="0 0 220 220"
            width={220}
            height={220}
            role="img"
            aria-label={`Fördelning per kategori, ${metric === "distance" ? "distans" : "tid"}`}
            onPointerLeave={() => {
              setHovered(null);
              setTooltip(null);
            }}
          >
            {slices.map(({ d, value, share, startAngle, endAngle, midAngle }) => {
              const isDimmed = hovered !== null && hovered !== d.category;
              const path = annulusSectorPath(cx, cy, rOuter, rInner, startAngle, endAngle);
              const labelPos = polarToCartesian(cx, cy, (rOuter + rInner) / 2, midAngle);
              return (
                <g key={d.category}>
                  <path
                    d={path}
                    fill={`var(--cat-${d.category})`}
                    stroke="var(--color-background)"
                    strokeWidth={3}
                    strokeLinejoin="round"
                    opacity={isDimmed ? 0.4 : 1}
                    style={{ cursor: "pointer", transition: "opacity 120ms" }}
                    onPointerMove={(e) => {
                      setHovered(d.category);
                      setTooltip({ x: e.clientX, y: e.clientY });
                    }}
                    onPointerEnter={(e) => {
                      setHovered(d.category);
                      setTooltip({ x: e.clientX, y: e.clientY });
                    }}
                    onFocus={() => setHovered(d.category)}
                    tabIndex={0}
                  >
                    <title>
                      {CATEGORY_LABELS[d.category]}: {formatMetric(value, metric)} (
                      {Math.round(share * 100)}%)
                    </title>
                  </path>
                  {share >= 0.08 && (
                    <text
                      x={labelPos.x}
                      y={labelPos.y}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="#ffffff"
                      stroke="rgba(11,11,11,0.55)"
                      strokeWidth={3}
                      paintOrder="stroke"
                      style={{ fontSize: 12, fontWeight: 600, pointerEvents: "none" }}
                    >
                      {Math.round(share * 100)}%
                    </text>
                  )}
                </g>
              );
            })}
          </svg>
          <div
            className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center"
            style={{ inset: 0 }}
          >
            <span className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
              {formatMetric(total, metric)}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-400">totalt</span>
          </div>
          {tooltip && hovered && (
            <div
              className="pointer-events-none fixed z-10 rounded border border-zinc-200 bg-white px-2 py-1 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900"
              style={{ left: tooltip.x + 12, top: tooltip.y + 12 }}
            >
              <div className="font-semibold text-zinc-900 dark:text-zinc-100">
                {formatMetric(
                  metricValue(rows.find((r) => r.category === hovered)!, metric),
                  metric,
                )}
              </div>
              <div className="text-zinc-500 dark:text-zinc-400">
                {CATEGORY_LABELS[hovered]}
              </div>
            </div>
          )}
        </div>

        <ul className="flex flex-col gap-1.5 text-sm">
          {rows.map((d) => {
            const share = metricValue(d, metric) / total;
            return (
              <li
                key={d.category}
                className="flex items-center gap-2"
                onPointerEnter={() => setHovered(d.category)}
                onPointerLeave={() => setHovered(null)}
              >
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{
                    backgroundColor: `var(--cat-${d.category})`,
                    opacity: hovered !== null && hovered !== d.category ? 0.4 : 1,
                  }}
                />
                <span className="text-zinc-900 dark:text-zinc-100">
                  {CATEGORY_LABELS[d.category]}
                </span>
                <span className="text-zinc-500 dark:text-zinc-400">
                  {formatMetric(metricValue(d, metric), metric)} · {Math.round(share * 100)}%
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="w-fit text-xs text-zinc-500 underline hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        {showTable ? "Dölj tabell" : "Visa som tabell"}
      </button>

      {showTable && (
        <table className="w-full max-w-md text-sm">
          <thead>
            <tr className="text-left text-zinc-500 dark:text-zinc-400">
              <th className="pr-4 font-normal">Kategori</th>
              <th className="pr-4 font-normal">Antal</th>
              <th className="pr-4 font-normal">Distans</th>
              <th className="font-normal">Tid</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.category} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="flex items-center gap-2 py-1 pr-4">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: `var(--cat-${d.category})` }}
                  />
                  {CATEGORY_LABELS[d.category]}
                </td>
                <td className="pr-4">{d.count}</td>
                <td className="pr-4">{d.km.toFixed(1)} km</td>
                <td>{formatDuration(d.seconds)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
