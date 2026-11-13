"use client";

import { useRef, useState } from "react";

/* ------------------------------------------------------------------------ *
 * Diagrammen på /analys.
 *
 * Färgerna är neutrala med flit: kategorifärgerna (--cat-*) betyder redan
 * passtyper i appen, och "i år"/"förra året" eller "planerat"/"gjort" är inte
 * passtyper. Serierna skiljs i stället åt i ljushet OCH form — heldragen mot
 * streckad linje, fylld mot konturerad stapel — så identiteten aldrig hänger
 * på färg ensam. Ingen statusfärg: ett lägre värde än förra året är inget
 * larm (CLAUDE.md, Ton mot adepterna).
 *
 * viewBox är smal (360) så att texten i SVG:n är läsbar på 390 px.
 * ------------------------------------------------------------------------ */

const W = 360;
const H = 210;
// Nederkant: två rader med dagmarkeringar (i år, förra året) och veckoetiketten.
const PAD = { top: 10, right: 8, bottom: 38, left: 38 };
const PW = W - PAD.left - PAD.right;
const PH = H - PAD.top - PAD.bottom;

/** En markerad dag i blocket, t.ex. sjuk eller skadad enligt dagboken. */
export type DayMark = { label: string; color: string };

/** En rad markeringar, t.ex. årets sjuk- och skaddagar. `label` står till
 * vänster om raden ("i år", "förra året") så att det aldrig hänger på färg
 * vilket år en markering gäller. */
export type MarkRow = {
  label: string;
  marks: (DayMark | null)[];
  /** Konturerad i stället för fylld — samma formspråk som förra årets
   * staplar, så att året syns även utan att läsa etiketten. */
  outline?: boolean;
};

/** Smala remsor under x-axeln, en ruta per markerad dag och en rad per år.
 * Remsorna ligger under baslinjen och rör aldrig själva serierna. Rader utan
 * en enda markering ritas inte. */
function DayStrips({ rows, xOf, width }: { rows: MarkRow[]; xOf: (i: number) => number; width: number }) {
  const shown = rows.filter((r) => r.marks.some(Boolean));
  return (
    <g aria-hidden>
      {shown.map((r, ri) => {
        const y = PAD.top + PH + 7 + ri * 7;
        return (
          <g key={r.label}>
            <text x={PAD.left - 4} y={y + 4.5} textAnchor="end" className="tabular fill-[var(--ink-3)]" style={{ fontSize: 8 }}>
              {r.label}
            </text>
            {r.marks.map((m, i) =>
              m ? (
                <rect
                  key={i}
                  x={xOf(i) - width / 2 + (r.outline ? 0.5 : 0)}
                  y={y + (r.outline ? 0.5 : 0)}
                  width={Math.max(1.5, width - (r.outline ? 1 : 0))}
                  height={r.outline ? 4 : 5}
                  rx={0.75}
                  fill={r.outline ? "none" : m.color}
                  stroke={r.outline ? m.color : undefined}
                  strokeWidth={r.outline ? 1 : undefined}
                >
                  <title>{`${m.label}, ${r.label}`}</title>
                </rect>
              ) : null,
            )}
          </g>
        );
      })}
    </g>
  );
}

function markLegend(rows: MarkRow[] | undefined) {
  const seen = new Map<string, string>();
  for (const r of rows ?? []) for (const m of r.marks) if (m && !seen.has(m.label)) seen.set(m.label, m.color);
  return [...seen].map(([label, color]) => ({ label, color, kind: "fill" as const }));
}

export type LineSeries = {
  label: string;
  /** Ett värde per dag. Kortare än `days` = serien slutar där (t.ex. idag). */
  values: number[];
  color: string;
  dashed?: boolean;
};

function niceMax(v: number): number {
  if (v <= 0) return 1;
  const step = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= v) return m * step;
  return 10 * step;
}

function fmt(v: number): string {
  return Math.round(v).toLocaleString("sv-SE");
}

