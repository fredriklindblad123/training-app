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

/* ------------------------- höjdjusteringen ------------------------------ *
 * Backar påverkar EF kraftigt: uppför kommer man kortare per hjärtslag utan
 * att formen ändrats det minsta. Kurvan räknar därför på Garmins
 * grade-adjusted pace (avg_gap_seconds_per_km) — den fart passet motsvarar
 * på plant underlag — i stället för på rå fart.
 *
 * För Alice skiljer det 6–12 sekunder per kilometer på verkliga distanspass,
 * alltså 2–4 %. Det är samma storleksordning som brustöskeln på två procent,
 * så utan justeringen kunde ett kuperat pass ensamt vända riktningen.
 *
 * Justeringen är Garmins egen modell, inte en egen omräkning ur höjdmeter.
 * Saknas den för ett fragment används rå fart för just det fragmentet —
 * 111 av 117 pass har värdet, och att kasta de sex vore att tappa data för
 * att slippa en fallback.
 *
 * Höjdtaket fångar barometerglapp. Alices vattenlöpning i bassäng ligger som
 * "running" med 1 141 höjdmeter på 2,1 km, alltså 532 m/km — det finns ingen
 * löpterräng som är så brant över ett helt pass, och farten (18:38/km) visar
 * att det inte är löpning alls. Sådana pass säger ingenting om formen.  */
const EF_MAX_ELEVATION_PER_KM = 100;

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
    .filter((s) => {
      const climbPerKm = sessionElevation(s) / (s.distanceMeters / 1000);
      return climbPerKm <= EF_MAX_ELEVATION_PER_KM;
    })
    .map((s) => ({
      id: s.id,
      date: s.date,
      ef: gradeAdjustedDistance(s) / s.durationSeconds / (s.avgHr as number),
      label: s.dominantActivity.name ?? "Pass",
      category: s.category as EfficiencyPoint["category"],
      durationSeconds: s.durationSeconds,
      distanceMeters: s.distanceMeters,
      avgHr: s.avgHr as number,
    }));
}

/** Summerad stigning över passets fragment. */
function sessionElevation(session: TrainingSession): number {
  return session.activities.reduce((m, a) => m + (a.elevation_gain ?? 0), 0);
}

/**
 * Passets distans omräknad till plant underlag.
 *
 * Per fragment, eftersom uppvärmning och huvudpass kan ligga i olika terräng:
 * har fragmentet en grade-adjusted pace blir den justerade sträckan
 * varaktighet ÷ GAP, annars används fragmentets faktiska sträcka.
 */
function gradeAdjustedDistance(session: TrainingSession): number {
  return session.activities.reduce((metres, a) => {
    const gap = a.avg_gap_seconds_per_km;
    const duration = a.duration_seconds ?? 0;
    if (gap != null && gap > 0 && duration > 0) return metres + (duration / gap) * 1000;
    return metres + (a.distance_meters ?? 0);
  }, 0);
}

/* ------------------------- ETT mått på riktningen ------------------------ */

/* Formkurvans riktning räknades tidigare på tre olika sätt, på tre olika
 * ställen: dashboardens nyckeltal jämförde fyra veckor mot fyra, insikterna
 * räknade veckor i rad uppåt, och Form-vyns dom jämförde periodens första
 * tredjedel mot dess sista. De gav olika svar samtidigt — "stigit 3 veckor i
 * rad" bredvid "oförändrad över perioden" — vilket gör hela måttet omöjligt
 * att lita på. Rapporterat 2026-09-21.
 *
 * Det här är nu det enda facit. Metoden är dashboardens, för den är minst
 * känslig för brus: median över ett fönster mot median över fönstret innan,
 * med en tröskel under vilken ingen riktning påstås. Varken veckoräkning
 * eller ändpunktsjämförelse klarar det — EF svänger kraftigt med värme,
 * kupering och uttorkning (se brasklappen i EfficiencyChart).
 */

/** Fönstrets längd i dagar. Fyra veckor: kort nog att fånga en förändring,
 *  långt nog att en varm vecka inte ensam bestämmer riktningen. */
export const EF_WINDOW_DAYS = 28;
/** Minsta antal pass i VARDERA fönstret innan något påstås. */
export const EF_MIN_POINTS = 3;
/** Under den här förändringen påstås ingen riktning. Två procent ligger inom
 *  det brus väder och underlag ensamt kan orsaka mellan två månader. */
export const EF_NOISE_PCT = 0.02;

export type EfficiencyTrend = {
  /** Median för det senaste fönstret, meter per hjärtslag. */
  current: number | null;
  /** Median för fönstret dessförinnan. */
  baseline: number | null;
  /** Relativ förändring, 0,042 = +4,2 %. null när underlaget inte räcker. */
  changePct: number | null;
  direction: "upp" | "ner" | "oförändrad";
  /** Antal pass bakom de två fönstren tillsammans. */
  n: number;
  /** Antal pass i det senaste respektive föregående fönstret. Anropare visar
   * dem för att kunna säga "bygger underlag, 2 av 3 pass". */
  recentCount: number;
  priorCount: number;
};

function shift(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() + days);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function efficiencyTrend(points: EfficiencyPoint[], todayKey: string): EfficiencyTrend {
  const recentFrom = shift(todayKey, -EF_WINDOW_DAYS);
  const priorFrom = shift(todayKey, -EF_WINDOW_DAYS * 2);

  const recent = points
    .filter((p) => p.date >= recentFrom)
    .map((p) => p.ef * METERS_PER_BEAT);
  const prior = points
    .filter((p) => p.date >= priorFrom && p.date < recentFrom)
    .map((p) => p.ef * METERS_PER_BEAT);

  const current = recent.length >= EF_MIN_POINTS ? median(recent) : null;
  const baseline = prior.length >= EF_MIN_POINTS ? median(prior) : null;
  const changePct =
    current != null && baseline != null && baseline > 0 ? (current - baseline) / baseline : null;

  return {
    current,
    baseline,
    changePct,
    direction:
      changePct == null || Math.abs(changePct) < EF_NOISE_PCT
        ? "oförändrad"
        : changePct > 0
          ? "upp"
          : "ner",
    n: recent.length + prior.length,
    recentCount: recent.length,
    priorCount: prior.length,
  };
}

/** Domen, som en mening. Samma tal som dashboardens nyckeltal visar. */
export function efficiencyVerdict(trend: EfficiencyTrend): string {
  if (trend.current == null) {
    return "För få distanspass med puls i perioden för att säga något om riktningen.";
  }
  if (trend.changePct == null) {
    return `Senaste fyra veckorna ${trend.current.toFixed(2)} m/slag. För få pass innan för att jämföra mot.`;
  }
  const pct = `${trend.changePct > 0 ? "+" : "−"}${Math.abs(trend.changePct * 100).toFixed(1)} %`;
  if (trend.direction === "oförändrad") {
    return (
      `Oförändrad: ${trend.current.toFixed(2)} m/slag de senaste fyra veckorna mot ` +
      `${trend.baseline!.toFixed(2)} de fyra innan (${pct}, inom bruset).`
    );
  }
  return (
    `${trend.direction === "upp" ? "Stigande" : "Fallande"}: ${trend.current.toFixed(2)} m/slag ` +
    `de senaste fyra veckorna mot ${trend.baseline!.toFixed(2)} de fyra innan (${pct}).`
  );
}
