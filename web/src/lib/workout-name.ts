// Sträckan ur passets namn, när GPS:en mäter fel.
//
// Alice skriver upplägget i passnamnet ("10x400m med häckar/90sek vila").
// Står det 400 m har hon sprungit på bana, och då är 400 m rätt sträcka även
// när klockans GPS säger 392 eller 406. Utan den rättningen föll hälften av
// 400:orna på 10x400-passen under växlarnas 400-metersgolv
// (lib/training-gears.ts GEAR_MIN_REP_METERS) och räknades inte alls.
//
// Tolkningen plockar ut varje sträcka namnet nämner, i de former hon faktiskt
// skriver dem (kontrollerat mot 153 av hennes kvalitetspass 2026-09-29):
//
//   "10x400m", "5×1km", "2x600/3min vila"   upprepningar, med eller utan enhet
//   "1200m tröskel/3min", "800/3min vila"    ensamma sträckor
//   "2x(400, 600, 200)", "300 200 100/3min"  listor
//   "4x2varv"                                 varv på bana, 400 m styck
//
// Tider ("4x4min", "6x30sek", "90/60/5min vila") ger ingen sträcka. Tal utan
// enhet räknas bara som meter från 100 och uppåt.
//
// Namnets sträckor används bara för att RÄTTA ett varv vars GPS-sträcka
// redan ligger nära en av dem (MATCH_TOLERANCE) — aldrig för att hitta på
// varv. Ett ord i namnet som inte är en repetition ("Distans 10km") kan
// därför bara flytta ett varv som redan var nästan exakt den sträckan.

/** Hur nära GPS-sträckan måste ligga namnets sträcka för att rättas. GPS på
 * bana mäter i Alices data 1–9 % fel på korta rep (138 m för 150, 272 för
 * 300). 10 % täcker det men är långt från nästa vanliga sträcka, och ett
 * 6 km-varv i "Distans + 4x100m" rättas aldrig till 100 m. */
const MATCH_TOLERANCE = 0.1;

/** Kortaste tal utan enhet som tolkas som meter. */
const MIN_UNITLESS_METERS = 100;

const TRACK_LAP_METERS = 400;

/* Ett tal med valfri enhet. Enheten fångas så att tider kan sorteras bort;
 * "varv" före "m" så att "2varv" inte läses som meter. */
const NUMBER_WITH_UNIT =
  /(\d+(?:[.,]\d+)?)\s*(varv|km|min|sek|s|m)?(?![a-zåäö])/gi;

/** Rensar bort tidsangivelser: parenteser med en tidsenhet ("2x(3+2+1min)")
 * och varje tal med tidsenhet ("3min", "75sek"). Tal utan enhet i en
 * vilokedja ("90/60/5min") blir kvar men är under 100 och räknas inte;
 * sträckan i "800/3min vila" blir kvar och räknas. */
function stripTimes(name: string): string {
  return name
    .replace(/\([^)]*(?:min|sek)[^)]*\)/gi, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(?:min|sek|s)(?![a-zåäö])/gi, " ");
}

/** De sträckor (meter) namnet nämner, utan dubbletter. */
export function namedRepDistances(name: string | null | undefined): number[] {
  if (!name) return [];
  const out = new Set<number>();
  // "4x2varv" → 800 m. Tas före den allmänna tolkningen, som annars läser
  // "4x2" som fyra gånger två.
  const text = stripTimes(name).replace(/\d+\s*[x×]\s*(?=\d)/gi, " ");
  for (const m of text.matchAll(NUMBER_WITH_UNIT)) {
    const value = Number(m[1].replace(",", "."));
    const unit = m[2]?.toLowerCase();
    if (!Number.isFinite(value) || value <= 0) continue;
    let meters: number | null = null;
    if (unit === "varv") meters = value * TRACK_LAP_METERS;
    else if (unit === "km") meters = value * 1000;
    else if (unit === "m") meters = value;
    else if (unit == null && value >= MIN_UNITLESS_METERS) meters = value;
    if (meters != null) out.add(Math.round(meters));
  }
  return [...out].sort((a, b) => a - b);
}

/** Varvets sträcka: namnets, när GPS:en ligger nära en av dem; annars GPS:ens. */
export function correctedLapDistance(gpsMeters: number, named: number[]): number {
  let best: number | null = null;
  let bestOff = Infinity;
  for (const d of named) {
    const off = Math.abs(gpsMeters - d) / d;
    if (off <= MATCH_TOLERANCE && off < bestOff) {
      best = d;
      bestOff = off;
    }
  }
  return best ?? gpsMeters;
}
