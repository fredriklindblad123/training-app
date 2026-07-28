import type { createClient } from "@/lib/supabase/server";
import type { DayStatus } from "@/lib/calendar-utils";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Bygger en karta datum (YYYY-MM-DD) -> status för intervallet
 * [startDate, endDateExclusive). Aktivitet vinner alltid över en manuellt
 * satt day_type i dagboken (om man loggat "vila" men ändå sprang, räknas
 * det som träning).
 */
export async function getDayStatuses(
  supabase: SupabaseServerClient,
  startDate: string,
  endDateExclusive: string,
): Promise<Map<string, DayStatus>> {
  const statuses = new Map<string, DayStatus>();

  const [{ data: diaryEntries }, { data: activities }] = await Promise.all([
    supabase
      .from("diary_entries")
      .select("entry_date, day_type")
      .gte("entry_date", startDate)
      .lt("entry_date", endDateExclusive)
      .not("day_type", "is", null),
    supabase
      .from("activities")
      .select("start_time")
      .gte("start_time", startDate)
      .lt("start_time", endDateExclusive),
  ]);

  for (const entry of diaryEntries ?? []) {
    // "Ledig" visas inte som en egen status i kalendern — att inget pass
    // finns loggat säger redan det, och en egen färg för det gjorde
    // rutnätet plottrigt utan att tillföra information.
    if (entry.day_type && entry.day_type !== "rest") {
      statuses.set(entry.entry_date, entry.day_type as DayStatus);
    }
  }
  for (const activity of activities ?? []) {
    statuses.set(activity.start_time.slice(0, 10), "training");
  }

  return statuses;
}
