"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { isActivityCategory } from "@/lib/categories";
import { THRESHOLD_TEST_PROTOCOL } from "@/lib/planning";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/** Ett tröskeltest ska alltid bära protokollet i sin beskrivning (K8) — utan
 * det är "Tröskeltest" bara ett namn utan instruktion. Skriver bara över en
 * tom beskrivning, aldrig text tränaren själv skrivit in. */
function descriptionFor(workoutType: string, typed: string): string | null {
  const trimmed = typed.trim();
  if (trimmed) return trimmed;
  return workoutType === "test" ? THRESHOLD_TEST_PROTOCOL : null;
}

/** Fas 0-uppföljning (2026-08-16): vilken löpares rad en helt ny post (ett
 * eget pass, en ny dagboksrad, ett för hand inlagt planerat pass) ska
 * skrivas på — en löpare får alltid sitt eget id, en coach växlar via det
 * dolda `athlete`-fältet sidan skickar med (samma `athlete`-param som
 * URL:en, se page.tsx). Säkerheten ligger i RLS (widened i migration
 * 20260814110000), inte här — samma mönster som resolvedAthleteId i
 * sasongen/actions.ts. Uppdaterings-/raderingsactioner nedan behöver den
 * INTE: de opererar på en rad som redan finns, och RLS avgör redan om
 * anroparen får nå den — ett extra `.eq("user_id", ...)` mot den inloggade
 * personens EGET id skulle bara göra att en coachs ändring av en löpares
 * rad tyst missar (fel id att filtrera på).
 */
async function resolvedAthleteId(
  supabase: SupabaseServerClient,
  formData: FormData,
): Promise<string | null> {
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  return resolveScopedUserId(scoped, (formData.get("athlete") as string | null) ?? undefined);
}

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
  // ut anteckningar, och tvärtom. rpe/mood sätts inte alls härifrån — den
  // dagliga incheckningen som tidigare ägde rpe togs bort 2026-08-12
  // (se activities.garmin_feel/garmin_rpe och lib/diary-text.ts istället).
  const payload: Record<string, unknown> = {};
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
    // Ägaren rörs aldrig vid en uppdatering — user_id hör inte till
    // payloaden ovan, så en coachs redigering av en löpares rad aldrig kan
    // av misstag byta ägare till coachens eget id.
    await supabase.from("diary_entries").update(payload).eq("id", entryId);
  } else {
    const athleteId = await resolvedAthleteId(supabase, formData);
    if (!athleteId) return;
    await supabase
      .from("diary_entries")
      .insert({ ...payload, user_id: athleteId, entry_date: entryDate });
  }

  revalidatePath("/calendar", "layout");
  revalidatePath("/dashboard", "layout");
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
    .eq("id", activityId);

  revalidatePath("/calendar", "layout");
  revalidatePath("/dashboard", "layout");
}

export async function deletePlannedWorkout(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const workoutId = formData.get("workout_id") as string;
  if (!workoutId) return;

  await supabase.from("planned_workouts").delete().eq("id", workoutId);

  revalidatePath("/calendar", "layout");
  // Planerade pass redigeras även från Detaljplans dagsvy för flera
  // löpare (/detaljplan/pass), som återanvänder just de här actions —
  // utan den här raden skulle en ändring där se ut att inte hända.
  revalidatePath("/detaljplan", "layout");
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
    .eq("id", activityId);

  revalidatePath("/calendar", "layout");
  revalidatePath("/dashboard", "layout");
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
    // Ägaren rörs aldrig vid en uppdatering — user_id hör inte till
    // payloaden ovan, se samma motivering i saveDiaryEntry.
    await supabase.from("activities").update(payload).eq("id", activityId);
  } else {
    const athleteId = await resolvedAthleteId(supabase, formData);
    if (!athleteId) return;
    await supabase.from("activities").insert({
      ...payload,
      user_id: athleteId,
      // Slumpad nyckel i stället för datumet: unik-constrainten på
      // (user_id, source, external_id) är det som annars begränsar till ett
      // eget pass per dag.
      external_id: `manual:${crypto.randomUUID()}`,
    });
  }

  revalidatePath("/calendar", "layout");
  revalidatePath("/dashboard", "layout");
  revalidatePath("/trender");
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
  revalidatePath("/dashboard", "layout");
  revalidatePath("/trender");
}

// --- Planerade pass --------------------------------------------------------
// Alla pass skapas i /detaljplan (veckomallar) sedan 2026-08-17 — kalendern
// är medvetet inte längre en plats att lägga upp NYA pass på. Redigering av
// redan utrullade pass sker fortfarande här, se updatePlannedWorkout nedan.

// K8 (docs/tranarperspektiv.md): spara ett LT2-förslag från ett genomfört
// tröskeltest. Föreslås av lib/threshold-test.ts och skrivs bara hit när
// atleten/tränaren själv trycker spara — appen gissar aldrig ett värde in i
// profiles på egen hand. Källan märks 'test_field' (fälttest, inte
// laktattest — se lt2_source på profiles) så /settings och /trends kan visa
// hur säkert värdet är.
export async function saveTestLt2(formData: FormData) {
  const supabase = await createClient();
  // Ett tröskeltest sparas mot löparens EGEN profil, aldrig coachens —
  // profiles-RLS tillåter en coach att uppdatera bara sin egen rad (läsning
  // breddades i migration 20260814130000, skrivning medvetet inte), så det
  // här måste gå via athleteId, inte user.id.
  const athleteId = await resolvedAthleteId(supabase, formData);
  if (!athleteId) return;

  const lt2Raw = formData.get("lt2_hr") as string;
  const measuredOn = formData.get("measured_on") as string;
  if (!lt2Raw || !measuredOn) return;

  await supabase
    .from("profiles")
    .update({
      lt2_hr: Math.round(Number(lt2Raw)),
      lt2_source: "test_field",
      lt2_measured_on: measuredOn,
    })
    .eq("id", athleteId);

  revalidatePath("/calendar", "layout");
  revalidatePath("/settings");
  revalidatePath("/trender");
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
      description: descriptionFor(workoutType, (formData.get("description") as string) || ""),
      target_distance_meters: distanceRaw ? Number(distanceRaw) * 1000 : null,
      target_duration_seconds: durationRaw ? Number(durationRaw) * 60 : null,
      training_factor: (formData.get("training_factor") as string) || null,
    })
    .eq("id", workoutId);

  revalidatePath("/calendar", "layout");
  // Planerade pass redigeras även från Detaljplans dagsvy för flera
  // löpare (/detaljplan/pass), som återanvänder just de här actions —
  // utan den här raden skulle en ändring där se ut att inte hända.
  revalidatePath("/detaljplan", "layout");
}

