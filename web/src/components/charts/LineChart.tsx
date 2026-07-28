"use client";

import { useState } from "react";
import { formatMetricValue, type MetricFormatKind } from "@/lib/format";

export type LineDatum = { label: string; value: number | null };

// Enkelserie-linjediagram (t.ex. sömn/HRV/vilopuls över tid). Luckor
// (value=null, dagar utan mätning) ritas som brutna segment istället för
// att falskt binda ihop punkter över data som saknas.
export function LineChart({
  data,
  formatKind,
  emptyLabel = "Ingen data i perioden.",
}: {
  data: LineDatum[];
  formatKind: MetricFormatKind;
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const formatValue = (v: number) => formatMetricValue(formatKind, v);

  const values = data.map((d) => d.value).filter((v): v is number => v != null);
  if (values.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>;
  }

  const width = 800;
  const height = 200;
  const paddingLeft = 44;
  const paddingBottom = 24;
  const paddingTop = 16;
  const plotWidth = width - paddingLeft - 8;
  const plotHeight = height - paddingTop - paddingBottom;

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const niceMaxV = maxValue === minValue ? maxValue + 1 : maxValue;
  const niceMinV = maxValue === minValue ? Math.max(0, minValue - 1) : minValue;
  const range = niceMaxV - niceMinV || 1;

  const step = data.length > 1 ? plotWidth / (data.length - 1) : 0;

  const xFor = (i: number) => paddingLeft + i * step;
  const yFor = (v: number) => paddingTop + plotHeight - ((v - niceMinV) / range) * plotHeight;

  let pathD = "";
  let penDown = false;
  data.forEach((d, i) => {
    if (d.value == null) {
      penDown = false;
      return;
    }
    pathD += `${penDown ? "L" : "M"} ${xFor(i)} ${yFor(d.value)} `;
    penDown = true;
  });

  const gridTicks = 4;
  const labelStep = Math.max(1, Math.ceil(data.length / 8));
  const decimals = niceMaxV - niceMinV < 10 ? 1 : 0;

  return (
    <div className="flex flex-col gap-2">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label="Linjediagram"
        onPointerLeave={() => setHovered(null)}
      >
        {Array.from({ length: gridTicks + 1 }, (_, i) => {
          const v = niceMinV + (range / gridTicks) * i;
          const y = yFor(v);
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
                {v.toFixed(decimals)}
              </text>
            </g>
          );
        })}

        {hovered !== null && (
          <line
            x1={xFor(hovered)}
            x2={xFor(hovered)}
            y1={paddingTop}
            y2={paddingTop + plotHeight}
            className="stroke-zinc-300 dark:stroke-zinc-700"
            strokeWidth={1}
          />
        )}

        <path
          d={pathD}
          fill="none"
          style={{ stroke: "var(--cat-easy)" }}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {data.map((d, i) => {
          if (d.value == null) return null;
          const isHovered = hovered === i;
          return (
            <g key={i}>
              {/* Osynlig, större hit-yta för hover/tap. */}
              <circle
                cx={xFor(i)}
                cy={yFor(d.value)}
                r={12}
                fill="transparent"
                onPointerEnter={() => setHovered(i)}
                onPointerMove={() => setHovered(i)}
              />
              <circle
                cx={xFor(i)}
                cy={yFor(d.value)}
                r={isHovered ? 5 : 4}
                style={{ fill: "var(--cat-easy)" }}
                className="stroke-white dark:stroke-zinc-900"
                strokeWidth={2}
                pointerEvents="none"
              >
                <title>{`${d.label}: ${formatValue(d.value)}`}</title>
              </circle>
              {i % labelStep === 0 && (
                <text
                  x={xFor(i)}
                  y={height - 4}
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

      {hovered !== null && data[hovered].value != null && (
        <div className="text-sm text-zinc-700 dark:text-zinc-300">
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            {formatValue(data[hovered].value as number)}
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
                <td>{d.value != null ? formatValue(d.value) : "–"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
