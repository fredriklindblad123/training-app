import type { createClient } from "@/lib/supabase/server";

/* "Samma pass igen" — ersättaren för formkurvan (2026-11-20, omgjord
 * 2026-11-21).
 *
 * VARFÖR INGEN FORMKURVA. Dataverifieringen 2026-11-20 underkände "tröskelfart
 * vid samma puls": pulsen ligger fast vid målnivån, replängden styr farten,
 * och skillnaden mellan perioder var mindre än bruset mellan pass. I stället
 * visas samma pass bredvid varandra — fart och slutpuls, del för del, utan
 * linje, pil eller påstående om form.
 *
 * VAD SOM RÄKNAS SOM "SAMMA PASS" (2026-11-21). Först parades passen på
 * namnet. Det missade Alices 10x30s + 3x3 + 2x2 + 2x1 min den 21/11 2026,
 * som hon körde exakt likadant 8/11 2025 men döpt annorlunda. Nu paras passen
 * på upplägget som klockan faktiskt mätte: arbetsvarvens antal och längd,
 * t.ex. "10×30 s + 3×3 min + 2×2 min + 2×1 min". Namnet spelar ingen roll.
 *
 * VILKA PASS SOM FÅR VARA MED.
 *   - Utomhus (activity_type "running").
 *   - Löpband bara när farten är rättad efter löparens kommentar
 *     (_apply_treadmill_pace_notes i api/index.py) — annars mäter klockan
 *     farten med armrörelsen och den blir fel (4:27–5:35 i stället för
 *     3:10–3:05 på 30-sekundersrepen 21/11).
 *   - Inomhusbana aldrig: GPS:en mäter 400 m som 304–325 m.
 * Ett löpbandspass märks ut bredvid datumet — fart och puls på band och ute
 * är inte helt jämförbara, och det ska den som läser veta. */

type Lap = {
  activity_id: string;
  split_index: number;
  split_type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  hr_end: number | null;
};

type Act = {
  id: string;
  name: string | null;
  start_time: string;
  activity_type: string | null;
  description: string | null;
  category: string | null;
};

/** Passets namn som jämförbar nyckel ("Tröskel 5x5min/ 90sek vila" =
 * "Tröskel 5x5min/90sek vila"), eller null om namnet inte beskriver ett
 * upplägg ("Göteborg Löpning"). */
export function nameKey(name: string | null | undefined): string | null {
  if (!name) return null;
  const n = name.toLowerCase().replace(/×/g, "x");
  if (!/\d+\s*x\s*\d/.test(n)) return null;
  return n
    .replace(/tröskel|lätt/g, "")
    .replace(/sek|sec|sel/g, "s")
    .replace(/mim/g, "min")
    .replace(/joggvila|gåvila/g, "vila")
    .replace(/[\s,.]+/g, "");
}

/** Samma tolkning av fartkommentaren som synken gör (api/index.py). Här
 * räcker det att veta OM kommentaren innehåller farter. */
const PACE_NOTE = /(\d+)\s*(sek|s\b|sekund|min|minut)\w*\s*[:=]?\s*(\d{1,2})[.:,](\d{2})/i;

function usable(a: Act): boolean {
  if (a.activity_type === "running") return true;
  if (a.activity_type === "treadmill_running") return PACE_NOTE.test(a.description ?? "");
  return false;
}

/** Arbetsvarvets längd avrundad till ett "rep" som en tränare skriver det:
 * under 75 s till närmaste 15 s, annars till närmaste 30 s. */
function bucket(seconds: number): number {
  return seconds < 75 ? Math.round(seconds / 15) * 15 : Math.round(seconds / 30) * 30;
}

