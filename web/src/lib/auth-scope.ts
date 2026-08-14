import type { createClient } from "@/lib/supabase/server";

/* Fas 0 (2026-08-14): grunden för att en coach ska kunna se/redigera flera
 * löpares säsongsplanering, inte bara sin egen. Se
 * supabase/migrations/20260814100000_coach_athletes.sql för RLS-sidan —
 * den här filen är bara läsvägen som väljer VILKET user_id en sidas frågor
 * ska filtrera på, inte säkerhetsgränsen. Säkerheten ligger helt i RLS: en
 * coach kan bara faktiskt läsa/skriva rader för löpare `coach_athletes`
 * länkar dem till, oavsett vad den här filen råkar returnera.
 *
 * Gäller just nu bara /sasongen och de nya planeringssidorna (Flerårsplan,
 * Årsplan, övningsbibliotek) — kalendern, dashboarden, trender och
 * tävlingsresultat är oförändrade och läser fortfarande bara den inloggade
 * personens egna data. */

export type AthleteOption = {
  id: string;
  fullName: string | null;
};

export type ScopedProfile = {
  /** Den faktiskt inloggade personens eget id — alltid detta för en löpare,
   * coachens eget (troligen tomma) id för en coach. */
  userId: string;
  role: "athlete" | "coach";
  /** Bara ifyllt för en coach — löparna `coach_athletes` länkar hen till. */
  linkedAthletes: AthleteOption[];
};

export async function getScopedProfile(
  supabase: Awaited<ReturnType<typeof createClient>>,
): Promise<ScopedProfile | null> {
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profileRow } = await supabase
    .from("profiles")
    .select("role")
    .eq("id", user.id)
    .single();
  const role: "athlete" | "coach" = profileRow?.role === "coach" ? "coach" : "athlete";

  if (role !== "coach") {
    return { userId: user.id, role, linkedAthletes: [] };
  }

  const { data: links } = await supabase
    .from("coach_athletes")
    .select("athlete_id")
    .eq("coach_id", user.id);
  const athleteIds = (links ?? []).map((l) => l.athlete_id as string);

  let linkedAthletes: AthleteOption[] = [];
  if (athleteIds.length > 0) {
    const { data: rows } = await supabase
      .from("profiles")
      .select("id, full_name")
      .in("id", athleteIds)
      .order("full_name");
    linkedAthletes = (rows ?? []).map((r) => ({
      id: r.id as string,
      fullName: r.full_name as string | null,
    }));
  }

  return { userId: user.id, role, linkedAthletes };
}

/**
 * Vilket user_id en sidas frågor ska filtrera/skriva på.
 *
 * En löpare ser alltid bara sig själv — `athleteParam` ignoreras helt för
 * den rollen. En coach växlar via en `athlete`-query-parameter (samma
 * URL-drivna mönster som resten av /sasongen, se `competitionHref`) —
 * ogiltiga eller ej länkade värden faller tillbaka till första länkade
 * löparen. Har coachen ingen länkad löpare alls faller det tillbaka till
 * coachens eget id, vilket bara ger tomma resultat (coachen äger normalt
 * inga season_blocks/competitions själv) — ett medvetet ofarligt tomt läge,
 * inte en krasch.
 */
export function resolveScopedUserId(scoped: ScopedProfile, athleteParam?: string): string {
  if (scoped.role !== "coach") return scoped.userId;
  if (athleteParam && scoped.linkedAthletes.some((a) => a.id === athleteParam)) {
    return athleteParam;
  }
  return scoped.linkedAthletes[0]?.id ?? scoped.userId;
}
