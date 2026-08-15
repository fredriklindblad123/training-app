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
  /** Bara ifyllt för en löpare som har en coach — coachens id. Styr vem som
   * äger säsongsplaneringen (se planningOwnerId/canEditPlanning nedan). En
   * löpare kan i teorin ha flera coacher i schemat, men produkten har hittills
   * bara ett coach↔löpare-förhållande — första länken vinner. */
  coachId: string | null;
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
    const { data: coachLink } = await supabase
      .from("coach_athletes")
      .select("coach_id")
      .eq("athlete_id", user.id)
      .limit(1)
      .maybeSingle();
    return {
      userId: user.id,
      role,
      linkedAthletes: [],
      coachId: (coachLink?.coach_id as string | undefined) ?? null,
    };
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

  return { userId: user.id, role, linkedAthletes, coachId: null };
}

/**
 * Vem som äger säsongsplaneringen (block, veckomallar) för den här personen
 * — coachens id om löparen har en coach, annars den egna. En coach äger
 * alltid sin egen planering oavsett vilken löpare hen råkar visa just nu i
 * växlaren (den styr bara VILKEN löpares block som listas, inte vem
 * innehållet tillhör) — det är det som gör att samma block/mall kan gälla
 * flera löpare utan att dupliceras, se season_block_athletes i migration
 * 20260816100000.
 */
export function planningOwnerId(scoped: ScopedProfile): string {
  if (scoped.role === "coach") return scoped.userId;
  return scoped.coachId ?? scoped.userId;
}

/**
 * Får den inloggade personen redigera säsongsplaneringen (skapa/ändra block
 * och veckomallar) själv? En coach: alltid. En löpare: bara om hen inte har
 * en coach (självcoachat läge, samma som appen fungerade innan Fas 0) —
 * annars äger coachen planeringen och löparens vy är skrivskyddad.
 *
 * Ren UI-signal (döljer redigeringsformulär) — den faktiska spärren ligger i
 * RLS (season_blocks/week_templates m.fl., migration 20260816100000), så en
 * manipulerad request stoppas där oavsett vad den här funktionen svarar.
 */
export function canEditPlanning(scoped: ScopedProfile): boolean {
  return scoped.role === "coach" || scoped.coachId == null;
}

/**
 * Alla "vyer" en coach kan växla mellan i löparväljaren: sig själv (Fredrik
 * tränar ju också, utan egen tränare — se `canEditPlanning`, det gör hans
 * egen planering fullt redigerbar precis som innan Fas 0) plus alla länkade
 * löpare (Alice, Nike, ...). Skild från `linkedAthletes` med flit: den
 * listan är fortfarande den strikta coach_athletes-kopplingen (t.ex.
 * "löpare du coachar"-listan i Inställningar, där "ta bort dig själv" inte
 * skulle betyda något), den här är bara till för väljar-UI:t och för vilka
 * löpare ett block kan gälla för. En löpare (utan coach-roll) har ingen
 * växlare alls — bara sig själv.
 */
export function viewableAthletes(scoped: ScopedProfile): AthleteOption[] {
  if (scoped.role !== "coach") return [];
  return [{ id: scoped.userId, fullName: "Jag själv" }, ...scoped.linkedAthletes];
}

/**
 * Vilket user_id en sidas frågor ska filtrera/skriva på.
 *
 * En löpare ser alltid bara sig själv — `athleteParam` ignoreras helt för
 * den rollen. En coach växlar via en `athlete`-query-parameter (samma
 * URL-drivna mönster som resten av /sasongen, se `competitionHref`) — och
 * kan växla till sig själv precis som till en länkad löpare (se
 * `viewableAthletes`). Ogiltiga värden faller tillbaka till första länkade
 * löparen. Har coachen ingen länkad löpare alls faller det tillbaka till
 * coachens eget id, vilket bara ger tomma resultat (coachen äger normalt
 * inga season_blocks/competitions själv) — ett medvetet ofarligt tomt läge,
 * inte en krasch.
 */
export function resolveScopedUserId(scoped: ScopedProfile, athleteParam?: string): string {
  if (scoped.role !== "coach") return scoped.userId;
  if (athleteParam && viewableAthletes(scoped).some((a) => a.id === athleteParam)) {
    return athleteParam;
  }
  return scoped.linkedAthletes[0]?.id ?? scoped.userId;
}
