import type { createClient } from "@/lib/supabase/server";

function apiBase(): string {
  // VERCEL_URL pekar på den deploy-specifika adressen, som Vercel skyddar
  // bakom en inloggningssida (SSO) per default — interna server-till-server-
  // anrop dit studsar tyst mot den sidan istället för att nå vår endpoint.
  // VERCEL_PROJECT_PRODUCTION_URL är den publika produktionsdomänen och är
  // inte skyddad på samma sätt.
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) {
    return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  }
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

/** Speglar AUTO_SYNC_MIN_INTERVAL_MINUTES i web/api/index.py. Skickas med på
 * automatiska synkar så att upprepade inloggningar inom kvarten inte drar
 * igång ett nytt Garmin-anrop per gång. Själva beslutet fattas i Python, som
 * äger last_synced_at — det här är bara vad vi ber om. */
const AUTO_SYNC_MIN_INTERVAL_MINUTES = 15;

/** Synkar en användares Garmin-data, samma anrop som "Synka nu" på
 * /settings. Utan `minIntervalMinutes` körs synken alltid — det är vad
 * knappen ska göra när någon uttryckligen bett om färsk data. */
export async function triggerGarminSync(
  userId: string,
  minIntervalMinutes?: number,
): Promise<void> {
  await fetch(`${apiBase()}/api/garmin/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
    },
    body: JSON.stringify(
      minIntervalMinutes == null
        ? { user_id: userId }
        : { user_id: userId, min_interval_minutes: minIntervalMinutes },
    ),
  });
}

/**
 * Vilka användare som ska synkas när `userId` öppnar appen (uttrycklig
 * begäran 2026-08-27).
 *
 * En löpare: bara sig själv. En tränare: sig själv OCH alla länkade adepter
 * — tränaren tittar på deras data, så det är deras data som behöver vara
 * färsk när hen loggar in, inte bara hens egen.
 *
 * Läser via den inloggades egen klient, inte service_role: RLS på
 * `coach_athletes` avgör vilka länkar som syns, så listan kan aldrig
 * innehålla en löpare som anroparen inte faktiskt coachar. Det är viktigt,
 * för längre fram skickas de här id:na till en endpoint som med
 * INTERNAL_API_SECRET får synka vilken användare som helst.
 *
 * Fel sväljs medvetet: kan vi inte läsa rollen faller vi tillbaka på att
 * synka bara den inloggade. Att öppna appen får aldrig fallera på att en
 * bakgrundssynk inte gick att planera.
 */
export async function resolveSyncTargets(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string[]> {
  const { data: profile } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", userId)
    .single();

  if (profile?.role !== "coach") return [userId];

  const { data: links } = await supabase
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", userId);

  const athleteIds = (links ?? []).map((l) => l.athlete_id as string);
  // Set: en tränare som också är sin egen adept ska inte synkas två gånger.
  return [...new Set([userId, ...athleteIds])];
}

/**
 * Kör bakgrundssynk för en lista användare. Parallellt och med allSettled,
 * av två skäl:
 *
 * 1. Sekventiellt växer väntetiden med antalet adepter (fem användare à ~10 s
 *    Garmin-anrop = närmare en minut), och funktionen som håller `after()`
 *    vid liv har en bortre gräns. Parallellt är totaltiden den långsammaste
 *    enskilda synken, inte summan.
 * 2. En adept med utgången Garmin-token får aldrig hindra att de andra
 *    synkas — därför allSettled, inte all.
 */
export async function triggerGarminSyncForAll(userIds: string[]): Promise<void> {
  await Promise.allSettled(
    userIds.map((id) => triggerGarminSync(id, AUTO_SYNC_MIN_INTERVAL_MINUTES)),
  );
}
