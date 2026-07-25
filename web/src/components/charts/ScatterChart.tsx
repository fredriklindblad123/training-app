"use client";

import { useState } from "react";
import { formatMetricValue, type MetricFormatKind } from "@/lib/format";

export type ScatterPoint = { x: number; y: number; label: string };

export function ScatterChart({
  data,
  xLabel,
  yLabel,
  xFormatKind,
  yFormatKind,
}: {
  data: ScatterPoint[];
  xLabel: string;
  yLabel: string;
  xFormatKind: MetricFormatKind;
  yFormatKind: MetricFormatKind;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const formatX = (v: number) => formatMetricValue(xFormatKind, v);
  const formatY = (v: number) => formatMetricValue(yFormatKind, v);

  if (data.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Inte tillräckligt med data ännu.
      </p>
    );
  }

  const width = 320;
  const height = 260;
  const paddingLeft = 44;
  const paddingBottom = 34;
  const paddingTop = 12;
  const paddingRight = 12;
  const plotWidth = width - paddingLeft - paddingRight;
  const plotHeight = height - paddingTop - paddingBottom;

  const xs = data.map((d) => d.x);
  const ys = data.map((d) => d.y);
  const xMin = Math.min(...xs);
  const xMax = Math.max(...xs);
  const yMin = Math.min(...ys);
  const yMax = Math.max(...ys);
  const xRange = xMax - xMin || 1;
  const yRange = yMax - yMin || 1;

  const xFor = (v: number) => paddingLeft + ((v - xMin) / xRange) * plotWidth;
  const yFor = (v: number) => paddingTop + plotHeight - ((v - yMin) / yRange) * plotHeight;

  return (
    <div className="flex flex-col gap-1">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={`${xLabel} mot ${yLabel}`}
        onPointerLeave={() => setHovered(null)}
      >
        <line
          x1={paddingLeft}
          x2={paddingLeft}
          y1={paddingTop}
          y2={paddingTop + plotHeight}
          className="stroke-zinc-300 dark:stroke-zinc-700"
          strokeWidth={1}
        />
        <line
          x1={paddingLeft}
          x2={width - paddingRight}
          y1={paddingTop + plotHeight}
          y2={paddingTop + plotHeight}
          className="stroke-zinc-300 dark:stroke-zinc-700"
          strokeWidth={1}
        />

        {data.map((d, i) => (
          <circle
            key={i}
            cx={xFor(d.x)}
            cy={yFor(d.y)}
            r={hovered === i ? 5 : 4}
            style={{ fill: "var(--cat-easy)", opacity: 0.7 }}
            onPointerEnter={() => setHovered(i)}
            onPointerMove={() => setHovered(i)}
          >
            <title>
              {d.label}: {formatX(d.x)}, {formatY(d.y)}
            </title>
          </circle>
        ))}

        <text
          x={paddingLeft + plotWidth / 2}
          y={height - 6}
          textAnchor="middle"
          className="fill-zinc-500 dark:fill-zinc-400"
          style={{ fontSize: 10 }}
        >
          {xLabel}
        </text>
        <text
          x={12}
          y={paddingTop + plotHeight / 2}
          textAnchor="middle"
          className="fill-zinc-500 dark:fill-zinc-400"
          style={{ fontSize: 10 }}
          transform={`rotate(-90, 12, ${paddingTop + plotHeight / 2})`}
        >
          {yLabel}
        </text>
      </svg>
      {hovered !== null && (
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          {data[hovered].label}: {formatX(data[hovered].x)} · {formatY(data[hovered].y)}
        </div>
      )}
    </div>
  );
}
