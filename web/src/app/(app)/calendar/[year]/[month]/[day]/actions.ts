"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isActivityCategory } from "@/lib/categories";

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

  // Kategori är en underhierarki av dagtyp: bara relevant när dagtyp=träning
  // och det inte redan finns ett synkat Garmin-pass (då redigeras kategori
  // per-pass istället, se updateActivityCategory).
  const categoryRaw = formData.get("category") as string;
  const distanceRaw = formData.get("distance_km") as string;
  const durationRaw = formData.get("duration_min") as string;
  const externalId = entryDate; // ett manuellt pass per dag

  if (dayTypeRaw === "training" && isActivityCategory(categoryRaw)) {
    const distanceMeters = distanceRaw ? Number(distanceRaw) * 1000 : null;
    const durationSeconds = durationRaw ? Number(durationRaw) * 60 : null;
    const avgPace =
      distanceMeters && durationSeconds && distanceMeters > 0
        ? durationSeconds / (distanceMeters / 1000)
        : null;

    await supabase.from("activities").upsert(
      {
        user_id: user.id,
        source: "manual",
        external_id: externalId,
        activity_type:
          categoryRaw === "strength"
            ? "strength_training"
            : categoryRaw === "cross_training"
              ? "cross_training"
              : "running",
        name: "Manuellt loggat pass",
        start_time: `${entryDate}T12:00:00Z`,
        distance_meters: distanceMeters,
        duration_seconds: durationSeconds,
        avg_pace_seconds_per_km: avgPace,
        category: categoryRaw,
        category_source: "manual",
      },
      { onConflict: "user_id,source,external_id" },
    );
  } else {
    // Dagtyp ändrad bort från träning, eller kategori nollställd — ta bort
    // ett ev. tidigare manuellt loggat pass för dagen. No-op om inget finns.
    await supabase
      .from("activities")
      .delete()
      .eq("user_id", user.id)
      .eq("source", "manual")
      .eq("external_id", externalId);
  }

  revalidatePath("/calendar", "layout");
  revalidatePath("/stats", "layout");
}

export async function updateActivityCategory(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const activityId = formData.get("activity_id") as string;
  const category = formData.get("category") as string;
  if (!activityId || !isActivityCategory(category)) return;

  await supabase
    .from("activities")
    .update({ category, category_source: "manual" })
    .eq("id", activityId)
    .eq("user_id", user.id);

  revalidatePath("/calendar", "layout");
  revalidatePath("/stats", "layout");
}

export async function savePlannedWorkout(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const workoutId = formData.get("workout_id") as string;
  const scheduledDate = formData.get("scheduled_date") as string;
  const workoutType = formData.get("workout_type") as string;

  if (!isActivityCategory(workoutType)) {
    // Tom kategori = ta bort planeringen för dagen.
    if (workoutId) {
      await supabase
        .from("planned_workouts")
        .delete()
        .eq("id", workoutId)
        .eq("user_id", user.id);
    }
    revalidatePath("/calendar", "layout");
    return;
  }

  const goalIdRaw = formData.get("goal_id") as string;
  const distanceRaw = formData.get("target_distance_km") as string;
  const durationRaw = formData.get("target_duration_min") as string;
  const description = (formData.get("description") as string) || null;

  const targetDistanceMeters = distanceRaw ? Math.round(Number(distanceRaw) * 1000) : null;
  const targetDurationSeconds = durationRaw ? Math.round(Number(durationRaw) * 60) : null;
  const targetPaceSecondsPerKm =
    targetDistanceMeters && targetDurationSeconds && targetDistanceMeters > 0
      ? Math.round(targetDurationSeconds / (targetDistanceMeters / 1000))
      : null;

  const payload = {
    user_id: user.id,
    goal_id: goalIdRaw || null,
    scheduled_date: scheduledDate,
    workout_type: workoutType,
    description,
    target_distance_meters: targetDistanceMeters,
    target_duration_seconds: targetDurationSeconds,
    target_pace_seconds_per_km: targetPaceSecondsPerKm,
  };

  if (workoutId) {
    await supabase
      .from("planned_workouts")
      .update(payload)
      .eq("id", workoutId)
      .eq("user_id", user.id);
  } else {
    await supabase.from("planned_workouts").insert(payload);
  }

  revalidatePath("/calendar", "layout");
}

export async function deletePlannedWorkout(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const workoutId = formData.get("workout_id") as string;
  if (!workoutId) return;

  await supabase
    .from("planned_workouts")
    .delete()
    .eq("id", workoutId)
    .eq("user_id", user.id);

  revalidatePath("/calendar", "layout");
}

export async function resetActivityCategory(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const activityId = formData.get("activity_id") as string;
  if (!activityId) return;

  // category_source='auto' räcker — triggern (categorize_activity) räknar
  // om category från Garmin-fälten vid denna update.
  await supabase
    .from("activities")
    .update({ category_source: "auto" })
    .eq("id", activityId)
    .eq("user_id", user.id);

  revalidatePath("/calendar", "layout");
  revalidatePath("/stats", "layout");
}

const LACTATE_CONTEXTS = ["test", "workout", "race"];

// P0.3b: laktatvärden från ett laktattest (stegrande fart, ett stick per
// steg) — flera värden per pass måste gå att lägga in, därför en egen rad
// per mätvärde istället för en kolumn på activities. measured_at sätts till
// insättningstillfället (inte ett formulärfält) så ordningen på sticken blir
// rätt utan extra friktion i UI:t.
export async function addLactateReading(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const mmolRaw = formData.get("lactate_mmol") as string;
  if (!mmolRaw) return;

  const activityId = (formData.get("activity_id") as string) || null;
  const paceMinRaw = formData.get("pace_min") as string;
  const paceSekRaw = formData.get("pace_sek") as string;
  const hrRaw = formData.get("heart_rate") as string;
  const contextRaw = (formData.get("context") as string) || "test";
  const note = (formData.get("note") as string) || null;

  const paceMin = paceMinRaw ? Number(paceMinRaw) : 0;
  const paceSek = paceSekRaw ? Number(paceSekRaw) : 0;
  const paceSecondsPerKm = paceMinRaw || paceSekRaw ? paceMin * 60 + paceSek : null;

  await supabase.from("lactate_readings").insert({
    user_id: user.id,
    activity_id: activityId,
    lactate_mmol: Number(mmolRaw),
    pace_seconds_per_km: paceSecondsPerKm,
    heart_rate: hrRaw ? Number(hrRaw) : null,
    context: LACTATE_CONTEXTS.includes(contextRaw) ? contextRaw : "test",
    note,
  });

  revalidatePath("/calendar", "layout");
}

export async function deleteLactateReading(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const readingId = formData.get("reading_id") as string;
  if (!readingId) return;

  await supabase
    .from("lactate_readings")
    .delete()
    .eq("id", readingId)
    .eq("user_id", user.id);

  revalidatePath("/calendar", "layout");
}
