"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createGoal(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const title = formData.get("title") as string;
  const eventDate = formData.get("event_date") as string;
  const targetResult = (formData.get("target_result") as string) || null;
  const distanceRaw = formData.get("distance_meters") as string;
  const notes = (formData.get("notes") as string) || null;

  if (!title || !eventDate) return;

  await supabase.from("goals").insert({
    user_id: user.id,
    title,
    event_date: eventDate,
    target_result: targetResult,
    distance_meters: distanceRaw ? Number(distanceRaw) : null,
    notes,
  });

  revalidatePath("/goals");
  revalidatePath("/calendar", "layout");
}

export async function updateGoalStatus(goalId: string, status: string) {
  const supabase = await createClient();
  await supabase.from("goals").update({ status }).eq("id", goalId);
  revalidatePath("/goals");
  revalidatePath("/calendar", "layout");
}
