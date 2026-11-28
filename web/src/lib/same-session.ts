import type { createClient } from "@/lib/supabase/server";
import { toneOf, type Tone } from "@/lib/diary-themes";

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

/** Samma tolkning av fartkommentaren som synken gör (api/index.py,
 * REP_LENGTH och PACE_VALUE): en rad med både en replängd och en fart, i
 * vilken ordning som helst ("3min: 3.40" och "4.02 på 8minutraren", 2026-11-27).
 * Här räcker det att veta OM kommentaren innehåller farter. */
const REP_LENGTH = /(\d+)\s*(sek|s\b|sekund|min|minut)/i;
const PACE_VALUE = /(?<![\d.,:])(\d{1,2})[.:,](\d{2})(?!\d)/;

function hasPaceNote(description: string | null): boolean {
  return (description ?? "").split(/[\n;]+/).some((line) => REP_LENGTH.test(line) && PACE_VALUE.test(line));
}

function usable(a: Act): boolean {
  if (a.activity_type === "running") return true;
  if (a.activity_type === "treadmill_running") return hasPaceNote(a.description);
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
  /** Känslan i dagboken den dagen, ur hennes egen färgmarkering — null när
   * dagen saknar anteckning. Självskattat. */
  feel: { tone: Tone | null; good: string | null; bad: string | null } | null;
};
export type SameSessionGroup = { key: string; name: string; times: SameTime[] };

/* Ett ENSAMT långt uppvärmnings- eller nerjoggsvarv (2026-11-28). Samma
 * regel som merged_splits i databasen (migration
 * 20261128120000_merged_splits_edge_laps): passets första eller sista varv
 * är uppvärmning/nerjogg och inget rep när det är minst 800 m och minst 1,15
 * gånger långsammare än medianen av de övriga arbetsvarven. 31/10 blev
 * annars "4x4 min" sex rep — uppvärmningen på 3,1 km i 5:07/km gick under
 * 6:00-gränsen nedan. Mätt mot passnamnen: 17 pass fick rätt antal rep,
 * inget blev fel. */
export function withoutEdgeLaps<L extends { split_index: number; distance_meters: number | null; duration_seconds: number | null }>(
  work: L[],
  allLaps: { split_index: number }[],
): L[] {
  if (work.length < 3 || allLaps.length === 0) return work;
  const first = Math.min(...allLaps.map((l) => l.split_index));
  const last = Math.max(...allLaps.map((l) => l.split_index));
  const pace = (l: L) => (l.duration_seconds as number) / ((l.distance_meters as number) / 1000);
  const inner = work.filter((l) => l.split_index !== first && l.split_index !== last).map(pace);
  if (inner.length === 0) return work;
  const med = median(inner);
  return work.filter(
    (l) => !((l.split_index === first || l.split_index === last) && (l.distance_meters ?? 0) >= 800 && pace(l) >= med * 1.15),
  );
}

/** Ett pass delat i arbetsvarv per replängd, i den ordning delarna kom. */
function partsOf(laps: Lap[]): { key: string; parts: SamePart[] } | null {
  // Ett kvalitetspass har vila mellan repen. Utan vilovarv är det ett
  // distanspass med automatiska varv (fel kategori i databasen) — 9/11 2026
  // hamnade annars som "8×5 min" i 4:55/km.
  if (laps.filter((l) => l.split_type === "rest").length < 2) return null;
  const work = withoutEdgeLaps(
    laps.filter(
      (l) =>
        l.split_type === "active" &&
        (l.duration_seconds ?? 0) >= 25 &&
        (l.distance_meters ?? 0) > 0 &&
        // Joggvila som råkat bli ett aktivt varv: långsammare än 6:00/km.
        (l.duration_seconds as number) / ((l.distance_meters as number) / 1000) < 360,
    ),
    laps,
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
  {
    from,
    to = todayKey,
    maxGroups = 8,
    maxTimes = 3,
  }: {
    /** Perioden jämförelserna gäller: pass vars senaste gång ligger i
     * [from, to] visas, mot gångerna före. Följer periodvalet på Form. */
    from: string;
    to?: string;
    maxGroups?: number;
    maxTimes?: number;
  },
): Promise<SameSessionGroup[]> {
  const since = new Date(Date.parse(`${from}T12:00:00Z`) - 540 * 86_400_000).toISOString().slice(0, 10);
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
      feel: null,
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

  const picked = [...groups.entries()]
    .map(([key, ts]) => [key, ts.filter((t) => t.date <= to)] as const)
    .filter(([, ts]) => ts.length >= 2 && ts[0].date >= from)
    .sort((a2, b2) => b2[1][0].date.localeCompare(a2[1][0].date))
    .slice(0, maxGroups)
    .map(([key, ts]) => ({ key, name: (ts[0] as SameTime & { structKey: string }).structKey, times: ts.slice(0, maxTimes) }));

  // Känslan i dagboken för de visade gångerna (2026-11-21, begärt).
  const dates = [...new Set(picked.flatMap((g) => g.times.map((t) => t.date)))];
  if (dates.length > 0) {
    const { data: diaryRows } = await supabase
      .from("diary_entries")
      .select("entry_date, notes_good_chars, notes_bad_chars, notes_good_text, notes_bad_text")
      .eq("user_id", userId)
      .in("entry_date", dates);
    const byDate = new Map(
      ((diaryRows ?? []) as {
        entry_date: string;
        notes_good_chars: number | null;
        notes_bad_chars: number | null;
        notes_good_text: string | null;
        notes_bad_text: string | null;
      }[]).map((d) => [d.entry_date, d]),
    );
    for (const g of picked)
      for (const t of g.times) {
        const d = byDate.get(t.date);
        if (d && (d.notes_good_text || d.notes_bad_text || (d.notes_good_chars ?? 0) + (d.notes_bad_chars ?? 0) > 0))
          t.feel = {
            tone: toneOf(d.notes_good_chars, d.notes_bad_chars),
            good: d.notes_good_text?.trim() || null,
            bad: d.notes_bad_text?.trim() || null,
          };
      }
  }
  return picked;
}