// --- Repgrupper på ett planerat pass (K1) -----------------------------------
// Ett pass har flera repgrupper i följd ("2×1000 m + 4×600 m" är två), se
// supabase/migrations/20260801100000_planned_rep_groups.sql för varför det
// är en egen tabell och inte fler kolumner här. Nyckelformatet de bygger
// (plannedSignatureKey/-Label i lib/session-signature.ts) måste matcha
// buildSessionSignature exakt — se kommentaren i den filen.
//
// Tabellen har ingen egen user_id — ägarskap avgörs av RLS-policyn (via
// planned_workouts.user_id), inte av ett explicit .eq("user_id", ...) här.
// Det är samma mönster som competition_events i planering/actions.ts.

/** Bygger insert/update-payloaden för en repgrupp ur formulärfälten. Vila och
 * pace matas in som min+sek (samma mönster som addLactateReading ovan) i
 * stället för råa sekunder — en tränare tänker "3:15", inte "195". */
function repGroupFieldsFromForm(formData: FormData) {
  const distanceRaw = formData.get("distance_meters") as string;
  const durationMinRaw = formData.get("duration_minutes") as string;
  const paceMinRaw = formData.get("pace_min") as string;
  const paceSekRaw = formData.get("pace_sek") as string;
  const recoveryMinRaw = formData.get("recovery_minutes") as string;
  const recoveryKindRaw = ((formData.get("recovery_kind") as string) || "").trim();
  const noteRaw = ((formData.get("note") as string) || "").trim();

  const paceMin = paceMinRaw ? Number(paceMinRaw) : 0;
  const paceSek = paceSekRaw ? Number(paceSekRaw) : 0;

  return {
    reps: Number(formData.get("reps")) || 1,
    distance_meters: distanceRaw ? Math.round(Number(distanceRaw)) : null,
    duration_seconds: durationMinRaw ? Math.round(Number(durationMinRaw) * 60) : null,
    target_pace_seconds_per_km: paceMinRaw || paceSekRaw ? paceMin * 60 + paceSek : null,
    recovery_seconds: recoveryMinRaw ? Math.round(Number(recoveryMinRaw) * 60) : null,
    recovery_kind: recoveryKindRaw || null,
    note: noteRaw || null,
  };
}

export async function addPlannedRepGroup(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const workoutId = formData.get("planned_workout_id") as string;
  if (!workoutId) return;

  const fields = repGroupFieldsFromForm(formData);
  // rep_has_a_measure-constrainten kräver minst en av de två — ett tyst
  // no-op här är bättre än ett 500-fel för ett tomt formulär.
  if (fields.distance_meters == null && fields.duration_seconds == null) return;

  // Ny grupp läggs sist i ordningen, så en tillagd grupp aldrig kastar om
  // vad "2×1000 + 4×600" betyder för de grupper som redan finns.
  const { data: existing } = await supabase
    .from("planned_rep_groups")
    .select("sort_order")
    .eq("planned_workout_id", workoutId)
    .order("sort_order", { ascending: false })
    .limit(1);
  const nextSort = ((existing ?? [])[0]?.sort_order ?? -1) + 1;

  await supabase.from("planned_rep_groups").insert({
    planned_workout_id: workoutId,
    sort_order: nextSort,
    ...fields,
  });

  revalidatePath("/calendar", "layout");
  // Planerade pass redigeras även från Detaljplans dagsvy för flera
  // löpare (/detaljplan/pass), som återanvänder just de här actions —
  // utan den här raden skulle en ändring där se ut att inte hända.
  revalidatePath("/detaljplan", "layout");
}

export async function updatePlannedRepGroup(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const id = formData.get("id") as string;
  if (!id) return;

  const fields = repGroupFieldsFromForm(formData);
  if (fields.distance_meters == null && fields.duration_seconds == null) return;

  await supabase.from("planned_rep_groups").update(fields).eq("id", id);

  revalidatePath("/calendar", "layout");
  // Planerade pass redigeras även från Detaljplans dagsvy för flera
  // löpare (/detaljplan/pass), som återanvänder just de här actions —
  // utan den här raden skulle en ändring där se ut att inte hända.
  revalidatePath("/detaljplan", "layout");
}

export async function deletePlannedRepGroup(formData: FormData) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return;

  const id = formData.get("id") as string;
  if (!id) return;

  await supabase.from("planned_rep_groups").delete().eq("id", id);

  revalidatePath("/calendar", "layout");
  // Planerade pass redigeras även från Detaljplans dagsvy för flera
  // löpare (/detaljplan/pass), som återanvänder just de här actions —
  // utan den här raden skulle en ändring där se ut att inte hända.
  revalidatePath("/detaljplan", "layout");
}
