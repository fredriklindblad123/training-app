/* ---------------------------------------------------------------------------
 * Distansdelen av ett kvalitetspass (2026-11-14).
 *
 * Ett pass har en kategori, och hela passet räknades i den: Alice tröskelpass
 * 2026-11-12 gav 10,4 km tröskel, fast 3,2 km var uppvärmning och 2 km
 * nerjogg. Tränarens regel: inga trösklar går långsammare än 4:25/km — det
 * som går långsammare i passets kanter är distans.
 *
 * Bara Alice (Fredriks val). Gränsen är hennes tröskelfart; andra löpare har
 * andra farter, och en lånad gräns är den vanligaste felkällan här.
 *
 * Bara KANTERNA räknas som distans: långsamma varv före passets första snabba
 * varv (uppvärmning) och efter dess sista (nerjogg). Allt däremellan — rep och
 * vilor — är tröskel. Att i stället pröva varje varv fäller inomhuspassen:
 * GPS:en mäter 400 m som 304 m, så "Tröskel 15x400m" (2026-01-08) har alla
 * rep i 4:45–4:54/km på pappret. Har passet inget varv under gränsen delas
 * det inte alls.
 *
 * Uppvärmning eller nerjogg som sparats som egen aktivitet i passet räknas
 * som distans när den går långsammare än gränsen.
 *
 * Antalet pass påverkas inte — passet ÄR ett tröskelpass. Det här gäller bara
 * hur tid och distans fördelas per passtyp.
 * ------------------------------------------------------------------------ */

import type { TrainingSession } from "@/lib/sessions";
import type { createClient } from "@/lib/supabase/server";

/** Långsammaste tröskelfart i sekunder per km, per löpare. */
export const THRESHOLD_FLOOR_PACE: Record<string, number> = {
  // Alice: 4:25/km.
  "7db90b90-adc9-45c6-bc33-6f28b4939c2a": 265,
};

export const SPLIT_CATEGORIES = new Set(["threshold", "interval"]);

export type SplitLap = {
  activity_id: string;
  split_index: number;
  split_type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
};

/** Distansdelen av ett pass: meter och sekunder (varvens egen tid). */
export type EasyPart = { meters: number; seconds: number };

const pace = (m: number | null, s: number | null) =>
  m != null && s != null && m > 0 && s > 0 ? s / (m / 1000) : null;

/** Index för passets första och sista varv i tröskelfart, eller null när
 * inget varv går under gränsen (då delas passet inte). Varven ska ligga i
 * tidsordning. Delad med dagvyns varvtabell, så att den och summeringarna
 * delar passet på samma ställe. */
export function qualityRange(
  rows: { isRest: boolean; meters: number | null; seconds: number | null }[],
  floor: number,
): { first: number; last: number } | null {
  const fast = (r: (typeof rows)[number]) => {
    const p = pace(r.meters, r.seconds);
    return !r.isRest && p != null && p <= floor;
  };
  const first = rows.findIndex(fast);
  if (first === -1) return null;
  let last = first;
  rows.forEach((r, i) => {
    if (fast(r)) last = i;
  });
  return { first, last };
}

/** Kanterna av en aktivitets varv som är långsammare än gränsen. */
export function edgeLaps(laps: SplitLap[], floor: number): EasyPart {
  const sorted = [...laps].sort((a, b) => a.split_index - b.split_index);
  const range = qualityRange(
    sorted.map((l) => ({
      isRest: l.split_type !== "active",
      meters: l.distance_meters,
      seconds: l.duration_seconds,
    })),
    floor,
  );
  if (!range) return { meters: 0, seconds: 0 };
  const { first, last } = range;
  const out = { meters: 0, seconds: 0 };
  sorted.forEach((l, i) => {
    if (i >= first && i <= last) return;
    out.meters += l.distance_meters ?? 0;
    out.seconds += l.duration_seconds ?? 0;
  });
  return out;
}

export function easyPartOfSession(
  s: TrainingSession,
  lapsByActivity: Map<string, SplitLap[]>,
  floor: number,
): EasyPart {
  const out = { meters: 0, seconds: 0 };
  if (!SPLIT_CATEGORIES.has(s.category)) return out;
  for (const f of s.activities) {
    if (f.id === s.dominantActivity.id) {
      const laps = lapsByActivity.get(f.id);
      if (laps && laps.length > 0) {
        const e = edgeLaps(laps, floor);
        out.meters += e.meters;
        out.seconds += e.seconds;
      }
      continue;
    }
    // Egen aktivitet för uppvärmning eller nerjogg.
    const p = pace(f.distance_meters, f.duration_seconds);
    if (p != null && p > floor) {
      out.meters += f.distance_meters ?? 0;
      out.seconds += f.duration_seconds ?? 0;
    }
  }
  return out;
}

type Supabase = Awaited<ReturnType<typeof createClient>>;

/** Distansdelen per pass (nyckel: dominerande aktivitetens id) för en
 * löpare med gräns. Tom karta för alla andra — då fördelas allt som förut. */
export async function fetchEasyParts(
  supabase: Supabase,
  userId: string,
  sessions: TrainingSession[],
): Promise<Map<string, EasyPart>> {
  const out = new Map<string, EasyPart>();
  const floor = THRESHOLD_FLOOR_PACE[userId];
  if (floor == null) return out;
  const quality = sessions.filter((s) => SPLIT_CATEGORIES.has(s.category));
  const ids = quality.map((s) => s.dominantActivity.id);
  const lapsByActivity = new Map<string, SplitLap[]>();
  for (let i = 0; i < ids.length; i += 30) {
    const { data } = await supabase
      .from("activity_splits")
      .select("activity_id, split_index, split_type, distance_meters, duration_seconds")
      .in("activity_id", ids.slice(i, i + 30));
    for (const l of (data ?? []) as SplitLap[]) {
      lapsByActivity.set(l.activity_id, [...(lapsByActivity.get(l.activity_id) ?? []), l]);
    }
  }
  for (const s of quality) {
    const e = easyPartOfSession(s, lapsByActivity, floor);
    if (e.meters > 0 || e.seconds > 0) out.set(s.dominantActivity.id, e);
  }
  return out;
}

/** Ett pass delat för visning: kvalitetsdelen under passets kategori och
 * uppvärmning/nerjogg under distans. Utan distansdel ett enda element, så
 * att andra pass visas som förut. */
export type SessionPart = { category: string; meters: number; seconds: number };

export function sessionParts(
  category: string,
  meters: number,
  seconds: number,
  easy: EasyPart | null | undefined,
): SessionPart[] {
  if (!easy || (easy.meters <= 0 && easy.seconds <= 0)) return [{ category, meters, seconds }];
  return [
    { category, meters: Math.max(0, meters - easy.meters), seconds: Math.max(0, seconds - easy.seconds) },
    { category: "easy", meters: easy.meters, seconds: easy.seconds },
  ];
}

/** Distansdelen per pass för en dags aktiviteter med varv redan hämtade
 * (dagvyn) — samma regel som fetchEasyParts, utan extra fråga. */
export function easyPartsFromLaps(
  userId: string,
  sessions: TrainingSession[],
  lapsByActivity: Map<string, SplitLap[]>,
): Map<string, EasyPart> {
  const out = new Map<string, EasyPart>();
  const floor = THRESHOLD_FLOOR_PACE[userId];
  if (floor == null) return out;
  for (const s of sessions) {
    const e = easyPartOfSession(s, lapsByActivity, floor);
    if (e.meters > 0 || e.seconds > 0) out.set(s.dominantActivity.id, e);
  }
  return out;
}
