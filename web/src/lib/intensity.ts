// Intensitetsfördelning (P1.3 i docs/insikter-roadmap.md).
//
// Zontiderna kommer från Garmins `hrTimeInZone_1..5` per aktivitet. Summering
// över dagens fragment är korrekt även när fragmenteringen förstör allt annat
// (1.3) — det är därför den här vyn går att bygga på befintlig data i dag.
//
// Det som *inte* går att fixa i efterhand: zongränserna. Garmin levererar
// bara sekunder per zon, aldrig pulsintervallen de räknades mot, och de
// intervallen sparas inte i `activities.raw_data` heller. Ett personligt
// tröskelband (`profiles.threshold_hr_low/high`, P0.3b) kan alltså inte
// användas för att räkna om zonerna — bara för att säga hur långt ifrån
// klockans gissning det ligger. Därför är hela sektionen byggd runt att
// gränserna redovisas öppet i stället för att antas vara rätt.

/** Sekunder i pulszon 1–5, i den ordningen. */
export type ZoneSeconds = [number, number, number, number, number];

export const ZONE_INDEXES = [0, 1, 2, 3, 4] as const;

export const ZONE_LABELS = ["Zon 1", "Zon 2", "Zon 3", "Zon 4", "Zon 5"] as const;

/** Kort beskrivning per zon — vad zonen är tänkt att vara, inte vad den är. */
export const ZONE_DESCRIPTIONS = [
  "Mycket lätt",
  "Lugnt, aerobt",
  "Mitten — varken lugnt eller tröskel",
  "Tröskelarbete",
  "Över tröskel",
] as const;

export function zoneColorVar(zoneIndex: number): string {
  return `var(--zone-${zoneIndex + 1})`;
}

export function emptyZoneSeconds(): ZoneSeconds {
  return [0, 0, 0, 0, 0];
}

export function addZoneSeconds(target: ZoneSeconds, add: ZoneSeconds): void {
  for (const i of ZONE_INDEXES) target[i] += add[i];
}

export function zoneTotal(zones: ZoneSeconds): number {
  return zones[0] + zones[1] + zones[2] + zones[3] + zones[4];
}

/* ------------------------------- tre band -------------------------------- */

// Målmodellerna i litteraturen är formulerade i *tre* fysiologiska band
// (under LT1 / mellan LT1 och LT2 / över LT2), inte i klockans fem. Den
// vedertagna grova översättningen är zon 1–2 = lugnt, zon 3 = mitten,
// zon 4–5 = tröskel och över. Den översättningen är en approximation och
// skrivs ut i UI:t — den är inte gratis korrekt, den ärver samma
// gränsproblem som zonerna själva.

export type BandKey = "easy" | "middle" | "threshold";

export const BAND_LABELS: Record<BandKey, string> = {
  easy: "Lugnt (zon 1–2)",
  middle: "Mitten (zon 3)",
  threshold: "Tröskel och över (zon 4–5)",
};

/** Rampsteg för de tre banden: samma blå hue som zonerna, glest samplad, så
 * att jämförelsegrafen och zongrafen läses som samma system. */
export const BAND_COLOR_VARS: Record<BandKey, string> = {
  easy: "var(--zone-1)",
  middle: "var(--zone-3)",
  threshold: "var(--zone-5)",
};

export function bandsFromZones(zones: ZoneSeconds): Record<BandKey, number> {
  return {
    easy: zones[0] + zones[1],
    middle: zones[2],
    threshold: zones[3] + zones[4],
  };
}

/* ------------------------------ målmodeller ------------------------------ */

export type IntensityModel = {
  id: string;
  label: string;
  /** Andelar i procent, summerar till 100. */
  target: Record<BandKey, number>;
  /** Var siffran kommer ifrån. Visas i UI — appen ska inte påstå vad som är
   * rätt, den ska visa vad en modell säger och vem som säger det. */
  source: string;
};

export const INTENSITY_MODELS: IntensityModel[] = [
  {
    id: "norwegian",
    label: "Norsk (dubbeltröskel)",
    target: { easy: 72, middle: 4, threshold: 24 },
    source:
      "Marius Bakken: 23–25 % av veckovolymen på eller över tröskel under " +
      "förberedelseperiod, resten tydligt lugnt (2.2 i insikter-roadmap.md).",
  },
  {
    id: "polarized",
    label: "Polariserad (80/20)",
    target: { easy: 80, middle: 5, threshold: 15 },
    source:
      "Klassisk polariserad fördelning: merparten tydligt lugnt, en mindre " +
      "del hårt, och så lite som möjligt i mitten.",
  },
  {
    id: "pyramidal",
    label: "Pyramidal",
    target: { easy: 80, middle: 15, threshold: 5 },
    source:
      "Pyramidal fördelning: mest lugnt, därefter tröskel, minst över " +
      "tröskel. Vanlig under grundträningsperiod.",
  },
];

/** Almgrens eget tröskelband, som referenspunkt för vad ett *personligt*
 * kalibrerat band är — aldrig som mål att kopiera (2.3: metoden är inte
 * skriven för en 17-årig junior). */
export const ALMGREN_THRESHOLD_BAND = { low: 167, high: 178 };

/** Personligt kalibrerade pulsgränser från `profiles` (P0.3b). Alla nullbara:
 * migrationen kan vara applicerad utan att någon fyllt i värdena. */
export type ThresholdProfile = {
  thresholdHrLow: number | null;
  thresholdHrHigh: number | null;
  maxHr: number | null;
  lt1Hr: number | null;
  lt2Hr: number | null;
};

export const EMPTY_THRESHOLD_PROFILE: ThresholdProfile = {
  thresholdHrLow: null,
  thresholdHrHigh: null,
  maxHr: null,
  lt1Hr: null,
  lt2Hr: null,
};

export function hasPersonalThresholds(profile: ThresholdProfile): boolean {
  return profile.thresholdHrLow != null && profile.thresholdHrHigh != null;
}
