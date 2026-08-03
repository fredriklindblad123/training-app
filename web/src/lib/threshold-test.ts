/* ---------------------------------------------------------------------------
 * K8 (docs/tranarperspektiv.md): uppskatta LT2 ur ett genomfört tröskeltest.
 *
 * Fältprotokollet, ur docs/insikter-roadmap.md (P1.3, "Kalibreringen är
 * blockeraren"): 30 minuter maxinsats i jämn fart. Snittpulsen för de sista
 * 20 minuterna motsvarar ungefär den anaeroba tröskeln (LT2) — kroppen har då
 * hunnit stabiliseras kring den intensitet som går att hålla i just den
 * längden, vilket är det ett laktattest egentligen mäter.
 *
 * Det här är en uppskattning ur en enda mätpunkt, inte en omräkning av
 * klockans pulszoner (de kan inte räknas om i efterhand — se
 * lib/intensity.ts). Ett värde härifrån ska alltid märkas `test_field`
 * (motsats: `test_lactate` för ett riktigt laktattest), aldrig visas som om
 * det vore en mätning.
 * ------------------------------------------------------------------------ */

import type { SignatureLap } from "./session-signature";

/** Etiketter för `profiles.lt2_source`. Ett fälttest är en uppskattning, ett
 * laktattest är en mätning (K8, fallgrop 1) — värdet ska alltid visas med sin
 * källa, aldrig som en anonym siffra. Delas mellan dagvyn och /settings. */
export const LT2_SOURCE_LABELS: Record<string, string> = {
  test_field: "Fälttest",
  test_lactate: "Laktattest",
  manuell: "Manuellt",
};

/** Hur många minuter av testets slut som snittpulsen räknas över. */
const TAIL_MINUTES = 20;
const TAIL_SECONDS = TAIL_MINUTES * 60;

/** Kortaste passlängd testet accepteras för. Protokollet ber om 30 minuter,
 * men ett pass som blev några minuter kortare än planerat ska ändå kunna ge
 * ett svar så länge det finns utrymme för en 20-minuters svans att räkna på.
 * Kortare än så är för osäkert — gissa inte. */
const MIN_DURATION_SECONDS = 25 * 60;

export type Lt2Estimate = {
  /** Uppskattat LT2 i slag/min, avrundat till heltal. Null när passet inte
   * duger som tröskeltest — gissa aldrig ett värde. */
  lt2: number | null;
  /** Varför ett värde inte gick att räkna fram, eller varför det som räknats
   * fram är mindre säkert. Null bara när lt2 kommer ur tidsviktad varvdata
   * för de sista 20 minuterna — den säkra vägen. Visas i UI. */
  reason: string | null;
  /** Hur många minuter uppskattningen faktiskt bygger på. */
  minutesUsed: number;
};

/**
 * Uppskattar LT2 ur ett genomfört tröskeltest: tidsviktad snittpuls för de
 * sista `TAIL_MINUTES` minuterna av passet.
 *
 * Varvdata används när den finns och räcker till: varven gås igenom bakifrån
 * och samlas tills 20 minuter är täckta, och `avg_hr` viktas per varvs
 * längd — samma princip som `buildSession` i lib/sessions.ts använder för
 * ett passets snittpuls, så att ett kort avslutningsvarv inte väger lika
 * tungt som ett långt.
 *
 * Utan varvdata, eller när varven som finns inte räcker till 20 minuter,
 * faller uppskattningen tillbaka på passets egen snittpuls — mindre säkert
 * (uppvärmning och start är då inräknad), men bättre än inget svar alls.
 * Det märks tydligt via `reason`.
 */
export function estimateLt2({
  laps,
  totalDurationSeconds,
  avgHr,
}: {
  laps: SignatureLap[];
  totalDurationSeconds: number | null;
  avgHr: number | null;
}): Lt2Estimate {
  if (totalDurationSeconds == null || totalDurationSeconds < MIN_DURATION_SECONDS) {
    return {
      lt2: null,
      reason:
        "Passet är för kort för att vara ett tröskeltest (under 25 minuter) — inget värde uppskattas.",
      minutesUsed: 0,
    };
  }

  const sortedLaps = laps
    .filter((l) => l.duration_seconds != null && l.duration_seconds > 0)
    .sort((a, b) => a.split_index - b.split_index);
  const totalLapSeconds = sortedLaps.reduce(
    (sum, l) => sum + (l.duration_seconds as number),
    0,
  );

  // Varvdata finns och räcker till en 20-minuterssvans — räkna tidsviktat på
  // den, bakifrån.
  if (sortedLaps.length > 0 && totalLapSeconds >= TAIL_SECONDS) {
    let secondsCovered = 0;
    let hrWeight = 0;
    let hrSum = 0;
    for (let i = sortedLaps.length - 1; i >= 0 && secondsCovered < TAIL_SECONDS; i--) {
      const lap = sortedLaps[i];
      const duration = lap.duration_seconds as number;
      secondsCovered += duration;
      if (lap.avg_hr != null) {
        hrSum += lap.avg_hr * duration;
        hrWeight += duration;
      }
    }
    if (hrWeight > 0) {
      return {
        lt2: Math.round(hrSum / hrWeight),
        reason: null,
        minutesUsed: Math.round(secondsCovered / 60),
      };
    }
    // Varv fanns och täckte svansen, men inget av dem hade pulsdata — samma
    // fallback som när varvdata saknas helt.
  }

  if (avgHr != null) {
    return {
      lt2: Math.round(avgHr),
      reason: "Räknat på passets snittpuls, inte de sista 20 minuterna — mindre säkert.",
      minutesUsed: Math.round(totalDurationSeconds / 60),
    };
  }

  return {
    lt2: null,
    reason: "Passet saknar pulsdata — inget värde kan uppskattas.",
    minutesUsed: 0,
  };
}
