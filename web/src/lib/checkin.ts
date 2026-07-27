import type { createClient } from "@/lib/supabase/server";
import { mean } from "@/lib/stats-utils";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

export type CheckInStats = {
  streakDays: number;
  weeklyAvgFeeling: number | null;
};

/** Räknar ut hur många dagar i rad (bakåt från `asOfDate`, inklusive den) som
 * har en ifylld check-in, samt snittkänsla de senaste 7 dagarna före
 * `asOfDate`. Det här är det direkta "något tillbaka"-kvittot som P0.4
 * kräver — belöning driver ifyllnad, se docs/insikter-roadmap.md. */
export async function computeCheckInStats(
  supabase: SupabaseServerClient,
  userId: string,
  asOfDate: string,
): Promise<CheckInStats> {
  const since = new Date(`${asOfDate}T00:00:00Z`);
  since.setUTCDate(since.getUTCDate() - 30);
  const sinceStr = since.toISOString().slice(0, 10);

  const { data: history } = await supabase
    .from("diary_entries")
    .select("entry_date, feeling")
    .eq("user_id", userId)
    .gte("entry_date", sinceStr)
    .lte("entry_date", asOfDate)
    .not("feeling", "is", null)
    .order("entry_date", { ascending: false });

  const filledDates = new Set((history ?? []).map((h) => h.entry_date as string));

  let streakDays = 0;
  const cursor = new Date(`${asOfDate}T00:00:00Z`);
  while (filledDates.has(cursor.toISOString().slice(0, 10))) {
    streakDays += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }

  const lastWeek = (history ?? [])
    .filter((h) => (h.entry_date as string) < asOfDate)
    .slice(0, 7)
    .map((h) => h.feeling as number);
  const weeklyAvgFeeling = mean(lastWeek);

  return { streakDays, weeklyAvgFeeling };
}
