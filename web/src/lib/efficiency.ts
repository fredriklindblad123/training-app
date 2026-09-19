// Formkurva / Efficiency Factor (P1.4 i docs/insikter-roadmap.md), som ren
// logik — separerad ur EfficiencyChart.tsx (presentation) så att både
// /trender och /dashboard kan räkna på exakt samma pass-urval och formel. Se
// EfficiencyChart.tsx för enhets- och trendlinje-resonemanget.

import type { ActivityCategory } from "@/lib/categories";
import type { TrainingSession } from "@/lib/sessions";
import { median } from "@/lib/stats-utils";

export type EfficiencyPoint = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** (distans_m / duration_s) / avg_hr — råvärdet enligt roadmapens formel. */
  ef: number;
  label: string;
  category: Extract<ActivityCategory, "easy" | "long_run">;
  durationSeconds: number;
  distanceMeters: number;
  avgHr: number;
};

/** EF-filtret enligt P1.4: bara jämförbara pass, aldrig intervaller. */
export const EF_MIN_SECONDS = 20 * 60;
export const EF_CATEGORIES = ["easy", "long_run"] as const;

/** m/s per slag → meter per hjärtslag, samma omräkning som EfficiencyChart. */
export const METERS_PER_BEAT = 60;

/** Bygger formkurvans datapunkter ur pass (aldrig aktiviteter, P0.5) — bara
 * lugna/långa pass med minst 20 minuters varaktighet och en riktig snittpuls,
 * annars mäter EF ett fragment eller ett intervallpass i stället för formen. */
export function computeEfficiencyPoints(sessions: TrainingSession[]): EfficiencyPoint[] {
  return sessions
    .filter(
      (s) =>
        (EF_CATEGORIES as readonly string[]).includes(s.category) &&
        s.durationSeconds >= EF_MIN_SECONDS &&
        s.avgHr != null &&
        s.avgHr > 0 &&
        s.distanceMeters > 0,
    )
    .map((s) => ({
      id: s.id,
      date: s.date,
      ef: s.distanceMeters / s.durationSeconds / (s.avgHr as number),
      label: s.dominantActivity.name ?? "Pass",
      category: s.category as EfficiencyPoint["category"],
      durationSeconds: s.durationSeconds,
      distanceMeters: s.distanceMeters,
      avgHr: s.avgHr as number,
    }));
}

/* ------------------------------ domraden --------------------------------- */

// Diagrammet visade riktningen men sa den aldrig. Att läsa en lutning ur en
// punktsvärm med fyra veckors rullande median är inte gratis — och eftersom
// EF svarar kraftigt på värme, underlag och kupering är det lätt att läsa in
// en trend som inte finns. Därför räknas domen fram en gång, med uttalade
// krav på underlag, i stället för att varje läsare gissar sin egen.

/** Minsta antal pass i vardera änden innan en riktning får påstås. Tre: två
 * pass kan vara två varma dagar i rad. */
const VERDICT_MIN_POINTS = 3;

/** Under den här förändringen påstås ingen riktning. 1,5 % ligger inom det
 * brus väder och underlag ensamt kan orsaka mellan två månader. */
const VERDICT_MIN_CHANGE = 0.015;

export type EfficiencyVerdict = {
  /** Relativ förändring, 0,042 = +4,2 %. */
  change: number;
  direction: "upp" | "ner" | "oförändrad";
  /** Antal pass bakom jämförelsen totalt. */
  n: number;
};

/**
 * Jämför första och sista tredjedelen av perioden, median mot median.
 *
 * Median och inte medelvärde: ett enda pass med tappat pulsband eller i
 * motvind ska inte kunna vända domen. Tredjedelar och inte första/sista
 * punkten: ändpunkter är de mest brusiga värdena i serien, och att bygga en
 * trend på två av dem vore precis det misstag diagrammets brasklapp varnar
 * för. `null` när underlaget inte räcker — hellre ingen dom än en påhittad.
 */
export function efficiencyVerdict(points: EfficiencyPoint[]): EfficiencyVerdict | null {
  if (points.length < VERDICT_MIN_POINTS * 2) return null;

  const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
  const third = Math.floor(sorted.length / 3);
  if (third < VERDICT_MIN_POINTS) return null;

  const firstMedian = median(sorted.slice(0, third).map((p) => p.ef));
  const lastMedian = median(sorted.slice(-third).map((p) => p.ef));
  if (firstMedian == null || lastMedian == null || firstMedian <= 0) return null;

  const change = lastMedian / firstMedian - 1;
  return {
    change,
    direction:
      Math.abs(change) < VERDICT_MIN_CHANGE ? "oförändrad" : change > 0 ? "upp" : "ner",
    n: sorted.length,
  };
}
