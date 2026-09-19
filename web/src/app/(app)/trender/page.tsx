import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { buildInsights, insightsForPhase } from "@/lib/insights";
import { InsightCard } from "@/components/InsightCard";
import { IntensityChart, type IntensityWeek } from "@/components/charts/IntensityChart";
import { EfficiencyChart, type EfficiencyRace } from "@/components/charts/EfficiencyChart";
import { computeEfficiencyPoints, efficiencyVerdict } from "@/lib/efficiency";
import {
  EMPTY_THRESHOLD_PROFILE,
  PHASE_INTENSITY_MODEL,
  emptyZoneSeconds,
  type ThresholdProfile,
  type ZoneSeconds,
} from "@/lib/intensity";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
  type TrainingSession,
} from "@/lib/sessions";
import { coefficientOfVariation, isoWeekStart, median, weekLabel } from "@/lib/stats-utils";
import { SessionQuality, type SignatureGroup } from "@/components/SessionQuality";
import { EasyDiscipline } from "@/components/EasyDiscipline";
import { LoadStrip } from "@/components/LoadStrip";
import { TrainingGears } from "@/components/TrainingGears";
import { CollapsibleSection } from "@/components/ui/CollapsibleSection";
import {
  computeTrainingGears,
  gearVerdict,
  GEAR_PURPOSE,
  type Gear,
  type GearKey,
  type GearRep,
} from "@/lib/training-gears";
import { computeEasyDiscipline, easyBandFrom } from "@/lib/easy-discipline";
import { computeLoadRamp } from "@/lib/load-ramp";
import {
  paceBasisFromGoal,
  paceBasisFromRace,
  pickRacePace,
  RACE_PACE_MONTHS,
  type RaceResultRow,
} from "@/lib/race-pace";
import { groupBySignature, toOccurrence, type SignatureLap } from "@/lib/session-signature";
import { addDays as planAddDays, PHASE_LABELS, type PhaseType } from "@/lib/planning";
import { matchPlanToSessions, summarizeCompliance, type PlannedWorkout } from "@/lib/plan-matching";
import { ComplianceCard } from "@/components/ComplianceCard";
import {
  buildWeekSeries,
  buildWeekSeriesForRange,
  toDateKey,
  weekRangeLabel,
} from "@/lib/week-series";
import { getViewMode } from "@/lib/view-mode";

const WEEK_OPTIONS = [12, 26, 52] as const;
type WeekOption = (typeof WEEK_OPTIONS)[number];

type SeasonBlockRow = {
  id: string;
  name: string;
  phase: PhaseType;
  start_date: string;
  end_date: string;
  focus: string | null;
};

/** Tävlingsdagar: `competitions`/`competition_events` (idrottarens egna
 * importerade resultat), INTE `activities.category === "race"`. Alice bär
 * aldrig klockan under själva loppet på bana — bara uppvärmning och nerjogg
 * spelas in, och ingetdera matchar tävlingsdetekteringen i databasen
 * (`supabase/migrations/20260725120000_activity_category.sql`). Så för
 * banlopp (majoriteten av hennes tävlingar) är `activities` blind för att en
 * tävling ens ägde rum. Vid terränglöpning/väg bär hon klockan hela loppet,
 * så där FINNS en riktig `category==="race"`-aktivitet — den täcks då redan
 * in via `competitions` om resultatet är importerat, annars fångas den av
 * unionen i `buildRaceDays` nedan.
 *
 * `competitions` är alltså den auktoritativa källan för "ägde en tävling
 * rum den här dagen"; Garmin-taggade race-pass är bara ett komplement för
 * dagar som (ännu) saknar ett importerat resultat. */
type CompetitionEventLite = { event: string };
type CompetitionLite = {
  competition_date: string;
  name: string;
  competition_events: CompetitionEventLite[];
};

function competitionLabel(c: CompetitionLite): string {
  const events = c.competition_events.map((e) => e.event).join(", ");
  return events ? `${c.name} (${events})` : c.name;
}

/** date (YYYY-MM-DD) -> läsbar tävlingsetikett. Unionen av `competitions`
 * (primär källa) och Garmin race-pass på dagar `competitions` inte täcker. */
