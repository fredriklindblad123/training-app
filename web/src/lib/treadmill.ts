/* Löpbandets verkliga fart (2026-11-28).
 *
 * Ett löpband visar en fart som sällan stämmer: rullens diameter, slitet
 * band och en motor som tappar under belastning ger ofta några procent fel,
 * och vid tröskelfart är 3 % runt 7 s/km — lika mycket som skillnaden
 * mellan två tröskelpass. Appen mäter därför bandet: ett kritstreck på
 * bandet, bandets längd mätt med måttband, och tiden för ett antal varv vid
 * några inställda farter. Verklig fart = bandets längd / tid per varv.
 *
 * Det här är bara räkningen. Mätningen (kamera eller knackning) ger en lista
 * med tidpunkter då strecket passerade; resten sker här, så att samma regler
 * gäller oavsett hur tidpunkterna togs fram.
 *
 * FALLGROPAR
 * - Bandets längd avgör noggrannheten. 1 cm fel på 3 m är 0,33 %, cirka
 *   1 s/km vid 4:00. Knackningens ojämnhet jämnas ut av antalet varv.
 * - Ett missat varv eller en dubbelknack får inte ändra resultatet. Varje
 *   tidsavstånd avrundas därför till ett helt antal varv mot medianen, och
 *   varvtiden är lutningen i en regression av tid mot varvnummer.
 * - Bandet tappar fart under en löpare. En mätning på tomt band säger inget
 *   om det; kontrollmätningen med löpare ger en faktor som läggs på linjen.
 * - Linjen räknas i km/h, inte i min/km. Felet är en procent av farten
 *   (plus en liten förskjutning), och det är linjärt i fart, inte i tempo. */

export type Revolutions = {
  /** Antal hela varv mellan första och sista passagen. */
  revs: number;
  /** Tid från första till sista passagen, sekunder. */
  seconds: number;
  /** Tid per varv ur regressionen, sekunder. */
  period: number;
  /** Tidsavstånd som tolkats som missade varv (två eller fler varv). */
  missed: number;
  /** Passager som låg för tätt och slogs ihop (dubbelknack, dubbelträff). */
  doubles: number;
  /** Spridning kring regressionen, i procent av varvtiden. */
  jitterPct: number;
};

/** Varvtid ur tidpunkterna (sekunder) då strecket passerade.
 * null när underlaget inte räcker: färre än 6 passager, eller så ojämnt att
 * det inte går att avgöra vad som är ett varv. */
export function revolutionsFrom(times: number[]): Revolutions | null {
  const t = [...times].sort((a, b) => a - b);
  if (t.length < 6) return null;
  const gaps = t.slice(1).map((x, i) => x - t[i]);
  const m = median(gaps);
  if (!(m > 0)) return null;

  // Ett tidsavstånd under 40 % av medianen är samma passage två gånger.
  const kept = [t[0]];
  let doubles = 0;
  for (let i = 1; i < t.length; i++) {
    if (t[i] - kept[kept.length - 1] < 0.4 * m) doubles++;
    else kept.push(t[i]);
  }
  if (kept.length < 6) return null;

  const period0 = median(kept.slice(1).map((x, i) => x - kept[i]));
  const n: number[] = [0];
  let missed = 0;
  for (let i = 1; i < kept.length; i++) {
    const k = Math.max(1, Math.round((kept[i] - kept[i - 1]) / period0));
    if (k > 1) missed++;
    n.push(n[i - 1] + k);
  }
  const { slope, residualSd } = linearFit(n, kept);
  if (!(slope > 0)) return null;
  const jitterPct = (residualSd / slope) * 100;
  // Mer än en fjärdedels varv i spridning: avrundningen till hela varv går
  // inte att lita på.
  if (residualSd > 0.25 * slope) return null;
  return {
    revs: n[n.length - 1],
    seconds: kept[kept.length - 1] - kept[0],
    period: slope,
    missed,
    doubles,
    jitterPct,
  };
}

/** Minsta antal farter för en kalibrering. Med två går det alltid att dra en
 * linje, men inte att se om den stämmer; med tre syns en felmätning. */
export const MIN_SPEEDS = 3;

/** Största rimliga fel på ett band. Ett band som går mer än 15 % fel är
 * nästan alltid en felmätning: fel längd, fel fart inskriven, eller ett
 * streck som räknats två gånger per varv. */
export const MAX_BELT_ERROR = 0.15;

/** Varför en uppmätt fart inte är rimlig, i klartext. null = den är det. */
export function pointProblem(setKmh: number, actualKmh: number): string | null {
  const err = actualKmh / setKmh - 1;
  if (Math.abs(err) <= MAX_BELT_ERROR) return null;
  return `Uppmätt ${(Math.abs(err) * 100).toFixed(0)} % ${err < 0 ? "långsammare" : "fortare"} än inställt. Kontrollera bandets längd och att bandet står på farten du skrev in.`;
}

