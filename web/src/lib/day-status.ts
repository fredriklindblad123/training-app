import type { createClient } from "@/lib/supabase/server";
import type { DayStatus } from "@/lib/calendar-utils";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/**
 * Bygger en karta datum (YYYY-MM-DD) -> status för intervallet
 * [startDate, endDateExclusive). Ett loggat pass gör dagen till träningsdag
 * när dagboken säger "vila" — har man sprungit har man sprungit.
 *
 * Men BARA över "vila". Fram till 2026-09-24 skrev aktivitetsloopen nedan
 * över allt dagboken sagt, sjuk och skadad inräknat, och regeln var motiverad
 * med just vilofallet ("om man loggat vila men ändå sprang"). Den lånade
 * tröskeln gav årsvyn ett eget svar om samma dag: 2026-02-02 är märkt
 * `injured` i dagboken och har en aktivitet (Vattenlöpning) — månadsvyn,
 * veckovyn, uppföljningens frånvarokolumn och svitremsan säger alla "Skadad"
 * den dagen, medan årsrutan lyste grön "Tränade". Rehabträning under en skada
 * upphäver inte skadan, och årsvyn är just den yta man läser för att se var
 * skadeperioderna ligger.
 */
export async function getDayStatuses(
  supabase: SupabaseServerClient,
  userId: string,
  startDate: string,
  endDateExclusive: string,
): Promise<Map<string, DayStatus>> {
  const statuses = new Map<string, DayStatus>();

  const [{ data: diaryEntries }, { data: activities }] = await Promise.all([
    supabase
      .from("diary_entries")
      .select("entry_date, day_type")
      .eq("user_id", userId)
      .gte("entry_date", startDate)
      .lt("entry_date", endDateExclusive)
      .not("day_type", "is", null),
    supabase
      .from("activities")
      .select("start_time")
      .eq("user_id", userId)
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
    const key = activity.start_time.slice(0, 10);
    // Sjuk och skadad står kvar även om ett pass loggats den dagen — se
    // kommentaren ovanför funktionen. "Vila" ligger aldrig i kartan, så en
    // vilodag med pass blir träningsdag av sig själv.
    const existing = statuses.get(key);
    if (existing === "sick" || existing === "injured") continue;
    statuses.set(key, "training");
  }

  return statuses;
}
