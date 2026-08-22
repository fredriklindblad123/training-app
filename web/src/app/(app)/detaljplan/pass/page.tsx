import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getScopedProfile,
  resolveScopedUserId,
  viewableAthletes,
  type AthleteOption,
} from "@/lib/auth-scope";
import { WEEKDAY_LABELS } from "@/lib/planning";
import { DayContent } from "@/components/DayContent";

/* Dagsvy för flera löpare samtidigt (uttrycklig begäran 2026-08-22): klick
 * på ett pass i Detaljplans veckovy landar här, med en kolumn per löpare i
 * det urval man stod på. Kalenderns dagvy visar samma sak för EN löpare —
 * den här sidan finns för att kunna läsa flera mot varandra utan att klicka
 * fram och tillbaka.
 *
 * Hela dagen visas, inte bara det pass som klickades: det var det som
 * efterfrågades ("dagsvyn, med all information"), och matchPlanToSessions
 * parar ändå ihop plan och utfall över hela dagen (en dubbeltröskeldag har
 * två av varje).
 *
 * Redigering av planerade pass sker med kalenderdagvyns egna actions —
 * ingen kopia av den logiken här, så ett pass beter sig likadant oavsett
 * vilken av de två vyerna man råkar redigera det i. */

function weekdayLabel(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  return WEEKDAY_LABELS[(d.getUTCDay() + 6) % 7];
}

/** En löpares kolumn: rubrik + hela dagvyn. Innehållet kommer från samma
 * DayContent som kalenderns dagvy renderar, så kolumnerna visar exakt allt
 * den gör — och kan aldrig glida isär från den. */
function AthleteColumn({
  athlete,
  dateKey,
  nextDateKey,
}: {
  athlete: AthleteOption;
  dateKey: string;
  nextDateKey: string;
}) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return (
    <div className="flex min-w-[26rem] flex-1 flex-col gap-3 rounded border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          {athlete.fullName ?? "Namnlös löpare"}
        </span>
        <Link
          href={`/calendar/${y}/${m}/${d}?athlete=${athlete.id}`}
          className="text-xs text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          Hennes kalenderdag →
        </Link>
      </div>
      <DayContent userId={athlete.id} dateStr={dateKey} nextDateStr={nextDateKey} />
    </div>
  );
}

export default async function PassDayPage({
  searchParams,
}: {
  searchParams: Promise<{ block?: string; date?: string; slot?: string; athlete?: string }>;
}) {
  const { block: blockId, date: dateKey, athlete: athleteParam } = await searchParams;
  if (!dateKey || !/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) notFound();

  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;

  const athletesById = new Map(viewableAthletes(scoped).map((a) => [a.id, a]));
  const showAll = athleteParam === "alla" || (athleteParam == null && scoped.role === "coach");
  const focusId = showAll ? null : resolveScopedUserId(scoped, athleteParam ?? undefined);

  // Vilka löpare kolumnerna gäller: blockets taggade löpare (det är därifrån
  // man klickade), begränsat till urvalet vyn stod på. Utan block faller vi
  // tillbaka på den enskilda löparen — sidan ska aldrig visa fler än man
  // valt.
  let candidateIds: string[] = [];
  let blockName: string | null = null;
  if (blockId) {
    const { data: block } = await supabase
      .from("season_blocks")
      .select("id, name, season_block_athletes(athlete_id)")
      .eq("id", blockId)
      .maybeSingle();
    if (block) {
      blockName = block.name as string;
      candidateIds = ((block.season_block_athletes ?? []) as { athlete_id: string }[]).map(
        (r) => r.athlete_id,
      );
    }
  }
  if (candidateIds.length === 0 && focusId) candidateIds = [focusId];
  const athleteIds = candidateIds.filter((id) => (focusId ? id === focusId : true));
  if (athleteIds.length === 0) notFound();

  const nextDate = new Date(`${dateKey}T00:00:00Z`);
  nextDate.setUTCDate(nextDate.getUTCDate() + 1);
  const nextDateKey = nextDate.toISOString().slice(0, 10);

  const columns = athleteIds
    .map((id) => athletesById.get(id))
    .filter((a): a is AthleteOption => a != null);

  const backHref = `/detaljplan${showAll ? "?athlete=alla" : focusId ? `?athlete=${focusId}` : ""}`;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <Link
          href={backHref}
          className="text-sm text-zinc-500 underline underline-offset-2 hover:text-zinc-800 dark:text-zinc-400 dark:hover:text-zinc-200"
        >
          ← Detaljplan
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          {weekdayLabel(dateKey)} {dateKey}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
          {columns.length === 1
            ? columns[0].fullName ?? "Namnlös löpare"
            : `${columns.length} löpare sida vid sida`}
          {blockName ? ` · ${blockName}` : ""}
        </p>
        {columns.length > 1 && (
          /* Formuläret finns i varje kolumn, men passets detaljer hör till
             PASSET och inte till löparen — en ändring i vilken kolumn som
             helst gäller alla taggade. Utan den här raden ser det ut som att
             man måste skriva samma sak en gång per löpare. */
          <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
            Passets innehåll är gemensamt: ändrar du det planerade passet i en kolumn gäller
            ändringen alla löpare som är taggade till det. Dagbok, genomförda pass och
            sömn är förstås personliga.
          </p>
        )}
      </div>

      {columns.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">Inga löpare att visa.</p>
      ) : (
        <div className="flex flex-wrap items-start gap-4">
          {columns.map((a) => (
            <AthleteColumn
              key={a.id}
              athlete={a}
              dateKey={dateKey}
              nextDateKey={nextDateKey}
            />
          ))}
        </div>
      )}
    </div>
  );
}
