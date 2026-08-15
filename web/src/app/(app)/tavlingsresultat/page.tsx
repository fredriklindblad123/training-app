import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
import {
  addDays as planAddDays,
  SEASON_LABELS,
  toDateKey,
  type Priority,
  type SeasonKind,
} from "@/lib/planning";
import { SESSION_ACTIVITY_COLUMNS, type SessionActivity } from "@/lib/sessions";
import { CATEGORY_VALUES, categoryColorVar } from "@/lib/categories";
import { BAND_LABELS } from "@/lib/intensity";
import { formatHoursMinutes } from "@/lib/format";
import { BASELINE_WINDOW_DAYS, type DailyStatusInput } from "@/lib/daily-status";
import { computeRaceBuildup, BUILDUP_WINDOW_DAYS, type RaceBuildup } from "@/lib/race-buildup";
import {
  RaceProgressionChart,
  type RaceProgressionPoint,
  type RaceProgressionSeries,
} from "@/components/charts/RaceProgressionChart";

/* Tävlingsresultat: analys och jämförelse av redan inlagda tävlingar —
 * grenutveckling över tid och upptrappningen inför två valda lopp.
 *
 * Flyttad ut ur /sasongen 2026-08-13 till en egen vy: att lägga till/redigera
 * tävlingar (prioritet, resultat per gren) är säsongsplanering och stannar
 * på /sasongen, men att analysera resultaten som redan finns är en annan
 * fråga med en annan kadens — man går hit efter ett lopp, inte när man
 * planerar nästa block. Se docs/tranarperspektiv.md K5.
 *
 * Ombyggd 2026-08-13: grafen bar tidigare bara en gren i taget, med en
 * fristående "alla resultat"-tabell och en till per-gren-tabell runt
 * omkring den — såg ut som att grafen landat mitt i en tabell av misstag.
 * Nu väljer man en eller flera grenar som egna kurvor i samma graf (RaceProg
 * ressionChart normaliserar mot vardera grenens eget personbästa, se den
 * filens kommentar för varför), och EN detaljtabell under grafen visar allt
 * som är valt just nu — ingen tabell före grafen längre. */

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

type CompetitionEventRow = {
  id: string;
  event: string;
  target_result: string | null;
  actual_result: string | null;
  placement: number | null;
  /** Tolkad löptid i sekunder (K9-importen, se migration
   * 20260803100000_competition_result_seconds.sql). Null för hopp/kast och
   * för grenar utan resultat — `actual_result` är fortfarande källan för
   * visning, det här är bara det sorterbara talet. */
  result_seconds: number | null;
};

type CompetitionRow = {
  id: string;
  name: string;
  competition_date: string;
  priority: Priority;
  venue: SeasonKind | null;
  competition_events: CompetitionEventRow[];
};

/** Sammandrag för ett enskilt lopp i jämförelseläget. */
type RaceAggregate = {
  competition: CompetitionRow;
  buildup: RaceBuildup;
};

/** "1500m, 800m" — grenarna för en tävling, tomt streck om inga är inlagda. */
function raceEventsLabel(events: CompetitionEventRow[]): string {
  return events.length > 0 ? events.map((e) => e.event).join(", ") : "–";
}

/** Resultaten precis som atleten skrev dem — ingen tolkning eller sortering
 * av fritexten (se fallgropen i docs/tranarperspektiv.md K5). */
function raceResultsLabel(events: CompetitionEventRow[]): string {
  return events.length > 0
    ? events.map((e) => e.actual_result ?? "inget resultat").join(", ")
    : "–";
}

function racePlacementsLabel(events: CompetitionEventRow[]): string {
  return events.length > 0
    ? events.map((e) => (e.placement != null ? String(e.placement) : "–")).join(", ")
    : "–";
}

/** Laddar upptrappningsprofilen (lib/race-buildup.ts) för ett enskilt lopp.
 * Hämtar bara det loppets eget fönster — anropas parvis, aldrig för alla
 * tävlingar på en gång (se kommentaren vid `compareRaceA`/`compareRaceB`
 * nedan). */
