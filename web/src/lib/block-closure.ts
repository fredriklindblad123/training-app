import { sessionKm } from "@/lib/block-analysis";
import type { createClient } from "@/lib/supabase/server";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  trainingSeconds,
  type SessionActivity,
} from "@/lib/sessions";
import { addDays, mondayOf, toDateKey } from "@/lib/planning";
import { formatRaceSeconds } from "@/lib/format";

/* Blockbokslut (C5, 2026-11-21).
 *
 * Blocket ställs mot de två senaste blocken av samma fas (Allmän mot Allmän,
 * osv.) i en tabell: träningstid och distans per vecka, längsta vecka,
 * träningsdagar, sjuk- och skadedagar — och vilka lopp som följde efter
 * blocken. Allt är fakta ur klockan, planen och dagboken; inget mått som
 * inte redan finns på andra ställen i appen (CLAUDE.md: verifiera nya mått
 * först). Tiden räknas med trainingSeconds, samma regel som Idag.
 *
 * Ett pågående block räknas fram till idag, och veckosnittet delas med de
 * dagar som gått — inte med blockets hela längd. */

export type ClosureBlock = { id: string; name: string; phase: string; start_date: string; end_date: string };

export type ClosureColumn = {
  block: ClosureBlock;
  ongoing: boolean;
  weeks: number;
  minutesPerWeek: number;
  kmPerWeek: number;
  longestWeek: number;
  trainingDays: number;
  days: number;
  sickDays: number;
  injuredDays: number;
  /** De första loppen (800/1500 m) inom åtta veckor efter blocket. */
  racesAfter: { date: string; event: string; result: string }[];
};

const RACE_EVENTS = ["800m", "1500m"];

function dayCount(from: string, to: string): number {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1;
}

export async function blockClosure(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  blocks: ClosureBlock[],
  current: ClosureBlock,
  today: string,
): Promise<ClosureColumn[]> {
  const earlier = blocks
    .filter((b) => b.phase === current.phase && b.id !== current.id && b.end_date < current.start_date)
    .sort((a, b) => b.start_date.localeCompare(a.start_date))
    .slice(0, 2);
  const cols = [current, ...earlier];
  const from = cols.reduce((m, b) => (b.start_date < m ? b.start_date : m), current.start_date);
  const until = cols.reduce((m, b) => (b.end_date > m ? b.end_date : m), current.end_date);
  const raceUntil = toDateKey(addDays(new Date(`${until}T12:00:00`), 56));

  const [{ data: actRows }, { data: diaryRows }, { data: raceRows }] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", userId)
      .gte("start_time", from)
      .lt("start_time", toDateKey(addDays(new Date(`${until}T12:00:00`), 1)))
      .order("start_time"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type")
      .eq("user_id", userId)
      .gte("entry_date", from)
      .lte("entry_date", until)
      .in("day_type", ["sick", "injured"]),
    supabase
      .from("competition_events")
      .select("event, actual_result, result_seconds, competitions!inner(competition_date, user_id)")
      .eq("competitions.user_id", userId)
      .gte("competitions.competition_date", from)
      .lte("competitions.competition_date", raceUntil)
      .in("event", RACE_EVENTS)
      .not("result_seconds", "is", null),
  ]);

  const sessions = groupActivitiesIntoSessions((actRows ?? []) as unknown as SessionActivity[]);
  const diary = (diaryRows ?? []) as { entry_date: string; day_type: string }[];
  const races = ((raceRows ?? []) as unknown as {
    event: string;
    result_seconds: number | null;
    competitions: { competition_date: string };
  }[])
    .map((r) => ({ date: r.competitions.competition_date, event: r.event, result: formatRaceSeconds(r.result_seconds) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  return cols.map((b) => {
    const ongoing = today >= b.start_date && today <= b.end_date;
    const end = ongoing ? today : b.end_date;
    const days = dayCount(b.start_date, end);
    const inside = sessions.filter((s) => s.date >= b.start_date && s.date <= end);
    const minutes = inside.reduce((sum, s) => sum + trainingSeconds(s), 0) / 60;
    const km = inside.reduce((sum, s) => sum + sessionKm(s), 0);
    const byWeek = new Map<string, number>();
    for (const s of inside) {
      const wk = toDateKey(mondayOf(s.date));
      byWeek.set(wk, (byWeek.get(wk) ?? 0) + trainingSeconds(s) / 60);
    }
    const nextStart = toDateKey(addDays(new Date(`${b.end_date}T12:00:00`), 1));
    const raceEnd = toDateKey(addDays(new Date(`${b.end_date}T12:00:00`), 56));
    return {
      block: b,
      ongoing,
      weeks: days / 7,
      minutesPerWeek: (minutes / days) * 7,
      kmPerWeek: (km / days) * 7,
      longestWeek: Math.max(0, ...byWeek.values()),
      trainingDays: new Set(inside.map((s) => s.date)).size,
      days,
      sickDays: diary.filter((d) => d.day_type === "sick" && d.entry_date >= b.start_date && d.entry_date <= end).length,
      injuredDays: diary.filter((d) => d.day_type === "injured" && d.entry_date >= b.start_date && d.entry_date <= end).length,
      racesAfter: ongoing ? [] : races.filter((r) => r.date >= nextStart && r.date <= raceEnd).slice(0, 3),
    };
  });
}

/** Korta observationer ur tabellen — fakta, aldrig betyg. */
export function closureLines(cols: ClosureColumn[]): string[] {
  const [now, ...rest] = cols;
  if (!now || rest.length === 0) return [];
  const lines: string[] = [];
  const others = rest.map((c) => Math.round(c.minutesPerWeek));
  const nowMin = Math.round(now.minutesPerWeek);
  const max = Math.max(...others);
  const min = Math.min(...others);
  if (nowMin > max) lines.push(`Mest träningstid per vecka av blocken: ${nowMin} min mot ${others.join(" och ")}.`);
  else if (nowMin < min) lines.push(`Minst träningstid per vecka av blocken: ${nowMin} min mot ${others.join(" och ")}.`);
  else lines.push(`Träningstiden per vecka, ${nowMin} min, ligger mellan de tidigare blocken (${others.join(" och ")}).`);
  const kms = rest.map((c) => Math.round(c.kmPerWeek));
  lines.push(`Löpdistansen är ${Math.round(now.kmPerWeek)} km i veckan, mot ${kms.join(" och ")}.`);
  const nowOff = now.sickDays + now.injuredDays;
  if (nowOff > 0 || rest.some((c) => c.sickDays + c.injuredDays > 0)) {
    lines.push(
      `${now.injuredDays > 0 ? `${now.injuredDays} skadedagar` : "Inga skadedagar"} och ${now.sickDays} sjukdagar i dagboken${now.ongoing ? " hittills" : ""}. Tidigare block: ${rest
        .map((c) => `${c.injuredDays} skadade, ${c.sickDays} sjuka`)
        .join("; ")}.`,
    );
  }
  return lines;
}
