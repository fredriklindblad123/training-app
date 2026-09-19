// Syreupptag (VO2max) — det aeroba taket.
//
// ── Vad talet är, och inte är ────────────────────────────────────────────
// Garmins VO2max är ingen mätning. Den är en modellskattning ur förhållandet
// mellan fart och puls under löpning: springer du fortare vid samma puls
// stiger skattningen. Det betyder att den ärver allt som stör det
// förhållandet — värme, kupering, uttorkning, ett glappande pulsband — precis
// som formkurvan gör (se lib/efficiency.ts).
//
// ── Varför den inte får läsas punkt för punkt ────────────────────────────
// Klockan levererar bara heltal, och för en tränad löpare rör sig talet
// knappt. Alices år ligger mellan 58 och 61, och värdet flippar 59 → 58 → 59
// inom samma dygn (10 mars 2026). Ett enskilt steg på ±1 är alltså brus, inte
// en förändring i kapacitet. Därför bygger domen på tredjedelar av perioden,
// aldrig på första och sista värdet, och UI:t skriver ut spannet i stället för
// att låtsas om en precision som inte finns.

import type { TrainingSession } from "@/lib/sessions";
import { median } from "@/lib/stats-utils";

export type Vo2maxPoint = { date: string; value: number };

export type Vo2maxTrend = {
  points: Vo2maxPoint[];
  /** Senaste värdet i perioden. */
  current: number;
  min: number;
  max: number;
  /** Förändring mellan periodens första och sista tredjedel, i enheter. */
  change: number;
  direction: "upp" | "ner" | "oförändrad";
};

/** Under den här förändringen påstås ingen riktning. 0,5 enheter: klockan
 * rapporterar heltal, så allt under ett halvt steg ligger inom avrundningen. */
const MIN_CHANGE = 0.5;

/** Minsta antal mätningar i vardera änden innan en riktning får påstås. */
const MIN_POINTS = 5;

export function computeVo2maxTrend(sessions: TrainingSession[]): Vo2maxTrend | null {
  /* Ett värde per dag. Klockan skriver samma skattning på varje aktivitet
   * under dagen, och ett intervallpass med tre fragment hade annars vägt tre
   * gånger så tungt som ett distanspass med ett. */
  const byDate = new Map<string, number>();
  for (const session of sessions) {
    for (const activity of session.activities) {
      if (activity.vo2max != null && activity.vo2max > 0) {
        byDate.set(session.date, activity.vo2max);
      }
    }
  }

  const points: Vo2maxPoint[] = [...byDate.entries()]
    .map(([date, value]) => ({ date, value }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) return null;

  const values = points.map((p) => p.value);
  const third = Math.floor(points.length / 3);
  let change = 0;
  if (third >= MIN_POINTS) {
    const first = median(values.slice(0, third));
    const last = median(values.slice(-third));
    if (first != null && last != null) change = last - first;
  }

  return {
    points,
    current: values[values.length - 1],
    min: Math.min(...values),
    max: Math.max(...values),
    change,
    direction:
      Math.abs(change) < MIN_CHANGE ? "oförändrad" : change > 0 ? "upp" : "ner",
  };
}

/** Domen, som en mening. Ett platt syreupptag är inte ett larm — hos en
 * tränad löpare är det normaltillståndet, och tiderna kan förbättras ändå
 * genom löpekonomi och tröskelfart. Texten säger det, i stället för att
 * måla ett stillastående tal som ett misslyckande. */
export function vo2maxVerdict(t: Vo2maxTrend): { headline: string; detail: string } {
  const span = `${t.min}–${t.max}`;
  if (t.direction === "oförändrad") {
    return {
      headline: `Syreupptaget ligger stilla på ${t.current}.`,
      detail:
        `Spannet i perioden är ${span}, och klockan rapporterar heltal — rörelser på ett steg är ` +
        `brus. Ett platt syreupptag hos en tränad löpare är normalt: taket höjs långsamt, medan ` +
        `tiderna kan fortsätta förbättras genom löpekonomi och högre tröskelfart.`,
    };
  }
  const word = t.direction === "upp" ? "stigit" : "sjunkit";
  return {
    headline: `Syreupptaget har ${word} till ${t.current}.`,
    detail:
      `Förändringen är ${t.change > 0 ? "+" : ""}${t.change.toFixed(1)} enheter mellan periodens ` +
      `första och sista tredjedel, inom spannet ${span}. Talet är en skattning ur fart och puls, ` +
      `så en varm eller kuperad period kan flytta det utan att kapaciteten ändrats.`,
  };
}