function Legend({ items }: { items: { label: string; color: string; kind: "line" | "dash" | "fill" | "outline" }[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-2)]">
      {items.map((it) => (
        <span key={it.label} className="flex items-center gap-1.5">
          {it.kind === "line" || it.kind === "dash" ? (
            <svg width="18" height="8" aria-hidden>
              <line
                x1="0"
                x2="18"
                y1="4"
                y2="4"
                stroke={it.color}
                strokeWidth="2"
                strokeDasharray={it.kind === "dash" ? "4 3" : undefined}
              />
            </svg>
          ) : (
            <span
              aria-hidden
              className="inline-block h-2.5 w-3 rounded-sm"
              style={
                it.kind === "fill"
                  ? { backgroundColor: it.color }
                  : { border: `1.5px solid ${it.color}` }
              }
            />
          )}
          {it.label}
        </span>
      ))}
    </div>
  );
}

export function CumulativeLineChart({
  series,
  days,
  dayLabels,
  unit,
  ariaLabel,
  defaultIndex,
  markRows,
}: {
  series: LineSeries[];
  /** Markeringsrader, en post per dag i blocket; null = ingen markering. */
  markRows?: MarkRow[];
  /** Dagen som visas innan man pekat, t.ex. idag. */
  defaultIndex?: number;
  days: number;
  /** En etikett per dag i blocket, t.ex. "Dag 47 · 13/11". Färdiga strängar,
   * inte en funktion — funktioner kan inte skickas till en klientkomponent. */
  dayLabels: string[];
  unit: string;
  ariaLabel: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement | null>(null);
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const x = (i: number) => PAD.left + (days <= 1 ? 0 : (i / (days - 1)) * PW);
  const y = (v: number) => PAD.top + PH - (v / max) * PH;
  const ticks = [0, max / 2, max];
  const weekTicks = Array.from({ length: Math.ceil(days / 7) }, (_, w) => w * 7).filter((d) => d < days);
  const hi = hover ?? defaultIndex ?? Math.max(...series.map((s) => s.values.length)) - 1;

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(days - 1, Math.round(((px - PAD.left) / PW) * (days - 1)))));
  };

  return (
    <div className="flex flex-col gap-2">
      <Legend
        items={[
          ...series.map((s) => ({ label: s.label, color: s.color, kind: s.dashed ? ("dash" as const) : ("line" as const) })),
          ...markLegend(markRows),
        ]}
      />
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-2xl touch-pan-y"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={0.5} />
            <text x={PAD.left - 4} y={y(t) + 3} textAnchor="end" className="tabular fill-[var(--ink-3)]" style={{ fontSize: 9 }}>
              {fmt(t)}
            </text>
          </g>
        ))}
        {weekTicks.map((d, w) => (
          <text key={d} x={x(d)} y={H - 4} textAnchor="middle" className="fill-[var(--ink-3)]" style={{ fontSize: 9 }}>
            v{w + 1}
          </text>
        ))}
        {markRows && <DayStrips rows={markRows} xOf={x} width={days <= 1 ? 3 : PW / (days - 1)} />}
        {series.map((s) =>
          s.values.length > 1 ? (
            <path
              key={s.label}
              d={s.values.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ")}
              fill="none"
              stroke={s.color}
              strokeWidth={2}
              strokeDasharray={s.dashed ? "5 4" : undefined}
              strokeLinejoin="round"
            />
          ) : null,
        )}
        {hi >= 0 && (
          <line x1={x(hi)} x2={x(hi)} y1={PAD.top} y2={PAD.top + PH} stroke="var(--ink-3)" strokeWidth={0.75} />
        )}
        {series.map((s) =>
          hi < s.values.length ? (
            <circle
              key={s.label}
              cx={x(hi)}
              cy={y(s.values[hi])}
              r={4}
              fill={s.dashed ? "var(--background)" : s.color}
              stroke={s.color}
              strokeWidth={2}
            />
          ) : null,
        )}
      </svg>
      <p className="text-sm text-[var(--ink-2)]">
        <span className="tabular">{dayLabels[hi]}</span>
        {series.map((s) =>
          hi < s.values.length ? (
            <span key={s.label}>
              {" · "}
              {s.label}{" "}
              <span className="tabular font-medium text-[var(--foreground)]">
                {fmt(s.values[hi])} {unit}
              </span>
            </span>
          ) : null,
        )}
      </p>
    </div>
  );
}

export type BarSeries = {
  label: string;
  /** Ett värde per grupp; null = inget att visa (t.ex. en vecka som inte börjat). */
  values: (number | null)[];
  color: string;
  style: "fill" | "outline";
};

