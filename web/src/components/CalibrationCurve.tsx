import { actualKmh, kmhToPace, type Calibration, type CalibrationPoint } from "@/lib/treadmill";

/* Kalibreringskurvan: hur mycket bandets visade fart skiljer sig från den
 * verkliga, över bandets farter (2026-11-28).
 *
 * Y-axeln är skillnaden i sekunder per km, inte verklig fart mot visad. Ett
 * band som går 3 % fel ligger annars som en linje nästan exakt på
 * diagonalen, och felet syns inte. Uppåt = bandet går långsammare än det
 * visar. Prickarna är de uppmätta farterna, linjen kalibreringen. */

const W = 340;
const H = 170;
const PAD = { l: 34, r: 10, t: 12, b: 28 };
const X_MIN = 10.5; // km/h, 5:43/km
const X_MAX = 20.5; // km/h, 2:56/km

function fmtPace(kmh: number): string {
  const s = Math.round(kmhToPace(kmh));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function CalibrationCurve({ calibration, points }: { calibration: Calibration; points: CalibrationPoint[] }) {
  const empty = { ...calibration, loadedFactor: null };
  const diff = (set: number, act: number) => kmhToPace(act) - kmhToPace(set);
  const curve: [number, number][] = [];
  for (let k = X_MIN; k <= X_MAX + 1e-9; k += 0.25) curve.push([k, diff(k, actualKmh(empty, k))]);
  const pts = points.map((p) => [p.setKmh, diff(p.setKmh, p.actualKmh)] as [number, number]);
  const ys = [...curve.map((c) => c[1]), ...pts.map((p) => p[1]), 0];
  let yMin = Math.floor(Math.min(...ys) - 1);
  let yMax = Math.ceil(Math.max(...ys) + 1);
  if (yMax - yMin < 6) {
    const mid = (yMax + yMin) / 2;
    yMin = Math.floor(mid - 3);
    yMax = Math.ceil(mid + 3);
  }
  const x = (k: number) => PAD.l + ((k - X_MIN) / (X_MAX - X_MIN)) * (W - PAD.l - PAD.r);
  const y = (d: number) => PAD.t + ((yMax - d) / (yMax - yMin)) * (H - PAD.t - PAD.b);
  // Högst sex rader: steget väljs efter hur stort spannet är.
  const step = [1, 2, 5, 10, 20, 50].find((st) => (yMax - yMin) / st <= 6) ?? 100;
  const yTicks: number[] = [];
  for (let v = Math.ceil(yMin / step) * step; v <= yMax; v += step) yTicks.push(v);
  const xTicks = [12, 13.33, 15, 17.14, 20]; // 5:00 4:30 4:00 3:30 3:00

  return (
    <figure className="flex flex-col gap-1">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full text-[var(--ink-3)]" role="img" aria-label="Skillnaden mellan bandets visade och verkliga fart, i sekunder per kilometer">
        {yTicks.map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeDasharray={v === 0 ? "4 3" : undefined} strokeWidth={v === 0 ? 1.2 : 1} />
            <text x={PAD.l - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill="currentColor">
              {v > 0 ? `+${v}` : v}
            </text>
          </g>
        ))}
        {xTicks.map((k) => (
          <text key={k} x={x(k)} y={H - 10} textAnchor="middle" fontSize={9} fill="currentColor">
            {fmtPace(k)}
          </text>
        ))}
        <text x={x(X_MIN) + 2} y={y(0) - 4} fontSize={9} fill="currentColor">
          rätt fart
        </text>
        <polyline
          points={curve.map(([k, d]) => `${x(k)},${y(d)}`).join(" ")}
          fill="none"
          stroke="var(--foreground)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
        {pts.map(([k, d], i) => (
          <circle key={i} cx={x(k)} cy={y(d)} r={4.5} fill="var(--foreground)" stroke="var(--surface)" strokeWidth={2} />
        ))}
      </svg>
      <figcaption className="text-xs text-[var(--ink-3)]">
        Bandets fart per km längs botten. Uppåt: så många sekunder per km långsammare går bandet än det visar. Prickarna
        är de uppmätta farterna.
      </figcaption>
    </figure>
  );
}
