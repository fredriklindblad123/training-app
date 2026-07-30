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

/** Synkar en användares Garmin-data, samma anrop som "Synka nu" på
 * /settings. Delad så att den kan triggas därifrån OCH automatiskt när man
 * går in i appen (se app/actions.ts) — utan att dubblera fetch-logiken. */
export async function triggerGarminSync(userId: string): Promise<void> {
  await fetch(`${apiBase()}/api/garmin/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "",
    },
    body: JSON.stringify({ user_id: userId }),
  });
}