function label(sec: number): string {
  if (sec < 60) return `${sec} s`;
  const m = sec / 60;
  return Number.isInteger(m) ? `${m} min` : `${m.toLocaleString("sv-SE")} min`;
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type SamePart = { label: string; reps: number; pace: number; endHr: number | null };
export type SameTime = {
  activityId: string;
  date: string;
  treadmill: boolean;
  parts: SamePart[];
  /** Passets eget namn i Garmin, t.ex. "10x30sek/30sek vila + 3x3min …". */
  title: string | null;
  category: string | null;
};
export type SameSessionGroup = { key: string; name: string; times: SameTime[] };

/** Ett pass delat i arbetsvarv per replängd, i den ordning delarna kom. */
function partsOf(laps: Lap[]): { key: string; parts: SamePart[] } | null {
  // Ett kvalitetspass har vila mellan repen. Utan vilovarv är det ett
  // distanspass med automatiska varv (fel kategori i databasen) — 9/11 2026
  // hamnade annars som "8×5 min" i 4:55/km.
  if (laps.filter((l) => l.split_type === "rest").length < 2) return null;
  const work = laps.filter(
    (l) =>
      l.split_type === "active" &&
      (l.duration_seconds ?? 0) >= 25 &&
      (l.distance_meters ?? 0) > 0 &&
      // Joggvila som råkat bli ett aktivt varv: långsammare än 6:00/km.
      (l.duration_seconds as number) / ((l.distance_meters as number) / 1000) < 360,
  );
  if (work.length < 3) return null;
  const order: number[] = [];
  const byLen = new Map<number, Lap[]>();
  for (const l of work) {
    const b = bucket(l.duration_seconds as number);
    if (!byLen.has(b)) order.push(b);
    byLen.set(b, [...(byLen.get(b) ?? []), l]);
  }
  const parts = order.map((b) => {
    const ls = byLen.get(b) as Lap[];
    const hrs = ls.map((l) => l.hr_end).filter((h): h is number => h != null).map(Number);
    return {
      label: label(b),
      reps: ls.length,
      pace: median(ls.map((l) => (l.duration_seconds as number) / ((l.distance_meters as number) / 1000))),
      endHr: hrs.length ? median(hrs) : null,
    };
  });
  return { key: parts.map((p) => `${p.reps}×${p.label}`).join(" + "), parts };
}

export async function fetchSameSessions(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  todayKey: string,
  { recentDays = 120, maxGroups = 4, maxTimes = 3 }: { recentDays?: number; maxGroups?: number; maxTimes?: number } = {},
): Promise<SameSessionGroup[]> {
  const since = new Date(Date.parse(`${todayKey}T12:00:00Z`) - 540 * 86_400_000).toISOString().slice(0, 10);
  const { data: actRows } = await supabase
    .from("activities")
    .select("id, name, start_time, activity_type, category, description:raw_data->>description")
    .eq("user_id", userId)
    .in("category", ["threshold", "interval", "threshold_test"])
    .gte("start_time", since)
    .order("start_time", { ascending: false })
    .limit(300);
  const acts = ((actRows ?? []) as Act[]).filter(usable);
  if (acts.length < 2) return [];

  // Varven för alla kandidater. PostgREST ger högst 1 000 rader per svar,
  // så frågan pagineras — ett tröskelpass har 15–35 varv.
  const laps: Lap[] = [];
  const ids = acts.map((a) => a.id);
  for (let i = 0; i < ids.length; i += 60) {
    const chunk = ids.slice(i, i + 60);
    for (let from = 0; ; from += 1000) {
      const { data } = await supabase
        .from("activity_splits")
        .select("activity_id, split_index, split_type, distance_meters, duration_seconds, hr_end")
        .in("activity_id", chunk)
        .order("activity_id")
        .order("split_index")
        .range(from, from + 999);
      const rows = (data ?? []) as Lap[];
      laps.push(...rows);
      if (rows.length < 1000) break;
    }
  }
  const lapsBy = new Map<string, Lap[]>();
  for (const l of laps) lapsBy.set(l.activity_id, [...(lapsBy.get(l.activity_id) ?? []), l]);

  /* Gruppering: samma upplägg ELLER samma namn. Upplägget fångar pass som
     döpts olika (10x30s + 3x3 + 2x2 + 2x1 min 2025 och 2026); namnet fångar
     pass där klockan räknat ett rep för lite (12x2min 7/11 och 28/3). */
  const times: (SameTime & { structKey: string; nameK: string | null })[] = [];
  for (const a of acts) {
    const p = partsOf((lapsBy.get(a.id) ?? []).sort((x, y) => x.split_index - y.split_index));
    if (!p) continue;
    times.push({
      activityId: a.id,
      date: a.start_time.slice(0, 10),
      treadmill: a.activity_type === "treadmill_running",
      parts: p.parts,
      title: a.name?.trim() || null,
      category: a.category,
      structKey: p.key,
      nameK: nameKey(a.name),
    });
  }
  const parent = times.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const firstBy = new Map<string, number>();
  times.forEach((t, i) => {
    for (const k of [`s:${t.structKey}`, t.nameK ? `n:${t.nameK}` : null]) {
      if (!k) continue;
      const j = firstBy.get(k);
      if (j == null) firstBy.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<string, SameTime[]>();
  times.forEach((t, i) => {
    const root = String(find(i));
    groups.set(root, [...(groups.get(root) ?? []), t]);
  });

  const recentFrom = new Date(Date.parse(`${todayKey}T12:00:00Z`) - recentDays * 86_400_000).toISOString().slice(0, 10);
  return [...groups.entries()]
    .filter(([, times]) => times.length >= 2 && times[0].date >= recentFrom)
    .sort((a, b) => b[1][0].date.localeCompare(a[1][0].date))
    .slice(0, maxGroups)
    .map(([key, ts]) => ({ key, name: (ts[0] as SameTime & { structKey: string }).structKey, times: ts.slice(0, maxTimes) }));
}
