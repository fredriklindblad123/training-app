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

  // Dagtyp-rutan högst upp och dagboksformuläret längre ner skickar båda hit,
  // men bara med sina egna fält — bygg payloaden av det som faktiskt kom med
  // (formData.has, inte bara get) så att ett sparat dagtyp-val aldrig nollar
  // ut anteckningar, och tvärtom. rpe/mood sätts inte alls längre härifrån
  // (RPE fylls i via den dagliga incheckningen på /dashboard i stället).
  const payload: Record<string, unknown> = {
    user_id: user.id,
    entry_date: entryDate,
  };
  if (formData.has("notes")) {
    payload.notes = (formData.get("notes") as string) || null;
  }
  if (formData.has("sleep_hours")) {
    const sleepRaw = formData.get("sleep_hours") as string;
    payload.sleep_hours = sleepRaw ? Number(sleepRaw) : null;
  }
  if (formData.has("day_type")) {
    payload.day_type = (formData.get("day_type") as string) || null;
  }

  if (entryId) {
    await supabase.from("diary_entries").update(payload).eq("id", entryId);
  } else {
    await supabase.from("diary_entries").insert(payload);
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


// --- Egna pass -------------------------------------------------------------
// Flera egna pass per dag ska gå att logga, oavsett om dagen redan har
// Garmin-pass: ett styrkepass på kvällen efter ett löppass på morgonen är
// normalfallet, inte undantaget. Tidigare låg logiken inbakad i
// dagboksformuläret med external_id = datumet, vilket via unik-constrainten
// (user_id, source, external_id) tillät exakt ett eget pass per dag — och
// bara på dagar utan Garmin-data.

export async function saveManualActivity(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const activityId = (formData.get("activity_id") as string) || null;
  const entryDate = formData.get("entry_date") as string;
  const category = formData.get("category") as string;
  if (!entryDate || !isActivityCategory(category)) return;

  const time = ((formData.get("start_time") as string) || "12:00").slice(0, 5);
  const distanceRaw = formData.get("distance_km") as string;
  const durationRaw = formData.get("duration_min") as string;
  const name = ((formData.get("name") as string) || "").trim();

  const distanceMeters = distanceRaw ? Number(distanceRaw) * 1000 : null;
  const durationSeconds = durationRaw ? Number(durationRaw) * 60 : null;
  const avgPace =
    distanceMeters && durationSeconds && distanceMeters > 0
      ? durationSeconds / (distanceMeters / 1000)
      : null;

  const payload = {
    user_id: user.id,
    source: "manual",
    activity_type:
      category === "strength"
        ? "strength_training"
        : category === "cross_training"
          ? "cross_training"
          : "running",
    name: name || "Eget pass",
    // Riktig tid, inte en fast middagstid: passgrupperingen delar dagen i
    // flera pass när det skiljer mer än ett par timmar, så utan tid skulle
    // morgonens löpning och kvällens styrka slås ihop till ett pass.
    start_time: `${entryDate}T${time}:00Z`,
    distance_meters: distanceMeters,
    duration_seconds: durationSeconds,
    avg_pace_seconds_per_km: avgPace,
    category,
    category_source: "manual",
  };

  if (activityId) {
    await supabase.from("activities").update(payload).eq("id", activityId);
  } else {
    await supabase.from("activities").insert({
      ...payload,
      // Slumpad nyckel i stället för datumet: unik-constrainten på
      // (user_id, source, external_id) är det som annars begränsar till ett
      // eget pass per dag.
      external_id: `manual:${crypto.randomUUID()}`,
    });
  }

  revalidatePath("/calendar", "layout");
  revalidatePath("/stats", "layout");
  revalidatePath("/trends");
}

export async function deleteManualActivity(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const id = formData.get("activity_id") as string;
  if (!user || !id) return;

  // Bara egna pass får raderas härifrån — Garmin-pass hämtas om vid nästa
  // synk ändå och ska inte gå att ta bort av misstag.
  await supabase.from("activities").delete().eq("id", id).eq("source", "manual");

  revalidatePath("/calendar", "layout");
  revalidatePath("/stats", "layout");
  revalidatePath("/trends");
}

// --- Planerade pass --------------------------------------------------------
// De flesta pass skapas via veckomallar på /planering, men ett enskilt extra
// pass (t ex ett läger-tillfälle som inte hör till mallen) går att lägga in
// direkt här. Det kräver ett aktivt block för dagen — block_id sätts alltid
// av sidan, aldrig av formuläret, så ett pass aldrig kan hamna utan block.

export async function addPlannedWorkout(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const scheduledDate = formData.get("scheduled_date") as string;
  const blockId = formData.get("block_id") as string;
  const workoutType = formData.get("workout_type") as string;
  if (!scheduledDate || !blockId || !workoutType) return;

  const distanceRaw = formData.get("target_distance_km") as string;
  const durationRaw = formData.get("target_duration_min") as string;

  await supabase.from("planned_workouts").insert({
    user_id: user.id,
    scheduled_date: scheduledDate,
    slot: Number(formData.get("slot")) || 1,
    workout_type: workoutType,
    title: ((formData.get("title") as string) || "").trim() || null,
    description: ((formData.get("description") as string) || "").trim() || null,
    target_distance_meters: distanceRaw ? Number(distanceRaw) * 1000 : null,
    target_duration_seconds: durationRaw ? Number(durationRaw) * 60 : null,
    block_id: blockId,
  });

  revalidatePath("/calendar", "layout");
}

export async function updatePlannedWorkout(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const workoutId = formData.get("workout_id") as string;
  const workoutType = formData.get("workout_type") as string;
  if (!workoutId || !workoutType) return;

  const distanceRaw = formData.get("target_distance_km") as string;
  const durationRaw = formData.get("target_duration_min") as string;

  await supabase
    .from("planned_workouts")
    .update({
      workout_type: workoutType,
      slot: Number(formData.get("slot")) || 1,
      title: ((formData.get("title") as string) || "").trim() || null,
      description: ((formData.get("description") as string) || "").trim() || null,
      target_distance_meters: distanceRaw ? Number(distanceRaw) * 1000 : null,
      target_duration_seconds: durationRaw ? Number(durationRaw) * 60 : null,
    })
    .eq("id", workoutId)
    .eq("user_id", user.id);

  revalidatePath("/calendar", "layout");
}
