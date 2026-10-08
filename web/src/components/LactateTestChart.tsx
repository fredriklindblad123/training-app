"use client";

import { useEffect, useRef, useState } from "react";
import { GEAR_COLOR_VAR } from "@/lib/training-gears";
import { mmss, paceFromKmh, type LabZoneSet, type LactateTestStep } from "@/lib/zone-sources";

/* ------------------------------------------------------------------------ *
 * LactateTestChart — ett uppmätt stegtest, ritat som i testrapporten.
 *
 * Till skillnad från LactateCurve (schematisk, ritad genom trösklarna) är
 * det här mätvärden: puls, fart, laktat och Borg per steg, med testets tre
 * intensitetszoner bakom pulskurvan.
 *
 * ── Fyra serier i samma yta ─────────────────────────────────────────────
 * Resten av appen undviker dubbla axlar (se ComboChart). Här är det ett
 * uttryckligt val (2026-09-29): diagrammet ska se ut som Aktivitus rapport,
 * som löparen och tränaren redan känner igen. Det som gör det läsbart
 * trots det, samma lösning som rapporten:
 *
 *   - Puls har vänsteraxeln och zonerna, fart högeraxeln.
 *   - Laktat och Borg har ingen utskriven axel. Varje punkt bär i stället
 *     sitt tal, så inget värde behöver avläsas mot en skala.
 *   - Varje serie har en egen form (cirkel, romb, trappa, kvadrat), så
 *     identiteten aldrig hänger på färgen ensam.
 *   - Hovring visar stegets alla fyra värden, och tabellen under har dem
 *     utan någon skala alls.
 *
 * ── Ritningen ────────────────────────────────────────────────────────────
 * Svg:n ritas i verkliga pixlar efter behållarens bredd (ResizeObserver),
 * inte i en skalad viewBox — med en viewBox krymper texten till oläslighet
 * på 390 px.
 * ------------------------------------------------------------------------ */

const H = 300;
const M = { top: 14, right: 36, bottom: 26, left: 36 };

const fmt1 = (v: number) => v.toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 });

