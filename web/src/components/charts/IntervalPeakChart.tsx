"use client";

import { useRef, useState } from "react";
import type { IntervalSessionPeak } from "@/lib/training-gears";

/* ------------------------------------------------------------------------ *
 * IntervalPeakChart — maxpulsen per intervallpass.
 *
 * Samma tal som intervallväxeln i växeldiagrammet, uppdelat per pass: varje
 * prick är medianen av passets repmaxpulser, strecket går från passets lägsta
 * till högsta rep. Medianlinjen är växeldiagrammets värde för hela perioden,
 * så att det syns att de två hör ihop.
 *
 * viewBox är smal (360) i stället för formkurvans 800: grafen läses mest på
 * telefon, och med en smal viewBox blir texten i SVG:n läsbar i 390 px utan
 * att skalas ner till 4 px.
 * ------------------------------------------------------------------------ */

const WIDTH = 360;
const HEIGHT = 200;
const PAD_TOP = 10;
const PAD_LEFT = 32;
const PAD_RIGHT = 8;
const X_AXIS_H = 18;
const PLOT_H = HEIGHT - PAD_TOP - X_AXIS_H;
const PLOT_W = WIDTH - PAD_LEFT - PAD_RIGHT;
const DAY_MS = 24 * 3600 * 1000;

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function dayMs(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

function shortDate(date: string): string {
  const [, m, d] = date.split("-");
  return `${Number(d)}/${Number(m)}`;
}

function monthTicks(fromMs: number, toMs: number): { ms: number; label: string }[] {
  const out: { ms: number; label: string }[] = [];
  const cursor = new Date(fromMs);
  cursor.setUTCDate(1);
  if (cursor.getTime() < fromMs) cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  while (cursor.getTime() <= toMs) {
    out.push({ ms: cursor.getTime(), label: MONTHS[cursor.getUTCMonth()] });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

export function IntervalPeakChart({
  peaks,
  lt2,
  periodMedian,
  fromDate,
  toDate,
  color,
}: {
  peaks: IntervalSessionPeak[];
  lt2: number | null;
  /** Intervallväxelns median i växeldiagrammet, om den finns. */
  periodMedian: number | null;
  fromDate: string;
  toDate: string;
  color: string;
}) {
  const [hovered, setHovered] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  if (peaks.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-3)]">
        Inga intervallpass med rep på minst 400 m och en minut i perioden.
      </p>
    );
  }

  const fromMs = dayMs(fromDate);
  const toMs = Math.max(dayMs(toDate), fromMs + DAY_MS);
  const xFor = (date: string) => PAD_LEFT + ((dayMs(date) - fromMs) / (toMs - fromMs)) * PLOT_W;

  const all = [
    ...peaks.flatMap((p) => [p.low, p.high]),
    ...(lt2 != null ? [lt2] : []),
    ...(periodMedian != null ? [periodMedian] : []),
  ];
  const yMin = Math.floor(Math.min(...all) - 3);
  const yMax = Math.ceil(Math.max(...all) + 3);
  const yFor = (hr: number) => PAD_TOP + PLOT_H - ((hr - yMin) / (yMax - yMin)) * PLOT_H;

  const step = yMax - yMin > 24 ? 10 : 5;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) yTicks.push(v);

  const hoveredPeak = peaks.find((p) => p.sessionId === hovered) ?? peaks[peaks.length - 1];

  /** Närmaste pass i x-led — en liten prick är svår att träffa med fingret. */
  const handlePointer = (event: React.PointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return;
    const rect = svg.getBoundingClientRect();
    if (rect.width === 0) return;
    const x = ((event.clientX - rect.left) / rect.width) * WIDTH;
    let best = peaks[0];
    for (const p of peaks) {
      if (Math.abs(xFor(p.date) - x) < Math.abs(xFor(best.date) - x)) best = p;
    }
    setHovered(best.sessionId);
  };

  return (
    <div className="flex flex-col gap-2">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        className="h-auto w-full max-w-2xl touch-pan-y"
        role="img"
        aria-label="Maxpuls per intervallpass"
        onPointerMove={handlePointer}
        onPointerDown={handlePointer}
      >
        {yTicks.map((v) => (
          <g key={v}>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(v)}
              y2={yFor(v)}
              stroke="var(--line)"
              strokeWidth={0.5}
            />
            <text
              x={PAD_LEFT - 4}
              y={yFor(v) + 3}
              textAnchor="end"
              className="tabular fill-[var(--ink-3)]"
              style={{ fontSize: 9 }}
            >
              {v}
            </text>
          </g>
        ))}

        {monthTicks(fromMs, toMs).map((t) => {
          const x = PAD_LEFT + ((t.ms - fromMs) / (toMs - fromMs)) * PLOT_W;
          return (
            <text
              key={t.ms}
              x={x}
              y={HEIGHT - 4}
              textAnchor="middle"
              className="fill-[var(--ink-3)]"
              style={{ fontSize: 9 }}
            >
              {t.label}
            </text>
          );
        })}

        {lt2 != null && (
          <g>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(lt2)}
              y2={yFor(lt2)}
              stroke="var(--ink-3)"
              strokeWidth={1}
              strokeDasharray="3 3"
            />
            <text
              x={WIDTH - PAD_RIGHT - 2}
              y={yFor(lt2) - 3}
              textAnchor="end"
              className="fill-[var(--ink-3)]"
              style={{ fontSize: 9 }}
            >
              LT2 {lt2}
            </text>
          </g>
        )}

        {periodMedian != null && (
          <g>
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yFor(periodMedian)}
              y2={yFor(periodMedian)}
              stroke={color}
              strokeWidth={1}
              opacity={0.5}
            />
            <text
              x={PAD_LEFT + 3}
              y={yFor(periodMedian) - 3}
              className="fill-[var(--ink-2)]"
              style={{ fontSize: 9 }}
            >
              median {periodMedian}
            </text>
          </g>
        )}

        {peaks.map((p) => {
          const x = xFor(p.date);
          const active = p.sessionId === hoveredPeak.sessionId;
          return (
            <g key={p.sessionId}>
              {p.high > p.low && (
                <line
                  x1={x}
                  x2={x}
                  y1={yFor(p.low)}
                  y2={yFor(p.high)}
                  stroke={color}
                  strokeWidth={active ? 2 : 1.5}
                  opacity={active ? 0.9 : 0.45}
                />
              )}
              <circle
                cx={x}
                cy={yFor(p.hr)}
                r={active ? 4.5 : 3.5}
                fill={color}
                stroke="var(--background)"
                strokeWidth={1}
              />
            </g>
          );
        })}
      </svg>

      <p className="text-sm text-[var(--ink-2)]">
        <span className="tabular">{shortDate(hoveredPeak.date)}</span>
        {hoveredPeak.name ? ` · ${hoveredPeak.name}` : ""} ·{" "}
        <span className="tabular font-medium text-[var(--foreground)]">{hoveredPeak.hr} slag/min</span>
        {hoveredPeak.reps > 1
          ? ` — median av ${hoveredPeak.reps} rep, ${hoveredPeak.low}–${hoveredPeak.high}`
          : " — ett rep"}
      </p>
    </div>
  );
}
