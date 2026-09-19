// Träningens tre växlar: distans, tröskel, intervall — var och en mätt mot
// adeptens egna trösklar.
//
// ── Varför den här indelningen ───────────────────────────────────────────
// Medeldistansträning består av tre olika jobb: bygga motorn (distans), höja
// farten som går att hålla (tröskel), och höja taket plus lära kroppen
// loppfarten (intervall). De ska ligga på tydligt åtskilda intensiteter —
// distans under LT1, tröskel mellan LT1 och LT2, intervall över LT2.
//
// När de glider ihop tränar man i praktiken bara en sak, oavsett vad passen
// heter. För Alice ligger tröskel- och intervallpassens medianpuls två slag
// isär (182 mot 184), och deras mittersta hälfter överlappar på 181–186.
// Det går inte att se i Intensitetsfördelningen, eftersom den bygger på
// Garmins zonhinkar och klockan aldrig skickar gränserna den räknade mot.
// Den här modulen använder bara puls och profilens trösklar.
//
// ── Varför aerob/anaerob inte duger ──────────────────────────────────────
// På 1500 m kommer ungefär fyra femtedelar av energin aerobt. En sådan
// indelning lägger nästan all träning i en låda, och — värre — slår ihop
// tröskel och VO2max-arbete, som är just det par som behöver hållas isär.

import type { TrainingSession } from "@/lib/sessions";
import { percentile } from "@/lib/stats-utils";

export type GearKey = "distans" | "troskel" | "intervall";

export const GEAR_LABELS: Record<GearKey, string> = {
  distans: "Distans",
  troskel: "Tröskel",
  intervall: "Intervall",
};

export const GEAR_PURPOSE: Record<GearKey, string> = {
  distans: "Bygga motorn. Utdelningen kommer av tid på foten vid låg intensitet.",
  troskel: "Höja farten du kan hålla. Arbete mellan trösklarna, aldrig över.",
  intervall: "Höja taket och lära kroppen loppfarten. Ska ligga tydligt över LT2.",
};

/** Färgvariabel per växel — samma ordning som intensiteten stiger. */
export const GEAR_COLOR_VAR: Record<GearKey, string> = {
  distans: "var(--zone-2)",
  troskel: "var(--status-watch)",
  intervall: "var(--status-concern)",
};

export type GearBand = { low: number; high: number };
export type GearStats = { p25: number; median: number; p75: number; n: number };

export type Gear = {
  key: GearKey;
  target: GearBand;
  /** null när perioden saknar underlag för växeln. */
  actual: GearStats | null;
  /** Andel av underlaget som hamnade över växelns tak, 0–1. null för
   * intervall, som inte har något meningsfullt tak. */
  shareOverCeiling: number | null;
};

export type TrainingGears = {
  gears: Gear[];
  lt1: number;
  lt2: number;
  axisMin: number;
  axisMax: number;
};

/** En repetition ur ett kvalitetspass, redan filtrerad på `split_type`. */
export type GearRep = {
  category: string;
  distanceMeters: number;
  durationSeconds: number;
  avgHr: number;
};

/* Distans mäts per *pass* (ett distanspass har en intensitet), tröskel och
 * intervall per *varv* (ett intervallpass har en per repetition). Olika
 * enheter i samma diagram är avsiktligt, men måste skrivas ut i UI:t.
 *
 * Varvgolvet på 400 m finns för att snittpulsen ska hinna bli meningsfull:
 * på ett 200-metersryck ligger pulsen efter hela vägen och underskattar
 * ansträngningen. Följden är att jämförelsen mellan tröskel och intervall
 * snarast *underskattar* hur lika passen är. */
export const GEAR_MIN_REP_METERS = 400;
/* Tidsgolv utöver distansgolvet. Pulsen ligger efter i början av varje
 * repetition, och på ett snabbt 400-metersvarv hinner den aldrig ikapp — ett
 * inledande varv drar då ner snittet utan att säga något om intensiteten.
 * 60 sekunder är den punkt där avg_hr börjar beskriva arbetet i stället för
 * uppladdningen till det. */
export const GEAR_MIN_REP_SECONDS = 60;
export const GEAR_MIN_SESSION_SECONDS = 20 * 60;

/** Marginal under LT1 för distansmålet, samma som lib/easy-discipline.ts. */
const EASY_LOWER_MARGIN = 25;
const EASY_UPPER_MARGIN = 8;

/** Intervallmålets tak när maxpuls saknas: LT2 + 17 slag. */
const INTERVAL_SPAN_WITHOUT_MAX = 17;
/** Andel av maxpuls som övre gräns när den finns — över det är det lopp. */
const INTERVAL_CEILING_FRACTION = 0.97;

function statsFrom(values: number[]): GearStats | null {
  if (values.length < 4) return null;
  const p25 = percentile(values, 0.25);
  const median = percentile(values, 0.5);
  const p75 = percentile(values, 0.75);
  if (p25 == null || median == null || p75 == null) return null;
  return {
    p25: Math.round(p25),
    median: Math.round(median),
    p75: Math.round(p75),
    n: values.length,
  };
}

