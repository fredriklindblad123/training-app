import type { createClient } from "@/lib/supabase/server";

/* "Samma pass igen" (2026-11-21) — ersättaren för formkurvan.
 *
 * VARFÖR INGEN FORMKURVA. Dataverifieringen 2026-11-20 underkände "tröskelfart
 * vid samma puls" mot Alices data: pulsen ligger fast vid målnivån (fart mot
 * slutpuls r = 0,09), replängden styr farten (34–42 % av variationen), och
 * skillnaden mellan perioder var mindre än bruset mellan pass. Ett upprepat
 * pass, 15x90sek/45sek, gick 3:43, 3:42 och 3:43/km på ett år medan loppen
 * varierade mellan 4:41 och 4:56. Ett trendtal hade alltså påstått något
 * datan inte bär.
 *
 * VAD DET HÄR ÄR I STÄLLET. Samma pass, med samma namn, bredvid varandra:
 * medianfart och median slutpuls för repen, varje gång det körts. Ingen linje,
 * ingen pil, inget påstående om form. Tränaren ser själv om fart och puls
 * ändrats tillsammans (vald intensitet) eller bara farten.
 *
 * URVALET är exakt det som prövades, och ska inte ändras utan ny prövning:
 *   - bara utomhus (activity_type "running"): inomhus mäter GPS:en 400 m som
 *     304–325 m, och repen faller bort eller blir fel;
 *   - aktiva varv på minst 400 m och 60 s, i 3:30–4:25/km (210–265 s/km) —
 *     4:25 är Alices tröskelgolv (THRESHOLD_FLOOR_PACE i quality-split.ts),
 *     3:30 skiljer bort intervallrepen i blandade pass;
 *   - första repet räknas inte (pulsen har inte hunnit upp);
 *   - minst 3 godkända rep, annars visas inte den gången.
 * Golvet är satt för Alice. Det är inte prövat för någon annan löpare. */

export const SAME_MIN_REPS = 3;
const MIN_REP_METERS = 400;
const MIN_REP_SECONDS = 60;
const FASTEST = 210;
const SLOWEST = 265;

/** Passets namn till en jämförbar nyckel, eller null om namnet inte beskriver
 * ett upplägg ("Göteborg Löpning", "Distans"). "Tröskel 5x5min/ 90sek vila"
 * och "Tröskel 5x5min/90sek vila" blir samma nyckel. */
export function sessionKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/×/g, "x");
  if (!/\d+\s*x\s*\d/.test(n)) return null;
  return n
    .replace(/tröskel|lätt/g, "")
    .replace(/\bsek\b|sek|sec|sel/g, "s")
    .replace(/mim/g, "min")
    .replace(/joggvila|gåvila/g, "vila")
    .replace(/[\s,.]+/g, "");
}

/** Visningsnamn för en nyckel: passets eget namn utan "Tröskel" först. */
export function displayName(name: string): string {
  return name.replace(/^\s*(lätt\s+)?tröskel\s+/i, "").trim();
}

type Lap = {
  activity_id: string;
  split_index: number;
  split_type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  hr_end: number | null;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type SameSessionTime = {
  activityId: string;
  date: string;
  reps: number;
  /** Sekunder per km. */
  pace: number;
  /** Slag/min, null när pulskurvan saknas. */
  endHr: number | null;
};

export type SameSessionGroup = { key: string; name: string; times: SameSessionTime[] };

/** Repen ur ett pass enligt urvalet ovan. */
export function qualifyingReps(laps: Lap[]): { pace: number; endHr: number | null }[] {
  const reps = laps
    .filter((l) => l.split_type === "active" || l.split_type == null)
    .filter((l) => (l.distance_meters ?? 0) >= MIN_REP_METERS && (l.duration_seconds ?? 0) >= MIN_REP_SECONDS)
    .map((l) => ({ pace: (l.duration_seconds as number) / ((l.distance_meters as number) / 1000), endHr: l.hr_end }))
    .filter((r) => r.pace >= FASTEST && r.pace <= SLOWEST);
  return reps.slice(1);
}

/** Pass som körts minst två gånger med samma upplägg, senaste först. Bara
 * grupper där det senaste passet ligger inom `recentDays` visas — en
 * jämförelse ska handla om något som är aktuellt. */
export async function fetchSameSessions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  todayKey: string,
  { recentDays = 120, maxGroups = 3 }: { recentDays?: number; maxGroups?: number } = {},
): Promise<SameSessionGroup[]> {
  const { data: acts } = await supabase
    .from("activities")
    .select("id, name, start_time")
    .eq("user_id", userId)
    .eq("activity_type", "running")
    .in("category", ["threshold", "interval", "threshold_test"])
    .order("start_time", { ascending: false })
    .limit(400);
  const rows = (acts ?? []) as { id: string; name: string | null; start_time: string }[];

  const byKey = new Map<string, { name: string; acts: { id: string; date: string }[] }>();
  for (const a of rows) {
    const key = sessionKey(a.name);
    if (!key) continue;
    const g = byKey.get(key) ?? { name: displayName(a.name as string), acts: [] };
    g.acts.push({ id: a.id, date: a.start_time.slice(0, 10) });
    byKey.set(key, g);
  }
  const recentFrom = new Date(Date.parse(`${todayKey}T12:00:00Z`) - recentDays * 86_400_000).toISOString().slice(0, 10);
  const candidates = [...byKey.entries()].filter(([, g]) => g.acts.length >= 2 && g.acts[0].date >= recentFrom);
  if (candidates.length === 0) return [];

  const ids = candidates.flatMap(([, g]) => g.acts.map((a) => a.id));
  const { data: lapRows } = await supabase
    .from("activity_splits")
    .select("activity_id, split_index, split_type, distance_meters, duration_seconds, hr_end")
    .in("activity_id", ids)
    .order("activity_id")
    .order("split_index");
  const lapsBy = new Map<string, Lap[]>();
  for (const l of (lapRows ?? []) as Lap[]) {
    const list = lapsBy.get(l.activity_id);
    if (list) list.push(l);
    else lapsBy.set(l.activity_id, [l]);
  }

  const groups: SameSessionGroup[] = [];
  for (const [key, g] of candidates) {
    const times: SameSessionTime[] = [];
    for (const a of g.acts) {
      const reps = qualifyingReps(lapsBy.get(a.id) ?? []);
      if (reps.length < SAME_MIN_REPS) continue;
      const hrs = reps.map((r) => r.endHr).filter((h): h is number => h != null);
      times.push({
        activityId: a.id,
        date: a.date,
        reps: reps.length,
        pace: median(reps.map((r) => r.pace)),
        endHr: hrs.length >= SAME_MIN_REPS ? median(hrs) : null,
      });
    }
    if (times.length >= 2 && times[0].date >= recentFrom) groups.push({ key, name: g.name, times });
  }
  return groups.sort((a, b) => b.times[0].date.localeCompare(a.times[0].date)).slice(0, maxGroups);
}
