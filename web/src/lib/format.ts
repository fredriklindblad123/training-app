export function formatDuration(seconds: number | null | undefined): string {
  if (seconds == null) return "–";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0
    ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : `${m}:${String(s).padStart(2, "0")}`;
}

export function formatPace(secondsPerKm: number | null | undefined): string {
  if (secondsPerKm == null) return "–";
  const m = Math.floor(secondsPerKm / 60);
  const s = Math.round(secondsPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

export function formatKm(meters: number | null | undefined): string {
  if (meters == null) return "–";
  return `${(meters / 1000).toFixed(2)} km`;
}

/** Sömnlängd o.dyl. — "8 h 48 min" läser sig bättre än "8:48:00". */
export function formatHoursMinutes(seconds: number | null | undefined): string {
  if (seconds == null) return "–";
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

// Namngivna formatvarianter istället för att skicka formatterfunktioner som
// props till "use client"-komponenter — funktioner går inte att serialisera
// över server/klient-gränsen i Next.js, men en sträng gör.
export type MetricFormatKind =
  | "km"
  | "hours"
  | "bpm"
  | "ms"
  | "decimal2"
  | "decimal1"
  | "decimal0";

export function formatMetricValue(kind: MetricFormatKind, value: number): string {
  switch (kind) {
    case "km":
      return `${value.toFixed(1)} km`;
    case "hours":
      return formatHoursMinutes(value * 3600);
    case "bpm":
      return `${Math.round(value)} slag/min`;
    case "ms":
      return `${Math.round(value)} ms`;
    case "decimal2":
      return value.toFixed(2);
    case "decimal1":
      return value.toFixed(1);
    case "decimal0":
      return value.toFixed(0);
  }
}
