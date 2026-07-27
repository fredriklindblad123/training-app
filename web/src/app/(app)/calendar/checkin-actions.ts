"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { computeCheckInStats, type CheckInStats } from "@/lib/checkin";

// P0.4: daglig subjektiv check-in. Anropas direkt från klientkomponenten
// (DailyCheckIn) som en vanlig async-funktion — inte via ett <form> — så att
// det fjärde knapptrycket kan spara och visa återkoppling i samma steg utan
// en separat "spara"-knapp. diary_entries har unik constraint på
// (user_id, entry_date), så upsert räcker.
export type SaveCheckInInput = {
  entryDate: string;
  feeling: number;
  effort: number; // 1–5 från knappraden, sparas som rpe = effort * 2 (behåller 1–10-skalan)
  soreness: number;
  motivation: number;
};

export type SaveCheckInResult = ({ ok: true } & CheckInStats) | { ok: false };

function isValidScore(n: number): boolean {
  return Number.isInteger(n) && n >= 1 && n <= 5;
}

export async function saveCheckIn(
  input: SaveCheckInInput,
): Promise<SaveCheckInResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false };

  const { entryDate, feeling, effort, soreness, motivation } = input;
  if (
    !entryDate ||
    !isValidScore(feeling) ||
    !isValidScore(effort) ||
    !isValidScore(soreness) ||
    !isValidScore(motivation)
  ) {
    return { ok: false };
  }

  const { error } = await supabase.from("diary_entries").upsert(
    {
      user_id: user.id,
      entry_date: entryDate,
      feeling,
      motivation,
      soreness_level: soreness,
      rpe: effort * 2,
    },
    { onConflict: "user_id,entry_date" },
  );
  if (error) return { ok: false };

  const stats = await computeCheckInStats(supabase, user.id, entryDate);

  revalidatePath("/calendar", "layout");

  return { ok: true, ...stats };
}