/** Om linjen är rimlig: lutningen nära 1 och ingen fart mellan 5:30 och
 * 3:00/km som hamnar mer än 15 % fel. null = den är det. */
export function calibrationProblem(c: { slope: number; intercept: number }): string | null {
  for (const k of [10.9, 15, 20]) {
    if (Math.abs((c.slope * k + c.intercept) / k - 1) > MAX_BELT_ERROR) {
      return "Farterna passar inte på en linje. Någon av dem är troligen felmätt eller har fel inställd fart.";
    }
  }
  return null;
}

/** Varför en mätning inte gick att räkna, i klartext. null = den gick. */
export function revolutionsProblem(times: number[]): string | null {
  if (times.length < 6) {
    return times.length === 0
      ? "Inga passager registrerades."
      : `Bara ${times.length} passager registrerades. Det behövs fler för att räkna varvtiden.`;
  }
  if (!revolutionsFrom(times)) return "Passagerna kom för ojämnt för att avgöra vad som är ett varv.";
  return null;
}

export type CalibrationPoint = {
  /** Farten bandet var inställt på, km/h. */
  setKmh: number;
  /** Uppmätt fart, km/h. */
  actualKmh: number;
  revs: number;
  seconds: number;
  method: "kamera" | "knack";
};

export type Calibration = {
  /** Verklig fart (tomt band) = slope · inställd + intercept, km/h. */
  slope: number;
  intercept: number;
  /** Verklig fart med löpare / verklig fart på tomt band. null = ej mätt. */
  loadedFactor: number | null;
};

/** Fart i km/h ur bandets längd och varvtid. */
export function kmhFrom(beltLengthCm: number, period: number): number {
  return (beltLengthCm / 100 / period) * 3.6;
}

/** Linjen genom mätpunkterna. Med en punkt: bara en procentsats (ingen
 * förskjutning), eftersom en linje inte går att lägga genom en punkt. */
export function fitCalibration(points: { setKmh: number; actualKmh: number }[]): {
  slope: number;
  intercept: number;
  /** Största avvikelse från linjen, km/h. null med färre än tre punkter. */
  maxResidualKmh: number | null;
} | null {
  if (points.length === 0) return null;
  if (points.length === 1 || new Set(points.map((p) => p.setKmh.toFixed(2))).size === 1) {
    const ratio = median(points.map((p) => p.actualKmh / p.setKmh));
    return { slope: ratio, intercept: 0, maxResidualKmh: null };
  }
  const { slope, intercept } = linearFit(
    points.map((p) => p.setKmh),
    points.map((p) => p.actualKmh),
  );
  const maxResidualKmh =
    points.length >= 3
      ? Math.max(...points.map((p) => Math.abs(slope * p.setKmh + intercept - p.actualKmh)))
      : null;
  return { slope, intercept, maxResidualKmh };
}

/** Verklig fart när bandet står på `setKmh`. */
export function actualKmh(c: Calibration, setKmh: number): number {
  return (c.slope * setKmh + c.intercept) * (c.loadedFactor ?? 1);
}

/** Vad bandet ska ställas på för att ge `wantedKmh` i verklig fart. */
export function setKmhFor(c: Calibration, wantedKmh: number): number {
  return (wantedKmh / (c.loadedFactor ?? 1) - c.intercept) / c.slope;
}

export const kmhToPace = (kmh: number) => 3600 / kmh;
export const paceToKmh = (secondsPerKm: number) => 3600 / secondsPerKm;

/** Bandets visade fart ur fritext: "4:00", "4.00" eller "4,00" är min/km,
 * "15", "15,5" eller "15.5 km/h" är km/h. null för allt annat. */
export function parseBeltSpeed(input: string): { kmh: number; unit: "pace" | "kmh" } | null {
  const s = input.trim().toLowerCase().replace(/\s*(km\/h|kmh|\/km|min\/km)$/, "");
  const pace = s.match(/^(\d{1,2})[:.,](\d{2})$/);
  if (pace && !/km\/h|kmh/.test(input.toLowerCase())) {
    const sec = Number(pace[1]) * 60 + Number(pace[2]);
    if (sec >= 150 && sec <= 900) return { kmh: paceToKmh(sec), unit: "pace" };
  }
  const num = s.match(/^(\d{1,2})(?:[.,](\d{1,2}))?$/);
  if (num) {
    const kmh = Number(`${num[1]}.${num[2] ?? "0"}`);
    if (kmh >= 4 && kmh <= 30) return { kmh, unit: "kmh" };
  }
  return null;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

function linearFit(x: number[], y: number[]): { slope: number; intercept: number; residualSd: number } {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) ** 2;
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  const intercept = my - slope * mx;
  const ss = y.reduce((a, yi, i) => a + (yi - (slope * x[i] + intercept)) ** 2, 0);
  return { slope, intercept, residualSd: n > 2 ? Math.sqrt(ss / (n - 2)) : 0 };
}