export function LactateTestChart({
  set,
  steps,
}: {
  set: LabZoneSet;
  steps: LactateTestStep[];
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  /* Börjar på 0, inte på en gissad bredd. En fast startbredd (tidigare 640)
   * tryckte ut flexbehållaren på mobil, så ResizeObserver mätte den utökade
   * bredden och svg:n fastnade på 681 px på en 390 px-skärm. Höjden hålls
   * ändå (minHeight nedan), så sidan hoppar inte när diagrammet ritas. */
  const [width, setWidth] = useState(0);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const narrow = width < 480;
  const pw = Math.max(width - M.left - M.right, 100);
  const ph = H - M.top - M.bottom;

  const tMax = Math.max(...steps.map((s) => s.offsetSeconds));
  const x = (t: number) => M.left + (t / tMax) * pw;

  const hrs = steps.flatMap((s) => (s.heartRate != null ? [s.heartRate] : []));
  const hrTop = Math.ceil(Math.max(set.maxHr ?? 0, ...hrs) / 25) * 25 + 5;
  const hrBottom = Math.max(Math.floor((Math.min(...hrs) - 40) / 25) * 25, 0);
  const yHr = (v: number) => M.top + ph - ((v - hrBottom) / (hrTop - hrBottom)) * ph;

  const speeds = steps.flatMap((s) => (s.speedKmh != null ? [s.speedKmh] : []));
  const spBottom = Math.floor(Math.min(...speeds)) - 4;
  const spTop = Math.ceil(Math.max(...speeds)) + 4;
  const ySp = (v: number) => M.top + ph - ((v - spBottom) / (spTop - spBottom)) * ph;

  /* Laktat och Borg utan utskriven axel, i var sitt eget höjdband så att
     de fyra serierna inte slutar i samma punkt: i slutet av ett stegtest är
     allt högt samtidigt, och i rapporten ligger 202, 18 och 11,7 ovanpå
     varandra. Laktat från noll, lyft från x-axeln och med toppen strax under mitten, Borg 6–20 i
     bandet ovanför. Skalorna är fria att välja just för att talet står
     vid varje punkt. */
  const lacs = steps.flatMap((s) => (s.lactateMmol != null ? [s.lactateMmol] : []));
  const lacMax = Math.max(...lacs);
  const yLac = (v: number) => M.top + ph - (0.08 + (v / lacMax) * 0.38) * ph;
  const yRpe = (v: number) => M.top + ph - (0.12 + ((v - 6) / 14) * 0.5) * ph;

  const lt1 = set.lt1Hr ?? set.z3Low;
  const lt2 = set.lt2Hr ?? set.z4Low;
  const zones = [
    { key: "distans" as const, label: "Låg", low: set.z2Low, high: lt1 },
    { key: "troskel" as const, label: "Medel", low: lt1, high: lt2 },
    { key: "intervall" as const, label: "Hög", low: lt2, high: set.maxHr ?? lt2 + 10 },
  ];

  const measured = steps.filter((s) => s.speedKmh != null);
  const stepLen = measured.length > 1 ? measured[1].offsetSeconds - measured[0].offsetSeconds : 240;

  // Trappan: varje steg ritas från sin start till sticket i slutet.
  const stairs = measured
    .map((s, i) => {
      const x0 = x(s.offsetSeconds - stepLen);
      const x1 = x(s.offsetSeconds);
      const y = ySp(s.speedKmh as number);
      return `${i === 0 ? "M" : "L"}${x0.toFixed(1)} ${y.toFixed(1)} L${x1.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const hrTicks: number[] = [];
  for (let v = hrBottom; v <= hrTop - 5; v += 25) hrTicks.push(v);
  const spTicks: number[] = [];
  for (let v = spBottom; v <= spTop; v += narrow ? 4 : 2) spTicks.push(v);
  const tTicks = steps.map((s) => s.offsetSeconds).filter((_, i) => !narrow || i % 2 === 0);

  const hovered = hover == null ? null : steps[hover];
  const labelSize = narrow ? 10 : 11;

  const onMove = (e: React.PointerEvent<SVGRectElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const t = ((e.clientX - rect.left) / rect.width) * tMax;
    let best = 0;
    for (let i = 1; i < steps.length; i++) {
      if (Math.abs(steps[i].offsetSeconds - t) < Math.abs(steps[best].offsetSeconds - t)) best = i;
    }
    setHover(best);
  };

  const legend = [
    { key: "hr", label: "Puls (slag/min)", color: "var(--lt-hr)", shape: "circle" },
    { key: "speed", label: "Fart (km/h)", color: "var(--lt-speed)", shape: "stair" },
    { key: "lactate", label: "Laktat (mmol/l)", color: "var(--lt-lactate)", shape: "diamond" },
    { key: "rpe", label: "Upplevd ansträngning (Borg)", color: "var(--lt-rpe)", shape: "square" },
  ];

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-2)]">
        {legend.map((l) => (
          <li key={l.key} className="flex items-center gap-1.5">
            <svg width="16" height="10" aria-hidden>
              {l.shape === "stair" ? (
                <path d="M0 8 H6 V2 H16" fill="none" stroke={l.color} strokeWidth="2.5" />
              ) : (
                <>
                  <line x1="0" x2="16" y1="5" y2="5" stroke={l.color} strokeWidth="1.5" strokeDasharray="2 2" />
                  <Marker shape={l.shape} cx={8} cy={5} color={l.color} />
                </>
              )}
            </svg>
            {l.label}
          </li>
        ))}
      </ul>

      <div ref={wrapRef} className="relative w-full min-w-0" style={{ minHeight: H }}>
        {width > 0 && (
        <svg
          width={width}
          height={H}
          className="block"
          role="img"
          aria-label={`Laktattest: puls, fart, laktat och Borg per steg. Laktatet går från ${fmt1(lacs[0])} till ${fmt1(lacs[lacs.length - 1])} mmol/l, pulsen från ${hrs[0]} till ${hrs[hrs.length - 1]}. Aerob tröskel ${lt1}, anaerob ${lt2}.`}
        >
          {/* Zonerna bakom pulskurvan, samma färger som växlarna. */}
          {zones.map((z) => (
            <g key={z.key}>
              <rect
                x={M.left}
                width={pw}
                y={yHr(z.high)}
                height={Math.max(yHr(z.low) - yHr(z.high), 0)}
                fill={`color-mix(in oklab, ${GEAR_COLOR_VAR[z.key]} 18%, transparent)`}
              />
              <text
                x={M.left + 4}
                y={(yHr(z.high) + yHr(z.low)) / 2}
                dominantBaseline="middle"
                fontSize={10}
                fill="var(--ink-3)"
              >
                {z.label} {z.low}–{z.high}
              </text>
            </g>
          ))}

          {/* Rutnät och axlar */}
          {hrTicks.map((v) => (
            <g key={v}>
              <line x1={M.left} x2={M.left + pw} y1={yHr(v)} y2={yHr(v)} stroke="var(--line)" strokeWidth={1} />
              <text x={M.left - 6} y={yHr(v)} textAnchor="end" dominantBaseline="middle" fontSize={10} fill="var(--ink-3)" className="tabular">
                {v}
              </text>
            </g>
          ))}
          {spTicks.map((v) => (
            <text key={v} x={M.left + pw + 6} y={ySp(v)} dominantBaseline="middle" fontSize={10} fill="var(--ink-3)" className="tabular">
              {v}
            </text>
          ))}
          {tTicks.map((t) => (
            <text key={t} x={x(t)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--ink-3)" className="tabular">
              {mmss(t)}
            </text>
          ))}
          <text x={4} y={M.top - 4} fontSize={10} fill="var(--ink-3)">
            puls
          </text>
          <text x={width - 4} y={M.top - 4} textAnchor="end" fontSize={10} fill="var(--ink-3)">
            km/h
          </text>

          {hovered && (
            <line
              x1={x(hovered.offsetSeconds)}
              x2={x(hovered.offsetSeconds)}
              y1={M.top}
              y2={M.top + ph}
              stroke="var(--ink-3)"
              strokeWidth={1}
            />
          )}

          {/* Fart: trappa med talet ovanför varje steg. */}
          <path d={stairs} fill="none" stroke="var(--lt-speed)" strokeWidth={2.5} strokeLinejoin="round" />
          {measured.map((s) => (
            <text
              key={s.offsetSeconds}
              x={x(s.offsetSeconds - stepLen / 2)}
              y={ySp(s.speedKmh as number) - 5}
              textAnchor="middle"
              fontSize={labelSize}
              fill="var(--ink-2)"
              className="tabular"
            >
              {narrow ? s.speedKmh : fmt1(s.speedKmh as number)}
            </text>
          ))}

          <Series steps={steps} pick={(s) => s.rpe} y={yRpe} x={x} color="var(--lt-rpe)" shape="square" labelSize={labelSize} dy={17} format={(v) => String(v)} />
          <Series steps={steps} pick={(s) => s.lactateMmol} y={yLac} x={x} color="var(--lt-lactate)" shape="diamond" labelSize={labelSize} dy={14} format={fmt1} />
          <Series steps={steps} pick={(s) => s.heartRate} y={yHr} x={x} color="var(--lt-hr)" shape="circle" labelSize={labelSize} dy={-8} format={(v) => String(v)} />

          <rect
            x={M.left}
            y={M.top}
            width={pw}
            height={ph}
            fill="transparent"
            onPointerMove={onMove}
            onPointerDown={onMove}
            onPointerLeave={() => setHover(null)}
          />
        </svg>
        )}

        {hovered && (
          <div
            className="pointer-events-none absolute top-2 z-10 rounded-md border border-[var(--line)] bg-[var(--surface)] px-3 py-2 text-xs shadow-sm"
            style={
              x(hovered.offsetSeconds) > width / 2
                ? { right: width - x(hovered.offsetSeconds) + 8 }
                : { left: x(hovered.offsetSeconds) + 8 }
            }
          >
            <p className="font-medium text-[var(--foreground)]">
              {hovered.speedKmh != null
                ? `${fmt1(hovered.speedKmh)} km/h · ${paceFromKmh(hovered.speedKmh)}`
                : "Vilovärde före start"}
            </p>
            <p className="tabular text-[var(--ink-3)]">efter {mmss(hovered.offsetSeconds)}</p>
            <dl className="mt-1 grid grid-cols-[auto_auto] gap-x-3 tabular text-[var(--ink-2)]">
              {hovered.heartRate != null && (<><dt>Puls</dt><dd>{hovered.heartRate}</dd></>)}
              {hovered.lactateMmol != null && (<><dt>Laktat</dt><dd>{fmt1(hovered.lactateMmol)} mmol/l</dd></>)}
              {hovered.rpe != null && (<><dt>Borg</dt><dd>{hovered.rpe}</dd></>)}
            </dl>
          </div>
        )}
      </div>

      <details className="rounded-lg border border-[var(--line)] p-3 text-sm">
        <summary className="cursor-pointer text-[var(--ink-2)]">Visa som tabell</summary>
        <div className="mt-2 overflow-x-auto">
          <table className="tabular w-full text-left text-sm">
            <thead className="text-xs text-[var(--ink-3)]">
              <tr>
                <th className="py-1 pr-3 font-normal">Tid</th>
                <th className="py-1 pr-3 font-normal">Fart</th>
                <th className="py-1 pr-3 font-normal">Tempo</th>
                <th className="py-1 pr-3 font-normal">Puls</th>
                <th className="py-1 pr-3 font-normal">Laktat</th>
                <th className="py-1 font-normal">Borg</th>
              </tr>
            </thead>
            <tbody className="text-[var(--ink-2)]">
              {steps.map((s) => (
                <tr key={s.offsetSeconds} className="border-t border-[var(--line)]">
                  <td className="py-1 pr-3">{mmss(s.offsetSeconds)}</td>
                  <td className="py-1 pr-3">{s.speedKmh != null ? fmt1(s.speedKmh) : "vila"}</td>
                  <td className="py-1 pr-3">{s.speedKmh != null ? paceFromKmh(s.speedKmh) : "–"}</td>
                  <td className="py-1 pr-3">{s.heartRate ?? "–"}</td>
                  <td className="py-1 pr-3">{s.lactateMmol != null ? fmt1(s.lactateMmol) : "–"}</td>
                  <td className="py-1">{s.rpe ?? "–"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Marker({ shape, cx, cy, color }: { shape: string; cx: number; cy: number; color: string }) {
  const ring = { stroke: "var(--surface)", strokeWidth: 1.5 };
  if (shape === "diamond") {
    return <path d={`M${cx} ${cy - 5} L${cx + 5} ${cy} L${cx} ${cy + 5} L${cx - 5} ${cy} Z`} fill={color} {...ring} />;
  }
  if (shape === "square") {
    return <rect x={cx - 4} y={cy - 4} width={8} height={8} fill={color} {...ring} />;
  }
  return <circle cx={cx} cy={cy} r={4.5} fill={color} {...ring} />;
}

function Series({
  steps,
  pick,
  x,
  y,
  color,
  shape,
  labelSize,
  dy,
  format,
}: {
  steps: LactateTestStep[];
  pick: (s: LactateTestStep) => number | null;
  x: (t: number) => number;
  y: (v: number) => number;
  color: string;
  shape: string;
  labelSize: number;
  dy: number;
  format: (v: number) => string;
}) {
  const pts = steps.flatMap((s) => {
    const v = pick(s);
    return v == null ? [] : [{ t: s.offsetSeconds, v, px: x(s.offsetSeconds), py: y(v) }];
  });
  const d = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p.px.toFixed(1)} ${p.py.toFixed(1)}`).join(" ");
  return (
    <g>
      <path d={d} fill="none" stroke={color} strokeWidth={2} strokeDasharray="3 4" strokeLinecap="round" />
      {pts.map((p) => (
        <g key={p.t}>
          <Marker shape={shape} cx={p.px} cy={p.py} color={color} />
          <text
            x={p.px}
            y={p.py + dy}
            textAnchor="middle"
            fontSize={labelSize}
            fontWeight={500}
            fill="var(--foreground)"
            className="tabular"
            paintOrder="stroke"
            stroke="var(--surface)"
            strokeWidth={3}
          >
            {format(p.v)}
          </text>
        </g>
      ))}
    </g>
  );
}
