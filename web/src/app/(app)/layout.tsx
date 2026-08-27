import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { canEditPlanning, getScopedProfile } from "@/lib/auth-scope";
import { signOut } from "@/app/login/actions";
import { NavLinks } from "@/components/NavLinks";

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

  return (
    <div className="flex flex-1 flex-col">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-zinc-200 px-6 py-3 dark:border-zinc-800">
        <Suspense fallback={<span className="text-sm text-zinc-400">Laddar meny…</span>}>
          <NavLinks
            isCoach={scoped?.role === "coach"}
            planOwnedByCoach={scoped != null && !canEditPlanning(scoped)}
          />
        </Suspense>
        <div className="flex items-center gap-3 text-sm text-zinc-500 dark:text-zinc-400">
          <span>{user.email}</span>
          <form action={signOut}>
            <button type="submit" className="hover:text-zinc-950 dark:hover:text-zinc-50">
              Logga ut
            </button>
          </form>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
