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
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { HeaderAthleteSwitcher } from "@/components/HeaderAthleteSwitcher";
import { RefreshGarmin } from "@/components/RefreshGarmin";
import { BottomNav } from "@/components/BottomNav";
import { Dropdown } from "@/components/ui/Dropdown";
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
      {/* Fast header.
          Sidorna är långa — Trender har sex diagramsektioner, Blockplan ett
          rutnät per block — och valen man gör oftast låg längst upp, utanför
          skärmen. Nu följer de med.
          Halvgenomskinlig botten med backdrop-blur i stället för en solid:
          innehållet som passerar under ska synas skymta, annars ser raden ut
          som ett avhugget lock. z-40 räcker med marginal — inget i appen
          lägger sig högre än dropdownernas z-50, som ligger INUTI headern. */}
      {/* Sidhuvudet bär inte längre någon navigering (2026-09-16). Den bor i
          BottomNav, inom räckhåll för tummen. Kvar här är bara VEM du tittar
          på och VEM du är — löparväljaren, Garmin-uppdateringen och kontot. */}
      <header className="sticky top-0 z-40 flex flex-wrap items-center justify-end gap-x-4 gap-y-2 border-b border-[var(--line)] bg-[var(--background)]/90 px-4 py-2 backdrop-blur sm:px-6">
        <div className="flex flex-wrap items-center gap-2 text-sm text-[var(--ink-3)]">
          {/* Löparväljaren har EN plats i hela appen, och det är här.
              Den låg tidigare inuti varje sida och hamnade därför på olika
              djup överallt — direkt under rubriken på kalendersidorna, tre
              element in på Blocköversikt. Att den flyttade sig när man bytte sida
              gjorde att man fick leta efter det man använder oftast.
              Dold i löparläge: då tittar man på sig själv, och det finns
              inget att växla mellan. Suspense av samma skäl som menyn —
              komponenten läser searchParams. */}
          {isCoach && !runnerMode && scoped != null && (
            <Suspense fallback={null}>
              <HeaderAthleteSwitcher
                athletes={viewableAthletes(scoped)}
                defaultAthleteId={resolveScopedUserId(scoped)}
              />
            </Suspense>
          )}

          {/* Manuell hämtning. Automatiken går på varje sidvisning men är
              strypt till femton minuter; den här struntar i strypningen, för
              den som just kommit hem från ett pass vill se det nu. */}
          {/* Strömmas in (2026-09-16). Komponenten gör en egen fråga för att
              hämta senaste synktidpunkt, och den låg i den blockerande vägen:
              ingen del av sidhuvudet kunde ritas förrän garmin_connections
              svarat. Nu ritas knappen direkt och klockslaget fyller i sig när
              frågan är klar.
              Fallbacken är samma knapp, avstängd, och inte en snurra: formen
              är densamma så inget hoppar när den riktiga versionen tar över.
              Avstängd med flit — den riktiga knappen sitter i ett <form>, och
              en kopia utanför formuläret hade gått att klicka utan att något
              hände. */}
          <Suspense
            fallback={
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled
                  className="display flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-sm font-medium text-[var(--ink-2)] opacity-70"
                >
                  <span aria-hidden className="inline-block h-3 w-3" />
                  Uppdatera
                </button>
              </div>
            }
          >
            <RefreshGarmin />
          </Suspense>

          {/* Kontot samlat bakom EN knapp (2026-09-16).
              Lägesväxeln, adressen och utloggningen låg utspridda i raden och
              tog plats från det man faktiskt använder. Att byta mellan
              tränare och löpare gör man några gånger i veckan, inte per
              minut, och att logga ut ännu mer sällan — de hör hemma bakom ett
              klick, inte framför. */}
          <Dropdown
            align="right"
            width="w-56"
            label={
              <span
                aria-hidden
                className="display flex h-7 w-7 items-center justify-center rounded-full bg-[var(--surface-raised)] text-xs font-bold text-[var(--foreground)]"
              >
                {(scoped.email ?? "?").charAt(0).toUpperCase()}
              </span>
            }
          >
            <span className="truncate px-2 pt-1 pb-2 text-xs text-[var(--ink-3)]">
              {scoped.email}
            </span>
            {isCoach && (
              <div className="border-t border-[var(--line)] px-2 py-2">
                <ViewModeToggle mode={mode} />
              </div>
            )}
            <form action={signOut} className="border-t border-[var(--line)] pt-2">
              <button
                type="submit"
                className="w-full rounded-md px-2 py-1 text-left text-sm text-[var(--ink-2)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
              >
                Logga ut
              </button>
            </form>
          </Dropdown>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>

      {/* Hela navigeringen, längst ned. Suspense eftersom komponenten läser
          searchParams för att bära löparvalet mellan vyerna. */}
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
