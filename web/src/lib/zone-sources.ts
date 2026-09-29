// Två källor till samma fråga: hur lång tid i varje pulszon?
//
//   klockan  Garmins hrTimeInZone_1..5, räknade mot klockans egna gränser.
//   labbet   Samma pulskurva räknad mot uppmätta zoner (hr_zone_sets), av
//            compute_lab_zones i databasen. Se
//            supabase/migrations/20260929140000_lab_hr_zones.sql.
//
// Varför båda visas i stället för att labbet bara ersätter klockan: för
// Alice låg klockans zon 4 på 165 och zon 5 på 181, medan laktattestet
// 2026-09-29 gav LT1 183. Allt som räknats på klockans zoner — de
// historiska siffrorna i appen — är alltså missvisande, och det ska synas
// vilka siffror det gäller, inte tyst bytas ut.
//
// Klockans siffror är fortfarande det enda som finns för löpare utan
// uppmätt zonuppsättning. Då visas de som förut, utan jämförelse.
//
// Verifierat mot produktionsdata innan bygget: klockans egna gränser mot
// pulskurvan ger samma sekunder per zon som Garmin (inom 1–2 %, fem pass).

import type { createClient } from "@/lib/supabase/server";
import type { TrainingSession } from "@/lib/sessions";
import {
  addZoneSeconds,
  bandsFromZones,
  emptyZoneSeconds,
  zoneTotal,
  type BandKey,
  type ZoneSeconds,
} from "@/lib/intensity";

export type ZoneSource = "lab" | "garmin";

/** En uppmätt zonuppsättning (hr_zone_sets). Undre gräns per zon; zon 1 är
 * allt under z2Low. */
export type LabZoneSet = {
  id: string;
  label: string;
  /** YYYY-MM-DD */
  validFrom: string;
  source: string;
  z2Low: number;
  z3Low: number;
  z4Low: number;
  z5Low: number;
  maxHr: number | null;
};

export const LAB_ZONE_SET_COLUMNS =
  "id, label, valid_from, source, z2_low, z3_low, z4_low, z5_low, max_hr";

type LabZoneSetRow = {
  id: string;
  label: string;
  valid_from: string;
  source: string;
  z2_low: number;
  z3_low: number;
  z4_low: number;
  z5_low: number;
  max_hr: number | null;
};

export function toLabZoneSet(row: LabZoneSetRow): LabZoneSet {
  return {
    id: row.id,
    label: row.label,
    validFrom: row.valid_from,
    source: row.source,
    z2Low: row.z2_low,
    z3Low: row.z3_low,
    z4Low: row.z4_low,
    z5Low: row.z5_low,
    maxHr: row.max_hr,
  };
}

/** Den senaste uppmätta uppsättningen, eller null. Null betyder att sidan
 * ska visa klockans siffror som förut — det finns inget att jämföra mot. */
export async function loadLatestLabZoneSet(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<LabZoneSet | null> {
  const { data } = await supabase
    .from("hr_zone_sets")
    .select(LAB_ZONE_SET_COLUMNS)
    .eq("user_id", userId)
    .order("valid_from", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ? toLabZoneSet(data as LabZoneSetRow) : null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

/** "29 sep 2026" */
export function formatZoneSetDate(isoDate: string): string {
  const [y, m, d] = isoDate.split("-").map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Kort namn på källan, samma ord överallt: "Laktattest 29 sep 2026". */
export function labSourceName(set: LabZoneSet): string {
  const kind = set.source === "test_lactate" ? "Laktattest" : set.source === "test_field" ? "Fälttest" : "Manuella zoner";
  return `${kind} ${formatZoneSetDate(set.validFrom)}`;
}

/** Pulsintervall per zon, som text: ["under 160", "160–183", …]. */
export function labZoneRanges(set: LabZoneSet): string[] {
  const top = set.maxHr != null ? `${set.z5Low}–${set.maxHr}` : `${set.z5Low}+`;
  return [
    `under ${set.z2Low}`,
    `${set.z2Low}–${set.z3Low}`,
    `${set.z3Low}–${set.z4Low}`,
    `${set.z4Low}–${set.z5Low}`,
    top,
  ];
}

/** Samma sak för klockans gränser. Zon 1 börjar vid bounds[0]; allt under
 * räknar klockan inte alls. */
export function garminZoneRanges(bounds: number[]): string[] {
  return bounds.map((low, i) => (i < 4 ? `${low}–${bounds[i + 1]}` : `${low}+`));
}

/** Klockans zontid för ett pass. */
export function garminZones(s: TrainingSession): ZoneSeconds {
  return [s.hrZone1Seconds, s.hrZone2Seconds, s.hrZone3Seconds, s.hrZone4Seconds, s.hrZone5Seconds];
}

/** Klockans gränser som oftast förekommer bland passen — de glider en
 * slag hit eller dit när klockan räknar om maxpulsen, och det är den
 * typiska indelningen som ska redovisas, inte ett enskilt pass. */
export function typicalGarminBounds(sessions: TrainingSession[]): number[] | null {
  const counts = new Map<string, { bounds: number[]; n: number }>();
  for (const s of sessions) {
    if (!s.garminZoneBounds || s.garminZoneBounds.length !== 5) continue;
    const key = s.garminZoneBounds.join(",");
    const entry = counts.get(key) ?? { bounds: s.garminZoneBounds, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  let best: { bounds: number[]; n: number } | null = null;
  for (const e of counts.values()) if (!best || e.n > best.n) best = e;
  return best?.bounds ?? null;
}

export type ZoneSourceTotals = {
  garmin: ZoneSeconds;
  /** Null när inget pass i urvalet har uppmätt zontid. */
  lab: ZoneSeconds | null;
  sessionsWithGarmin: number;
  sessionsWithLab: number;
};

/** Summerar båda källorna över ett urval pass. Labbsiffran bygger bara på
 * pass som har den; täckningen redovisas så att ett halvt underlag inte
 * ser ut som ett helt. */
export function sumZoneSources(sessions: TrainingSession[]): ZoneSourceTotals {
  const garmin = emptyZoneSeconds();
  const lab = emptyZoneSeconds();
  let sessionsWithGarmin = 0;
  let sessionsWithLab = 0;
  for (const s of sessions) {
    if (s.hrZoneTotalSeconds > 0) {
      sessionsWithGarmin += 1;
      addZoneSeconds(garmin, garminZones(s));
    }
    if (s.labZoneSeconds && zoneTotal(s.labZoneSeconds) > 0) {
      sessionsWithLab += 1;
      addZoneSeconds(lab, s.labZoneSeconds);
    }
  }
  return { garmin, lab: sessionsWithLab > 0 ? lab : null, sessionsWithGarmin, sessionsWithLab };
}

/** Andel per band (lugnt/mitten/tröskel och över), 0–1. Null utan tid. */
export function bandShares(zones: ZoneSeconds | null): Record<BandKey, number> | null {
  if (!zones) return null;
  const total = zoneTotal(zones);
  if (total <= 0) return null;
  const b = bandsFromZones(zones);
  return { easy: b.easy / total, middle: b.middle / total, threshold: b.threshold / total };
}

/** Zonen där tyngdpunkten låg, och hur stor andel av tiden. */
export function dominantZone(zones: ZoneSeconds | null): { index: number; share: number } | null {
  if (!zones) return null;
  const total = zoneTotal(zones);
  if (total <= 0) return null;
  let index = 0;
  for (let i = 1; i < 5; i++) if (zones[i] > zones[index]) index = i;
  return { index, share: zones[index] / total };
}
