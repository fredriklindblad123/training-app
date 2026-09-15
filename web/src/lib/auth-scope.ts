import { cache } from "react";
import type { createClient } from "@/lib/supabase/server";

/* Fas 0 (2026-08-14): grunden för att en coach ska kunna se/redigera flera
 * löpares säsongsplanering, inte bara sin egen. Se
 * supabase/migrations/20260814100000_coach_athletes.sql för RLS-sidan —
 * den här filen är bara läsvägen som väljer VILKET user_id en sidas frågor
 * ska filtrera på, inte säkerhetsgränsen. Säkerheten ligger helt i RLS: en
 * coach kan bara faktiskt läsa/skriva rader för löpare `coach_athletes`
 * länkar dem till, oavsett vad den här filen råkar returnera.
 *
 * Successivt utökat sedan dess till i princip hela appen — dashboard,
 * kalender, trender, tävlingsresultat, /arsplan, /blockplan och
 * /flerarsplan tar alla emot en `athlete`-param och visar
 * `<AthleteSwitcher>` för en coach. */

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

/* Memoiserad per render-pass. Layouten OCH sidan anropar den här på varje
 * navigering, och varje anrop kostade tre sekventiella nätverksrundor mot
 * Supabase (auth.getUser + profiles + coach_athletes). Med middleware och
 * layoutens egen getUser blev det runt åtta rundor innan något renderades —
 * vilket är vad som faktiskt kändes som en långsam meny.
 *
 * cache() nycklar på argumentet, så det här fungerar bara därför att
 * createClient numera returnerar samma instans hela requesten igenom. */
export const getScopedProfile = cache(async function getScopedProfile(
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
});

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
 * Löparna en coach kan växla mellan i väljaren.
 *
 * Innehöll fram till 2026-09-14 även coachen själv, som "Jag själv". Det
 * blandade ihop två olika saker: att coacha någon och att träna själv är inte
 * två adepter, utan två aktiviteter. Följden var att en tränare fick sin egen
 * löprunda liggande bredvid fyra sjuttonåringars, och ständigt behövde
 * kontrollera vem som var vald innan hen skrev något.
 *
 * Coachens egen träning nås i stället via en egen ingång i menyn ("Min
 * träning", se components/NavLinks.tsx) — ett konto, men två tydligt skilda
 * lägen. Alternativet som övervägdes var två separata inloggningar, vilket
 * hade tvingat fram en dubblerad Garmin-koppling och en utloggning varje gång
 * man vill se sin egen runda.
 *
 * Skild från `linkedAthletes` med flit — den listan är den strikta
 * coach_athletes-kopplingen och används där kopplingen SOM SÅDAN är
 * poängen (t.ex. "löpare du coachar" i Inställningar). Den här är till för
 * väljar-UI:t och för vilka löpare ett block kan gälla. En löpare (utan
 * coach-roll) har ingen växlare alls — bara sig själv.
 */
export function viewableAthletes(scoped: ScopedProfile): AthleteOption[] {
  if (scoped.role !== "coach") return [];
  return scoped.linkedAthletes;
}

/**
 * Får coachen se sin EGEN träning via `?athlete=<eget id>`?
 *
 * Ja — den vägen är hur "Min träning" fungerar. `viewableAthletes` listar
 * inte längre coachen, så `resolveScopedUserId` måste släppa igenom det egna
 * id:t separat; annars hade menyingången landat på första adepten i stället.
 */
function isSelfOrViewable(scoped: ScopedProfile, id: string): boolean {
  return id === scoped.userId || scoped.linkedAthletes.some((a) => a.id === id);
}

/**
 * Löpare ett block eller en tävling kan TILLDELAS.
 *
 * Skild från `viewableAthletes` sedan 2026-09-14, och skillnaden är hela
 * poängen: väljaren är ett coachningsverktyg och ska bara innehålla adepter,
 * men en tränare som själv tränar måste fortfarande kunna lägga ett block
 * eller en tävling på sig själv. Slås de ihop förlorar man antingen den
 * förmågan eller får tillbaka sin egen löprunda i adeptlistan.
 *
 * "Jag själv" står först — det är den enda raden som inte är en adept, och
 * ordningen gör att den inte glöms bort bland namnen.
 */
export function assignableAthletes(scoped: ScopedProfile): AthleteOption[] {
  if (scoped.role !== "coach") return [];
  return [{ id: scoped.userId, fullName: "Jag själv" }, ...scoped.linkedAthletes];
}

/**
 * Vilket user_id en sidas frågor ska filtrera/skriva på.
 *
 * En löpare ser alltid bara sig själv — `athleteParam` ignoreras helt för
 * den rollen. En coach växlar via en `athlete`-query-parameter (samma
 * URL-drivna mönster som resten av appen, se t.ex. `athleteHref` i
 * /arsplan) — och kan växla till sig själv precis som till en länkad löpare (se
 * `viewableAthletes`). Ogiltiga värden faller tillbaka till första länkade
 * löparen. Har coachen ingen länkad löpare alls faller det tillbaka till
 * coachens eget id, vilket bara ger tomma resultat (coachen äger normalt
 * inga season_blocks/competitions själv) — ett medvetet ofarligt tomt läge,
 * inte en krasch.
 */
export function resolveScopedUserId(
  scoped: ScopedProfile,
  athleteParam?: string,
  /** Löparläge (lib/view-mode.ts): coachen tittar på sin egen träning. Då
   * ignoreras athleteParam helt, precis som för en adept — annars hade en
   * gammal länk med ?athlete= i sig kunnat dra in en adepts data i en vy som
   * utger sig för att vara ens egen. */
  runnerMode = false,
): string {
  if (scoped.role !== "coach" || runnerMode) return scoped.userId;
  if (athleteParam && isSelfOrViewable(scoped, athleteParam)) {
    return athleteParam;
  }
  return scoped.linkedAthletes[0]?.id ?? scoped.userId;
}
