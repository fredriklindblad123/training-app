/* ---------------------------------------------------------------------------
 * K6 i docs/tranarperspektiv.md: kontinuitet som huvudsiffra.
 *
 * Roadmapen (2.1, 2.3, P2.4) landar i att upprepbarhet är den starkaste
 * signalen i hela researchen — Lovisa Lindh ("det viktigaste är
 * kontinuiteten") och Andreas Almgren (målet är att upprepa kvalitet vecka
 * efter vecka, inte köra hårt en gång) säger samma sak oberoende av
 * varandra. Ändå är dashboardens huvudsiffror volym och belastning. Den här
 * modulen räknar de två svit-måtten som gör kontinuitet till en KPI-ring i
 * stället för något man bara ser i efterhand på /trends.
 *
 * Ren logik: ingen databasfråga, inget React. Anroparen (dashboard/page.tsx)
 * hämtar day_type-historiken och de genomförda passen och skickar in dem
 * färdiga.
 * ------------------------------------------------------------------------ */

import { addDays, mondayOf, QUALITY_WORKOUT_TYPES, toDateKey } from "@/lib/planning";

/** Antal kvalitetspass per vecka som räknas som en "kvalitetsvecka".
 *
 * Två är en utgångspunkt, inte en sanning — Almgren själv kör betydligt fler
 * kvalitetspass per vecka (dubbeltröskel), men han är seniorelit och Alice är
 * 17 år och junior (se varningen i insikter-roadmap.md 2.3). Två är satt lågt
 * medvetet: måttet ska gå att nå upprepade veckor i rad även i en
 * grundträningsperiod, annars mäter det aldrig något annat än att sviten
 * ständigt bryts.
 */
export const QUALITY_TARGET = 2;

export type InterruptionDayType = "sick" | "injured";

/** En enskild dag markerad som sjuk eller skadad i dagboken
 * (`diary_entries.day_type`). */
export type InterruptionDay = {
  /** YYYY-MM-DD */
  date: string;
  dayType: InterruptionDayType;
};

/** Ett genomfört pass, minimalt — bara det den här modulen faktiskt
 * behöver. `category` jämförs mot `QUALITY_WORKOUT_TYPES`. */
export type ContinuitySession = {
  /** YYYY-MM-DD */
  date: string;
  category: string;
};

export type ContinuityStreaks = {
  currentWeeksWithoutInterruption: number;
  bestWeeksWithoutInterruption: number;
  currentQualityWeeks: number;
  bestQualityWeeks: number;
  /** Vad som bröt den senaste sviten (avbrotts-sviten) — datum + typ. Null om
   * ingen avslutad vecka i underlaget någonsin varit avbruten. */
  lastInterruption: { date: string; dayType: InterruptionDayType } | null;
  /** Antal avslutade veckor bakom siffrorna ovan. Styr fallgrop 3 i K6:
   * dashboarden visar inget "personbästa" innan det här är minst 12 — en
   * svit räknad på ett par månaders data är inte ett riktvärde, det är brus. */
  totalCompletedWeeks: number;
};

const EMPTY_STREAKS: ContinuityStreaks = {
  currentWeeksWithoutInterruption: 0,
  bestWeeksWithoutInterruption: 0,
  currentQualityWeeks: 0,
  bestQualityWeeks: 0,
  lastInterruption: null,
  totalCompletedWeeks: 0,
};

type WeekBucket = {
  mondayKey: string;
  interrupted: boolean;
  qualityCount: number;
};

/**
 * Räknar kontinuitets- och kvalitetssviter ur day_type-historik och
 * genomförda pass.
 *
 * En vecka är avbruten om minst en dag i den har `day_type` 'sick' eller
 * 'injured'. En kvalitetsvecka har minst `QUALITY_TARGET` genomförda pass i
 * `QUALITY_WORKOUT_TYPES`.
 *
 * **Bara avslutade veckor räknas.** Innevarande vecka (den som innehåller
 * `today`) är per definition ofullständig — om den räknades med skulle en
 * svit kunna se bruten ut för att det bara råkar vara tisdag och inget
 * kvalitetspass hunnits med än, eller tvärtom se hel ut för att sjukdagen
 * ännu inte hunnit inträffa. Den utelämnas alltså helt, åt båda hållen.
 */
