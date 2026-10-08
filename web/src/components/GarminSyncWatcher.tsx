"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { latestGarminSync } from "@/lib/garmin-sync-status";

/* Uppdaterar sidan när bakgrundssynken mot Garmin är klar.
 *
 * Synken som startar vid sidvisning körs efter att sidan skickats (after() i
 * layouten). Utan den här komponenten visades därför alltid den gamla datan,
 * och ett pass man just sprungit syntes först när man bytte sida.
 *
 * Komponenten monteras bara när en synk faktiskt är på väg (layouten vet det
 * ur last_synced_at). Den frågar då var fjärde sekund efter senaste
 * synktidpunkt — en databasfråga, inget Garmin-anrop — och gör en tyst
 * router.refresh() när tidpunkten flyttat sig. Ger upp efter 90 s: en synk som
 * inte blivit klar då har misslyckats eller strypts, och då finns inget nytt
 * att visa. */
const POLL_MS = 4000;
const GIVE_UP_MS = 90_000;

export function GarminSyncWatcher({ since }: { since: string | null }) {
  const router = useRouter();

  useEffect(() => {
    let stopped = false;
    const started = Date.now();
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - started > GIVE_UP_MS) return;
      try {
        const latest = await latestGarminSync();
        if (latest && (!since || latest > since)) {
          stopped = true;
          router.refresh();
          return;
        }
      } catch {
        // Nätet hackade — försök igen vid nästa tick.
      }
      if (!stopped) timer = setTimeout(tick, POLL_MS);
    };
    let timer = setTimeout(tick, POLL_MS);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [since, router]);

  return null;
}
