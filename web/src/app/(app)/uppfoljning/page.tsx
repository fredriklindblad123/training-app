import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getScopedProfile,
  planningOwnerId,
  viewableAthletes,
  type AthleteOption,
} from "@/lib/auth-scope";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import type { PlannedWorkout } from "@/lib/plan-matching";
import { computeRangeStats, type RangeStats } from "@/lib/range-stats";
import {
  PERIOD_KINDS,
  PERIOD_LABELS,
  isPeriodKind,
  resolveBlockPeriod,
  resolveDatePeriod,
  type PeriodBlock,
  type PeriodKind,
  type ResolvedPeriod,
} from "@/lib/uppfoljning-period";
import {
  WORKOUT_LABELS,
  addDays,
  toDateKey,
  workoutTypeColorVar,
  type WorkoutType,
} from "@/lib/planning";

/* Uppföljning (uttrycklig begäran 2026-08-27): tränarens statistiksida —
 * antal pass, typ av pass och planerat mot genomfört, för alla löpare
 * samtidigt, per block/månad/vecka/dag.
 *
 * Ersätter /oversikt, som togs bort samma dag. Den sidan visade ett kort per
 * löpare med DAGENS planerade och genomförda pass — vilket den här sidan
 * gör i granulariteten "Dag", plus tre grovare kadenser och de siffror
 * Översikt aldrig hade (efterlevnad, kvalitetsandel, fördelning per passtyp).
 * Beredskapsbadgen som Översikt också visade följde inte med: den hör till
 * dagsformen, inte till uppföljning av planen, och finns kvar på
 * /dashboard där den räknas ur samma daily_metrics.
 *
 * Räknelogiken är LÅNAD, inte nyskriven: computeRangeStats i
 * lib/range-stats.ts är exakt samma funktion som /arsplan visar sin
 * blockstatistik med (den hette computeBlockStats till 2026-08-27, se den
 * filens kommentar). Det är hela poängen — ett block som granskas här och på
 * Årsplan får aldrig visa olika siffror, eftersom det är samma kod på samma
 * data. Efterlevnaden kommer i sin tur ur summarizeCompliance, samma som
 * kalendern, Detaljplan och /trender.
 *
 * Sidan ligger i menyns PLAN-grupp (components/NavLinks.tsx) trots att den
 * mest visar utfall: frågan den svarar på är "höll planen?", vilket är
 * planeringens egen uppföljning — inte loggbokens "vad hände?". */

export const dynamic = "force-dynamic";

type PlannedRow = PlannedWorkout & { user_id: string; training_factor: string | null };

/** Ett datumspann kan sakna både plan och utfall för en löpare. Det är ett
 * normalt tillstånd (en ny löpare, en vecka framåt i tiden), inte ett fel —
 * raden visas ändå, med nollor, så att tränaren ser VILKA löpare som saknar
 * upplägg i stället för att de tyst faller ur tabellen. */
type AthleteRow = {
  athlete: AthleteOption;
  stats: RangeStats;
};

/** Dagen efter `dateKeyStr`, som exklusiv övre gräns mot `start_time`
 * (en timestamptz — att jämföra den mot ett rent datum ger midnatt). */
function dayAfter(dateKeyStr: string): string {
  return toDateKey(addDays(new Date(`${dateKeyStr}T00:00:00`), 1));
}

function pct(n: number): string {
  return `${Math.round(n * 100)} %`;
}

/** Efterlevnad som andel, eller null när ingenting var planerat — då finns
 * inget att vara trogen mot, och "0 %" vore direkt missvisande. */
function complianceShare(stats: RangeStats): number | null {
  const planned = stats.plannedCount + stats.plannedRestDays;
  if (planned === 0) return null;
  return stats.completedCount / planned;
}