export function computeContinuityStreaks(
  interruptions: InterruptionDay[],
  sessions: ContinuitySession[],
  today: string,
): ContinuityStreaks {
  const allDates = [...interruptions.map((i) => i.date), ...sessions.map((s) => s.date)];
  if (allDates.length === 0) return EMPTY_STREAKS;

  const earliestDate = allDates.reduce((min, d) => (d < min ? d : min));
  const firstMonday = mondayOf(earliestDate);
  const currentMonday = mondayOf(today);

  const interruptionsByWeek = new Map<string, InterruptionDay[]>();
  for (const i of interruptions) {
    const wk = toDateKey(mondayOf(i.date));
    interruptionsByWeek.set(wk, [...(interruptionsByWeek.get(wk) ?? []), i]);
  }

  const qualityByWeek = new Map<string, number>();
  for (const s of sessions) {
    if (!(QUALITY_WORKOUT_TYPES as readonly string[]).includes(s.category)) continue;
    const wk = toDateKey(mondayOf(s.date));
    qualityByWeek.set(wk, (qualityByWeek.get(wk) ?? 0) + 1);
  }

  const weeks: WeekBucket[] = [];
  for (
    let monday = firstMonday;
    toDateKey(monday) < toDateKey(currentMonday);
    monday = addDays(monday, 7)
  ) {
    const mondayKey = toDateKey(monday);
    weeks.push({
      mondayKey,
      interrupted: (interruptionsByWeek.get(mondayKey) ?? []).length > 0,
      qualityCount: qualityByWeek.get(mondayKey) ?? 0,
    });
  }

  if (weeks.length === 0) return EMPTY_STREAKS; // Allt underlag ligger i innevarande vecka.

  const currentWeeksWithoutInterruption = trailingStreak(weeks, (w) => !w.interrupted);
  const bestWeeksWithoutInterruption = longestStreak(weeks, (w) => !w.interrupted);
  const currentQualityWeeks = trailingStreak(weeks, (w) => w.qualityCount >= QUALITY_TARGET);
  const bestQualityWeeks = longestStreak(weeks, (w) => w.qualityCount >= QUALITY_TARGET);

  // Senaste avbrottet: den sist avslutade avbrutna veckan, och inom den det
  // tidigaste datumet — det är dagen som faktiskt bröt sviten, inte den sista
  // sjukdagen i perioden.
  let lastInterruption: ContinuityStreaks["lastInterruption"] = null;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (!weeks[i].interrupted) continue;
    const days = [...(interruptionsByWeek.get(weeks[i].mondayKey) ?? [])].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    if (days[0]) lastInterruption = { date: days[0].date, dayType: days[0].dayType };
    break;
  }

  return {
    currentWeeksWithoutInterruption,
    bestWeeksWithoutInterruption,
    currentQualityWeeks,
    bestQualityWeeks,
    lastInterruption,
    totalCompletedWeeks: weeks.length,
  };
}

/** Antal veckor i rad, räknat bakåt från den senaste avslutade veckan, som
 * uppfyller villkoret. Stannar vid första veckan som inte gör det. */
function trailingStreak(weeks: WeekBucket[], holds: (w: WeekBucket) => boolean): number {
  let streak = 0;
  for (let i = weeks.length - 1; i >= 0; i--) {
    if (!holds(weeks[i])) break;
    streak++;
  }
  return streak;
}

/** Längsta sammanhängande sviten någonstans i historiken — personbästa. */
function longestStreak(weeks: WeekBucket[], holds: (w: WeekBucket) => boolean): number {
  let best = 0;
  let running = 0;
  for (const w of weeks) {
    if (holds(w)) {
      running++;
      best = Math.max(best, running);
    } else {
      running = 0;
    }
  }
  return best;
}
