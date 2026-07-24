"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function saveDiaryEntry(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const entryId = formData.get("entry_id") as string;
  const entryDate = formData.get("entry_date") as string;
  const notes = (formData.get("notes") as string) || null;
  const rpeRaw = formData.get("rpe") as string;
  const mood = (formData.get("mood") as string) || null;
  const sleepRaw = formData.get("sleep_hours") as string;
  const dayTypeRaw = formData.get("day_type") as string;

  const payload = {
    user_id: user.id,
    entry_date: entryDate,
    notes,
    rpe: rpeRaw ? Number(rpeRaw) : null,
    mood,
    sleep_hours: sleepRaw ? Number(sleepRaw) : null,
    day_type: dayTypeRaw || null,
  };

  if (entryId) {
    await supabase.from("diary_entries").update(payload).eq("id", entryId);
  } else {
    await supabase.from("diary_entries").insert(payload);
  }

  revalidatePath("/calendar", "layout");
}
