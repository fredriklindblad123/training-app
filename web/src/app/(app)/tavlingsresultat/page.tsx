import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId, viewableAthletes } from "@/lib/auth-scope";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
import { createCompetition, deleteCompetition, saveEventResult } from "./actions";
import {
  addDays as planAddDays,
  COMMON_EVENTS,
  competitionYearCounts,
  defaultCompetitionYear,
  PRIORITY_LABELS,
  SEASON_LABELS,
  toDateKey,
  type Priority,
  type SeasonKind,
} from "@/lib/planning";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import { CATEGORY_VALUES, categoryColorVar } from "@/lib/categories";
import { BAND_LABELS } from "@/lib/intensity";
import { formatHoursMinutes } from "@/lib/format";
import { BASELINE_WINDOW_DAYS, type DailyStatusInput } from "@/lib/daily-status";
import { computeRaceBuildup, BUILDUP_WINDOW_DAYS, type RaceBuildup } from "@/lib/race-buildup";
import { computeEfficiencyPoints } from "@/lib/efficiency";
import { isoWeekStart, median } from "@/lib/stats-utils";
import {
  RaceProgressionChart,
  type RaceProgressionPoint,
  type RaceProgressionSeries,
  type TrainingSeries,
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
 * som är valt just nu — ingen tabell före grafen längre.
 *
 * Utökad 2026-08-16: Tävlingar-sektionen (lägga till/prioritera/logga
 * resultat) flyttad hit från /sasongen, se motiveringen i actions.ts —
 * att analysera och att administrera samma tävlingar hör ihop på en sida,
 * /arsplan (tidigare /sasongen) behåller bara en läsande
 * "Nästa A-tävling"-rad och Årsplan-rutnätets tävlingsrad. */

const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primaryBtn =
  "w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
const ghostBtn =
  "w-fit rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Ett värde per iso-vecka (medianen av de dagsvärden som föll i veckan) —
 * samma aggregering som formkurvan på /trender redan använder. Råvärde per
 * pass ger annars en hackig, spretig linje i RaceProgressionChart (EF
 * svänger kraftigt med väder/underlag, se varningstexten längre ner). */
function weeklyMedianPoints(points: { date: string; value: number }[]): { date: string; value: number }[] {
  const byWeek = new Map<string, number[]>();
  for (const p of points) {
    const wk = isoWeekStart(p.date);
    byWeek.set(wk, [...(byWeek.get(wk) ?? []), p.value]);
  }
  return [...byWeek.entries()]
    .map(([date, values]) => ({ date, value: median(values) as number }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
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
  location: string | null;
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
 * (/arsplan) i form och stil, se docs/tranarperspektiv.md K5 punkt 2. */
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
    /** Tävlingslistans eget år-/bana-filter — egna namn (skilda från `bana`
     * ovan, som styr grenutvecklingsgrafen) sedan Tävlingar-sektionen
     * flyttades hit från /sasongen 2026-08-16. */
    tavlingsAr?: string;
    tavlingsBana?: string;
    /** Vilken tävling som just nu visar redigerbara resultatfält i stället
     * för ren text — en lista är annars antingen "allt redigerbart hela
     * tiden" (rörigt, kräver att man scannar igenom formulär för att bara
     * läsa ett resultat) eller "inget redigerbart" (kräver en helt egen
     * sida). En knapp per tävling, samma URL-param-mönster som resten av
     * sidans filter. */
    redigeraTavling?: string;
    /** Fas 0-uppföljning: vilken löpare en coach tittar på just nu — samma
     * mönster som /arsplan, se lib/auth-scope.ts. */
    athlete?: string;
  }>;
}) {
  const {
    gren: grenParam,
    bana: banaParam,
    raceA: raceAParam,
    raceB: raceBParam,
    tavlingsAr: tavlingsArParam,
    tavlingsBana: tavlingsBanaParam,
    redigeraTavling: redigeraTavlingParam,
    athlete: athleteParam,
  } = await searchParams;

  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const scopedUserId = resolveScopedUserId(scoped, athleteParam);
  const athleteQuery = scoped.role === "coach" ? scopedUserId : null;

  // Träningsdatan (Garmin-synken) börjar 2025-07-25, men de importerade
  // tävlingsresultaten går längre tillbaka — så för lopp före det datumet
  // saknas träningskurvor (formkurva/VO2max) och upptrappningsdata helt.
  // Ett dataläge, inte ett fel; sant tills äldre Garmin-historik importeras.
  const TRAINING_DATA_START = "2025-07-25";

  // Hela historiken, inte bara ett valt säsongsår — grenutvecklingen ska
  // kunna visa fler säsonger tillbaka. Billig fråga (en handfull rader per
  // säsong); upptrappningsprofilerna för de två valda loppen hämtas separat,
  // se loadRaceAggregate.
  const { data: competitionRows } = await supabase
    .from("competitions")
    .select(
      "id, name, competition_date, priority, venue, location, competition_events(id, event, target_result, actual_result, placement, result_seconds)",
    )
    .eq("user_id", scopedUserId)
    .order("competition_date");

  const allCompetitions: CompetitionRow[] = (competitionRows ?? []) as CompetitionRow[];

  // Tävlingslistans eget år-/bana-filter — filtreras i JS ur den redan
  // hämtade `allCompetitions` (hela historiken) i stället för en andra,
  // separat DB-fråga som originalet på /sasongen gjorde. competitionYearCounts
  // förväntar sig bara datumen.
  const { years: competitionYears, countsByYear: competitionCountsByYear } =
    competitionYearCounts(allCompetitions.map((c) => c.competition_date));
  const todayKey = toDateKey(new Date());
  const defaultYear = defaultCompetitionYear(
    todayKey.slice(0, 4),
    competitionYears,
    competitionCountsByYear,
  );
  const tavlingsAr = tavlingsArParam ?? defaultYear;
  const tavlingsBana: "alla" | "inne" | "ute" =
    tavlingsBanaParam === "inne" || tavlingsBanaParam === "ute" ? tavlingsBanaParam : "alla";
  const managedVenueFilter: SeasonKind | null =
    tavlingsBana === "inne" ? "indoor" : tavlingsBana === "ute" ? "outdoor" : null;
  const managedCompetitions = allCompetitions.filter((c) => {
    const matchesYear = tavlingsAr === "alla" || c.competition_date.startsWith(tavlingsAr);
    const matchesVenue = !managedVenueFilter || c.venue === managedVenueFilter;
    return matchesYear && matchesVenue;
  });

  /** Bygger en /tavlingsresultat-länk som behåller tävlingslistans
   * år-/bana-filter — bara den del som skickas in i `overrides` byts ut.
   * Samma mönster som toggleEventHref/banaHref nedan, som gör motsvarande
   * för grenutvecklingsgrafens filter. */
  function competitionHref(overrides: { tavlingsAr?: string; tavlingsBana?: string }): string {
    const params = new URLSearchParams();
    params.set("tavlingsAr", overrides.tavlingsAr ?? tavlingsAr);
    params.set("tavlingsBana", overrides.tavlingsBana ?? tavlingsBana);
    if (athleteParam) params.set("athlete", athleteParam);
    return `/tavlingsresultat?${params.toString()}#tavlingar`;
  }

  /** Slår av/på redigerbara resultatfält för en enskild tävling — `id` null
   * stänger av redigeringen igen ("Klar"). Behåller år-/bana-filtret. */
  function editCompetitionHref(id: string | null): string {
    const params = new URLSearchParams();
    params.set("tavlingsAr", tavlingsAr);
    params.set("tavlingsBana", tavlingsBana);
    if (athleteParam) params.set("athlete", athleteParam);
    if (id) params.set("redigeraTavling", id);
    return `/tavlingsresultat?${params.toString()}#tavlingar`;
  }

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

  // En rad-lista per vald gren, bana-filtrerad — underlaget för grafens kurvor.
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

  // --- Träningskurvor att jämföra tävlingsutvecklingen mot (uttrycklig
  // begäran) — formkurva (EF) och VO2max har riktig löpande historik sedan
  // Garmin-synken startade; LT2 har bara ett sparat värde i taget (skrivs
  // över vid varje nytt tröskeltest, se profiles.lt2_hr) så den blir en
  // enstaka punkt, inte en kurva, tills fler tröskeltest loggas regelbundet.
  const [{ data: trainingActivityRows }, { data: profileThresholdRow }] = await Promise.all([
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .eq("user_id", scopedUserId)
      .gte("start_time", TRAINING_DATA_START)
      .order("start_time"),
    supabase
      .from("profiles")
      .select("lt2_hr, lt2_measured_on")
      .eq("id", scopedUserId)
      .maybeSingle(),
  ]);

  const trainingSessions = groupActivitiesIntoSessions(
    (trainingActivityRows ?? []) as unknown as SessionActivity[],
  );

  // EF/VO2max som råvärde per pass ritar en hackig, spretig linje (EF
  // svänger kraftigt med väder/underlag/uttorkning, se varningen längre ner
  // på sidan) — samma veckovisa median som /trender redan använder för
  // formkurvan (isoWeekStart+median) ger en läsbar kurva att jämföra mot
  // tävlingsutvecklingen i stället för ett moln av punkter.
  const efPoints = weeklyMedianPoints(
    computeEfficiencyPoints(trainingSessions).map((p) => ({ date: p.date, value: p.ef * 60 })),
  );
  const vo2maxPoints = weeklyMedianPoints(
    trainingSessions
      .flatMap((s) => s.activities.map((a) => ({ date: s.date, value: a.vo2max })))
      .filter((p): p is { date: string; value: number } => p.value != null),
  );
  const lt2Points =
    profileThresholdRow?.lt2_hr != null && profileThresholdRow.lt2_measured_on
      ? [{ date: profileThresholdRow.lt2_measured_on as string, value: profileThresholdRow.lt2_hr as number }]
      : [];

  const trainingSeries: TrainingSeries[] = [
    {
      id: "ef",
      label: "Formkurva (EF)",
      unit: "m/slag",
      color: "#0891b2",
      higherIsBetter: true,
      points: efPoints,
      insufficientDataNote:
        efPoints.length < 2 ? "för få lugna/långa pass med puls i perioden ännu" : undefined,
    },
    {
      id: "vo2max",
      label: "VO2max",
      unit: "ml/kg/min",
      color: "#d97706",
      higherIsBetter: true,
      points: vo2maxPoints,
      insufficientDataNote: vo2maxPoints.length < 2 ? "ingen VO2max-skattning från klockan ännu" : undefined,
    },
    {
      id: "lt2",
      label: "Tröskelpuls (LT2)",
      unit: "slag/min",
      color: "#7c3aed",
      higherIsBetter: true,
      points: lt2Points,
      insufficientDataNote:
        lt2Points.length < 2
          ? "bara en sparad mätning — tröskelpuls har ingen entydig bättre/sämre-riktning för sig, och räcker inte till en kurva än"
          : undefined,
    },
  ].filter((s) => s.points.length > 0);

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

  // 21-dagarsfönstret för upptrappningen kan falla helt före
  // TRAINING_DATA_START (se ovan) — upptrappningstabellen blir tom av det
  // skälet, inte för att inget hände.
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

  /** Byter vilken löpare en coach tittar på, behåller grenval/bana-filter
   * samt tävlingslistans eget år-/bana-filter. */
  function athleteHref(id: string): string {
    const params = new URLSearchParams();
    for (const e of selectedEvents) params.append("gren", e);
    if (banaParam) params.set("bana", banaParam);
    params.set("tavlingsAr", tavlingsAr);
    params.set("tavlingsBana", tavlingsBana);
    params.set("athlete", id);
    return `/tavlingsresultat?${params.toString()}`;
  }

  return (
    <div className="flex flex-1 flex-col gap-10 px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Tävlingsresultat</h1>

      {scoped.role === "coach" && (
        <AthleteSwitcher
          athletes={viewableAthletes(scoped)}
          viewerUserId={scoped.userId}
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
            tabellen under. Kryssa i en streckad träningskurva (formkurva/VO2max/LT2) under
            grafen för att se om den följer tävlingsutvecklingen — ren visuell jämförelse, ingen
            uträknad korrelation (för få tävlingar per säsong för att ett sådant tal skulle
            betyda något). Tidsknapparna ovanför grafen zoomar in ett kortare fönster;
            personbästa räknas alltid ut från hela historiken, oavsett vad som visas just nu.
          </p>
        </div>

        {allCompetitions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inga tävlingar inlagda ännu. Lägg till dem under{" "}
            <a href="#tavlingar" className="underline">
              Tävlingar
            </a>{" "}
            nedan.
          </p>
        ) : eventOptions.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Ingen gren har minst två tidtagna resultat ännu (hopp och kast mäts i meter
            och räknas inte hit). Fyll i fler resultat under{" "}
            <a href="#tavlingar" className="underline">
              Tävlingar
            </a>{" "}
            nedan.
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
              trainingSeries={trainingSeries}
              emptyLabel="Inga lopp i de valda grenarna med det valda banfiltret."
            />

            {/* Ingen egen detaljtabell här längre — samma resultat listas
                redan (med rätt värden, oavsett grenval) i Tävlingar-listan
                nedan, det fanns ingen anledning till två listor med samma
                information på samma sida. */}

            {/* Upptrappningsjämförelsen — samma tabellstruktur som
                blockjämförelsen på /arsplan, men bara lopp i någon av de
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

      {/* ---------------- Tävlingar ---------------- */}
      <section id="tavlingar" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Tävlingar</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Prioriteten styr hur planeringen toppar. A är säsongens huvudmål och får en
          nedtrappning före sig; C är träningstävling och planeras rakt igenom.
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Årsväljare. Byggd ur datan (competitionYears), inte en hårdkodad
           * lista — annars slutar den fungera så fort ett nytt år börjar
           * tävlas i. "Alla år" ligger sist så historiken alltid går att nå,
           * men aldrig är förvalet. */}
          <div className="flex flex-wrap gap-1 text-sm" role="group" aria-label="Tävlingsår">
            {competitionYears.map((year) => (
              <Link
                key={year}
                href={competitionHref({ tavlingsAr: year })}
                aria-current={tavlingsAr === year ? "page" : undefined}
                className={`rounded px-3 py-1 ${
                  tavlingsAr === year
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {year} ({competitionCountsByYear.get(year)})
              </Link>
            ))}
            <Link
              href={competitionHref({ tavlingsAr: "alla" })}
              aria-current={tavlingsAr === "alla" ? "page" : undefined}
              className={`rounded px-3 py-1 ${
                tavlingsAr === "alla"
                  ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                  : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Alla år ({allCompetitions.length})
            </Link>
          </div>

          <div className="flex gap-1 text-sm" role="group" aria-label="Inne eller ute">
            {(
              [
                { key: "alla", label: "Alla banor" },
                { key: "inne", label: SEASON_LABELS.indoor },
                { key: "ute", label: SEASON_LABELS.outdoor },
              ] as const
            ).map((opt) => (
              <Link
                key={opt.key}
                href={competitionHref({ tavlingsBana: opt.key })}
                aria-current={tavlingsBana === opt.key ? "page" : undefined}
                className={`rounded px-3 py-1 ${
                  tavlingsBana === opt.key
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>

        {managedCompetitions.length === 0 && (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">
            Inga tävlingar {tavlingsAr === "alla" ? "" : `${tavlingsAr} `}
            {tavlingsBana !== "alla" ? `(${tavlingsBana === "inne" ? "inomhus" : "utomhus"}) ` : ""}
            än.
          </p>
        )}

        {managedCompetitions.length > 0 && (
          <div className="flex flex-col gap-2">
            {managedCompetitions.map((c) => {
              const editing = c.id === redigeraTavlingParam;
              return (
                <div
                  key={c.id}
                  className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="flex items-baseline gap-2">
                      <span
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          c.priority === "A"
                            ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                            : c.priority === "B"
                              ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                              : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                        }`}
                      >
                        {c.priority}
                      </span>
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {c.competition_date}
                        {c.venue ? ` · ${SEASON_LABELS[c.venue]}` : ""}
                        {c.location ? ` · ${c.location}` : ""}
                      </span>
                    </div>
                    <div className="flex items-center gap-3">
                      {c.competition_events.length > 0 && (
                        <Link
                          href={editCompetitionHref(editing ? null : c.id)}
                          className="text-xs text-zinc-500 underline hover:text-zinc-900 dark:hover:text-zinc-100"
                        >
                          {editing ? "Klar" : "Redigera"}
                        </Link>
                      )}
                      <form action={deleteCompetition}>
                        <input type="hidden" name="id" value={c.id} />
                        <button
                          type="submit"
                          className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          Ta bort
                        </button>
                      </form>
                    </div>
                  </div>

                  {c.competition_events.length > 0 && (
                    <div className="mt-3 flex flex-col gap-2">
                      {c.competition_events
                        .slice()
                        .sort((a, b) => a.event.localeCompare(b.event))
                        .map((e) =>
                          editing ? (
                            <form
                              key={e.id}
                              action={saveEventResult}
                              className="flex flex-wrap items-end gap-2 text-sm"
                            >
                              <input type="hidden" name="event_id" value={e.id} />
                              <span className="w-28 font-medium text-zinc-900 dark:text-zinc-100">
                                {e.event}
                              </span>
                              <span className="text-zinc-500 dark:text-zinc-400">
                                mål {e.target_result ?? "—"}
                              </span>
                              <input
                                name="actual_result"
                                defaultValue={e.actual_result ?? ""}
                                placeholder="resultat"
                                className={`${input} w-28`}
                              />
                              <input
                                name="placement"
                                type="number"
                                min="1"
                                defaultValue={e.placement ?? ""}
                                placeholder="plats"
                                className={`${input} w-20`}
                              />
                              <button type="submit" className={ghostBtn}>
                                Spara
                              </button>
                            </form>
                          ) : (
                            <div key={e.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                              <span className="w-28 font-medium text-zinc-900 dark:text-zinc-100">
                                {e.event}
                              </span>
                              <span className="text-zinc-600 dark:text-zinc-400">
                                {e.actual_result ?? "inget resultat inlagt"}
                                {e.placement != null ? ` · ${e.placement}:a plats` : ""}
                              </span>
                              {e.target_result && (
                                <span className="text-xs text-zinc-400 dark:text-zinc-600">
                                  mål {e.target_result}
                                </span>
                              )}
                            </div>
                          ),
                        )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        <details className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Lägg till tävling
          </summary>
          <form action={createCompetition} className="mt-3 flex flex-wrap items-end gap-3">
            {/* Så att createCompetition kan avgöra om det aktiva filtret
             * skulle dölja den nyskapade tävlingen och navigera om till rätt
             * år/bana i så fall — se motiveringen i actions.ts. */}
            <input type="hidden" name="current_tavlingsAr" value={tavlingsAr} />
            <input type="hidden" name="current_tavlingsBana" value={tavlingsBana} />
            <input type="hidden" name="athlete" value={scopedUserId} />
            <Field label="Namn">
              <input name="name" required placeholder="Inomhus-SM" className={input} />
            </Field>
            <Field label="Datum">
              <input type="date" name="competition_date" required className={input} />
            </Field>
            <Field label="Plats">
              <input name="location" placeholder="Göteborg" className={input} />
            </Field>
            <Field label="Inne/ute">
              <select name="venue" className={input} defaultValue="">
                <option value="">—</option>
                <option value="indoor">{SEASON_LABELS.indoor}</option>
                <option value="outdoor">{SEASON_LABELS.outdoor}</option>
              </select>
            </Field>
            <Field label="Prioritet">
              <select name="priority" className={input} defaultValue="C">
                {(["A", "B", "C"] as const).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grenar (komma mellan)">
              <input
                name="events"
                list="common-events"
                placeholder="1500m, 800m"
                className={input}
              />
              <datalist id="common-events">
                {COMMON_EVENTS.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>
            </Field>
            <Field label="Måltid (första grenen)">
              <input name="target_result" placeholder="4:35.00" className={input} />
            </Field>
            <button type="submit" className={primaryBtn}>
              Lägg till
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}
