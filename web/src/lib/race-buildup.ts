// K5 i docs/tranarperspektiv.md (≈ P2.3 i insikter-roadmapen): upptrappnings-
// profilen för de 21 dagarna före en tävling. Ren logik, ingen React — samma
// uppdelning som lib/daily-status.ts och blockaggregatet på /trends.
//
// Bygger uttryckligen INGEN egen resultattabell — competition_events (se
// planering/actions.ts, saveEventResult) har redan actual_result/placement.
// Den här modulen beskriver bara vad som hände *före* loppet.

import { computeDailyStatus, type DailyStatusInput } from "@/lib/daily-status";
import {
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import { QUALITY_WORKOUT_TYPES, addDays, toDateKey, type WorkoutType } from "@/lib/planning";
import {
  addZoneSeconds,
  bandsFromZones,
  emptyZoneSeconds,
  zoneTotal,
  type BandKey,
} from "@/lib/intensity";
import { mean } from "@/lib/stats-utils";

/** Fönstret upptrappningen räknas över — Almgrens sista tre veckor in mot ett
 * lopp, inte en godtycklig period. */
export const BUILDUP_WINDOW_DAYS = 21;

const QUALITY_SESSION_CATEGORIES = new Set<WorkoutType>(QUALITY_WORKOUT_TYPES);

export type RaceBuildup = {
  /** Träningsbelastning per sjudagarshink, kronologiskt: tre veckor före →
   * senaste veckan innan loppet. */
  weeklyLoad: [number, number, number];
  /** Löpta kilometer i fönstret. Alternativ träning och styrka räknas INTE
   * med: deras distans är inte jämförbar med löpvolym, och att summera dem
   * ihop gör upptrappningen obegriplig. Inför USM 2026-07-31 cyklade Alice
   * 133 km utöver 118 km löpning — en rå summa hade visat 251 km och antytt
   * en löpvecka som aldrig ägde rum. Samma avgränsning som /veckan gör i
   * sitt kategorifilter, och av samma skäl. */
  totalKm: number;
  /** Distans i alternativ träning (cykel m.m.). Hålls isär i stället för att
   * döljas — en upptrappning med tung cykelvolym är inte samma sak som en
   * med vila, och skillnaden är själva poängen. */
  crossTrainingKm: number;
  qualitySessions: number;
  restDays: number;
  avgSleepHours: number | null;
  /** SD-avvikelse mot den rullande baslinjen (P1.2), räknad med tävlingsdatumet
   * som "idag" — inte en egen omräkning. */
  hrvTrend: number | null;
  /** Dagar mellan sista kvalitetspasset i fönstret och loppet. `null` om inget
   * kvalitetspass hittades i de 21 dagarna. */
  lastHardSessionDaysBefore: number | null;
  bandPct: Record<BandKey, number>;
};

function windowStartOf(raceDate: string): string {
  return toDateKey(addDays(new Date(`${raceDate}T00:00:00`), -BUILDUP_WINDOW_DAYS));
}

/** Dagar mellan två YYYY-MM-DD, positivt när `from` ligger före `to`. */
function daysBetween(from: string, to: string): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00`) - Date.parse(`${from}T00:00:00`)) / 86_400_000,
  );
}

/**
 * Räknar upptrappningsprofilen för de 21 dagarna före `raceDate` (loppdagen
 * själv räknas inte in — det är vad som ledde fram dit).
 *
 * `activities` ska redan vara avgränsade till fönstret av anroparen (samma
 * mönster som `loadBlockAggregate` på /trends) — funktionen filtrerar ändå
 * defensivt på datum, så en bredare indata ger fortfarande rätt svar.
 *
 * `dailyStatusRows` ska täcka baslinjefönstret bakåt från `raceDate`
 * (BASELINE_WINDOW_DAYS, se lib/daily-status.ts), inte bara de 21 dagarna —
 * annars har `computeDailyStatus` inget att jämföra mot.
 */
export function computeRaceBuildup(
  raceDate: string,
  activities: SessionActivity[],
  dailyStatusRows: DailyStatusInput[],
): RaceBuildup {
  const windowStart = windowStartOf(raceDate);

  const sessions = groupActivitiesIntoSessions(activities).filter(
    (s) => s.date >= windowStart && s.date < raceDate,
  );

  // Vilodagar: kalenderdagar i fönstret helt utan pass — inte dagar med lågt
  // pass, det är en annan fråga.
  const sessionDates = new Set(sessions.map((s) => s.date));
  let restDays = 0;
  for (let i = 0; i < BUILDUP_WINDOW_DAYS; i++) {
    if (!sessionDates.has(toDateKey(addDays(new Date(`${windowStart}T00:00:00`), i)))) {
      restDays++;
    }
  }

  // Tre sjudagarshinkar, kronologiskt. Bucket 2 = de sju dagarna närmast
  // loppet (1–7 dagar före), bucket 0 = längst bak (15–21 dagar före).
  const weeklyLoad: [number, number, number] = [0, 0, 0];
  for (const s of sessions) {
    const daysBefore = daysBetween(s.date, raceDate);
    const bucket = daysBefore <= 7 ? 2 : daysBefore <= 14 ? 1 : 0;
    weeklyLoad[bucket] += s.trainingLoad;
  }

  // Se kommentaren vid totalKm i RaceBuildup: cykel- och styrkedistans är
  // inte löpvolym och får inte summeras ihop med den.
  const isCrossTraining = (category: string) =>
    category === "cross_training" || category === "strength";
  const totalKm =
    sessions.filter((s) => !isCrossTraining(s.category)).reduce((sum, s) => sum + s.distanceMeters, 0) /
    1000;
  const crossTrainingKm =
    sessions.filter((s) => isCrossTraining(s.category)).reduce((sum, s) => sum + s.distanceMeters, 0) /
    1000;

  const qualityDates = sessions
    .filter((s) => QUALITY_SESSION_CATEGORIES.has(s.category))
    .map((s) => s.date)
    .sort();

  // Ett av de mest handfasta måtten en tränare tittar på inför en
  // formtoppning: hur nära loppet låg det sista hårda passet.
  const lastHardSessionDaysBefore =
    qualityDates.length > 0
      ? daysBetween(qualityDates[qualityDates.length - 1], raceDate)
      : null;

  const zones = emptyZoneSeconds();
  for (const s of sessions) {
    addZoneSeconds(zones, [
      s.hrZone1Seconds,
      s.hrZone2Seconds,
      s.hrZone3Seconds,
      s.hrZone4Seconds,
      s.hrZone5Seconds,
    ]);
  }
  const bands = bandsFromZones(zones);
  const bandTotal = zoneTotal(zones);
  const bandPct: Record<BandKey, number> = {
    easy: bandTotal > 0 ? bands.easy / bandTotal : 0,
    middle: bandTotal > 0 ? bands.middle / bandTotal : 0,
    threshold: bandTotal > 0 ? bands.threshold / bandTotal : 0,
  };

  const sleepHours = dailyStatusRows
    .filter((r) => r.date >= windowStart && r.date < raceDate)
    .map((r) => r.sleepHours)
    .filter((v): v is number => v != null);

  // hrvTrend: computeDailyStatus med tävlingsdatumet som "idag" — baslinjen
  // (P1.2) räknas om automatiskt för det datumet, den här funktionen räknar
  // aldrig om den själv.
  const hrvMarker = computeDailyStatus(dailyStatusRows, raceDate).markers.find(
    (m) => m.spec.key === "hrv",
  );

  return {
    weeklyLoad,
    totalKm,
    crossTrainingKm,
    qualitySessions: qualityDates.length,
    restDays,
    avgSleepHours: mean(sleepHours),
    hrvTrend: hrvMarker?.deviation ?? null,
    lastHardSessionDaysBefore,
    bandPct,
  };
}
