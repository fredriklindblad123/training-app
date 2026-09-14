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
import { NavLinks, NavLinksView } from "@/components/NavLinks";
import { ViewModeToggle } from "@/components/ViewModeToggle";
import { HeaderAthleteSwitcher } from "@/components/HeaderAthleteSwitcher";
import { getViewMode } from "@/lib/view-mode";
import { syncTargetsFromScope, triggerGarminSyncForAll } from "@/lib/garmin-sync";

/* Menyn grupperas sedan 2026-08-27 i Logg och Plan — se motiveringen i
 * components/NavLinks.tsx, som äger både grupperna och ordningen. Historiken
 * nedan är varför de enskilda länkarna heter som de gör.
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
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Styr två saker i menyn: om "Översikt" (alla adepter sida vid sida) ska
  // synas — en löpare har ingen egen adept att se en översikt av — och om
  // Plan-gruppen ska märkas som tränarens (en adept med länkad coach ser
  // planeringen skrivskyddad, se canEditPlanning).
  const scoped = await getScopedProfile(supabase);
  const isCoach = scoped?.role === "coach";
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
  if (scoped) {
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
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--line)] px-6 py-3">
        {/* Fallbacken renderar SAMMA meny, bara utan löparvalet i länkarna.
            Tidigare stod det "Laddar meny…" här, vilket betydde att menyn
            försvann och ersattes av en textrad vid varje navigering — det såg
            ut som att appen laddade om sig själv. Suspense behövs bara för att
            NavLinks läser useSearchParams(); resten av menyn är känd direkt. */}
        <Suspense
          fallback={
            <NavLinksView
              isCoach={isCoach}
              planOwnedByCoach={scoped != null && !canEditPlanning(scoped)}
              runnerMode={runnerMode}
              athlete={null}
            />
          }
        >
          <NavLinks
            isCoach={isCoach}
            planOwnedByCoach={scoped != null && !canEditPlanning(scoped)}
            runnerMode={runnerMode}
          />
        </Suspense>
        <div className="flex flex-wrap items-center gap-3 text-sm text-[var(--ink-3)]">
          {/* Löparväljaren har EN plats i hela appen, och det är här.
              Den låg tidigare inuti varje sida och hamnade därför på olika
              djup överallt — direkt under rubriken på kalendersidorna, tre
              element in på Blockplan. Att den flyttade sig när man bytte sida
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

          {/* Växeln närmast kontot: den byter vem DU är i appen, inte vad du
              tittar på. Bara för en coach — en adept är bara löpare. */}
          {isCoach && <ViewModeToggle mode={mode} />}
          <span className="hidden sm:inline">{user.email}</span>
          <form action={signOut}>
            <button type="submit" className="hover:text-[var(--foreground)]">
              Logga ut
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