async function loadRaceAggregate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
  competition: CompetitionRow,
): Promise<RaceAggregate> {
  const raceDate = competition.competition_date;
  const windowStart = toDateKey(
    planAddDays(new Date(`${raceDate}T00:00:00`), -BUILDUP_WINDOW_DAYS),
  );
  // Baslinjefönstret (P1.2) sträcker sig längre bak än upptrappningens 21
  // dagar — computeDailyStatus behöver hela det för att räkna hrvTrend.
  const baselineStart = toDateKey(
    planAddDays(new Date(`${raceDate}T00:00:00`), -BASELINE_WINDOW_DAYS),
  );

  const [{ data: activityRows }, { data: metricRows }] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", userId)
      .gte("start_time", windowStart)
      .lt("start_time", raceDate)
      .order("start_time"),
    supabase
      .from("daily_metrics")
      .select("metric_date, hrv_overnight_avg, resting_hr, sleep_seconds, sleep_score")
      .eq("user_id", userId)
      .gte("metric_date", baselineStart)
      .lte("metric_date", raceDate),
  ]);

  const dailyStatusRows: DailyStatusInput[] = (metricRows ?? []).map((m) => ({
    date: m.metric_date as string,
    hrv: m.hrv_overnight_avg,
    restingHr: m.resting_hr,
    sleepHours: m.sleep_seconds != null ? m.sleep_seconds / 3600 : null,
    sleepScore: m.sleep_score,
  }));

  const buildup = computeRaceBuildup(
    raceDate,
    (activityRows ?? []) as unknown as SessionActivity[],
    dailyStatusRows,
  );

  return { competition, buildup };
}

/** Radlista för tävlingsjämförelsen — speglar blockjämförelsens rader
 * (/sasongen) i form och stil, se docs/tranarperspektiv.md K5 punkt 2. */
function raceComparisonRows(
  a: RaceAggregate,
  b: RaceAggregate,
): { label: string; a: string; b: string }[] {
  const weeklyLoadLabel = (w: RaceBuildup["weeklyLoad"]) =>
    w.map((v) => Math.round(v)).join(" → ");
  const hrvTrendLabel = (v: number | null) =>
    v != null ? `${v > 0 ? "+" : ""}${v.toFixed(1)} SD` : "otillräcklig historik för en baslinje";
  const lastHardLabel = (v: number | null) =>
    v != null ? `${v} ${v === 1 ? "dag" : "dagar"} före loppet` : "inget kvalitetspass i fönstret";

  return [
    { label: "Datum", a: a.competition.competition_date, b: b.competition.competition_date },
    {
      label: "Gren",
      a: raceEventsLabel(a.competition.competition_events),
      b: raceEventsLabel(b.competition.competition_events),
    },
    {
      label: "Resultat",
      a: raceResultsLabel(a.competition.competition_events),
      b: raceResultsLabel(b.competition.competition_events),
    },
    {
      label: "Placering",
      a: racePlacementsLabel(a.competition.competition_events),
      b: racePlacementsLabel(b.competition.competition_events),
    },
    {
      label: "Veckobelastning (3 v.)",
      a: weeklyLoadLabel(a.buildup.weeklyLoad),
      b: weeklyLoadLabel(b.buildup.weeklyLoad),
    },
    {
      label: "Löpdistans",
      a: `${a.buildup.totalKm.toFixed(0)} km`,
      b: `${b.buildup.totalKm.toFixed(0)} km`,
    },
    // Egen rad, inte hopslagen med löpdistansen: en upptrappning med tung
    // cykelvolym är inte samma sak som en med vila, och det är precis den
    // skillnaden man vill se när två lopp ställs mot varandra.
    {
      label: "Alternativ träning",
      a: a.buildup.crossTrainingKm > 0 ? `${a.buildup.crossTrainingKm.toFixed(0)} km` : "—",
      b: b.buildup.crossTrainingKm > 0 ? `${b.buildup.crossTrainingKm.toFixed(0)} km` : "—",
    },
    {
      label: "Kvalitetspass",
      a: String(a.buildup.qualitySessions),
      b: String(b.buildup.qualitySessions),
    },
    {
      label: "Vilodagar",
      a: `${a.buildup.restDays} av ${BUILDUP_WINDOW_DAYS}`,
      b: `${b.buildup.restDays} av ${BUILDUP_WINDOW_DAYS}`,
    },
    {
      label: "Senaste hårda passet",
      a: lastHardLabel(a.buildup.lastHardSessionDaysBefore),
      b: lastHardLabel(b.buildup.lastHardSessionDaysBefore),
    },
    {
      label: "Snittsömn",
      a: a.buildup.avgSleepHours != null ? formatHoursMinutes(a.buildup.avgSleepHours * 3600) : "ingen data",
      b: b.buildup.avgSleepHours != null ? formatHoursMinutes(b.buildup.avgSleepHours * 3600) : "ingen data",
    },
    {
      label: "HRV-trend",
      a: hrvTrendLabel(a.buildup.hrvTrend),
      b: hrvTrendLabel(b.buildup.hrvTrend),
    },
    {
      label: `${BAND_LABELS.easy} / ${BAND_LABELS.threshold}`,
      a: `${formatPct(a.buildup.bandPct.easy)} / ${formatPct(a.buildup.bandPct.threshold)}`,
      b: `${formatPct(b.buildup.bandPct.easy)} / ${formatPct(b.buildup.bandPct.threshold)}`,
    },
  ];
}

