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
import { Card, CardHeader } from "@/components/ui/Card";
import { Chip } from "@/components/ui/Chip";
import { Stat, StatRow, StatCell } from "@/components/ui/Stat";
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
import { buttonClass } from "@/components/ui/controls";
import { getViewMode } from "@/lib/view-mode";
import { AthleteMultiSelect } from "@/components/AthleteSwitcher";

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
 * lib/range-stats.ts är exakt samma funktion som /blockplan visar sin
 * blockstatistik med (den hette computeBlockStats till 2026-08-27, se den
 * filens kommentar). Det är hela poängen — ett block som granskas här och på
 * Blockplan får aldrig visa olika siffror, eftersom det är samma kod på samma
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
  searchParams: Promise<{ period?: string; datum?: string; block?: string; athlete?: string | string[] }>;
}) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null; // Layouten redirectar redan utan inloggning.
  if (scoped.role !== "coach") {
    // Samma spärr som /oversikt hade: en löpare har inga adepter att följa
    // upp, och hennes egen uppföljning bor på /dashboard och /trender.
    redirect("/dashboard");
  }

  /* Även en coach skickas härifrån i LÖPARLÄGE. Sidan är ren coachning — den
   * listar adepternas efterlevnad — och att nå den via en gammal länk medan
   * växeln står på "Löpare" hade visat andras data i ett läge som utger sig
   * för att vara ens eget. Menyn döljer redan länken; det här täpper till
   * bokmärket. */
  if ((await getViewMode()) === "runner") {
    redirect("/dashboard");
  }

  const {
    period: periodParam,
    datum,
    block: blockParam,
    athlete: athleteParam,
  } = await searchParams;
  const kind: PeriodKind = isPeriodKind(periodParam) ? periodParam : "vecka";
  const todayKey = toDateKey(new Date());
  const anchorDate = datum && /^\d{4}-\d{2}-\d{2}$/.test(datum) ? datum : todayKey;

  /* Urvalet av löpare. Upprepade ?athlete= (Next ger en sträng för en och en
     array för flera), filtrerade mot vilka som faktiskt är ens adepter — en
     handskriven URL ska inte kunna dra in någon annans siffror. Tomt urval
     betyder ALLA, så en länk utan parametrar fungerar som förut. */
  const allAthletes = viewableAthletes(scoped);
  const requested =
    athleteParam == null ? [] : Array.isArray(athleteParam) ? athleteParam : [athleteParam];
  const selectedIds = requested.filter((id) => allAthletes.some((a) => a.id === id));
  const athletes = selectedIds.length > 0
    ? allAthletes.filter((a) => selectedIds.includes(a.id))
    : allAthletes;

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
   * URL-param-mönster som /blockplan och /tavlingsresultat redan använder. */
  function href(next: { period?: PeriodKind; datum?: string; block?: string }): string {
    const params = new URLSearchParams();
    params.set("period", next.period ?? kind);
    const nextDatum = next.datum ?? anchorDate;
    if ((next.period ?? kind) !== "block") params.set("datum", nextDatum);
    const nextBlock = next.block ?? (kind === "block" ? blockParam : undefined);
    if ((next.period ?? kind) === "block" && nextBlock) params.set("block", nextBlock);
    for (const id of selectedIds) params.append("athlete", id);
    return `/uppfoljning?${params.toString()}`;
  }

  const tab = (active: boolean) =>
    `rounded px-3 py-1 text-sm ${
      active
        ? "bg-[var(--foreground)] text-[var(--background)]"
        : "border border-[var(--line)] hover:bg-[var(--surface-raised)] hover:bg-[var(--surface-raised)]"
    }`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div>
        <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Uppföljning</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Alla dina löpare sida vid sida: hur många pass som var planerade, hur många som blev
          gjorda och hur de fördelade sig. Samma uträkning som blockstatistiken på Blockplan, så
          siffrorna kan aldrig säga emot varandra.
        </p>
      </div>

      {/* Flerval: en plan gäller en grupp, och tränaren vill se just de löpare
          hen håller på med — inte alla, och inte en i taget. Enkelval hör till
          loggsidorna, där två personers data inte går att slå ihop. */}
      {allAthletes.length > 1 && (
        <AthleteMultiSelect
          athletes={allAthletes}
          selected={selectedIds}
          buildHref={(ids) => {
            const params = new URLSearchParams();
            params.set("period", kind);
            if (kind !== "block") params.set("datum", anchorDate);
            if (kind === "block" && blockParam) params.set("block", blockParam);
            for (const id of ids) params.append("athlete", id);
            return `/uppfoljning?${params.toString()}`;
          }}
        />
      )}

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
                className={buttonClass}
                aria-label="Föregående period"
              >
                ←
              </Link>
            ) : (
              <span className="px-2 py-1 text-[var(--ink-3)]" aria-hidden>
                ←
              </span>
            )}
            <span className="min-w-48 text-center font-medium text-[var(--foreground)]">
              {period.label}
            </span>
            {period.nextAnchor ? (
              <Link
                href={kind === "block" ? href({ block: period.nextAnchor }) : href({ datum: period.nextAnchor })}
                className={buttonClass}
                aria-label="Nästa period"
              >
                →
              </Link>
            ) : (
              <span className="px-2 py-1 text-[var(--ink-3)]" aria-hidden>
                →
              </span>
            )}
            <span className="text-xs text-[var(--ink-3)]">
              {period.startDate} – {period.endDate}
            </span>
          </div>
        )}
      </div>

      {kind === "block" && period == null && (
        <p className="text-sm text-[var(--ink-3)]">
          Inga block upplagda än — lägg upp säsongen på{" "}
          <Link href="/blockplan" className="underline">
            Blockplan
          </Link>
          .
        </p>
      )}

      {athletes.length === 0 && (
        <p className="text-sm text-[var(--ink-3)]">
          Inga löpare kopplade än — lägg till en under Inställningar.
        </p>
      )}

      {period && rows.length > 0 && (
        <>
          {/* Överblicken före detaljen: summan över hela gruppen, så man ser om
              perioden alls blev gjord innan man läser åtta kolumner per löpare.
              Räknas ur samma `rows` som tabellen nedanför och kan därför aldrig
              säga något annat. */}
          <StatRow columns={4}>
            <StatCell>
              <Stat label="Löpare" value={rows.length} sub={PERIOD_LABELS[kind].toLowerCase()} />
            </StatCell>
            <StatCell>
              <Stat
                label="Planerade pass"
                value={rows.reduce((n, r) => n + r.stats.plannedCount, 0)}
                sub="exkl. vilodagar"
              />
            </StatCell>
            <StatCell>
              <Stat
                label="Genomförda"
                value={rows.reduce((n, r) => n + r.stats.sessionCount, 0)}
                sub={`${rows.reduce((n, r) => n + r.stats.unplannedCount, 0)} oplanerade`}
              />
            </StatCell>
            <StatCell>
              <Stat
                label="Distans"
                value={rows.reduce((n, r) => n + r.stats.actualKm, 0).toFixed(1)}
                unit="km"
                sub="genomfört"
              />
            </StatCell>
          </StatRow>

          {/* Tabellen scrollar i sin egen behållare — sidan i sig ska aldrig
              scrolla i sidled, och åtta kolumner får inte plats på en telefon. */}
          <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <table className="w-full min-w-3xl border-collapse text-sm">
              <thead>
                <tr className="border-b border-[var(--line)] text-left text-[0.6875rem] tracking-wider text-[var(--ink-3)] uppercase">
                  <th scope="col" className="px-3 py-2.5 font-semibold">Löpare</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Planerat</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Genomfört</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Efterlevnad</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Kvalitet</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Distans</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Tid</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Tävlingar</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(({ athlete, stats }) => {
                  const share = complianceShare(stats);
                  return (
                    <tr key={athlete.id} className="border-b border-[var(--line)] last:border-0">
                      <th scope="row" className="px-3 py-2.5 text-left font-medium text-[var(--foreground)]">
                        <Link href={`/dashboard?athlete=${athlete.id}`} className="hover:underline">
                          {athlete.fullName ?? "Namnlös löpare"}
                        </Link>
                      </th>
                      <td className="tabular px-3 py-2.5 text-[var(--ink-2)]">
                        {stats.plannedCount}
                        {stats.plannedRestDays > 0 && (
                          <span className="text-xs text-[var(--ink-3)]">
                            {" "}
                            +{stats.plannedRestDays} vila
                          </span>
                        )}
                      </td>
                      <td className="tabular px-3 py-2.5 text-[var(--ink-2)]">
                        {stats.sessionCount}
                        {stats.unplannedCount > 0 && (
                          <span className="text-xs text-[var(--ink-3)]">
                            {" "}
                            varav {stats.unplannedCount} oplanerade
                          </span>
                        )}
                      </td>
                      <td className="tabular px-3 py-2.5 text-[var(--ink-2)]">
                        {/* Ingen färgskala här med flit: docs/tranarloopen.md
                            avsnitt 6 — rött för vad någon gjort eller inte
                            gjort hör inte hemma i appen. Talet står för sig. */}
                        {share == null ? (
                          <span className="text-[var(--ink-3)]">inget planerat</span>
                        ) : (
                          `${stats.completedCount} av ${stats.plannedCount + stats.plannedRestDays} · ${pct(share)}`
                        )}
                      </td>
                      <td className="tabular px-3 py-2.5 text-[var(--ink-2)]">
                        {stats.qualityPlanned === 0 ? (
                          <span className="text-[var(--ink-3)]">—</span>
                        ) : (
                          `${stats.qualityCompleted} av ${stats.qualityPlanned}`
                        )}
                      </td>
                      <td className="tabular px-3 py-2.5 text-[var(--ink-2)]">
                        {stats.actualKm.toFixed(1)} km
                        {stats.plannedKm != null && (
                          <span className="text-xs text-[var(--ink-3)]">
                            {" "}
                            / plan {stats.plannedKm.toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td className="tabular px-3 py-2.5 text-[var(--ink-2)]">
                        {stats.actualHours.toFixed(1)} h
                      </td>
                      <td className="tabular px-3 py-2.5 text-[var(--ink-2)]">
                        {stats.competitionCount}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Fördelning per passtyp — samma chip-form och samma
              kategorifärger (workoutTypeColorVar) som Blockplans
              blockstatistik, så en typ ser likadan ut var man än möter den. */}
          <section className="flex flex-col gap-3">
            <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
              Planerade pass per typ
            </h2>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {rows.map(({ athlete, stats }) => (
                <Card key={athlete.id} className="flex flex-col gap-3">
                  <CardHeader
                    title={athlete.fullName ?? "Namnlös löpare"}
                    detail={stats.plannedCount > 0 ? `${stats.plannedCount} pass` : undefined}
                  />
                  {stats.plannedByType.length === 0 ? (
                    <p className="text-sm text-[var(--ink-3)]">Inget planerat den här perioden.</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {stats.plannedByType.map((row) => (
                        <Chip
                          key={row.type}
                          colorVar={workoutTypeColorVar(row.type) ?? undefined}
                          ghost={workoutTypeColorVar(row.type) == null}
                        >
                          {WORKOUT_LABELS[row.type as WorkoutType] ?? row.type} · {row.count}
                        </Chip>
                      ))}
                    </div>
                  )}
                </Card>
              ))}
            </div>
          </section>
        </>
      )}
    </div>
  );
}
