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