export function GroupedBarChart({
  groups,
  series,
  unit,
  ariaLabel,
  groupLabels,
  defaultIndex,
  markRows,
}: {
  /** Markeringsrader med en post per DAG (7 per grupp), ritas som remsor
   * under veckans staplar. */
  markRows?: MarkRow[];
  /** Gruppen som visas innan man pekat, t.ex. innevarande vecka. */
  defaultIndex?: number;
  groups: string[];
  series: BarSeries[];
  unit: string;
  ariaLabel: string;
  /** Lång etikett per grupp, t.ex. "v3 · 12/10–18/10". */
  groupLabels: string[];
}) {
  const [hover, setHover] = useState<number | null>(null);
  const ref = useRef<SVGSVGElement | null>(null);
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.map((v) => v ?? 0))));
  const gw = PW / groups.length;
  // Drygt 40 % av gruppbredden är luft, så att veckorna skiljs åt tydligt.
  const inner = Math.min(gw * 0.58, 30);
  const bw = Math.max(3, (inner - 2 * (series.length - 1)) / series.length);
  const y = (v: number) => PAD.top + PH - (v / max) * PH;
  const lastWithData = groups.reduce((last, _, i) => (series.some((s) => s.values[i] != null) ? i : last), 0);
  const hi = hover ?? defaultIndex ?? lastWithData;

  const onPointer = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = ref.current?.getBoundingClientRect();
    if (!r || r.width === 0) return;
    const px = ((e.clientX - r.left) / r.width) * W;
    setHover(Math.max(0, Math.min(groups.length - 1, Math.floor((px - PAD.left) / gw))));
  };

  return (
    <div className="flex flex-col gap-2">
      <Legend items={[...series.map((s) => ({ label: s.label, color: s.color, kind: s.style })), ...markLegend(markRows)]} />
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full max-w-2xl touch-pan-y"
        role="img"
        aria-label={ariaLabel}
        onPointerMove={onPointer}
        onPointerDown={onPointer}
        onPointerLeave={() => setHover(null)}
      >
        {[0, max / 2, max].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={0.5} />
            <text x={PAD.left - 4} y={y(t) + 3} textAnchor="end" className="tabular fill-[var(--ink-3)]" style={{ fontSize: 9 }}>
              {fmt(t)}
            </text>
          </g>
        ))}
        {markRows && (
          <DayStrips rows={markRows} xOf={(d) => PAD.left + (d + 0.5) * (gw / 7)} width={gw / 7 - 1} />
        )}
        {groups.map((g, i) => {
          const gx = PAD.left + i * gw + (gw - inner) / 2;
          return (
            <g key={g} opacity={hover == null || hover === i ? 1 : 0.55}>
              {series.map((s, si) => {
                const v = s.values[i];
                if (v == null) return null;
                const h = Math.max(v > 0 ? 1.5 : 0, PAD.top + PH - y(v));
                const bx = gx + si * (bw + 2);
                return s.style === "fill" ? (
                  <rect key={s.label} x={bx} y={PAD.top + PH - h} width={bw} height={h} rx={1.5} fill={s.color} />
                ) : (
                  <rect
                    key={s.label}
                    x={bx + 0.75}
                    y={PAD.top + PH - h + 0.75}
                    width={Math.max(1, bw - 1.5)}
                    height={Math.max(0, h - 0.75)}
                    rx={1.5}
                    fill="none"
                    stroke={s.color}
                    strokeWidth={1.5}
                  />
                );
              })}
              <text
                x={PAD.left + i * gw + gw / 2}
                y={H - 4}
                textAnchor="middle"
                className="fill-[var(--ink-3)]"
                style={{ fontSize: 9 }}
              >
                {g}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="text-sm text-[var(--ink-2)]">
        <span className="tabular">{groupLabels[hi]}</span>
        {series.map((s) => (
          <span key={s.label}>
            {" · "}
            {s.label}{" "}
            <span className="tabular font-medium text-[var(--foreground)]">
              {s.values[hi] == null ? "–" : `${fmt(s.values[hi] as number)} ${unit}`}
            </span>
          </span>
        ))}
      </p>
    </div>
  );
}
