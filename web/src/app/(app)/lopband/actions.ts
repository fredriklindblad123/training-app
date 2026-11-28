"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { actualKmh, fitCalibration, type CalibrationPoint } from "@/lib/treadmill";

type Result = { ok: true; id: string } | { ok: false; error: string };

function validPoint(p: CalibrationPoint): boolean {
  return (
    Number.isFinite(p.setKmh) && p.setKmh >= 4 && p.setKmh <= 30 &&
    Number.isFinite(p.actualKmh) && p.actualKmh >= 3 && p.actualKmh <= 35 &&
    p.revs >= 5 && p.seconds > 0
  );
}

/** Sparar en mätning på tomt band. Med `newBand` skapas bandet först. */
export async function saveCalibration(input: {
  treadmillId: string | null;
  newBand: { name: string; beltLengthCm: number } | null;
  beltLengthCm: number;
  points: CalibrationPoint[];
  /** Löparen vars band det blir, när bandet är nytt (coachen kan mäta åt en löpare). */
  athlete: string | null;
}): Promise<Result> {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return { ok: false, error: "Inte inloggad." };
  const points = input.points.filter(validPoint);
  if (points.length === 0) return { ok: false, error: "Ingen giltig mätning att spara." };
  const fit = fitCalibration(points);
  if (!fit) return { ok: false, error: "Kunde inte räkna fram bandets linje." };

  let treadmillId = input.treadmillId;
  if (!treadmillId) {
    const name = input.newBand?.name.trim() ?? "";
    const length = input.newBand?.beltLengthCm ?? 0;
    if (!name) return { ok: false, error: "Ge bandet ett namn." };
    if (!(length >= 100 && length <= 1000)) return { ok: false, error: "Bandets längd ser inte rätt ut." };
    const { data, error } = await supabase
      .from("treadmills")
      .insert({ name, belt_length_cm: length })
      .select("id")
      .single();
    if (error || !data) return { ok: false, error: "Kunde inte spara bandet." };
    treadmillId = data.id as string;
    // Ett nytt band blir löparens band direkt — det är nästan alltid därför
    // man mäter det.
    const userId = resolveScopedUserId(scoped, input.athlete ?? undefined);
    await supabase.from("profiles").update({ treadmill_id: treadmillId }).eq("id", userId);
  }

  const { error } = await supabase.from("treadmill_calibrations").insert({
    treadmill_id: treadmillId,
    belt_length_cm: input.beltLengthCm,
    points,
    slope: fit.slope,
    intercept: fit.intercept,
  });
  if (error) return { ok: false, error: "Kunde inte spara mätningen." };
  revalidatePath("/lopband");
  return { ok: true, id: treadmillId };
}

/** Kontrollmätningen med löpare: en fart, jämförd med linjen för tomt band. */
export async function saveLoadedCheck(input: { calibrationId: string; point: CalibrationPoint }): Promise<Result> {
  const supabase = await createClient();
  if (!validPoint(input.point)) return { ok: false, error: "Mätningen räckte inte." };
  const { data: cal } = await supabase
    .from("treadmill_calibrations")
    .select("id, slope, intercept")
    .eq("id", input.calibrationId)
    .maybeSingle();
  if (!cal) return { ok: false, error: "Hittar inte mätningen." };
  const empty = actualKmh(
    { slope: Number(cal.slope), intercept: Number(cal.intercept), loadedFactor: null },
    input.point.setKmh,
  );
  const factor = input.point.actualKmh / empty;
  // Mer än 10 % åt något håll är troligen en felmätning, inte bandet.
  if (!(factor > 0.9 && factor < 1.1)) {
    return { ok: false, error: "Skillnaden mot tomt band blev över 10 %. Mät gärna igen." };
  }
  const { error } = await supabase
    .from("treadmill_calibrations")
    .update({ loaded_factor: factor, loaded_point: input.point })
    .eq("id", input.calibrationId);
  if (error) return { ok: false, error: "Bara den som mätte bandet kan lägga till kontrollen." };
  revalidatePath("/lopband");
  return { ok: true, id: input.calibrationId };
}

export async function chooseTreadmill(formData: FormData) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return;
  const userId = resolveScopedUserId(scoped, (formData.get("athlete") as string) || undefined);
  const id = (formData.get("treadmill_id") as string) || null;
  await supabase.from("profiles").update({ treadmill_id: id }).eq("id", userId);
  revalidatePath("/lopband");
  revalidatePath("/dashboard");
}
