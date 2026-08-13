import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  addDays as planAddDays,
  PRIORITY_LABELS,
  SEASON_LABELS,
  toDateKey,
  type Priority,
  type SeasonKind,
} from "@/lib/planning";
import { SESSION_ACTIVITY_COLUMNS, type SessionActivity } from "@/lib/sessions";
import { BAND_LABELS } from "@/lib/intensity";
import { formatHoursMinutes } from "@/lib/format";
import { BASELINE_WINDOW_DAYS, type DailyStatusInput } from "@/lib/daily-status";
import { computeRaceBuildup, BUILDUP_WINDOW_DAYS, type RaceBuildup } from "@/lib/race-buildup";
import { RaceProgressionChart, type RaceProgressionPoint } from "@/components/charts/RaceProgressionChart";

/* Tävlingsresultat: analys och jämförelse av redan inlagda tävlingar —
 * grenutveckling över tid och upptrappningen inför två valda lopp.
 *
 * Flyttad ut ur /sasongen 2026-08-13 till en egen vy: att lägga till/redigera
 * tävlingar (prioritet, resultat per gren) är säsongsplanering och stannar
 * på /sasongen, men att analysera resultaten som redan finns är en annan
 * fråga med en annan kadens — man går hit efter ett lopp, inte när man
 * planerar nästa block. Se docs/tranarperspektiv.md K5. */

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
      .gte("start_time", windowStart)
      .lt("start_time", raceDate)
      .order("start_time"),
    supabase
      .from("daily_metrics")
      .select("metric_date, hrv_overnight_avg, resting_hr, sleep_seconds, sleep_score")
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
    gren?: string;
    bana?: string;
    raceA?: string;
    raceB?: string;
  }>;
}) {
  const { gren: grenParam, bana: banaParam, raceA: raceAParam, raceB: raceBParam } =
    await searchParams;

  const supabase = await createClient();

  // Hela historiken, inte bara ett valt säsongsår — grenutvecklingen ska
  // kunna visa fler säsonger tillbaka. Billig fråga (en handfull rader per
  // säsong); upptrappningsprofilerna för de två valda loppen hämtas separat,
  // se loadRaceAggregate.
  const { data: competitionRows } = await supabase
    .from("competitions")
    .select(
      "id, name, competition_date, priority, venue, competition_events(id, event, target_result, actual_result, placement, result_seconds)",
    )
    .order("competition_date");

  // En tränare jämför samma distans över tid ("hur har 1500m utvecklats?"),
  // inte två godtyckliga lopp mot varandra — sektionen utgår därför från en
  // gren (competition_events.event), inte från ett fritt par lopp. Se
  // docs/tranarperspektiv.md K5. Bygger ingen egen resultattabell —
  // competition_events har redan actual_result/placement.
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

  const selectedEvent =
    grenParam && eventOptions.some((o) => o.event === grenParam)
      ? grenParam
      : (eventOptions[0]?.event ?? null);

  const banaFilter: "alla" | "inne" | "ute" =
    banaParam === "inne" || banaParam === "ute" ? banaParam : "alla";
  const banaVenue: SeasonKind | null =
    banaFilter === "inne" ? "indoor" : banaFilter === "ute" ? "outdoor" : null;

  // Alla resultat i den valda grenen, oavsett bana — basen för
  // upptrappningsjämförelsens väljare och för personbästat innan
  // bana-filtret smalnar av vad som faktiskt visas.
  const eventRaceRows = selectedEvent
    ? eventResults
        .filter((r) => r.event === selectedEvent)
        .sort((a, b) => (a.competitionDate < b.competitionDate ? -1 : a.competitionDate > b.competitionDate ? 1 : 0))
    : [];
  // Bana-filtret smalnar av vad grafen/tabellen visar. "Personbästa" räknas
  // ur samma filtrerade urval — annars kan hjälplinjen peka på ett lopp som
  // inte ens syns i vyn, vilket hade sett trasigt ut med filtret på "inne".
  const filteredRaceRows = banaVenue ? eventRaceRows.filter((r) => r.venue === banaVenue) : eventRaceRows;
  // Delas mellan grafen (ritar sin egen PB-markör internt) och tabellen
  // under den, så de aldrig kan peka ut olika lopp som personbästa.
  const pbSecondsInFilter =
    filteredRaceRows.length > 0
      ? Math.min(...filteredRaceRows.map((r) => r.resultSeconds))
      : null;
  // Etiketten måste följa filtret. Inne och ute är skilda rekord i friidrott,
  // så det snabbaste inomhusloppet är inte "personbästa" när ett utomhuslopp
  // gått fortare — Alices 800m-bästa (2:21,99) sattes utomhus i juni, och att
  // kalla inomhustiden personbästa hade varit direkt fel.
  const bestResultLabel =
    banaFilter === "inne" ? "Bästa inomhus" : banaFilter === "ute" ? "Bästa utomhus" : "Personbästa";

  const progressionPoints: RaceProgressionPoint[] = filteredRaceRows.map((r) => ({
    id: r.eventRowId,
    date: r.competitionDate,
    competitionName: r.competitionName,
    resultLabel: r.resultLabel,
    resultSeconds: r.resultSeconds,
    venue: r.venue,
  }));

  // Upptrappningsjämförelsens <select>-fält ska bara innehålla lopp i den
  // valda grenen — det är så "jämför samma distans" blir konkret.
  const racesInSelectedEvent = selectedEvent
    ? allCompetitions.filter((c) =>
        c.competition_events.some((e) => e.event === selectedEvent && e.actual_result),
      )
    : [];
  // Ligger raceA/raceB inte i den valda grenen (t.ex. efter att grenen
  // byttes) nollställs de tyst här — ingen trasig jämförelse renderas.
  const compareRaceA = raceAParam
    ? (racesInSelectedEvent.find((c) => c.id === raceAParam) ?? null)
    : null;
  const compareRaceB = raceBParam
    ? (racesInSelectedEvent.find((c) => c.id === raceBParam) ?? null)
    : null;
  // Fristående frågor per valt lopp — aldrig en fråga per tävling i listan,
  // det hade blivit dyrt så fort säsongen har ett tiotal lopp.
  const [raceAggregateA, raceAggregateB] =
    compareRaceA && compareRaceB && compareRaceA.id !== compareRaceB.id
      ? await Promise.all([
          loadRaceAggregate(supabase, compareRaceA),
          loadRaceAggregate(supabase, compareRaceB),
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

  // Behåller alla parametrar på sidan och byter bara det som skickas in i
  // `overrides`. Utan den skulle t.ex. bana-knapparna nollställa grenvalet
  // och tvärtom. raceA/raceB följer med oförändrade — väljer man en gren de
  // inte tillhör tystnar jämförelsen själv (se racesInSelectedEvent).
  function raceHref(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    if (grenParam) params.set("gren", grenParam);
    if (banaParam) params.set("bana", banaParam);
    if (raceAParam) params.set("raceA", raceAParam);
    if (raceBParam) params.set("raceB", raceBParam);
    for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    return `/tavlingsresultat?${params.toString()}`;
  }

  return (
    <div className="flex flex-1 flex-col gap-10 px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Tävlingsresultat</h1>

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Alla resultat</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Med i storleksordningen tio lopp per säsong är det här beskrivande, inte
            statistiskt. Ingen trendlinje och ingen prognos — bara vad som faktiskt
            hände, gren för gren.
          </p>
        </div>

        {allCompetitions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inga tävlingar inlagda ännu. Lägg till dem på{" "}
            <Link href="/sasongen" className="underline">
              planeringssidan
            </Link>
            .
          </p>
        ) : (
          <div className="w-full max-w-full overflow-x-auto">
            <table className="w-full min-w-max text-left text-sm">
              <thead>
                <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Datum
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Tävling
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Bana
                  </th>
                  <th scope="col" className="py-1 pr-4 font-normal">
                    Prioritet
                  </th>
                  <th scope="col" className="py-1 font-normal">
                    Resultat
                  </th>
                </tr>
              </thead>
              <tbody className="[&_tr]:border-t [&_tr]:border-zinc-100 dark:[&_tr]:border-zinc-800">
                {allCompetitions.map((c) => (
                  <tr key={c.id}>
                    <td className="py-1.5 pr-4 tabular-nums">{c.competition_date}</td>
                    <td className="py-1.5 pr-4">{c.name}</td>
                    <td className="py-1.5 pr-4">{c.venue ? SEASON_LABELS[c.venue] : "–"}</td>
                    <td className="py-1.5 pr-4">{PRIORITY_LABELS[c.priority]}</td>
                    <td className="py-1.5">{raceResultsLabel(c.competition_events)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {eventOptions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ingen gren har minst två tidtagna resultat ännu (hopp och kast mäts i meter
            och räknas inte hit). Fyll i fler resultat på{" "}
            <Link href="/sasongen" className="underline">
              planeringssidan
            </Link>
            .
          </p>
        ) : (
          <>
            {/* Grenväljare — flest resultat först, default öppnar på den grenen. */}
            <div className="flex flex-wrap gap-2 text-sm">
              {eventOptions.map((o) => (
                <Link
                  key={o.event}
                  href={raceHref({ gren: o.event })}
                  className={`rounded px-3 py-1 ${
                    o.event === selectedEvent
                      ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                      : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  }`}
                >
                  {o.event} ({o.count})
                </Link>
              ))}
            </div>

            {/* Inne/ute-filter — samma knappradsstil som väljaren ovan. Formen
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
                  href={raceHref({ bana: b.key })}
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
              points={progressionPoints}
              bestLabel={bestResultLabel}
              emptyLabel="Inga lopp i den här grenen med det valda banfiltret."
            />

            {/* Tabellen under grafen — samma urval som grafen (gren + bana),
                kronologisk, personbästa markerad. */}
            {filteredRaceRows.length > 0 && (
              <div className="w-full max-w-full overflow-x-auto">
                <table className="w-full min-w-max text-left text-sm">
                  <thead>
                    <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                      <th scope="col" className="py-1 pr-4 font-normal">
                        Datum
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
                    {filteredRaceRows.map((r) => {
                      const isPb = r.resultSeconds === pbSecondsInFilter;
                      return (
                        <tr
                          key={r.eventRowId}
                          className={isPb ? "bg-zinc-50 dark:bg-zinc-900" : undefined}
                        >
                          <td className="py-1.5 pr-4 tabular-nums">{r.competitionDate}</td>
                          <td className="py-1.5 pr-4">{r.competitionName}</td>
                          <td className="py-1.5 pr-4">
                            {r.venue ? SEASON_LABELS[r.venue] : "–"}
                          </td>
                          <td className="py-1.5 tabular-nums">
                            {r.resultLabel}
                            {isPb && (
                              <span className="ml-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                {bestResultLabel}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Upptrappningsjämförelsen — samma tabellstruktur som
                blockjämförelsen på /sasongen, men bara lopp i den valda grenen. */}
            {racesInSelectedEvent.length < 2 ? (
              <p className="text-sm text-zinc-500 dark:text-zinc-400">
                Upptrappningsjämförelsen kräver minst två lopp i den här grenen med
                registrerat resultat.
              </p>
            ) : (
              <>
                <form
                  action="/tavlingsresultat"
                  method="get"
                  className="flex flex-wrap items-end gap-3 text-sm"
                >
                  {selectedEvent && <input type="hidden" name="gren" value={selectedEvent} />}
                  {banaParam && <input type="hidden" name="bana" value={banaParam} />}
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
                      {racesInSelectedEvent.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.competition_date})
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
                      {racesInSelectedEvent.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name} ({c.competition_date})
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
                    Kunde inte jämföra — välj två olika lopp i den här grenen med resultat.
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
