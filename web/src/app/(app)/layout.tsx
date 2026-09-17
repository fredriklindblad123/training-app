import { Suspense } from "react";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  canEditPlanning,
  getScopedProfile,
  resolveScopedUserId,
  viewableAthletes,
} from "@/lib/auth-scope";
import { signOut } from "@/app/login/actions";
import { RefreshGarmin } from "@/components/RefreshGarmin";
import { BottomNav } from "@/components/BottomNav";
import { TopBar } from "@/components/TopBar";
import { ModeCircle } from "@/components/ModeCircle";
import { circleButtonClass } from "@/components/ui/CircleButton";
import { getViewMode } from "@/lib/view-mode";
import { syncTargetsFromScope, triggerGarminSyncForAll } from "@/lib/garmin-sync";

/* Navigeringen bor sedan 2026-09-16 i components/BottomNav.tsx, längst ned
 * på sidan i stället för i sidhuvudet. Den äger grupperna (Logg och Plan,
 * sedan 2026-08-27) och ordningen. Historiken nedan är varför de enskilda
 * vyerna heter som de gör.
 *
 * Ordningen namngav tidigare loopens kadenser, inte artefakttyper
 * (docs/tranarloopen.md). Första länken hette tidigare "Idag"; bytt tillbaka
 * till "Dashboard" 2026-08-12 på uttrycklig begäran. Träningskalendern
 * flyttades upp som andra länk 2026-08-13 (uppslagsverket man går till näst
 * oftast efter dashboarden) och döptes om från "Kalender" för att skilja
 * den från kalenderappar i största allmänhet.
 *
 * "Blocket" döptes 2026-08-13 om till "Trender" (och /blocket → /trender) —
 * sidan visade redan trendanalys internt (rubriken sa "Trender"), bara
 * menyn och adressen hade halkat efter. "Tävlingsresultat" fick en egen
 * länk samma dag, utbruten ur Säsongen (se sasongen/page.tsx).
 *
 * "Veckan" togs bort 2026-08-13: dubblerade kalenderns veckovy
 * (/calendar/vecka/[date]), som nu äger både rutnätet och nyckeltalen.
 *
 * "Flerårsplan" (fas 0, 2026-08-14): mål/volym/tävlingar per år, en egen
 * länk bredvid Säsongen eftersom den lever på en längre horisont än en
 * enskild säsong — se /flerarsplan/page.tsx.
 *
 * Själva länklistan bor numera i components/NavLinks.tsx — utbruten till en
 * klientkomponent 2026-08-16 så att en coachs valda löpare (?athlete=)
 * följer med genom hela menyn, inte bara inom en sida. */

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();

  /* EN autentiseringsrunda, inte två (2026-09-16).
   *
   * Layouten anropade tidigare auth.getUser() här, och getScopedProfile
   * anropade den igen några rader ned. createClient och getScopedProfile är
   * båda memoiserade per rendering, men getUser är det inte — den går alltid
   * ut på nätet mot Supabase Auth för att validera token.
   *
   * Uppmätt mot produktion: ett oinloggat anrop till /dashboard, som bara
   * hinner köra middleware och omdirigera, tar 440 ms. Rundan kostar alltså
   * omkring 200 ms, och den gjordes två gånger innan något renderades.
   *
   * getScopedProfile returnerar null utan inloggad användare, vilket är exakt
   * samma villkor som getUser gav — inloggningskontrollen blir därmed inte
   * svagare, bara billigare. */
  const scoped = await getScopedProfile(supabase);
  if (!scoped) {
    redirect("/login");
  }

  // Styr två saker i menyn: om "Översikt" (alla adepter sida vid sida) ska
  // synas — en löpare har ingen egen adept att se en översikt av — och om
  // Plan-gruppen ska märkas som tränarens (en adept med länkad coach ser
  // planeringen skrivskyddad, se canEditPlanning).
  const isCoach = scoped.role === "coach";
  const mode = await getViewMode();
  const runnerMode = isCoach && mode === "runner";

  /* Garmin-synk på VARJE sidvisning, inte bara vid inloggning.
   *
   * Tidigare triggades den bara av login-formuläret. En tränare som stannar
   * inloggad hela dagen och klickar mellan sina adepter fick därmed data som
   * i värsta fall var ett dygn gammal (nattens cron) — och det är precis när
   * man öppnar en adepts sida som man vill ha färskt.
   *
   * Kostar noll extra frågor: listan härleds ur `scoped`, som layouten redan
   * hämtat. Och den är strypt i Python (AUTO_SYNC_MIN_INTERVAL_MINUTES = 15),
   * så tät klickning ger inte täta Garmin-anrop — det är strypningen som gör
   * att det här går att göra per sidvisning över huvud taget.
   *
   * after() så att inget av det syns i svarstiden. */
  {
    const targets = syncTargetsFromScope(scoped);
    after(async () => {
      try {
        await triggerGarminSyncForAll(targets);
      } catch {
        // Synkas ändå på schemat eller vid nästa sidvisning. En misslyckad
        // bakgrundssynk får aldrig synas för den som bara bläddrar.
      }
    });
  }

  return (
    <div className="flex flex-1 flex-col">
      {/* Uppe: vem du tittar på och vem du är. Nere: vilken vy du är i.
          Uppdelningen är medveten — toppraden ändrar SAMMANHANG, bottenraden
          byter VY, och att blanda dem gjorde tidigare båda raderna till
          samlingar av knappar utan inbördes ordning. */}
      <Suspense fallback={null}>
        <TopBar
          /* Tom lista i löparläge: då tittar man på sig själv och har inget
             att växla mellan. */
          athletes={isCoach && !runnerMode ? viewableAthletes(scoped) : []}
          defaultAthleteId={resolveScopedUserId(scoped)}
          actions={
            <>
              {/* Manuell hämtning. Automatiken går på varje sidvisning men är
                  strypt till femton minuter; den här struntar i strypningen,
                  för den som just kommit hem från ett pass vill se det nu.
                  Strömmas in: komponenten gör en egen fråga för senaste
                  synktidpunkt, och den ska inte hålla upp resten av raden.
                  Fallbacken är samma cirkel, avstängd, så inget hoppar. */}
              <Suspense
                fallback={
                  <span
                    aria-hidden
                    className="h-8 w-8 shrink-0 rounded-full border border-[var(--line)] bg-[var(--surface)] opacity-60"
                  />
                }
              >
                <RefreshGarmin />
              </Suspense>

              {/* Bara för en coach — en adept är bara löpare och har inget
                  att växla mellan. */}
              {isCoach && <ModeCircle mode={mode} />}

              <form action={signOut} className="flex">
                <button
                  type="submit"
                  title="Logga ut"
                  aria-label="Logga ut"
                  className={circleButtonClass}
                >
                  <svg
                    viewBox="0 0 24 24"
                    className="h-4 w-4"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={1.9}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <path d="M15 17l5-5-5-5M20 12H9M11 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h5" />
                  </svg>
                </button>
              </form>
            </>
          }
        />
      </Suspense>

      {/* Plats för den klistrade bottenraden. Utan den lägger sig menyn över
          sidans sista sektion — syntes i säsongsöversikten, där
          tävlingsbanan hamnade delvis bakom flikarna. Rapporterat. */}
      <main className="flex flex-1 flex-col pb-28 sm:pb-24">{children}</main>

      {/* Navigeringen, inom räckhåll för tummen. Suspense eftersom
          komponenten läser searchParams för att bära löparvalet mellan
          vyerna. */}
      <Suspense fallback={null}>
        <BottomNav
          isCoach={isCoach}
          planOwnedByCoach={!canEditPlanning(scoped)}
          runnerMode={runnerMode}
        />
      </Suspense>
    </div>
  );
}