function buildRaceDays(
  competitions: CompetitionLite[],
  raceSessions: { date: string; dominantActivity: { name: string | null } }[],
): Map<string, string> {
  const byDate = new Map<string, CompetitionLite[]>();
  for (const c of competitions) {
    byDate.set(c.competition_date, [...(byDate.get(c.competition_date) ?? []), c]);
  }
  const raceDays = new Map<string, string>();
  for (const [date, comps] of byDate) {
    raceDays.set(date, comps.map(competitionLabel).join(" + "));
  }
  for (const s of raceSessions) {
    if (!raceDays.has(s.date)) {
      raceDays.set(s.date, s.dominantActivity.name?.trim() || "Tävling");
    }
  }
  return raceDays;
}

/** Hämtar alla varv för en uppsättning aktiviteter.
 *
 * PostgREST returnerar som standard högst 1000 rader, och varvfrågan hade
 * ingen paginering: en 52-veckorsvy med 3131 varv kapades tyst till 1000, så
 * passkvalitetsvyn byggde sina jämförelser på ungefär en tredjedel av
 * underlaget utan att säga något. Felet syntes inte i 12-veckorsvyn, som
 * ligger under gränsen.
 *
 * Aktiviteterna chunkas dessutom: `in.(...)` hamnar i frågesträngen, och
 * flera hundra uuid:n blir en URL ingen vill felsöka.
 */
const SPLIT_PAGE_SIZE = 1000;
const ACTIVITY_CHUNK = 80;

async function fetchAllSplits(
  supabase: Awaited<ReturnType<typeof createClient>>,
  activityIds: string[],
): Promise<SignatureLap[]> {
  const out: SignatureLap[] = [];
  for (let i = 0; i < activityIds.length; i += ACTIVITY_CHUNK) {
    const chunk = activityIds.slice(i, i + ACTIVITY_CHUNK);
    for (let from = 0; ; from += SPLIT_PAGE_SIZE) {
      const { data } = await supabase
        .from("activity_splits")
        .select(
          "activity_id, split_index, split_type, distance_meters, duration_seconds, avg_hr, max_hr",
        )
        .in("activity_id", chunk)
        .order("activity_id")
        .order("split_index")
        .range(from, from + SPLIT_PAGE_SIZE - 1);
      const rows = (data ?? []) as SignatureLap[];
      out.push(...rows);
      if (rows.length < SPLIT_PAGE_SIZE) break;
    }
  }
  return out;
}