export default async function UppfoljningPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; datum?: string; block?: string }>;
}) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null; // Layouten redirectar redan utan inloggning.
  if (scoped.role !== "coach") {
    // Samma spärr som /oversikt hade: en löpare har inga adepter att följa
    // upp, och hennes egen uppföljning bor på /dashboard och /trender.
    redirect("/dashboard");
  }

  const { period: periodParam, datum, block: blockParam } = await searchParams;
  const kind: PeriodKind = isPeriodKind(periodParam) ? periodParam : "vecka";
  const todayKey = toDateKey(new Date());
  const anchorDate = datum && /^\d{4}-\d{2}-\d{2}$/.test(datum) ? datum : todayKey;

  const athletes = viewableAthletes(scoped);

  // Blocken ägs av coachen (planningOwnerId), inte av löparna — se
  // season_block_athletes i migration 20260816100000. Hämtas alltid, inte
  // bara i block-läget, eftersom väljaren ska kunna byta TILL block.
  const { data: blockRows } = await supabase
    .from("season_blocks")
    .select("id, name, start_date, end_date")
    .eq("user_id", planningOwnerId(scoped))
    .order("start_date");
  const blocks = (blockRows ?? []) as PeriodBlock[];

  const period: ResolvedPeriod | null =
    kind === "block"
      ? resolveBlockPeriod(blocks, blockParam, todayKey)
      : resolveDatePeriod(kind, anchorDate);

  const athleteIds = athletes.map((a) => a.id);

  /* En fråga per tabell för ALLA löpare (.in på user_id), inte en fråga per
   * löpare som /oversikt gjorde. Med fyra adepter var det 16 rundturer per
   * sidladdning där tre räcker — och till skillnad från Översikt hämtar den
   * här sidan hela perioden, inte bara en dag, så antalet rader per fråga
   * växer med granulariteten. RLS filtrerar bort allt coachen inte får se,
   * oavsett vad `.in()` råkar innehålla. */
  const [{ data: plannedRows }, { data: activityRows }, { data: competitionRows }] =
    period == null || athleteIds.length === 0
      ? [{ data: [] }, { data: [] }, { data: [] }]
      : await Promise.all([
          supabase
            .from("planned_workouts")
            // Ett enda strängliteral, inte hopsatt med + — supabase-js
            // typar resultatet genom att PARSA select-strängen vid
            // typkontroll, och en konkatenering blir bara `string`, vilket
            // ger GenericStringError[] i stället för raderna.
            .select(
              "id, user_id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds, training_factor",
            )
            .in("user_id", athleteIds)
            .gte("scheduled_date", period.startDate)
            .lte("scheduled_date", period.endDate),
          supabase
            .from("activities")
            .select(SESSION_ACTIVITY_COLUMNS)
            .in("user_id", athleteIds)
            // Slutdagen är INKLUSIVE, så den övre gränsen är exklusiv och går
            // vid midnatt dagen efter — annars faller allt som startade efter
            // 00:00 sista dagen bort. Samma mönster som `nextExclusive` i
            // kalenderns månads- och veckovyer.
            .gte("start_time", period.startDate)
            .lt("start_time", dayAfter(period.endDate))
            .order("start_time"),
          supabase
            .from("competitions")
            .select("user_id, competition_date")
            .in("user_id", athleteIds)
            .gte("competition_date", period.startDate)
            .lte("competition_date", period.endDate),
        ]);

  /* Grupperingen till pass görs PER LÖPARE, aldrig på den blandade listan:
   * groupActivitiesIntoSessions slår ihop fragment som ligger nära varandra i
   * tid (uppvärmning + huvudpass + nerjogg, se docs/insikter-roadmap.md 1.3),
   * och två löpare som tränar samtidigt skulle annars smälta ihop till ett
   * enda pass. */
  const activitiesByAthlete = new Map<string, SessionActivity[]>();
  for (const row of (activityRows ?? []) as unknown as SessionActivity[]) {
    const list = activitiesByAthlete.get(row.user_id);
    if (list) list.push(row);
    else activitiesByAthlete.set(row.user_id, [row]);
  }

  const rows: AthleteRow[] =
    period == null
      ? []
      : athletes.map((athlete) => {
          const planned = ((plannedRows ?? []) as PlannedRow[]).filter(
            (p) => p.user_id === athlete.id,
          );
          const sessions: TrainingSession[] = groupActivitiesIntoSessions(
            activitiesByAthlete.get(athlete.id) ?? [],
          );
          const competitionDates = ((competitionRows ?? []) as { user_id: string; competition_date: string }[])
            .filter((c) => c.user_id === athlete.id)
            .map((c) => c.competition_date);

          return {
            athlete,
            stats: computeRangeStats({
              range: { startDate: period.startDate, endDate: period.endDate },
              planned,
              sessions,
              competitionDates,
            }),
          };
        });

  /** Bygger en länk som byter EN sak och behåller resten — samma
   * URL-param-mönster som /arsplan och /tavlingsresultat redan använder. */
  function href(next: { period?: PeriodKind; datum?: string; block?: string }): string {
    const params = new URLSearchParams();
    params.set("period", next.period ?? kind);
    const nextDatum = next.datum ?? anchorDate;
    if ((next.period ?? kind) !== "block") params.set("datum", nextDatum);
    const nextBlock = next.block ?? (kind === "block" ? blockParam : undefined);
    if ((next.period ?? kind) === "block" && nextBlock) params.set("block", nextBlock);
    return `/uppfoljning?${params.toString()}`;
  }

  const tab = (active: boolean) =>
    `rounded px-3 py-1 text-sm ${
      active
        ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
        : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
    }`;

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Uppföljning</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Alla dina löpare sida vid sida: hur många pass som var planerade, hur många som blev
          gjorda och hur de fördelade sig. Samma uträkning som blockstatistiken på Årsplan, så
          siffrorna kan aldrig säga emot varandra.
        </p>
      </div>

      {/* Granularitet */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap gap-1" role="group" aria-label="Period">
          {PERIOD_KINDS.map((k) => (
            <Link key={k} href={href({ period: k })} aria-current={kind === k ? "page" : undefined} className={tab(kind === k)}>
              {PERIOD_LABELS[k]}
            </Link>
          ))}
        </div>

        {/* Periodnavigering. Datumperioder är oändliga åt båda håll; block
            tar slut, och då döljs pilen hellre än att visas död. */}
        {period && (
          <div className="flex items-center gap-2 text-sm">
            {period.prevAnchor ? (
              <Link
                href={kind === "block" ? href({ block: period.prevAnchor }) : href({ datum: period.prevAnchor })}
                className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                aria-label="Föregående period"
              >
                ←
              </Link>
            ) : (
              <span className="px-2 py-1 text-zinc-300 dark:text-zinc-700" aria-hidden>
                ←
              </span>
            )}
            <span className="min-w-48 text-center font-medium text-zinc-900 dark:text-zinc-100">
              {period.label}
            </span>
            {period.nextAnchor ? (
              <Link
                href={kind === "block" ? href({ block: period.nextAnchor }) : href({ datum: period.nextAnchor })}
                className="rounded border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                aria-label="Nästa period"
              >
                →
              </Link>
            ) : (
              <span className="px-2 py-1 text-zinc-300 dark:text-zinc-700" aria-hidden>
                →
              </span>
            )}
            <span className="text-xs text-zinc-400 dark:text-zinc-500">
              {period.startDate} – {period.endDate}
            </span>
          </div>
        )}
      </div>

      {kind === "block" && period == null && (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">
          Inga block upplagda än — lägg upp säsongen på{" "}
          <Link href="/arsplan" className="underline">
            Årsplan
          </Link>
          .
        </p>
      )}

      {athletes.length === 0 && (
        <p className="text-sm text-zinc-400 dark:text-zinc-600">
          Inga löpare kopplade än — lägg till en under Inställningar.
        </p>
      )}

      {period && rows.length > 0 && (
        <>
          {/* Tabellen scrollar i sin egen behållare — sidan i sig ska aldrig
              scrolla i sidled, och åtta kolumner får inte plats på en telefon. */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-3xl border-collapse text-sm">
              <thead>
                <tr className="border-b border-zinc-200 text-left text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  <th scope="col" className="py-2 pr-4 font-medium">Löpare</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Planerat</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Genomfört</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Efterlevnad</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Kvalitet</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Distans</th>
                  <th scope="col" className="py-2 pr-4 font-medium">Tid</th>
                  <th scope="col" className="py-2 font-medium">Tävlingar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ athlete, stats }) => {
                  const share = complianceShare(stats);
                  return (
                    <tr key={athlete.id} className="border-b border-zinc-100 dark:border-zinc-900">
                      <th scope="row" className="py-2 pr-4 text-left font-medium text-zinc-900 dark:text-zinc-100">
                        <Link href={`/dashboard?athlete=${athlete.id}`} className="hover:underline">
                          {athlete.fullName ?? "Namnlös löpare"}
                        </Link>
                      </th>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        {stats.plannedCount}
                        {stats.plannedRestDays > 0 && (
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            {" "}
                            +{stats.plannedRestDays} vila
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        {stats.sessionCount}
                        {stats.unplannedCount > 0 && (
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            {" "}
                            varav {stats.unplannedCount} oplanerade
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        {/* Ingen färgskala här med flit: docs/tranarloopen.md
                            avsnitt 6 — rött för vad någon gjort eller inte
                            gjort hör inte hemma i appen. Talet står för sig. */}
                        {share == null ? (
                          <span className="text-zinc-400 dark:text-zinc-600">inget planerat</span>
                        ) : (
                          `${stats.completedCount} av ${stats.plannedCount + stats.plannedRestDays} · ${pct(share)}`
                        )}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        {stats.qualityPlanned === 0 ? (
                          <span className="text-zinc-400 dark:text-zinc-600">—</span>
                        ) : (
                          `${stats.qualityCompleted} av ${stats.qualityPlanned}`
                        )}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        {stats.actualKm.toFixed(1)} km
                        {stats.plannedKm != null && (
                          <span className="text-xs text-zinc-400 dark:text-zinc-500">
                            {" "}
                            / plan {stats.plannedKm.toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td className="py-2 pr-4 text-zinc-700 dark:text-zinc-300">
                        {stats.actualHours.toFixed(1)} h
                      </td>
                      <td className="py-2 text-zinc-700 dark:text-zinc-300">
                        {stats.competitionCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Fördelning per passtyp — samma chip-form och samma
              kategorifärger (workoutTypeColorVar) som Årsplans
              blockstatistik, så en typ ser likadan ut var man än möter den. */}
          <section className="flex flex-col gap-3">
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              Planerade pass per typ
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map(({ athlete, stats }) => (
                <div key={athlete.id} className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {athlete.fullName ?? "Namnlös löpare"}
                  </div>
                  {stats.plannedByType.length === 0 ? (
                    <p className="mt-2 text-sm text-zinc-400 dark:text-zinc-600">
                      Inget planerat den här perioden.
                    </p>
                  ) : (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {stats.plannedByType.map((row) => (
                        <span
                          key={row.type}
                          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-200 px-2 py-0.5 text-xs text-zinc-700 dark:border-zinc-700 dark:text-zinc-300"
                        >
                          <span
                            className="h-2 w-2 shrink-0 rounded-full"
                            style={
                              workoutTypeColorVar(row.type)
                                ? { backgroundColor: workoutTypeColorVar(row.type) as string }
                                : { border: "1.5px dashed currentColor" }
                            }
                            aria-hidden="true"
                          />
                          {WORKOUT_LABELS[row.type as WorkoutType] ?? row.type} · {row.count}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
