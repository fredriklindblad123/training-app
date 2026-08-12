// Formkurva / Efficiency Factor (P1.4 i docs/insikter-roadmap.md), som ren
// logik — separerad ur EfficiencyChart.tsx (presentation) så att både
// /blocket och /idag kan räkna på exakt samma pass-urval och formel. Se
// EfficiencyChart.tsx för enhets- och trendlinje-resonemanget.

import type { ActivityCategory } from "@/lib/categories";
import type { TrainingSession } from "@/lib/sessions";

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