export function computeTrainingGears(
  sessions: TrainingSession[],
  reps: GearRep[],
  lt1Hr: number | null,
  lt2Hr: number | null,
  maxHr: number | null,
): TrainingGears | null {
  // Båda trösklarna krävs. Att skatta den ena ur den andra hade gett tre
  // band byggda på en gissning, och hela poängen är att banden är personliga.
  if (lt1Hr == null || lt2Hr == null || lt1Hr <= 0 || lt2Hr <= lt1Hr) return null;

  const distansHrs = sessions
    .filter(
      (s) =>
        (s.category === "easy" || s.category === "long_run") &&
        s.durationSeconds >= GEAR_MIN_SESSION_SECONDS &&
        s.avgHr != null &&
        s.avgHr > 0,
    )
    .map((s) => s.avgHr as number);

  const repHrs = (category: string) =>
    reps
      .filter(
        (r) =>
          r.category === category &&
          r.distanceMeters >= GEAR_MIN_REP_METERS &&
          r.durationSeconds >= GEAR_MIN_REP_SECONDS,
      )
      .map((r) => r.avgHr);

  const troskelHrs = repHrs("threshold");
  const intervallHrs = repHrs("interval");

  const intervalCeiling = maxHr
    ? Math.round(maxHr * INTERVAL_CEILING_FRACTION)
    : lt2Hr + INTERVAL_SPAN_WITHOUT_MAX;

  const targets: Record<GearKey, GearBand> = {
    distans: { low: lt1Hr - EASY_LOWER_MARGIN, high: lt1Hr - EASY_UPPER_MARGIN },
    troskel: { low: lt1Hr, high: lt2Hr },
    intervall: { low: lt2Hr, high: Math.max(intervalCeiling, lt2Hr + 6) },
  };

  const values: Record<GearKey, number[]> = {
    distans: distansHrs,
    troskel: troskelHrs,
    intervall: intervallHrs,
  };

  /* Taket som räknas som överskridet per växel. Intervall har inget: en
     repetition som går över LT2 är precis vad den ska göra. */
  const ceilings: Record<GearKey, number | null> = {
    distans: lt1Hr,
    troskel: lt2Hr,
    intervall: null,
  };

  const gears: Gear[] = (["distans", "troskel", "intervall"] as GearKey[]).map((key) => {
    const vals = values[key];
    const ceiling = ceilings[key];
    return {
      key,
      target: targets[key],
      actual: statsFrom(vals),
      shareOverCeiling:
        ceiling != null && vals.length > 0
          ? vals.filter((v) => v > ceiling).length / vals.length
          : null,
    };
  });

  if (gears.every((g) => g.actual == null)) return null;

  const lows = [
    ...gears.map((g) => g.target.low),
    ...gears.flatMap((g) => (g.actual ? [g.actual.p25] : [])),
  ];
  const highs = [
    ...gears.map((g) => g.target.high),
    ...gears.flatMap((g) => (g.actual ? [g.actual.p75] : [])),
  ];

  return {
    gears,
    lt1: lt1Hr,
    lt2: lt2Hr,
    axisMin: Math.min(...lows) - 6,
    axisMax: Math.max(...highs) + 6,
  };
}

/* ------------------------------- domar ----------------------------------- */

/** Hur nära varandra tröskel och intervall ligger, i slag. `null` när någon
 * av dem saknar underlag. Det är växeldiagrammets huvudtal: är skillnaden
 * liten tränar man samma sak två gånger i veckan under olika namn. */
export function gearSeparation(g: TrainingGears): number | null {
  const t = g.gears.find((x) => x.key === "troskel")?.actual;
  const i = g.gears.find((x) => x.key === "intervall")?.actual;
  if (!t || !i) return null;
  return i.median - t.median;
}

export function gearVerdict(gear: Gear, lt1: number, lt2: number): string {
  const a = gear.actual;
  if (!a) return "För lite underlag i perioden.";
  const pct = gear.shareOverCeiling != null ? Math.round(gear.shareOverCeiling * 100) : null;

  switch (gear.key) {
    case "distans":
      return a.median > lt1
        ? `Medianpuls ${a.median}, över aerob tröskel ${lt1}. ${pct} % av passen ligger över taket.`
        : `Medianpuls ${a.median}, under aerob tröskel ${lt1}. Disciplinen håller.`;
    case "troskel":
      return pct != null && pct >= 25
        ? `${pct} % av varven ligger över anaerob tröskel ${lt2} — det är intervallarbete, inte tröskel.`
        : `Medianpuls ${a.median}, inom bandet ${lt1}–${lt2}.`;
    case "intervall":
      return a.median >= lt2
        ? `Medianpuls ${a.median}, över anaerob tröskel ${lt2}.`
        : `Medianpuls ${a.median}, under anaerob tröskel ${lt2} — intervallerna går inte tillräckligt hårt.`;
  }
}
