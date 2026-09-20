
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
 * Vilka användare som ska synkas när någon öppnar appen: en löpare bara sig
 * själv, en tränare sig själv OCH alla länkade adepter — tränaren tittar på
 * deras data, så det är deras som behöver vara färsk.
 *
 * Härledd ur det layouten redan hämtat med getScopedProfile, utan en enda
 * extra fråga. Det fanns tidigare en variant (resolveSyncTargets) som slog
 * upp profil och coach-kopplingar på nytt — två nätverksrundor per
 * sidvisning, precis en sådan dubblett som gjorde menyn trög. Den togs bort
 * 2026-09-20 när startsidans knapp, dess enda kvarvarande anropare, ersattes
 * av en redirect.
 */
export function syncTargetsFromScope(scoped: {
  userId: string;
  role: "athlete" | "coach";
  linkedAthletes: { id: string }[];
}): string[] {
  if (scoped.role !== "coach") return [scoped.userId];
  return [...new Set([scoped.userId, ...scoped.linkedAthletes.map((a) => a.id)])];
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
/* Senaste gången vi ens FÖRSÖKTE synka en användare, i den här
 * serverinstansens minne.
 *
 * Strypningen i Python (AUTO_SYNC_MIN_INTERVAL_MINUTES) är fortfarande facit —
 * den är det enda som fungerar över flera instanser. Men utan den här
 * grinden skickar vi ett HTTP-anrop per användare vid VARJE sidvisning, bara
 * för att Python ska läsa last_synced_at och svara "nej". Det är osynligt för
 * den som klickar (after() kör efter svaret) men fullständigt onödigt arbete.
 *
 * En Map i modulscope överlever så länge serverinstansen är varm, vilket är
 * det normala under ett aktivt arbetspass — och det är precis då det klickas
 * mycket. Kall instans betyder bara att vi frågar Python en gång extra, vilket
 * strypningen där ändå fångar. Korrektheten hänger alltså aldrig på den här
 * cachen; den tar bara bort det uppenbart bortkastade.
 */
const lastAttempt = new Map<string, number>();

/** Nollställer grinden för givna användare.
 *
 * Används av den manuella uppdateringsknappen: utan det skulle en användare
 * som nyss synkades automatiskt hoppas över, och knappen hade känts trasig
 * trots att allt fungerade som tänkt. */
export function clearSyncGate(userIds: string[]): void {
  for (const id of userIds) lastAttempt.delete(id);
}

/** Samma fönster som Python använder, i millisekunder. */
const ATTEMPT_WINDOW_MS = AUTO_SYNC_MIN_INTERVAL_MINUTES * 60 * 1000;

export async function triggerGarminSyncForAll(userIds: string[]): Promise<void> {
  const now = Date.now();
  const due = userIds.filter((id) => {
    const prev = lastAttempt.get(id);
    return prev == null || now - prev >= ATTEMPT_WINDOW_MS;
  });
  if (due.length === 0) return;
  for (const id of due) lastAttempt.set(id, now);

  await Promise.allSettled(due.map((id) => triggerGarminSync(id, AUTO_SYNC_MIN_INTERVAL_MINUTES)));
}
