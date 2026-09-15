import { formatHoursMinutes, formatKm } from "@/lib/format";

/* Kort beskrivning av ETT pass — "5×1000 m", "10 km · 55 min".
 *
 * Skild från plannedSignatureLabel i lib/session-signature.ts med flit. Den
 * modulen bygger en nyckel som ska kunna MATCHAS mot verkligt utförda varv,
 * och utelämnar därför tidsbaserade grupper helt: ett "5×3 min" har ingen
 * motsvarighet bland distansbaserade varv. Här är syftet ett annat — att
 * beskriva passet för en människa — och då är 5×3 min precis lika mycket ett
 * intervallpass som 5×1000 m. Att återanvända fel modul hade tyst tappat
 * halva intervallpassen.
 */

export type RepGroupLike = {
  reps: number;
  distance_meters: number | null;
  duration_seconds: number | null;
  sort_order: number;
};

/** "5×1000 m", "4×3 min", "3×1000 m + 4×400 m". Null när grupperna är tomma. */
export function describeRepGroups(groups: RepGroupLike[]): string | null {
  const parts = [...groups]
    .sort((a, b) => a.sort_order - b.sort_order)
    .map((g) => {
      if (g.distance_meters != null && g.distance_meters > 0) {
        // Meter under en kilometer, annars km — "5×1000 m" är hur en
        // medeldistanslöpare faktiskt skriver det, inte "5×1 km".
        return g.distance_meters >= 2000
          ? `${g.reps}×${(g.distance_meters / 1000).toFixed(1).replace(".", ",")} km`
          : `${g.reps}×${g.distance_meters} m`;
      }
      if (g.duration_seconds != null && g.duration_seconds > 0) {
        const min = Math.round(g.duration_seconds / 60);
        return `${g.reps}×${min} min`;
      }
      // En grupp utan både distans och tid är bara ett antal — sällsynt, men
      // att tappa den helt vore värre än att visa vad som faktiskt står.
      return `${g.reps}×`;
    })
    .filter((s) => s !== "");

  return parts.length > 0 ? parts.join(" + ") : null;
}

/** "10.00 km · 55 min" — vad som finns, i den ordningen. Null när inget finns.
 *
 * formatHoursMinutes och inte formatDuration: den senare ger "55:00", vilket
 * i en sammanfattningsrad läser som ett klockslag snarare än en längd. Samma
 * motivering står redan vid formatHoursMinutes i lib/format.ts, som infördes
 * för sömnlängd av exakt det skälet. formatKm behålls som den är — "10.00 km"
 * är formatet i hela appen, och en egen variant just här hade varit värre än
 * decimalpunkten. */
export function describeTargets(
  distanceMeters: number | null | undefined,
  durationSeconds: number | null | undefined,
): string | null {
  const parts = [
    distanceMeters && distanceMeters > 0 ? formatKm(distanceMeters) : null,
    durationSeconds && durationSeconds > 0 ? formatHoursMinutes(durationSeconds) : null,
  ].filter((p): p is string => p != null);
  return parts.length > 0 ? parts.join(" · ") : null;
}

/**
 * Passets innehåll i en rad.
 *
 * Repgrupperna vinner när de finns: "5×1000 m" säger mer om ett intervallpass
 * än "8 km", och den som ser båda läser ändå repetitionerna först. Saknas de
 * faller den tillbaka på målen — vilket är det normala för distanspass, som
 * inte har någon repstruktur alls.
 */
export function describePlannedWorkout(w: {
  target_distance_meters?: number | null;
  target_duration_seconds?: number | null;
  planned_rep_groups?: RepGroupLike[] | null;
}): string | null {
  const reps = describeRepGroups(w.planned_rep_groups ?? []);
  const targets = describeTargets(w.target_distance_meters, w.target_duration_seconds);
  if (reps && targets) return `${reps} · ${targets}`;
  return reps ?? targets;
}