export default async function TrendsPage({
  searchParams,
}: {
  searchParams: Promise<{
    weeks?: string;
    block?: string;
    /** Fas 0-uppföljning: vilken löpare en coach tittar på just nu — samma
     * mönster som /sasongsoversikt, se lib/auth-scope.ts. */
    athlete?: string;
  }>;
}) {
  const { weeks: weeksParam, block: blockParam, athlete: athleteParam } = await searchParams;
  const weeksNum = Number(weeksParam);
  const weeks: WeekOption = (WEEK_OPTIONS as readonly number[]).includes(weeksNum)
    ? (weeksNum as WeekOption)
    : 12;

  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const runnerMode = scoped.role === "coach" && (await getViewMode()) === "runner";
  const scopedUserId = resolveScopedUserId(scoped, athleteParam, runnerMode);
  const athleteQuery = scoped.role === "coach" ? `&athlete=${scopedUserId}` : "";
  const todayKey = toDateKey(new Date());

  // P1.5: träningsblock som tidsenhet. Block är kopplade till löpare via
  // season_block_athletes (samma block kan gälla flera löpare), inte
  // user_id — se migration 20260816100000. Blocken hämtas alltid (billigt,
  // en rad per block) så att både väljaren och jämförelseläget kan använda
  // dem, oavsett om ett block faktiskt är valt just nu. Bara påbörjade block
  // visas som väljare — ett framtida planerat block har per definition ingen
  // data att visa, och skulle bara se trasigt ut om man klickade på det.
  /* En fråga, inte två i rad.
   *
   * Låg tidigare som season_block_athletes → .in("id", blockIds) →
   * season_blocks, alltså två sekventiella nätverksrundor där den andra bara
   * väntade på id:n från den första. PostgREST kan filtrera på en inbäddad
   * resurs med !inner, vilket gör samma sak i en runda.
   *
   * Verifierat mot produktionsdatan innan bytet: båda varianterna ger exakt
   * samma 11 block för samma löpare. */
  const { data: blockRows } = await supabase
    .from("season_blocks")
    .select("id, name, phase, start_date, end_date, focus, season_block_athletes!inner(athlete_id)")
    .eq("season_block_athletes.athlete_id", scopedUserId)
    .lte("start_date", todayKey)
    .order("start_date", { ascending: false });
  const blocks: SeasonBlockRow[] = blockRows ?? [];
  const activeBlock = blockParam ? (blocks.find((b) => b.id === blockParam) ?? null) : null;

  // Blockvyn byter ut det rullande fönstret mot blockets egna datum — allt
  // nedanför (ComboChart, IntensityChart, EfficiencyChart, korrelationerna)
  // är redan generiskt över "en serie perioder mellan startDate och nu", så
  // det enda som behöver bytas ut är själva fönstret.
  const weekSeries = activeBlock
    ? buildWeekSeriesForRange(activeBlock.start_date, activeBlock.end_date)
    : buildWeekSeries(weeks);
  const startDate = activeBlock ? activeBlock.start_date : weekSeries[0];
  // Exklusiv övre gräns — bara satt i blockvy. Utan block gäller "fram till
  // nu", precis som tidigare.
  const endDateExclusive = activeBlock
    ? toDateKey(planAddDays(new Date(`${activeBlock.end_date}T00:00:00`), 1))
    : null;

  // Tröskelkolumnerna (P0.3b) kan saknas i databasen när migrationen ännu inte
  // är körd. Den frågan får därför gå separat och felet sväljas: sidan ska
  // fungera utan dem, bara med en tydligare brasklapp om zongränserna.
  const [
    { data: activityRows },
    { data: diaryEntries },
    profileResult,
    { data: plannedRows },
    { data: competitionRows },
  ] = await Promise.all([
    (() => {
      let q = supabase
        .from("activities")
        .select(SESSION_ACTIVITY_COLUMNS)
        .eq("user_id", scopedUserId)
        .gte("start_time", startDate);
      if (endDateExclusive) q = q.lt("start_time", endDateExclusive);
      return q.order("start_time");
    })(),
    (() => {
      let q = supabase
        .from("diary_entries")
        .select("entry_date, day_type, notes")
        .eq("user_id", scopedUserId)
        .gte("entry_date", startDate);
      if (endDateExclusive) q = q.lt("entry_date", endDateExclusive);
      return q.order("entry_date");
    })(),
    supabase
      .from("profiles")
      .select("threshold_hr_low, threshold_hr_high, max_hr, lt1_hr, lt2_hr, goal_event, goal_seconds")
      .eq("id", scopedUserId)
      .maybeSingle(),
    // K2: bara hämtad i blockvy — efterlevnad hör bara hemma där (se
    // ComplianceCard och tranarperspektiv.md K2 punkt 5), så ett rullande
    // fönster utan block slipper en fråga den inte använder.
    activeBlock
      ? supabase
          .from("planned_workouts")
          .select(
            "id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds",
          )
          .eq("user_id", scopedUserId)
          .gte("scheduled_date", startDate)
          .lt("scheduled_date", endDateExclusive as string)
      : Promise.resolve({ data: [] as PlannedWorkout[] | null }),
    // Tävlingsdagar från idrottarens egna importerade resultat, inte Garmin
    // — se kommentaren vid buildRaceDays.
    (() => {
      let q = supabase
        .from("competitions")
        .select("name, competition_date, competition_events(event)")
        .eq("user_id", scopedUserId)
        .gte("competition_date", startDate);
      if (endDateExclusive) q = q.lt("competition_date", endDateExclusive);
      return q.order("competition_date");
    })(),
  ]);

  const profileRow = profileResult.error ? null : profileResult.data;
  const thresholdProfile: ThresholdProfile = profileRow
    ? {
        thresholdHrLow: profileRow.threshold_hr_low ?? null,
        thresholdHrHigh: profileRow.threshold_hr_high ?? null,
        maxHr: profileRow.max_hr ?? null,
        lt1Hr: profileRow.lt1_hr ?? null,
        lt2Hr: profileRow.lt2_hr ?? null,
      }
    : EMPTY_THRESHOLD_PROFILE;

  // --- Pass, inte aktiviteter (P0.5/1.3) -------------------------------------
  // SESSION_ACTIVITY_COLUMNS är en runtime-sträng, så Supabase-klienten kan
  // inte härleda radtypen och faller tillbaka på GenericStringError[]. Kolumn-
  // listan och SessionActivity definieras bredvid varandra i lib/sessions.ts
  // och hålls i synk där — därför är omvägen via unknown säker här.
  const sessions: TrainingSession[] = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );

  const sessionsByWeek = new Map<string, TrainingSession[]>();
  for (const session of sessions) {
    const wk = isoWeekStart(session.date);
    sessionsByWeek.set(wk, [...(sessionsByWeek.get(wk) ?? []), session]);
  }

  // --- P2.1: passkvalitet för återkommande nyckelpass ------------------------
  // Varven hämtas för periodens aktiviteter och grupperas på signatur, dvs
  // vad som faktiskt genomfördes (antal och längd på aktiva varv) — passnamnen
  // är för inkonsekventa för att gruppera på.
  const activityIds = sessions.flatMap((s) => s.activities.map((a) => a.id));
  const dateByActivityId = new Map<string, string>();
  // Passets kategori, inte fragmentets: uppvärmningen i ett intervallpass är
  // märkt easy men passet är ett intervallpass, och det är den nivån
  // grupperingen ska ske på.
  const categoryByActivityId = new Map<string, string | null>();
  for (const session of sessions) {
    for (const a of session.activities) {
      dateByActivityId.set(a.id, session.date);
      categoryByActivityId.set(a.id, session.category ?? null);
    }
  }

  let signatureGroups: SignatureGroup[] = [];
  const gearReps: GearRep[] = [];
  if (activityIds.length > 0) {
    const lapRows = await fetchAllSplits(supabase, activityIds);

    const lapsByActivity = new Map<string, SignatureLap[]>();
    for (const lap of lapRows) {
      lapsByActivity.set(lap.activity_id, [...(lapsByActivity.get(lap.activity_id) ?? []), lap]);
    }

    const occurrences = [...lapsByActivity.entries()]
      .map(([id, laps]) =>
        toOccurrence(
          id,
          dateByActivityId.get(id) ?? "",
          laps,
          categoryByActivityId.get(id) ?? null,
        ),
      )
      .filter((o): o is NonNullable<typeof o> => o != null && o.date !== "");

    signatureGroups = groupBySignature(occurrences);

    /* Växlarnas underlag ur samma varv som signaturerna redan hämtat.
     *
     * Bara varven ur passets *dominerande* aktivitet räknas. Ett
     * intervallpass består ofta av tre aktiviteter — uppvärmning, huvudpass,
     * nerjogg — och alla tre ärver passets kategori. Tar man varv från alla
     * hamnar uppvärmningens kilometrar bland intervallrepetitionerna: mätt
     * så sjönk intervallernas undre kvartil från 181 till 171 slag, alltså
     * tio slag av ren uppvärmning. Dominerande aktivitet är den som avgjorde
     * kategorin, och därmed den som bär kvalitetsarbetet. */
    for (const session of sessions) {
      if (session.category !== "threshold" && session.category !== "interval") continue;
      for (const lap of lapsByActivity.get(session.dominantActivity.id) ?? []) {
        if (lap.split_type !== "active") continue;
        if (lap.distance_meters == null || lap.avg_hr == null) continue;
        if (lap.duration_seconds == null) continue;
        gearReps.push({
          category: session.category,
          distanceMeters: lap.distance_meters,
          durationSeconds: lap.duration_seconds,
          avgHr: lap.avg_hr,
        });
      }
    }
  }

  // --- C. Formkurva (P1.4) — beräknad på passnivå, aldrig per aktivitet -----
  // Delad med /dashboard (lib/efficiency.ts) — samma pass-urval och formel överallt.
  const efPoints = computeEfficiencyPoints(sessions);

  // Veckans EF som eget lager i huvudgrafen — "fart" i Almgrens fyra axlar.
  const efByWeek = new Map<string, number[]>();
  for (const point of efPoints) {
    const wk = isoWeekStart(point.date);
    // Meter per hjärtslag, samma enhet som formkurvan visar.
    efByWeek.set(wk, [...(efByWeek.get(wk) ?? []), point.ef * 60]);
  }
  const efWeekly = weekSeries.map((wk) => median(efByWeek.get(wk) ?? []));

  const raceDays = buildRaceDays(
    (competitionRows ?? []) as CompetitionLite[],
    sessions.filter((s) => s.category === "race"),
  );

  const efVerdict = efficiencyVerdict(efPoints);

  const efRaces: EfficiencyRace[] = [...raceDays].map(([date, label]) => ({ date, label }));

  // --- B. Intensitetsfördelning (P1.3) --------------------------------------
  const intensityWeeks: IntensityWeek[] = weekSeries.map((wk) => {
    const zoneSeconds: ZoneSeconds = emptyZoneSeconds();
    for (const session of sessionsByWeek.get(wk) ?? []) {
      zoneSeconds[0] += session.hrZone1Seconds;
      zoneSeconds[1] += session.hrZone2Seconds;
      zoneSeconds[2] += session.hrZone3Seconds;
      zoneSeconds[3] += session.hrZone4Seconds;
      zoneSeconds[4] += session.hrZone5Seconds;
    }
    return { key: wk, label: weekLabel(wk), fullLabel: weekRangeLabel(wk), zoneSeconds };
  });

  const sessionsWithZoneData = sessions.filter((s) => s.hrZoneTotalSeconds > 0).length;

  // L3 (docs/tranarloopen.md): insikterna överst gör att man slipper skumma
  // sidans sex sektioner för att veta vad som är värt att titta närmare på.
  // Andelen räknas som tid i zon 4+5 av veckans totala pulstid — samma
  // definition som Tröskel+-måttet använder.
  const thresholdShareWeekly = intensityWeeks.map((w) => {
    const total = w.zoneSeconds.reduce((a, b) => a + b, 0);
    return total > 0 ? (w.zoneSeconds[3] + w.zoneSeconds[4]) / total : null;
  });
  const blockInsights = insightsForPhase(
    buildInsights({ efWeekly, thresholdShareWeekly }),
    "block",
  );

  // --- P1.5: konsekvens inom blocket ------------------------------------
  // Variationskoefficienten för veckobelastning — Almgrens "quite consistent
  // within that period" (2.3 i insikter-roadmapen). Bara meningsfull när
  // fönstret är ett faktiskt block: en rullande 12-veckorsvy blandar per
  // definition olika träningsfaser och en låg/hög CV där säger inget om
  // konsekvens, bara att fönstret råkar spänna över olika sorters veckor.
  // Veckans totala träningsbelastning. Stackades tidigare per passkategori
  // för huvudgrafen — den grafen är borta och ingen läser fördelningen, så
  // bara summan räknas ut.
  const weeklyLoadTotals = weekSeries.map((wk) =>
    (sessionsByWeek.get(wk) ?? []).reduce(
      (sum, session) => sum + Math.max(session.trainingLoad, 0),
      0,
    ),
  );
  const loadCv =
    activeBlock && weeklyLoadTotals.filter((v) => v > 0).length >= 2
      ? coefficientOfVariation(weeklyLoadTotals)
      : null;

  // --- K2: efterlevnad inom blocket --------------------------------------
  // Samma fråga som CV ovan svarar på indirekt ("var träningen jämn"), fast
  // rakt på sak: "blev det gjort". Bara i blockvy, se kommentaren vid
  // planned_workouts-frågan ovan. `sessions`/`diaryEntries` täcker redan
  // exakt blockets fönster (startDate–endDateExclusive), så ingen ny fråga
  // mot databasen behövs utöver planned_workouts.
  const blockCompliance = activeBlock
    ? summarizeCompliance(matchPlanToSessions((plannedRows ?? []) as PlannedWorkout[], sessions))
    : null;
  const blockDayTypeByDate = new Map<string, string | null>(
    (diaryEntries ?? []).map((e) => [e.entry_date as string, e.day_type as string | null]),
  );

  // --- Måltempo -----------------------------------------------------------
  // Egen fråga, med eget fönster: den valda perioden kan sakna lopp helt
  // (ett förberedelseblock gör det per definition), men träningen i den
  // syftar ändå mot en loppfart. Därför 24 månader bakåt från i dag,
  // oberoende av periodväljaren.
  const racePaceFrom = toDateKey(
    new Date(
      new Date(`${todayKey}T00:00:00`).setMonth(
        new Date(`${todayKey}T00:00:00`).getMonth() - RACE_PACE_MONTHS,
      ),
    ),
  );
  const { data: raceResultRows } = await supabase
    .from("competition_events")
    .select("event, result_seconds, competitions!inner(competition_date, user_id)")
    .eq("competitions.user_id", scopedUserId)
    .gte("competitions.competition_date", racePaceFrom)
    .not("result_seconds", "is", null);

  const racePace = pickRacePace(
    ((raceResultRows ?? []) as unknown as {
      event: string;
      result_seconds: number | null;
      competitions: { competition_date: string };
    }[]).map<RaceResultRow>((r) => ({
      event: r.event,
      result_seconds: r.result_seconds,
      competition_date: r.competitions.competition_date,
    })),
  );

  const gears = computeTrainingGears(
    sessions,
    gearReps,
    thresholdProfile.lt1Hr,
    thresholdProfile.lt2Hr,
    thresholdProfile.maxHr,
    // Målet går före personbästa: träningsfarter ska utgå från vad löparen
    // siktar mot. Båda räknas om till 1500-ekvivalent först, så multiplarna
    // fungerar oavsett målgren.
    paceBasisFromGoal(
      profileRow?.goal_event ?? null,
      profileRow?.goal_seconds != null ? Number(profileRow.goal_seconds) : null,
    ) ?? paceBasisFromRace(racePace),
  );
  // Domarna i sektionsrubrikerna är pulsbaserade. Saknas pulsvyn faller de
  // tillbaka på fartvyns växlar, som har samma nycklar.
  const gearByKey = new Map<GearKey, Gear>(
    ((gears?.hr ?? gears?.pace)?.gears ?? []).map((g) => [g.key, g]),
  );

  // Nyckelpassen delas på växel: tröskelpass hör hemma i tröskelsektionen,
  // allt annat kvalitetsarbete i intervallsektionen.
  const thresholdGroups = signatureGroups.filter((g) => g.category === "threshold");
  const intervalGroups = signatureGroups.filter((g) => g.category !== "threshold");

  // --- Är lugnt verkligen lugnt? -----------------------------------------
  // Kringgår Garmins zonhinkar helt — bara passets snittpuls mot ett band ur
  // profilen. Se lib/easy-discipline.ts för varför zonandelarna inte duger
  // till just den frågan.
  const easyDiscipline = computeEasyDiscipline(
    sessions,
    easyBandFrom(thresholdProfile.lt1Hr, thresholdProfile.maxHr),
  );

  // --- Rampen -------------------------------------------------------------
  // Ersätter det staplade belastningsdiagrammet. Innevarande vecka utesluts
  // av computeLoadRamp — en halvfärdig vecka mot fyra hela visar alltid fall.
  const loadRamp = computeLoadRamp(weekSeries, weeklyLoadTotals, isoWeekStart(todayKey));

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">

      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Form</h1>
          {activeBlock ? (
            <p className="text-sm text-[var(--ink-3)]">
              <strong className="font-medium text-[var(--foreground)]">{activeBlock.name}</strong> (
              {PHASE_LABELS[activeBlock.phase]}), {activeBlock.start_date} – {activeBlock.end_date}
              {activeBlock.focus ? ` — ${activeBlock.focus}` : ""}. Räknas per{" "}
              <strong className="font-medium">pass</strong>, inte per Garmin-aktivitet.
            </p>
          ) : (
            <p className="text-sm text-[var(--ink-3)]">
              Allt på den här sidan räknas per <strong className="font-medium">pass</strong>, inte
              per Garmin-aktivitet: uppvärmning, huvudpass och nerjogg slås ihop till ett pass innan
              något summeras.
            </p>
          )}
        </div>
        <div className="flex flex-col items-end gap-2 text-sm">
          <div className="flex gap-2">
            {WEEK_OPTIONS.map((w) => (
              <Link
                key={w}
                href={`/trender?weeks=${w}${athleteQuery}`}
                className={`rounded px-3 py-1 ${
                  !activeBlock && weeks === w
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "border border-[var(--line)]"
                }`}
              >
                {w} veckor
              </Link>
            ))}
          </div>
          {blocks.length > 0 && (
            <div className="flex flex-wrap justify-end gap-2">
              {blocks.map((b) => (
                <Link
                  key={b.id}
                  href={`/trender?block=${b.id}${athleteQuery}`}
                  title={`${PHASE_LABELS[b.phase]}, ${b.start_date} – ${b.end_date}`}
                  className={`rounded px-3 py-1 ${
                    activeBlock?.id === b.id
                      ? "bg-[var(--foreground)] text-[var(--background)]"
                      : "border border-[var(--line)]"
                  }`}
                >
                  {b.name}
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Toppen är en dom, inte ett lager av nyckeltal. Här låg tidigare
          CV-rutan, efterlevnadskortet och fyra nyckeltal — ett dussin tal
          före första diagrammet, med Efterlevnad visad två gånger. CV och
          efterlevnad hör ihop med belastningen och ligger nu i "Håller jag
          ihop?" längst ner. Kvar överst: påståendena. */}
      {/* L3: påståenden före diagram. Sidan har sex sektioner — den här
          ytan säger vad som är värt att titta på, i stället för att man ska
          skumma alla för att upptäcka det själv. */}
      {blockInsights.length > 0 && (
        <section className="flex flex-col gap-3">
          {blockInsights.map((i) => (
            <InsightCard
              key={i.id}
              headline={i.headline}
              detail={i.detail}
              href={i.href}
              tone={i.tone}
            />
          ))}
        </section>
      )}

      {/* ===== Träningens tre växlar: sidans ingång ===== */}
      {gears && (
        <section className="flex flex-col gap-3">
          <div>
            <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
              Träningens tre växlar
            </h2>
            <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
              Medeldistansträning är tre olika jobb: bygga motorn, höja farten du kan hålla, och
              höja taket. De ska ligga på åtskilda intensiteter — annars tränas samma sak flera
              gånger i veckan under olika namn. Sektionerna nedan är samma tre växlar, en i taget.
            </p>
          </div>

          <TrainingGears data={gears} />

          {/* Intensitetsfördelningen svarar på samma fråga som diagrammet
              ovan, fast ur Garmins zonhinkar i stället för ur dina egna
              trösklar. Den ligger kvar, men nedfälld och intill sin bättre
              informerade granne — inte som en andra sanning längre ner. */}
          <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)]">
            <summary className="cursor-pointer p-4 text-sm text-[var(--ink-2)]">
              Samma fråga ur Garmins pulszoner
            </summary>
            <div className="flex flex-col gap-3 border-t border-[var(--line)] p-4">
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="display text-lg leading-tight font-semibold text-[var(--foreground)]">Intensitetsfördelning</h3>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Andel av veckans pulstid per zon, summerad över passets alla fragment.{" "}
            {sessionsWithZoneData} av {sessions.length} pass i perioden har zondata.
            Medeldistansträning handlar mindre om hur mycket och mer om fördelningen.
          </p>
        </div>

        <IntensityChart
          weeks={intensityWeeks}
          defaultModelId={
            activeBlock ? PHASE_INTENSITY_MODEL[activeBlock.phase] : undefined
          }
          profile={thresholdProfile}
          emptyLabel="Ingen pulszondata i perioden."
        />
      </section>

            </div>
          </details>
        </section>
      )}

      {/* ===== Växel 1 ===== */}
      <CollapsibleSection
        title="Distans"
        meta={GEAR_PURPOSE.distans}
        headline={
          gearByKey.has("distans") ? (
            <span className="text-sm text-[var(--ink-2)]">
              {gearVerdict(gearByKey.get("distans") as Gear, gears?.lt1 ?? 0, gears?.lt2 ?? 0)}
            </span>
          ) : undefined
        }
      >
      <section className="flex flex-col gap-3">
        <div>
          <h3 className="display text-lg leading-tight font-semibold text-[var(--foreground)]">
            Formkurva (Efficiency Factor)
          </h3>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Hur långt du kommer per hjärtslag. Stiger kurvan vid samma puls går formen åt rätt håll.
            Bara lugna pass och långpass på minst 20 minuter med registrerad snittpuls räknas —
            intervaller går inte att jämföra med distanslöpning. {efPoints.length} pass i perioden
            klarar filtret.
          </p>
        </div>

        {efVerdict && (
          <p className="text-base font-medium text-[var(--foreground)]">
            {efVerdict.direction === "oförändrad" ? (
              <>Oförändrad över perioden ({efVerdict.n} pass).</>
            ) : (
              <>
                {efVerdict.change > 0 ? "+" : "−"}
                {Math.abs(efVerdict.change * 100).toFixed(1)} % över perioden — riktningen pekar{" "}
                <span
                  className={
                    efVerdict.direction === "upp"
                      ? "text-emerald-600 dark:text-emerald-400"
                      : "text-amber-600 dark:text-amber-400"
                  }
                >
                  {efVerdict.direction === "upp" ? "uppåt" : "nedåt"}
                </span>{" "}
                ({efVerdict.n} pass).
              </>
            )}
          </p>
        )}

        <EfficiencyChart
          points={efPoints}
          races={efRaces}
          fromDate={startDate}
          toDate={activeBlock ? activeBlock.end_date : todayKey}
          emptyLabel="Inga pass i perioden klarar filtret (lugnt/långpass, ≥ 20 min, med snittpuls)."
        />

        <p className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--ink-2)]">
          <strong className="font-medium text-[var(--foreground)]">Läs kurvan försiktigt.</strong>{" "}
          Efficiency Factor påverkas kraftigt av värme, uttorkning, stress, höjd och underlag. En
          dipp i juli är sannolikt vädret, inte formen. Kurvan är dessutom räknad på rå fart — ett
          kuperat pass ser sämre ut än ett platt även när ansträngningen är densamma. Använd den för
          att se riktningen över månader, aldrig för att bedöma ett enskilt pass.
        </p>
      </section>

      {easyDiscipline && (
        <EasyDiscipline
          data={easyDiscipline}
          /* Målfartsbandet för distans kommer från växeldiagrammets fartvy,
             så de två sektionerna aldrig visar olika mål för samma sak. */
          paceTarget={gears?.pace?.gears.find((g) => g.key === "distans")?.target ?? null}
        />
      )}

      </CollapsibleSection>

      {/* ===== Växel 2 ===== */}
      <CollapsibleSection
        title="Tröskel"
        meta={GEAR_PURPOSE.troskel}
        headline={
          gearByKey.has("troskel") ? (
            <span className="text-sm text-[var(--ink-2)]">
              {gearVerdict(gearByKey.get("troskel") as Gear, gears?.lt1 ?? 0, gears?.lt2 ?? 0)}
            </span>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <h3 className="display text-lg leading-tight font-semibold text-[var(--foreground)]">
            Tröskelpassens nyckelpass
          </h3>
          <SessionQuality
            groups={thresholdGroups}
            racePace={racePace}
            showRaceReference={false}
          />
        </div>
      </CollapsibleSection>

      {/* ===== Växel 3 ===== */}
      <CollapsibleSection
        title="Intervall"
        meta={GEAR_PURPOSE.intervall}
        headline={
          gearByKey.has("intervall") ? (
            <span className="text-sm text-[var(--ink-2)]">
              {gearVerdict(gearByKey.get("intervall") as Gear, gears?.lt1 ?? 0, gears?.lt2 ?? 0)}
            </span>
          ) : undefined
        }
      >
        <div className="flex flex-col gap-3">
          <h3 className="display text-lg leading-tight font-semibold text-[var(--foreground)]">
            Intervallpassens nyckelpass
          </h3>
          <SessionQuality groups={intervalGroups} racePace={racePace} />
        </div>
      </CollapsibleSection>

      {/* ===== Fråga 3: håller jag ihop? ===== */}
      <LoadStrip ramp={loadRamp} loadCv={loadCv}>
        {activeBlock && blockCompliance && (
          <ComplianceCard
            title={activeBlock.name}
            compliance={blockCompliance}
            dayTypeByDate={blockDayTypeByDate}
          />
        )}
      </LoadStrip>

      {/* L5 (docs/tranarloopen.md): loopens utgång. Sidan slutar med nästa
          steg, inte med sista diagrammet — det är det som gör sidorna till en
          loop i stället för fyra hus. Datumet förifylls så det nya blocket
          börjar dagen efter det nuvarande slutar, i stället för att man
          landar på ett tomt formulär och får räkna själv. */}
      {activeBlock && (
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <div className="flex-1">
            <p className="font-medium text-[var(--foreground)]">Nästa block</p>
            <p className="text-sm text-[var(--ink-3)]">
              {activeBlock.name} slutar {activeBlock.end_date}. Utvärderingen ovan är underlaget för
              hur nästa ska se ut.
            </p>
          </div>
          <Link
            href={
              scoped.role === "coach"
                ? `/sasongsoversikt?athlete=alla&nyttBlockFran=${toDateKey(planAddDays(new Date(`${activeBlock.end_date}T00:00:00`), 1))}`
                : `/sasongsoversikt?nyttBlockFran=${toDateKey(planAddDays(new Date(`${activeBlock.end_date}T00:00:00`), 1))}`
            }
            className="rounded bg-[var(--foreground)] px-4 py-2 text-sm text-[var(--background)] hover:opacity-90"
          >
            Skapa nästa block →
          </Link>
        </div>
      )}
    </div>
  );
}
