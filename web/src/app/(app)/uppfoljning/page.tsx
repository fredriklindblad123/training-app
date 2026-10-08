import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getScopedProfile,
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
import {
  computeRangeStats,
  type RangeInterruption,
  type RangeStats,
} from "@/lib/range-stats";
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
 * lib/range-stats.ts är exakt samma funktion som /sasongsoversikt visar sin
 * blockstatistik med (den hette computeBlockStats till 2026-08-27, se den
 * filens kommentar). Det är hela poängen — ett block som granskas här och på
 * Säsongsöversikt får aldrig visa olika siffror, eftersom det är samma kod på samma
 * data. Efterlevnaden kommer i sin tur ur summarizeCompliance, samma som
 * kalendern, Blockplan och /trender.
 *
 * Sidan ligger i navigeringens PLAN-grupp (components/BottomNav.tsx) trots att den
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

/** "5/5 · 100 %" — genomförda av passerade. Inget att mäta ger ett streck. */
function doneOf(done: number, due: number): React.ReactNode {
  if (due === 0) return <span className="text-[var(--ink-3)]">—</span>;
  return `${done}/${due} · ${Math.round((done / due) * 100)} %`;
}

/** Tabellcell som på mobil blir "rubrik över värde" i ett kort. */
const FOLLOW_UP_CELL =
  "tabular block text-[var(--ink-2)] before:block before:text-[0.6875rem] before:tracking-wider before:text-[var(--ink-3)] before:uppercase before:content-[attr(data-label)] sm:table-cell sm:px-3 sm:py-2.5 sm:before:content-none";

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

  /* Även en coach skickas härifrån i LÖPARLÄGE. Sidan är ren coachning — den
   * listar adepternas efterlevnad — och att nå den via en gammal länk medan
   * växeln står på "Löpare" hade visat andras data i ett läge som utger sig
   * för att vara ens eget. Menyn döljer redan länken; det här täpper till
   * bokmärket. */
  if ((await getViewMode()) === "runner") {
    redirect("/dashboard");
  }

  const { period: periodParam, datum, block: blockParam } = await searchParams;
  const todayKey = toDateKey(new Date());
  const anchorDate = datum && /^\d{4}-\d{2}-\d{2}$/.test(datum) ? datum : todayKey;

  const athletes = viewableAthletes(scoped);

  /* Blocken hämtas via löparna (season_block_athletes), inte via vem som
   * äger dem. Med ägaren som filter såg en andra tränare inga block alls:
   * Robert, som coachar samma löpare som Daniel, fick "Inga block upplagda än"
   * trots att hans löpare hade tolv (2026-10-08). Samma väg som
   * Säsongsöversikten. Hämtas alltid, inte bara i block-läget, eftersom
   * väljaren ska kunna byta TILL block. */
  const athleteIdList = athletes.map((a) => a.id);
  const { data: blockRows } =
    athleteIdList.length > 0
      ? await supabase
          .from("season_blocks")
          .select("id, name, start_date, end_date, blockFilter:season_block_athletes!inner(athlete_id)")
          .in("blockFilter.athlete_id", athleteIdList)
          .order("start_date")
      : { data: [] };
  // Ett block med flera löpare kommer en gång; mappas om till PeriodBlock.
  const blocks: PeriodBlock[] = [
    ...new Map(
      ((blockRows ?? []) as (PeriodBlock & { blockFilter?: unknown })[]).map((b) => [
        b.id,
        { id: b.id, name: b.name, start_date: b.start_date, end_date: b.end_date },
      ]),
    ).values(),
  ];

  const blockPeriod = resolveBlockPeriod(blocks, blockParam, todayKey);

  /* Förvalet är BLOCK, inte vecka (begäran 2026-09-21). En tränare öppnar
     sidan för att se hur perioden går, och en enskild vecka svarar sällan på
     det — särskilt inte en vecka som just börjat, där allt ser tomt ut.

     Villkoret är att idag FAKTISKT ligger i ett block, inte bara att det
     finns block. resolveBlockPeriod faller annars tillbaka på det senaste
     block som redan börjat, och säsongen har glapp: 2026-08-31–09-27 är
     fyra veckor utan block. Där öppnade sidan på Tävlingsperiod 2026 Aug,
     en period som tagit slut, och kallade den innevarande. Ligger idag i
     ett glapp visas veckan, och blockförvalet återkommer av sig självt när
     nästa block börjar.

     Den uttryckliga Block-knappen påverkas inte: klickar man dit gäller
     resolveBlockPeriods vanliga fallback, så fliken aldrig blir död. */
  const todayInBlock = blocks.some((b) => todayKey >= b.start_date && todayKey <= b.end_date);
  const kind: PeriodKind = isPeriodKind(periodParam)
    ? periodParam
    : todayInBlock
      ? "block"
      : "vecka";

  const period: ResolvedPeriod | null =
    kind === "block" ? blockPeriod : resolveDatePeriod(kind, anchorDate);

  const athleteIds = athletes.map((a) => a.id);

  /* En fråga per tabell för ALLA löpare (.in på user_id), inte en fråga per
   * löpare som /oversikt gjorde. Med fyra adepter var det 16 rundturer per
   * sidladdning där tre räcker — och till skillnad från Översikt hämtar den
   * här sidan hela perioden, inte bara en dag, så antalet rader per fråga
   * växer med granulariteten. RLS filtrerar bort allt coachen inte får se,
   * oavsett vad `.in()` råkar innehålla. */
  const [
    { data: plannedRows },
    { data: activityRows },
    { data: competitionRows },
    { data: interruptionRows },
  ] =
    period == null || athleteIds.length === 0
      ? [{ data: [] }, { data: [] }, { data: [] }, { data: [] }]
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
          /* Sjuk- och skaddagar (begäran 2026-09-21). De hör hemma här av
             samma skäl som efterlevnaden gör det: en löpare med tre pass av
             åtta planerade läses helt olika beroende på om hon var sjuk i
             fyra dagar. Utan kolumnen ser raden bara ut som slarv.

             Samma tabell och samma filter som dashboardens svit använder,
             så en vecka som bryter sviten där också räknas som sjuk här. */
          supabase
            .from("diary_entries")
            .select("user_id, entry_date, day_type")
            .in("user_id", athleteIds)
            .in("day_type", ["sick", "injured"])
            .gte("entry_date", period.startDate)
            .lte("entry_date", period.endDate),
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

          const interruptions: RangeInterruption[] = (
            (interruptionRows ?? []) as {
              user_id: string;
              entry_date: string;
              day_type: string;
            }[]
          )
            .filter((e) => e.user_id === athlete.id)
            .map((e) => ({ date: e.entry_date, dayType: e.day_type as "sick" | "injured" }));

          return {
            athlete,
            stats: computeRangeStats({
              range: { startDate: period.startDate, endDate: period.endDate },
              planned,
              sessions,
              competitionDates,
              interruptions,
              today: new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" }),
            }),
          };
        });

  /** Bygger en länk som byter EN sak och behåller resten — samma
   * URL-param-mönster som /sasongsoversikt och /tavlingsresultat redan använder. */
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
        ? "bg-[var(--foreground)] text-[var(--background)]"
        : "border border-[var(--line)] hover:bg-[var(--surface-raised)] hover:bg-[var(--surface-raised)]"
    }`;

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div>
        <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Uppföljning</h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Alla dina löpare sida vid sida: hur många pass som var planerade, hur många som blev
          gjorda och hur de fördelade sig. Samma uträkning som blockstatistiken på Säsongsöversikt, så
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
          <Link href="/sasongsoversikt" className="underline">
            Säsongsöversikt
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
              perioden alls blev gjord innan man läser tio kolumner per löpare.
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
              {(() => {
                const due = rows.reduce(
                  (n, r) => n + r.stats.qualityDue + r.stats.distanceDue + r.stats.strengthDue,
                  0,
                );
                const done = rows.reduce(
                  (n, r) => n + r.stats.qualityDone + r.stats.distanceDone + r.stats.strengthDone,
                  0,
                );
                return (
                  <Stat
                    label="Efterlevnad"
                    value={due > 0 ? `${done}/${due}` : "—"}
                    sub={due > 0 ? `${Math.round((done / due) * 100)} % av planerade hittills` : "inga pass passerade än"}
                  />
                );
              })()}
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

          {/* Tio kolumner får inte plats på en telefon. På stor skärm är det
              en tabell som scrollar i sin egen behållare; på mobil ställs
              samma tabell om med CSS så att varje löpare blir ett kort, med
              kolumnrubriken (data-label) ovanför varje värde. */}
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] sm:overflow-x-auto">
            <table className="block w-full border-collapse text-sm sm:table sm:min-w-4xl">
              <thead className="hidden sm:table-header-group">
                <tr className="border-b border-[var(--line)] text-left text-[0.6875rem] tracking-wider text-[var(--ink-3)] uppercase">
                  <th scope="col" className="px-3 py-2.5 font-semibold">Löpare</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Planerat</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Efterlevnad</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Kvalitet</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Distanspass</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Styrka</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Distans</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Tid</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Tävlingar</th>
                </tr>
              </thead>
              <tbody className="block sm:table-row-group">
                {rows.map(({ athlete, stats }) => {
                  return (
                    <tr key={athlete.id} className="grid grid-cols-2 gap-x-4 gap-y-2 border-b border-[var(--line)] p-3 last:border-0 sm:table-row sm:p-0">
                      <th scope="row" className="col-span-2 text-left font-medium text-[var(--foreground)] sm:px-3 sm:py-2.5">
                        <Link href={`/dashboard?athlete=${athlete.id}`} className="hover:underline">
                          {athlete.fullName ?? "Namnlös löpare"}
                        </Link>
                      </th>
                      <td data-label="Planerat" className={FOLLOW_UP_CELL}>
                        {stats.plannedCount}
                        {stats.plannedRestDays > 0 && (
                          <span className="text-xs text-[var(--ink-3)]">
                            {" "}
                            +{stats.plannedRestDays} vila
                          </span>
                        )}
                      </td>
                      {/* Antal gjorda pass av varje slag mot antal planerade som
                          passerat, inom perioden — inte parat dag för dag
                          (begäran 2026-10-08, se lib/range-stats.ts).
                          Efterlevnaden är summan av de tre. Ingen färgskala:
                          rött för vad någon gjort eller inte gjort hör inte
                          hemma i appen (docs/tranarloopen.md 6). */}
                      <td data-label="Efterlevnad" className={FOLLOW_UP_CELL}>
                        {doneOf(
                          stats.qualityDone + stats.distanceDone + stats.strengthDone,
                          stats.qualityDue + stats.distanceDue + stats.strengthDue,
                        )}
                      </td>
                      <td data-label="Kvalitet" className={FOLLOW_UP_CELL}>
                        {doneOf(stats.qualityDone, stats.qualityDue)}
                      </td>
                      <td data-label="Distanspass" className={FOLLOW_UP_CELL}>
                        {doneOf(stats.distanceDone, stats.distanceDue)}
                      </td>
                      <td data-label="Styrka" className={FOLLOW_UP_CELL}>
                        {doneOf(stats.strengthDone, stats.strengthDue)}
                      </td>
                      <td data-label="Distans" className={FOLLOW_UP_CELL}>
                        {stats.actualKm.toFixed(1)} km
                        {stats.plannedKm != null && (
                          <span className="text-xs text-[var(--ink-3)]">
                            {" "}
                            / plan {stats.plannedKm.toFixed(1)}
                          </span>
                        )}
                      </td>
                      <td data-label="Tid" className={FOLLOW_UP_CELL}>
                        {stats.actualHours.toFixed(1)} h
                      </td>
                      {/* Genomförda av alla tävlingar i perioden, även kommande:
                          "0/1" är en tävling som ligger framför. */}
                      <td data-label="Tävlingar" className={FOLLOW_UP_CELL}>
                        {stats.competitionCount === 0 ? (
                          <span className="text-[var(--ink-3)]">—</span>
                        ) : (
                          `${stats.competitionsDone}/${stats.competitionCount}`
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Fördelning per passtyp — samma chip-form och samma
              kategorifärger (workoutTypeColorVar) som Säsongsöversikts
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
