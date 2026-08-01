/** Pearson-korrelationskoefficient. Kräver minst 5 punkter för att räknas
 * som meningsfull — under det returneras null istället för ett skakigt tal. */
export function pearsonCorrelation(pairs: [number, number][]): number | null {
  const n = pairs.length;
  if (n < 5) return null;

  const xs = pairs.map((p) => p[0]);
  const ys = pairs.map((p) => p[1]);
  const xMean = xs.reduce((a, b) => a + b, 0) / n;
  const yMean = ys.reduce((a, b) => a + b, 0) / n;

  let num = 0;
  let xDenom = 0;
  let yDenom = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - xMean;
    const dy = ys[i] - yMean;
    num += dx * dy;
    xDenom += dx * dx;
    yDenom += dy * dy;
  }

  if (xDenom === 0 || yDenom === 0) return null;
  return num / Math.sqrt(xDenom * yDenom);
}

export function correlationStrengthLabel(r: number): string {
  const abs = Math.abs(r);
  if (abs < 0.1) return "Ingen tydlig koppling";
  if (abs < 0.3) return "Svag koppling";
  if (abs < 0.5) return "Måttlig koppling";
  if (abs < 0.7) return "Tydlig koppling";
  return "Stark koppling";
}

/** Måndagsdatum (YYYY-MM-DD) för veckan som datumsträngen (YYYY-MM-DD) tillhör. */
export function isoWeekStart(dateStr: string): string {
  const date = new Date(`${dateStr}T00:00:00`);
  const day = (date.getDay() + 6) % 7; // 0=mån..6=sön
  date.setDate(date.getDate() - day);
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** Aritmetiskt medelvärde. null för tom lista (hellre än NaN som smittar vidare). */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

/** Median. Robust mot enstaka utstickare, vilket är poängen när baslinjen ska
 * beskriva "det normala" och inte påverkas av en enskild sjukvecka. */
export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/** Robust intervall kring datans median, byggt på MAD (medianabsolut-
 * avvikelse) i stället för SD — poängen är att kunna zooma en graf till den
 * meningsfulla klustringen utan att ett fåtal orimliga mätvärden (GPS-fel,
 * ett avbrutet pass) drar ut hela skalan så att den verkliga variationen ser
 * ut som ett rakt streck. `k` är tröskeln i skalade MAD-enheter — 3,5 är den
 * vedertagna gränsen för "modified z-score"-utstickare (Iglewicz & Hoaglin).
 * `null` när datan är för gles eller helt konstant (inget att skala mot). */
export function robustRange(values: number[], k = 3.5): { low: number; high: number } | null {
  if (values.length < 4) return null;
  const med = median(values);
  if (med == null) return null;
  const madRaw = median(values.map((v) => Math.abs(v - med)));
  if (madRaw == null || madRaw === 0) return null;
  // 1,4826 skalar MAD så den motsvarar SD för normalfördelad data.
  const scaledMad = madRaw * 1.4826;
  return { low: med - k * scaledMad, high: med + k * scaledMad };
}

/** Stickprovsstandardavvikelse (n−1). Kräver minst 2 värden. */
export function standardDeviation(values: number[]): number | null {
  if (values.length < 2) return null;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const sumSq = values.reduce((acc, v) => acc + (v - m) * (v - m), 0);
  return Math.sqrt(sumSq / (values.length - 1));
}

/** Variationskoefficient (SD / medelvärde), enligt P1.5 i insikter-roadmap.md:
 * lågt värde = jämn belastning vecka för vecka inom ett block, högt värde =
 * ryckig träning. Oberoende av skala, till skillnad från ren SD — vilket är
 * poängen när blocken jämförs mot varandra och har olika volymnivå. */
export function coefficientOfVariation(values: number[]): number | null {
  const m = mean(values);
  const sd = standardDeviation(values);
  if (m == null || sd == null || m <= 0) return null;
  return sd / m;
}

/** Personlig baslinje för en markör: centrum + spridning över ett fönster.
 * `n` = antal faktiska mätvärden bakom siffrorna, så anropande kod kan visa
 * "bygger baslinje — n av N" istället för att låtsas att den är färdig. */
export type Baseline = { center: number; sd: number; n: number };

/** Rullande baslinje per position, enligt 2.4/P1.2 i insikter-roadmap.md:
 * centrum = median över fönstret (robust), spridning = SD (n−1).
 *
 * Fönstret är *bakåtblickande och inklusive punkten själv*. Att ta med
 * punkten dämpar signalen med ca 1/window, men alternativet (exkludera den)
 * blir instabilt när det bara finns en handfull mätningar — och glest data är
 * normalfallet här. Positioner med färre än `minPoints` mätvärden får `null`:
 * en baslinje byggd på fem dagar är brus, och då ska ingenting ritas alls
 * hellre än något som ser ut som en bedömning.
 *
 * `null` i indata är en lucka (ingen mätning) och hoppas över — den räknas
 * varken som noll eller interpoleras. */
export function rollingBaseline(
  values: (number | null)[],
  options: { window?: number; minPoints?: number } = {},
): (Baseline | null)[] {
  const window = options.window ?? 8;
  const minPoints = options.minPoints ?? 4;

  return values.map((_, i) => {
    const from = Math.max(0, i - window + 1);
    const sample = values.slice(from, i + 1).filter((v): v is number => v != null);
    if (sample.length < minPoints) return null;
    const center = median(sample);
    const sd = standardDeviation(sample);
    if (center == null || sd == null || sd <= 0) return null;
    return { center, sd, n: sample.length };
  });
}

/** Avvikelse i SD-enheter mot baslinjen. Skalan är poängen: 0 = ditt normala,
 * ±1 = kanten på ditt normalintervall — samma tolkning för HRV som för
 * vilopuls som för sömn, vilket är det som gör att de får dela y-axel. */
export function baselineDeviation(
  value: number | null,
  baseline: Baseline | null,
): number | null {
  if (value == null || baseline == null || baseline.sd <= 0) return null;
  return (value - baseline.center) / baseline.sd;
}

/** Avrundning uppåt till ett "snyggt" axelmax (1/2/5 × tiopotens). */
export function niceCeil(value: number): number {
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

/** Kort etikett för en veckas måndagsdatum, t.ex. "V.31". */
export function weekLabel(mondayDateStr: string): string {
  const date = new Date(`${mondayDateStr}T00:00:00`);
  const jan4 = new Date(date.getFullYear(), 0, 4);
  const jan4Day = (jan4.getDay() + 6) % 7;
  const week1Monday = new Date(jan4);
  week1Monday.setDate(jan4.getDate() - jan4Day);
  const diffWeeks = Math.round(
    (date.getTime() - week1Monday.getTime()) / (7 * 24 * 60 * 60 * 1000),
  );
  return `V.${diffWeeks + 1}`;
}
