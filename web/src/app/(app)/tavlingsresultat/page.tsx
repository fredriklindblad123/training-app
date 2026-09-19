import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { Stat, StatRow, StatCell } from "@/components/ui/Stat";
import {
  addCompetitionEvent,
  deleteCompetitionEvent,
  deleteCompetition,
  saveEventResult,
} from "./actions";
import {
  addDays as planAddDays,
  competitionYearCounts,
  defaultCompetitionYear,
  SEASON_LABELS,
  toDateKey,
  type Priority,
  type SeasonKind,
  COMMON_EVENTS,
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
import { buttonClass, fieldClass, primaryButtonClass } from "@/components/ui/controls";
import { getViewMode } from "@/lib/view-mode";

/* Resultat: här fyller löparen i vad det blev, och ser sin utveckling.
 *
 * ARBETSDELNINGEN (2026-09-17): tränaren lägger upp tävlingen under Tävling —
 * vad den heter, när den är, och vilka som ska med. Löparen väljer själv
 * vilken gren hon sprang och fyller i tid och placering här. Alice kan köra
 * 1500 där Nike kör 800 på samma lopp, och det är inget tränaren ska behöva
 * fylla i åt dem.
 *
 * Analys och jämförelse av redan inlagda tävlingar —
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
 * /sasongsoversikt (tidigare /sasongen) behåller bara en läsande
 * "Nästa A-tävling"-rad och Säsongsöversikts veckorutnäts tävlingsrad. */

const input =
  fieldClass;
const ghostBtn =
  buttonClass;

function formatPct(v: number): string {
  return `${Math.round(v * 100)}%`;
}

/** Ett värde per iso-vecka (medianen av de dagsvärden som föll i veckan) —
 * samma aggregering som formkurvan på /trender redan använder. Råvärde per
 * pass ger annars en hackig, spretig linje i RaceProgressionChart (EF
 * svänger kraftigt med väder/underlag, se varningstexten längre ner). */
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
 * (/sasongsoversikt) i form och stil, se docs/tranarperspektiv.md K5 punkt 2. */
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
     * mönster som /sasongsoversikt, se lib/auth-scope.ts. */
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
  const runnerMode = scoped.role === "coach" && (await getViewMode()) === "runner";
  const scopedUserId = resolveScopedUserId(scoped, athleteParam, runnerMode);
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

  /* KOMMANDE tävlingar står för sig, och står UTANFÖR årsfiltret.
   *
   * Rapporterat: en löpare såg inte sina kommande tävlingar alls. Två skäl,
   * båda i filtret. Årsfiltret väljer ett år med tävlingar i — alltså det år
   * historiken ligger i — och gömde därmed samtliga tolv lopp som låg nästa
   * säsong. Det enda kommande loppet i innevarande år låg dessutom sist i en
   * kronologisk lista efter sjutton genomförda.
   *
   * Ett årsfilter är rätt axel för historik och fel för "vad har jag framför
   * mig". Kommande filtreras därför bara på bana och sorteras närmast först;
   * genomförda behåller årsfiltret, som är vad det finns för. */
  const upcomingCompetitions = allCompetitions
    .filter((c) => c.competition_date >= todayKey)
    .filter((c) => !managedVenueFilter || c.venue === managedVenueFilter)
    .sort((a, b) => a.competition_date.localeCompare(b.competition_date));

  const pastCompetitions = managedCompetitions
    .filter((c) => c.competition_date < todayKey)
    .sort((a, b) => b.competition_date.localeCompare(a.competition_date));

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
  /* Tomt urval måste gå att uttrycka i URL:en. Utan en sentinel faller en
     tom lista tillbaka på förstahandsgrenen, och då gick den sista valda
     grenen inte att kryssa ur — man var tvungen att välja en annan gren
     först, vilket ingen gissar sig till. NO_EVENTS är den signalen. */
  const NO_EVENTS = "inga";
  const explicitlyEmpty = requestedEvents.includes(NO_EVENTS);
  const validRequestedEvents = requestedEvents.filter((e) => eventOptions.some((o) => o.event === e));
  const selectedEvents = explicitlyEmpty
    ? []
    : validRequestedEvents.length > 0
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
    if (next.length === 0) params.append("gren", NO_EVENTS);
    else for (const e of next) params.append("gren", e);
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


  /* Ett tävlingskort. Utbrutet 2026-09-17 när listan delades i kommande och
   * genomförda — två kopior av samma hundra rader JSX hade oundvikligen
   * glidit isär.
   *
   * `editing` styr om resultat- och grenfälten är framme. Kommande tävlingar
   * skickar alltid in true: man kom hit för att rapportera, och ett extra
   * klick före varje inmatning är en tröskel utan syfte. Genomförda behåller
   * länkbeteendet, så listan inte blir en vägg av fält. */
  function CompetitionCard({ c, editing }: { c: CompetitionRow; editing: boolean }) {
    return (

              <div
                key={c.id}
                className="rounded-lg border border-[var(--line)] p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        c.priority === "A"
                          ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                          : c.priority === "B"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            : "bg-[var(--surface-raised)] text-[var(--ink-2)]"
                      }`}
                    >
                      {c.priority}
                    </span>
                    <span className="font-medium text-[var(--foreground)]">{c.name}</span>
                    <span className="text-sm text-[var(--ink-3)]">
                      {c.competition_date}
                      {c.venue ? ` · ${SEASON_LABELS[c.venue]}` : ""}
                      {c.location ? ` · ${c.location}` : ""}
                    </span>
                  </div>
                  <div className="flex items-center gap-3">
                    {c.competition_events.length > 0 && (
                      <Link
                        href={editCompetitionHref(editing ? null : c.id)}
                        className="text-xs text-[var(--ink-3)] underline hover:text-[var(--foreground)]"
                      >
                        {editing ? "Klar" : "Redigera"}
                      </Link>
                    )}
                    <form action={deleteCompetition}>
                      <input type="hidden" name="id" value={c.id} />
                      <button
                        type="submit"
                        className="text-xs text-[var(--ink-3)] hover:text-[var(--status-concern)]"
                      >
                        Ta bort
                      </button>
                    </form>
                  </div>
                </div>

                {/* Grenlistan visas alltid, även tom: det är HÄR man fyller
                    i sitt resultat, och en tävling utan grenar såg tidigare
                    ut som att den inte gick att rapportera på. Tränaren
                    lägger bara upp namn, datum och vilka som ska med —
                    vilken gren var och en springer är löparens eget, och
                    Alice kan köra 1500 där Nike kör 800. */}
                {(c.competition_events.length > 0 || editing) && (
                  <div className="mt-3 flex flex-col gap-2">
                    {c.competition_events
                      .slice()
                      .sort((a, b) => a.event.localeCompare(b.event))
                      .map((e) =>
                        editing ? (
                          <div key={e.id} className="flex flex-wrap items-end gap-2">
                          <form
                            action={saveEventResult}
                            className="flex flex-wrap items-end gap-2 text-sm"
                          >
                            <input type="hidden" name="event_id" value={e.id} />
                            <span className="w-28 font-medium text-[var(--foreground)]">
                              {e.event}
                            </span>
                            <span className="text-[var(--ink-3)]">
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
                          {/* Egen form: en submit-knapp inuti spara-formuläret
                              hade skickat fel handling. */}
                          <form action={deleteCompetitionEvent}>
                            <input type="hidden" name="event_id" value={e.id} />
                            <button
                              type="submit"
                              title={`Ta bort ${e.event}`}
                              className="pb-1.5 text-xs text-[var(--status-concern-ink)] hover:underline"
                            >
                              Ta bort
                            </button>
                          </form>
                          </div>
                        ) : (
                          <div key={e.id} className="flex flex-wrap items-baseline gap-2 text-sm">
                            <span className="w-28 font-medium text-[var(--foreground)]">
                              {e.event}
                            </span>
                            <span className="text-[var(--ink-2)]">
                              {e.actual_result ?? "inget resultat inlagt"}
                              {e.placement != null ? ` · ${e.placement}:a plats` : ""}
                            </span>
                            {e.target_result && (
                              <span className="text-xs text-[var(--ink-3)]">
                                mål {e.target_result}
                              </span>
                            )}
                          </div>
                        ),
                      )}

                    {editing && (
                      <>
                        {c.competition_events.length === 0 && (
                          <p className="text-sm text-[var(--ink-3)]">
                            Ingen gren inlagd än. Lägg till den du sprang.
                          </p>
                        )}
                        {/* Grenlistan är förslag, inte en spärr — fritext
                            tillåts, så en stafett eller en ovanlig sträcka
                            inte blir omöjlig att rapportera. */}
                        <form
                          action={addCompetitionEvent}
                          className="flex flex-wrap items-end gap-2 border-t border-[var(--line)] pt-2 text-sm"
                        >
                          <input type="hidden" name="competition_id" value={c.id} />
                          <input
                            name="event"
                            list="vanliga-grenar"
                            required
                            placeholder="gren, t.ex. 1500m"
                            className={`${input} w-40`}
                          />
                          <input
                            name="target_result"
                            placeholder="mål (valfritt)"
                            className={`${input} w-28`}
                          />
                          <button type="submit" className={ghostBtn}>
                            Lägg till gren
                          </button>
                        </form>
                      </>
                    )}
                  </div>
                )}
              </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Resultat</h1>

      {/* Karriären i fyra tal. Sidan öppnade tidigare direkt i grenväljaren,
          så omfattningen — hur många lopp, hur länge, vad som väntar — fanns
          bara underförstådd i diagrammet. "Nästa" räknas ur framtida datum,
          inte ur prioritet: ett lopp nästa vecka är mer relevant än ett
          A-lopp om ett halvår, och prioriteten styr ingen planering. */}
      <StatRow columns={4}>
        <StatCell>
          <Stat
            label="Tävlingar"
            value={allCompetitions.length > 0 ? allCompetitions.length : "—"}
            sub="totalt inlagda"
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Tidtagna lopp"
            value={eventResults.length > 0 ? eventResults.length : "—"}
            sub={`${eventOptions.length} grenar`}
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Säsonger"
            value={competitionYears.length > 0 ? competitionYears.length : "—"}
            sub={
              competitionYears.length > 0
                ? `${competitionYears[competitionYears.length - 1]}–${competitionYears[0]}`
                : undefined
            }
          />
        </StatCell>
        <StatCell>
          <Stat
            label="Nästa tävling"
            value={(() => {
              const next = allCompetitions
                .filter((c) => c.competition_date >= todayKey)
                .sort((a, b) => a.competition_date.localeCompare(b.competition_date))[0];
              return next ? next.competition_date.slice(5).replace("-", "/") : "—";
            })()}
            sub={(() => {
              const next = allCompetitions
                .filter((c) => c.competition_date >= todayKey)
                .sort((a, b) => a.competition_date.localeCompare(b.competition_date))[0];
              return next ? next.name : "inget inlagt";
            })()}
          />
        </StatCell>
      </StatRow>

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">Grenutveckling</h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Välj en eller flera grenar för att se dem som egna kurvor i samma graf — minst en
            måste vara vald. Y-axeln är
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
          <p className="text-sm text-[var(--ink-3)]">
            Inga tävlingar inlagda ännu. Lägg till dem under{" "}
            <a href="#tavlingar" className="underline">
              Tävlingar
            </a>{" "}
            nedan.
          </p>
        ) : eventOptions.length === 0 ? (
          <p className="text-sm text-[var(--ink-3)]">
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
                /* Varje gren går alltid att kryssa ur, även den sista.
                 *
                 * Förut var den sista valda låst: `selectedEvents` föll
                 * tillbaka på eventOptions[0] när inget var valt, så ett
                 * urkryssande landade i samma läge — eller bytte till en
                 * ANNAN gren om den urkryssade inte råkade ha flest resultat
                 * ("jag klickar på 800m men den är fortsatt markerad",
                 * 2026-08-27). Låsningen löste det men skapade ett nytt
                 * problem: för att byta gren måste man välja den nya FÖRST,
                 * och klickar man på den gamla händer ingenting alls.
                 *
                 * Nu kan tomt urval uttryckas i URL:en (gren=inga), grafen
                 * visar sin tomma text, och chipen beter sig likadant oavsett
                 * hur många som är valda. */
                const chipStyle = active
                  ? { borderColor: eventColor(o.event), backgroundColor: eventColor(o.event), color: "white" }
                  : { borderColor: "var(--line)" };

                return (
                  <Link
                    key={o.event}
                    href={toggleEventHref(o.event)}
                    aria-pressed={active}
                    className="flex items-center gap-1.5 rounded border px-3 py-1"
                    style={chipStyle}
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
                      ? "bg-[var(--foreground)] text-[var(--background)]"
                      : "border border-[var(--line)] hover:bg-[var(--surface-raised)]"
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

            {/* Ingen egen detaljtabell här längre — samma resultat listas
                redan (med rätt värden, oavsett grenval) i Tävlingar-listan
                nedan, det fanns ingen anledning till två listor med samma
                information på samma sida. */}

            {/* Upptrappningsjämförelsen — samma tabellstruktur som
                blockjämförelsen på /sasongsoversikt, men bara lopp i någon av de
                valda grenarna. */}
            {racesInSelectedEvents.length < 2 ? (
              <p className="text-sm text-[var(--ink-3)]">
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
                    <span className="text-[var(--ink-2)]">Lopp A</span>
                    <select
                      name="raceA"
                      defaultValue={raceAParam ?? ""}
                      className={fieldClass}
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
                    <span className="text-[var(--ink-2)]">Lopp B</span>
                    <select
                      name="raceB"
                      defaultValue={raceBParam ?? ""}
                      className={fieldClass}
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
                  <button type="submit" className={primaryButtonClass}>
                    Jämför
                  </button>
                </form>

                {raceAParam && raceBParam && !(raceAggregateA && raceAggregateB) && (
                  <p className="text-sm text-[var(--ink-3)]">
                    Kunde inte jämföra — välj två olika lopp med resultat.
                  </p>
                )}

                {raceAggregateA &&
                  raceAggregateB &&
                  (buildupDataGapApplies ? (
                    <p className="rounded-lg border border-[var(--line)] p-3 text-sm text-[var(--ink-2)]">
                      Träningsdatan börjar 2025-07-25, men de importerade tävlingsresultaten
                      slutar 2024-07-21. De {BUILDUP_WINDOW_DAYS} dagarna före de här två
                      loppen ligger därför före träningsdatans start, och upptrappningen går
                      inte att visa — inget mättes, det är inte det samma som att inget
                      hände. Så fort ett lopp med träningsdata i fönstret jämförs dyker
                      tabellen upp här.
                    </p>
                  ) : (
                    <details className="rounded-lg border border-[var(--line)]" open>
                      <summary className="cursor-pointer p-4 text-sm text-[var(--ink-2)]">
                        Upptrappning de {BUILDUP_WINDOW_DAYS} dagarna före respektive lopp
                      </summary>
                      <div className="w-full max-w-full overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                        <table className="w-full min-w-max text-left text-sm">
                          <thead>
                            <tr className="text-xs text-[var(--ink-3)]">
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
                          <tbody className="[&_tr]:border-t [&_tr]:border-[var(--line)]">
                            {raceComparisonRows(raceAggregateA, raceAggregateB).map((row) => (
                              <tr key={row.label}>
                                <th
                                  scope="row"
                                  className="py-1.5 pr-4 font-normal text-[var(--ink-2)]"
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
      {/* Grenförslagen. En datalist och inte en select: listan finns för att
          slippa skriva "1500m" varje gång, inte för att begränsa — en stafett
          eller en ovanlig sträcka ska gå att rapportera ändå. */}
      <datalist id="vanliga-grenar">
        {COMMON_EVENTS.map((e) => (
          <option key={e} value={e} />
        ))}
      </datalist>

      <section id="tavlingar" className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">Tävlingar</h2>
        {/* Texten lovade tidigare att "prioriteten styr hur planeringen toppar" och att
            en A-tävling "får en nedtrappning före sig". Det gjorde den aldrig: priority
            förekommer inte i template-sync.ts, planning.ts, plan-matching.ts eller
            block-stats.ts, utan färgar bara markörer och väljer nästa A-tävling. Löftet
            togs bort 2026-09-13 i stället för att byggas — planeringen ska styras av
            tränaren, inte av ett antagande appen gör åt honom. */}
        <p className="max-w-3xl text-sm text-[var(--ink-3)]">
          Prioriteten märker upp säsongen: A är huvudmålen, B allt annat. Den visas i
          tidslinjen och väljer &quot;Nästa A-tävling&quot;, men styr ingen planering — hur
          veckorna ser ut inför ett lopp bestämmer du i Säsongsöversikt och Blockplan.
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
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "border border-[var(--line)] hover:bg-[var(--surface-raised)]"
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
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "border border-[var(--line)] hover:bg-[var(--surface-raised)]"
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
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "border border-[var(--line)] hover:bg-[var(--surface-raised)]"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>

        {/* KOMMANDE först, och utanför årsfiltret. Det är här man fyller i
            vilken gren man ska springa; resultatet kommer efteråt.
            Kortet är alltid utfällt i den här listan — man kom hit för att
            rapportera, och ett extra klick före varje inmatning är en
            tröskel utan syfte. */}
        <h3 className="display text-base font-semibold text-[var(--foreground)]">Kommande</h3>
        {upcomingCompetitions.length === 0 ? (
          <p className="text-sm text-[var(--ink-3)]">Inga tävlingar inlagda framåt.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {upcomingCompetitions.map((c) => (
              <CompetitionCard key={c.id} c={c} editing />
            ))}
          </div>
        )}

        <h3 className="display mt-4 text-base font-semibold text-[var(--foreground)]">
          Genomförda
        </h3>
        {pastCompetitions.length === 0 ? (
          <p className="text-sm text-[var(--ink-3)]">
            Inga tävlingar {tavlingsAr === "alla" ? "" : `${tavlingsAr} `}
            {tavlingsBana !== "alla" ? `(${tavlingsBana === "inne" ? "inomhus" : "utomhus"}) ` : ""}
            än.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {pastCompetitions.map((c) => (
              <CompetitionCard key={c.id} c={c} editing={c.id === redigeraTavlingParam} />
            ))}
          </div>
        )}

        {/* "Lägg till tävling" är borttaget härifrån (2026-09-17, begärt).
            Tävlingen SKAPAS av tränaren under Tävling; den här sidan är
            loggen, där man fyller i vad det blev. Att ha båda vägarna gjorde
            att en adept lade upp en egen tävling som ingen annan såg, i
            stället för att rapportera in på den tränaren redan planerat.
            Resultatet fylls i per gren på tävlingskorten ovanför. */}
        <p className="text-sm text-[var(--ink-3)]">
          Tävlingarna läggs upp av tränaren under{" "}
          <Link href="/tavlingar" className="underline">
            Tävling
          </Link>
          . Här fyller du i resultatet när du sprungit.
        </p>
      </section>
    </div>
  );
}
