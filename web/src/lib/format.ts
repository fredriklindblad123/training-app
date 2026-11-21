/** Klockslag för visning, alltid i svensk lokaltid — oavsett var Node-
 * processen kör. Serverkomponenter (t.ex. `settings/page.tsx`) körs på
 * Vercel i UTC, så ett `toLocaleString("sv-SE")` utan `timeZone` visar fel
 * klocka (2 timmar efter sommartid, 1 timme efter vintertid) trots att
 * datumet i databasen är rätt — `Intl` hanterar sommar-/vintertid åt oss så
 * länge zonen anges explicit. */
export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "–";
  return new Date(iso).toLocaleString("sv-SE", {
    timeZone: "Europe/Stockholm",
    dateStyle: "short",
    timeStyle: "short",
  });
}

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
  // Avrunda till hela sekunder först: 239,7 s gav annars "3:60".
  const total = Math.round(secondsPerKm);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, "0")} /km`;
}

/** Distans ur meter: "12,0 km" (B3 — decimalkomma, en decimal). Gav förr
 * "12.00 km", med punkt och två decimaler som ingen läste. */
export function formatKm(meters: number | null | undefined): string {
  if (meters == null) return "–";
  return `${(meters / 1000).toLocaleString("sv-SE", { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km`;
}

/** Sömnlängd o.dyl. — "8 h 48 min" läser sig bättre än "8:48:00". */
export function formatHoursMinutes(seconds: number | null | undefined): string {
  if (seconds == null) return "–";
  const total = Math.round(seconds / 60);
  // B3: minuter upp till 120 ("60 min", inte "1 h 0 min"), därefter h och min.
  if (total <= 120) return `${total} min`;
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h} h ${m} min`;
}

/* Enheter och tal (B3, 2026-11-21). En regel för hela appen:
 *   tid      minuter upp till 120, därefter "2 h 15 min" — aldrig "4:15:38"
 *   distans  decimalkomma, "42,4 km"
 *   datum    "20/11", med veckodag "fre 20/11"
 *   lopptid  "4:42,72"
 * Sidorna hade tre skrivsätt för tid och både punkt och komma i decimaler. */

/** Träningstid i minuter: "257 min", "2 h 15 min". */
export function formatMinutes(minutes: number | null | undefined): string {
  if (minutes == null || !Number.isFinite(minutes)) return "–";
  const m = Math.round(minutes);
  if (m <= 120) return `${m.toLocaleString("sv-SE")} min`;
  return `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** Tal med svenskt decimalkomma och fast antal decimaler. */
export function formatNumber(value: number | null | undefined, decimals = 0): string {
  if (value == null || !Number.isFinite(value)) return "–";
  return value.toLocaleString("sv-SE", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Kilometer med en decimal och decimalkomma: "42,4 km". */
export function formatKmSv(km: number | null | undefined, decimals = 1): string {
  if (km == null || !Number.isFinite(km)) return "–";
  return `${formatNumber(km, decimals)} km`;
}

const WEEKDAY_SHORT = ["sön", "mån", "tis", "ons", "tor", "fre", "lör"];

/** "20/11" ur "2026-11-20". Med `weekday` blir det "fre 20/11". */
export function formatDateShort(dateKey: string, weekday = false): string {
  const [y, m, d] = dateKey.slice(0, 10).split("-").map(Number);
  const base = `${d}/${m}`;
  if (!weekday) return base;
  return `${WEEKDAY_SHORT[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]} ${base}`;
}

/** Lopptid med decimalkomma: 282.72 → "4:42,72", 644 → "10:44". */
export function formatRaceSeconds(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds)) return "–";
  const hundredths = Math.round(seconds * 100);
  const whole = Math.floor(hundredths / 100);
  const frac = hundredths % 100;
  const m = Math.floor(whole / 60);
  const s = whole % 60;
  const base = m > 0 ? `${m}:${String(s).padStart(2, "0")}` : `${s}`;
  return frac > 0 ? `${base},${String(frac).padStart(2, "0")}` : base;
}

// Namngivna formatvarianter istället för att skicka formatterfunktioner som
// props till "use client"-komponenter — funktioner går inte att serialisera
// över server/klient-gränsen i Next.js, men en sträng gör.
export type MetricFormatKind =
  | "km"
  | "hours"
  | "bpm"
  | "ms"
  | "m_per_beat"
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
    // Meter per hjärtslag (formkurvan/Efficiency Factor). Enheten hör hemma i
    // formatteraren och inte i serie-etiketten: etiketten står i en legend
    // vars y-axel mäter SD, medan det här värdet bara dyker upp i tooltipen,
    // där det ÄR ett råvärde i m/slag.
    case "m_per_beat":
      return `${value.toFixed(2)} m/slag`;
    case "decimal2":
      return value.toFixed(2);
    case "decimal1":
      return value.toFixed(1);
    case "decimal0":
      return value.toFixed(0);
  }
}