export default async function TavlingsresultatPage({
  searchParams,
}: {
  searchParams: Promise<{
    gren?: string | string[];
    bana?: string;
    raceA?: string;
    raceB?: string;
    /** Fas 0-uppföljning: vilken löpare en coach tittar på just nu — samma
     * mönster som /sasongen, se lib/auth-scope.ts. */
    athlete?: string;
  }>;
}) {
  const {
    gren: grenParam,
    bana: banaParam,
    raceA: raceAParam,
    raceB: raceBParam,
    athlete: athleteParam,
  } = await searchParams;

  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const scopedUserId = resolveScopedUserId(scoped, athleteParam);
  const athleteQuery = scoped.role === "coach" ? scopedUserId : null;

  // Hela historiken, inte bara ett valt säsongsår — grenutvecklingen ska
  // kunna visa fler säsonger tillbaka. Billig fråga (en handfull rader per
  // säsong); upptrappningsprofilerna för de två valda loppen hämtas separat,
  // se loadRaceAggregate.
  const { data: competitionRows } = await supabase
    .from("competitions")
    .select(
      "id, name, competition_date, priority, venue, competition_events(id, event, target_result, actual_result, placement, result_seconds)",
    )
    .eq("user_id", scopedUserId)
    .order("competition_date");

  const allCompetitions: CompetitionRow[] = (competitionRows ?? []) as CompetitionRow[];

  type EventResultRow = {
    eventRowId: string;
    competitionId: string;
    competitionName: string;
    competitionDate: string;
    venue: SeasonKind | null;
    event: string;
    resultLabel: string;
    resultSeconds: number;
  };

  // Bara löpgrenar har result_seconds (hopp/kast mäts i meter och lämnades
  // null vid import, se migration 20260803100000) — de filtreras bort här,
  // innan grenväljaren eller grafen ser dem, så de aldrig kan väljas eller
  // krascha något nedströms.
  const eventResults: EventResultRow[] = allCompetitions.flatMap((c) =>
    c.competition_events
      .filter((e) => e.result_seconds != null)
      .map((e) => ({
        eventRowId: e.id,
        competitionId: c.id,
        competitionName: c.name,
        competitionDate: c.competition_date,
        venue: c.venue,
        event: e.event,
        resultLabel: e.actual_result ?? "inget resultat",
        resultSeconds: e.result_seconds as number,
      })),
  );

  const eventCounts = new Map<string, number>();
  for (const r of eventResults) {
    eventCounts.set(r.event, (eventCounts.get(r.event) ?? 0) + 1);
  }
  // Minst två resultat, annars finns ingen utveckling att visa — sorterad
  // flest först så väljaren öppnar på grenen med mest att visa.
  const eventOptions = [...eventCounts.entries()]
    .filter(([, count]) => count >= 2)
    .map(([event, count]) => ({ event, count }))
    .sort((a, b) => b.count - a.count || a.event.localeCompare(b.event, "sv"));

  // Färgen bär grenens identitet i grafen (flera kurvor samtidigt), och är
  // stabil per gren oavsett vilka andra grenar som råkar vara valda —
  // annars byter en gren färg varje gång man kryssar i eller ur en annan.
  // Cyklar den redan validerade kategoripaletten (lib/categories.ts).
  const eventColor = (event: string): string => {
    const idx = eventOptions.findIndex((o) => o.event === event);
    const category = CATEGORY_VALUES[(idx < 0 ? 0 : idx) % CATEGORY_VALUES.length];
    return categoryColorVar(category);
  };

  // Multival: flera grenar kan visas som egna kurvor samtidigt. Normaliseras
  // till en array (Next.js ger en sträng för en enskild query-param, en
  // array för upprepade) och filtreras mot vad som faktiskt går att välja.
  // Utan tidigare val öppnar sidan på grenen med flest resultat.
  const requestedEvents = grenParam == null ? [] : Array.isArray(grenParam) ? grenParam : [grenParam];
  const validRequestedEvents = requestedEvents.filter((e) => eventOptions.some((o) => o.event === e));
  const selectedEvents =
    validRequestedEvents.length > 0
      ? validRequestedEvents
      : eventOptions[0]
        ? [eventOptions[0].event]
        : [];

  const banaFilter: "alla" | "inne" | "ute" =
    banaParam === "inne" || banaParam === "ute" ? banaParam : "alla";
  const banaVenue: SeasonKind | null =
    banaFilter === "inne" ? "indoor" : banaFilter === "ute" ? "outdoor" : null;
  const bestResultLabel =
    banaFilter === "inne" ? "Bästa inomhus" : banaFilter === "ute" ? "Bästa utomhus" : "Personbästa";

  // En rad-lista per vald gren, bana-filtrerad — delas mellan grafens kurvor
  // och detaljtabellen under, så de aldrig kan visa olika urval.
  const rowsByEvent = new Map<string, EventResultRow[]>();
  for (const event of selectedEvents) {
    const rows = eventResults
      .filter((r) => r.event === event && (!banaVenue || r.venue === banaVenue))
      .sort((a, b) => (a.competitionDate < b.competitionDate ? -1 : a.competitionDate > b.competitionDate ? 1 : 0));
    rowsByEvent.set(event, rows);
  }

  const series: RaceProgressionSeries[] = selectedEvents.map((event) => ({
    event,
    color: eventColor(event),
    points: (rowsByEvent.get(event) ?? []).map(
      (r): RaceProgressionPoint => ({
        id: r.eventRowId,
        date: r.competitionDate,
        competitionName: r.competitionName,
        resultLabel: r.resultLabel,
        resultSeconds: r.resultSeconds,
        venue: r.venue,
      }),
    ),
  }));

  // Detaljtabellen: alla valda grenars rader i en enda kronologisk lista,
  // med grenen som egen kolumn — personbästa markeras per gren för sig
  // (samma bana-filtrerade urval som grafens kurva för den grenen).
  const detailRows = selectedEvents
    .flatMap((event) => {
      const rows = rowsByEvent.get(event) ?? [];
      const pb = rows.length > 0 ? Math.min(...rows.map((r) => r.resultSeconds)) : null;
      return rows.map((r) => ({ ...r, isPb: r.resultSeconds === pb }));
    })
    .sort((a, b) => (a.competitionDate < b.competitionDate ? -1 : a.competitionDate > b.competitionDate ? 1 : 0));

  // Upptrappningsjämförelsens <select>-fält innehåller lopp i någon av de
  // valda grenarna — det är så "jämför upptrappningen" blir konkret utan
  // att låsa jämförelsen till bara en gren i taget.
  const racesInSelectedEvents = allCompetitions.filter((c) =>
    c.competition_events.some((e) => selectedEvents.includes(e.event) && e.actual_result),
  );
  function raceOptionLabel(c: CompetitionRow): string {
    const matching = c.competition_events
      .filter((e) => selectedEvents.includes(e.event) && e.actual_result)
      .map((e) => e.event);
    return `${c.name} (${c.competition_date})${matching.length > 0 ? ` — ${matching.join(", ")}` : ""}`;
  }
  // Ligger raceA/raceB inte i någon vald gren (t.ex. efter att grenvalet
  // ändrats) nollställs de tyst här — ingen trasig jämförelse renderas.
  const compareRaceA = raceAParam
    ? (racesInSelectedEvents.find((c) => c.id === raceAParam) ?? null)
    : null;
  const compareRaceB = raceBParam
    ? (racesInSelectedEvents.find((c) => c.id === raceBParam) ?? null)
    : null;
  // Fristående frågor per valt lopp — aldrig en fråga per tävling i listan,
  // det hade blivit dyrt så fort säsongen har ett tiotal lopp.
  const [raceAggregateA, raceAggregateB] =
    compareRaceA && compareRaceB && compareRaceA.id !== compareRaceB.id
      ? await Promise.all([
          loadRaceAggregate(supabase, scopedUserId, compareRaceA),
          loadRaceAggregate(supabase, scopedUserId, compareRaceB),
        ])
      : [null, null];

  // Träningsdatan (Garmin-synken) börjar 2025-07-25, men de importerade
  // tävlingsresultaten slutar 2024-07-21. För tidiga lopp saknas därför
  // träningsdata i de 21 dagarna före — upptrappningstabellen blir tom av
  // det skälet, inte för att inget hände. Ett dataläge, inte ett fel; sant
  // tills nyare lopp läggs in.
  const TRAINING_DATA_START = "2025-07-25";
  const buildupDataGapApplies =
    raceAggregateA != null &&
    raceAggregateB != null &&
    raceAggregateA.competition.competition_date < TRAINING_DATA_START &&
    raceAggregateB.competition.competition_date < TRAINING_DATA_START;

  // Kryssar en gren i/ur urvalet, behåller övriga val och filter oförändrade.
  function toggleEventHref(event: string): string {
    const next = selectedEvents.includes(event)
      ? selectedEvents.filter((e) => e !== event)
      : [...selectedEvents, event];
    const params = new URLSearchParams();
    for (const e of next) params.append("gren", e);
    if (banaParam) params.set("bana", banaParam);
    if (raceAParam) params.set("raceA", raceAParam);
    if (raceBParam) params.set("raceB", raceBParam);
    if (athleteQuery) params.set("athlete", athleteQuery);
    return `/tavlingsresultat?${params.toString()}`;
  }

  // Byter bana-filtret, behåller grenvalen (flera "gren"-parametrar) och en
  // ev. pågående upptrappningsjämförelse oförändrade.
  function banaHref(bana: string): string {
    const params = new URLSearchParams();
    for (const e of selectedEvents) params.append("gren", e);
    params.set("bana", bana);
    if (raceAParam) params.set("raceA", raceAParam);
    if (raceBParam) params.set("raceB", raceBParam);
    if (athleteQuery) params.set("athlete", athleteQuery);
    return `/tavlingsresultat?${params.toString()}`;
  }

  /** Byter vilken löpare en coach tittar på, behåller grenval/bana-filter. */
  function athleteHref(id: string): string {
    const params = new URLSearchParams();
    for (const e of selectedEvents) params.append("gren", e);
    if (banaParam) params.set("bana", banaParam);
    params.set("athlete", id);
    return `/tavlingsresultat?${params.toString()}`;
  }

  return (
    <div className="flex flex-1 flex-col gap-10 px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Tävlingsresultat</h1>

      {scoped.role === "coach" && (
        <AthleteSwitcher
          linkedAthletes={scoped.linkedAthletes}
          activeId={scopedUserId}
          buildHref={athleteHref}
        />
      )}

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Grenutveckling</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Välj en eller flera grenar för att se dem som egna kurvor i samma graf. Y-axeln är
            andel av respektive grens eget personbästa, inte råtid — grenar med olika längd går
            annars inte att jämföra på samma axel. Exakt tid finns i hovertooltipen och
            tabellen under.
          </p>
        </div>

        {allCompetitions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inga tävlingar inlagda ännu. Lägg till dem på{" "}
            <Link
              href={athleteQuery ? `/sasongen?athlete=${athleteQuery}` : "/sasongen"}
              className="underline"
            >
              planeringssidan
            </Link>
            .
          </p>
        ) : eventOptions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ingen gren har minst två tidtagna resultat ännu (hopp och kast mäts i meter
            och räknas inte hit). Fyll i fler resultat på{" "}
            <Link
              href={athleteQuery ? `/sasongen?athlete=${athleteQuery}` : "/sasongen"}
              className="underline"
            >
              planeringssidan
            </Link>
            .
          </p>
        ) : (
          <>
            {/* Grenval — flera kan vara ikryssade samtidigt, flest resultat
                först. Ikryssad gren visar sin egen färg som markering. */}
            <div className="flex flex-wrap gap-2 text-sm">
              {eventOptions.map((o) => {
                const active = selectedEvents.includes(o.event);
                return (
                  <Link
                    key={o.event}
                    href={toggleEventHref(o.event)}
                    aria-pressed={active}
                    className="flex items-center gap-1.5 rounded border px-3 py-1"
                    style={
                      active
                        ? { borderColor: eventColor(o.event), backgroundColor: eventColor(o.event), color: "white" }
                        : { borderColor: "var(--color-zinc-300, #d4d4d8)" }
                    }
                  >
                    {o.event} ({o.count})
                  </Link>
                );
              })}
            </div>

            {/* Inne/ute-filter — samma knappradsstil som grenvalet. Formen
                (fylld/ihålig) i grafen bär skillnaden när filtret står på
                "alla"; knapparna här smalnar av vad som visas. */}
            <div className="flex flex-wrap gap-2 text-sm">
              {(
                [
                  { key: "alla", label: "Alla" },
                  { key: "inne", label: "Inomhus" },
                  { key: "ute", label: "Utomhus" },
                ] as const
              ).map((b) => (
                <Link
                  key={b.key}
                  href={banaHref(b.key)}
                  className={`rounded px-3 py-1 ${
                    banaFilter === b.key
                      ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {b.label}
                </Link>
              ))}
            </div>

            <RaceProgressionChart
              series={series}
              emptyLabel="Inga lopp i de valda grenarna med det valda banfiltret."
            />

            {/* Detaljtabell — allt som är valt just nu, en rad per lopp,
                grenen som egen kolumn, personbästa markerad per gren. */}
            {detailRows.length > 0 && (
              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-max text-left text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                      <th scope="col" className="py-1 pr-4 font-normal">
                        Datum
                      </th>
                      <th scope="col" className="py-1 pr-4 font-normal">
                        Gren
                      </th>
                      <th scope="col" className="py-1 pr-4 font-normal">
                        Tävling
                      </th>
                      <th scope="col" className="py-1 pr-4 font-normal">
                        Bana
                      </th>
                      <th scope="col" className="py-1 font-normal">
                        Resultat
                      </th>
                    </tr>
                  </thead>
                  <tbody className="[&_tr]:border-t [&_tr]:border-zinc-100 dark:[&_tr]:border-zinc-800">
                    {detailRows.map((r) => (
                      <tr key={r.eventRowId} className={r.isPb ? "bg-zinc-50 dark:bg-zinc-900" : undefined}>
                        <td className="py-1.5 pr-4 tabular-nums">{r.competitionDate}</td>
                        <td className="py-1.5 pr-4">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-2 w-2 shrink-0 rounded-full"
                              style={{ backgroundColor: eventColor(r.event) }}
                            />
                            {r.event}
                          </span>
                        </td>
                        <td className="py-1.5 pr-4">{r.competitionName}</td>
                        <td className="py-1.5 pr-4">{r.venue ? SEASON_LABELS[r.venue] : "–"}</td>
                        <td className="py-1.5 tabular-nums">
                          {r.resultLabel}
                          {r.isPb && (
                            <span className="ml-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              {bestResultLabel}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Upptrappningsjämförelsen — samma tabellstruktur som
                blockjämförelsen på /sasongen, men bara lopp i någon av de
                valda grenarna. */}
            {racesInSelectedEvents.length < 2 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Upptrappningsjämförelsen kräver minst två lopp med registrerat resultat i de
                valda grenarna.
              </p>
            ) : (
              <>
                <form
                  action="/tavlingsresultat"
                  method="get"
                  className="flex flex-wrap items-end gap-3 text-sm"
                >
                  {selectedEvents.map((e) => (
                    <input key={e} type="hidden" name="gren" value={e} />
                  ))}
                  {banaParam && <input type="hidden" name="bana" value={banaParam} />}
                  {athleteQuery && <input type="hidden" name="athlete" value={athleteQuery} />}
                  <label className="flex flex-col gap-1">
                    <span className="text-zinc-600 dark:text-zinc-400">Lopp A</span>
                    <select
                      name="raceA"
                      defaultValue={raceAParam ?? ""}
                      className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="" disabled>
                        Välj lopp
                      </option>
                      {racesInSelectedEvents.map((c) => (
                        <option key={c.id} value={c.id}>
                          {raceOptionLabel(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    <span className="text-zinc-600 dark:text-zinc-400">Lopp B</span>
                    <select
                      name="raceB"
                      defaultValue={raceBParam ?? ""}
                      className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
                    >
                      <option value="" disabled>
                        Välj lopp
                      </option>
                      {racesInSelectedEvents.map((c) => (
                        <option key={c.id} value={c.id}>
                          {raceOptionLabel(c)}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button type="submit" className="w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200">
                    Jämför
                  </button>
                </form>

                {raceAParam && raceBParam && !(raceAggregateA && raceAggregateB) && (
                  <p className="text-sm text-zinc-500 dark:text-zinc-400">
                    Kunde inte jämföra — välj två olika lopp med resultat.
                  </p>
                )}

                {raceAggregateA &&
                  raceAggregateB &&
                  (buildupDataGapApplies ? (
                    <p className="rounded border border-zinc-200 p-3 text-sm text-zinc-600 dark:border-zinc-800 dark:text-zinc-400">
                      Träningsdatan börjar 2025-07-25, men de importerade tävlingsresultaten
                      slutar 2024-07-21. De {BUILDUP_WINDOW_DAYS} dagarna före de här två
                      loppen ligger därför före träningsdatans start, och upptrappningen går
                      inte att visa — inget mättes, det är inte det samma som att inget
                      hände. Så fort ett lopp med träningsdata i fönstret jämförs dyker
                      tabellen upp här.
                    </p>
                  ) : (
                    <details className="rounded border border-zinc-200 dark:border-zinc-800" open>
                      <summary className="cursor-pointer p-4 text-sm text-zinc-600 dark:text-zinc-400">
                        Upptrappning de {BUILDUP_WINDOW_DAYS} dagarna före respektive lopp
                      </summary>
                      <div className="w-full max-w-full overflow-x-auto border-t border-zinc-200 p-4 dark:border-zinc-800">
                        <table className="w-full min-w-max text-left text-sm">
                          <thead>
                            <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                              <th scope="col" className="py-1 pr-4 font-normal">
                                Mått
                              </th>
                              <th scope="col" className="py-1 pr-4 font-normal">
                                {raceAggregateA.competition.name}
                              </th>
                              <th scope="col" className="py-1 font-normal">
                                {raceAggregateB.competition.name}
                              </th>
                            </tr>
                          </thead>
                          <tbody className="[&_tr]:border-t [&_tr]:border-zinc-100 dark:[&_tr]:border-zinc-800">
                            {raceComparisonRows(raceAggregateA, raceAggregateB).map((row) => (
                              <tr key={row.label}>
                                <th
                                  scope="row"
                                  className="py-1.5 pr-4 font-normal text-zinc-600 dark:text-zinc-400"
                                >
                                  {row.label}
                                </th>
                                <td className="py-1.5 pr-4 tabular-nums">{row.a}</td>
                                <td className="py-1.5 tabular-nums">{row.b}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </details>
                  ))}
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
