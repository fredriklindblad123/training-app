"use client";

import { useState } from "react";
import { formatMetricValue, type MetricFormatKind } from "@/lib/format";

export type BarDatum = { label: string; value: number };

function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)));
  const normalized = value / magnitude;
  let niceNormalized: number;
  if (normalized <= 1) niceNormalized = 1;
  else if (normalized <= 2) niceNormalized = 2;
  else if (normalized <= 5) niceNormalized = 5;
  else niceNormalized = 10;
  return niceNormalized * magnitude;
}

// Enkelserie-stapeldiagram (t.ex. veckovolym). Fast blå färg — flera olika
// mätvärden visas som separata paneler snarare än överlagrat i ett diagram,
// så ingen identitetsfärg krävs (se dataviz-riktlinjer: "single series, no
// legend box needed — the title names it").
export function BarChart({
  data,
  formatKind,
  emptyLabel = "Ingen data i perioden.",
}: {
  data: BarDatum[];
  formatKind: MetricFormatKind;
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const formatValue = (v: number) => formatMetricValue(formatKind, v);

  if (data.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>;
  }

  const width = 800;
  const height = 220;
  const paddingLeft = 40;
  const paddingBottom = 24;
  const paddingTop = 12;
  const plotWidth = width - paddingLeft - 8;
  const plotHeight = height - paddingTop - paddingBottom;

  const maxValue = Math.max(...data.map((d) => d.value));
  const niceMax = niceCeil(maxValue);
  const gridTicks = 4;

  const step = plotWidth / data.length;
  const barWidth = Math.min(24, step - 4);
  const labelStep = Math.max(1, Math.ceil(data.length / 12));

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Stapeldiagram"
        onPointerLeave={() => setHovered(null)}
      >
        {Array.from({ length: gridTicks + 1 }, (_, i) => {
          const v = (niceMax / gridTicks) * i;
          const y = paddingTop + plotHeight - (v / niceMax) * plotHeight;
          return (
            <g key={i}>
              <line
                x1={paddingLeft}
                x2={width}
                y1={y}
                y2={y}
                className="stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={paddingLeft - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-zinc-500 dark:fill-zinc-400"
                style={{ fontSize: 10 }}
              >
                {Math.round(v)}
              </text>
            </g>
          );
        })}

        {data.map((d, i) => {
          const barHeight = niceMax > 0 ? (d.value / niceMax) * plotHeight : 0;
          const x = paddingLeft + i * step + (step - barWidth) / 2;
          const y = paddingTop + plotHeight - barHeight;
          const isHovered = hovered === i;
          return (
            <g key={i}>
              <rect
                x={x}
                y={y}
                width={barWidth}
                height={Math.max(barHeight, 1)}
                rx={4}
                style={{
                  fill: "var(--cat-easy)",
                  opacity: isHovered ? 1 : 0.85,
                  cursor: "pointer",
                  transition: "opacity 120ms",
                }}
                onPointerEnter={() => setHovered(i)}
                onPointerMove={() => setHovered(i)}
                tabIndex={0}
              >
                <title>
                  {d.label}: {formatValue(d.value)}
                </title>
              </rect>
              {i % labelStep === 0 && (
                <text
                  x={x + barWidth / 2}
                  y={height - 6}
                  textAnchor="middle"
                  className="fill-zinc-500 dark:fill-zinc-400"
                  style={{ fontSize: 10 }}
                >
                  {d.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {hovered !== null && (
        <div className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatValue(data[hovered].value)}
          </span>{" "}
          — {data[hovered].label}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="w-fit text-xs text-zinc-500 underline hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        {showTable ? "Dölj tabell" : "Visa som tabell"}
      </button>
      {showTable && (
        <table className="w-full max-w-md text-sm">
          <tbody>
            {data.map((d, i) => (
              <tr key={i} className="border-t border-zinc-100 dark:border-zinc-800">
                <td className="py-1 pr-4">{d.label}</td>
                <td>{formatValue(d.value)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
