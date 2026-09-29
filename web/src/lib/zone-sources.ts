// Två källor till samma fråga: hur lång tid i varje pulszon?
//
//   klockan  Garmins hrTimeInZone_1..5, räknade mot klockans egna gränser.
//   labbet   Samma pulskurva räknad mot uppmätta zoner (hr_zone_sets), av
//            compute_lab_zones i databasen. Se
//            supabase/migrations/20260929140000_lab_hr_zones.sql.
//
// Har löparen en uppmätt zonuppsättning ersätter labbet klockan helt, även
// bakåt i tiden: pass före testet räknas mot det första testet. Klockans
// gränser låg för Alice långt under hennes trösklar (zon 4 från 165, LT1
// 183), så dess siffror visas inte alls då (beslut 2026-09-29). Kolumnerna
// hr_zone_* ligger kvar i databasen: de är det enda som finns för löpare
// utan uppmätt zonuppsättning, och för dem visas de som förut.
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
  /** Testets trösklar. Bara laktattest har dem, och LT2 är inte alltid en
   * zongräns (Aktivitus: LT2 197, Z4 från 193) — därför egna fält. */
  lt1Hr: number | null;
  lt2Hr: number | null;
  lt1SpeedKmh: number | null;
  lt2SpeedKmh: number | null;
};

export const LAB_ZONE_SET_COLUMNS =
  "id, label, valid_from, source, z2_low, z3_low, z4_low, z5_low, max_hr, lt1_hr, lt2_hr, lt1_speed_kmh, lt2_speed_kmh";

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
  lt1_hr: number | null;
  lt2_hr: number | null;
  lt1_speed_kmh: number | string | null;
  lt2_speed_kmh: number | string | null;
};

/** numeric kommer som sträng från PostgREST. */
function num(v: number | string | null): number | null {
  return v == null ? null : Number(v);
}

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
    lt1Hr: row.lt1_hr,
    lt2Hr: row.lt2_hr,
    lt1SpeedKmh: num(row.lt1_speed_kmh),
    lt2SpeedKmh: num(row.lt2_speed_kmh),
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

/** Ett stick i ett stegtest (lactate_test_steps). Vilovärdet före första
 * steget har ingen fart, puls eller Borg. */
export type LactateTestStep = {
  /** Sekunder från teststart när sticket togs — i slutet av steget. */
  offsetSeconds: number;
  /** Farten på steget som just avslutats. */
  speedKmh: number | null;
  heartRate: number | null;
  lactateMmol: number | null;
  rpe: number | null;
};

type LactateTestStepRow = {
  offset_seconds: number;
  speed_kmh: number | string | null;
  heart_rate: number | null;
  lactate_mmol: number | string | null;
  rpe: number | null;
};

/** Stegen i ett test, i tidsordning. Tom lista för uppsättningar utan
 * stegdata (manuella zoner, eller ett test som bara matats in som zoner). */
export async function loadLactateTestSteps(
  supabase: Awaited<ReturnType<typeof createClient>>,
  zoneSetId: string,
): Promise<LactateTestStep[]> {
  const { data } = await supabase
    .from("lactate_test_steps")
    .select("offset_seconds, speed_kmh, heart_rate, lactate_mmol, rpe")
    .eq("zone_set_id", zoneSetId)
    .order("offset_seconds");
  return ((data ?? []) as LactateTestStepRow[]).map((r) => ({
    offsetSeconds: r.offset_seconds,
    speedKmh: num(r.speed_kmh),
    heartRate: r.heart_rate,
    lactateMmol: num(r.lactate_mmol),
    rpe: r.rpe,
  }));
}

/** Sekunder → "4:00". Avrundar till hel sekund först, så att 276,9 blir
 * 4:37 och inte 4:60. */
export function mmss(seconds: number): string {
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** km/h → "4:37/km". */
export function paceFromKmh(kmh: number): string {
  return `${mmss(3600 / kmh)}/km`;
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

/** Klockans zontid för ett pass. */
export function garminZones(s: TrainingSession): ZoneSeconds {
  return [s.hrZone1Seconds, s.hrZone2Seconds, s.hrZone3Seconds, s.hrZone4Seconds, s.hrZone5Seconds];
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
