import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { buildInsights, insightsForPhase } from "@/lib/insights";
import { InsightCard } from "@/components/InsightCard";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  type SessionActivity,
} from "@/lib/sessions";
import {
  matchPlanToSessions,
  summarizeCompliance,
  type PlanMatch,
  type PlannedWorkout,
} from "@/lib/plan-matching";
import { ComplianceCard } from "@/components/ComplianceCard";
import { AvailabilityBand } from "@/components/AvailabilityBand";
import {
  WeekAgenda,
  type AgendaDiaryDay,
  type AgendaMetricDay,
} from "@/components/WeekAgenda";
import { QUALITY_WORKOUT_TYPES, type AvailabilityPeriod } from "@/lib/planning";
import { formatDuration, formatHoursMinutes } from "@/lib/format";
import { isoWeekStart, weekLabel } from "@/lib/stats-utils";
import { BarChart, type BarDatum } from "@/components/charts/BarChart";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  categoryColorVar,
  isActivityCategory,
  type ActivityCategory,
} from "@/lib/categories";
import { buildWeekSeriesForRange } from "@/lib/week-series";

// Hur många veckor bakåt "Fördelning per kategori" och "Distans och tid per
// vecka" (nedan) visar, ankrat på den vecka man tittar på (inte alltid idag)
// — kontext till veckan, "hur ligger den här mot de senaste tolv?" (se
// docs/tranarloopen.md 3.1). Flerveckorsdiagram på en sida som annars visar
// en enda vecka är avsiktligt: de två sektionerna flyttades hit från
// /blocket just för att ge den ramen.
const WEEKS_CONTEXT = 12;

/** En liggande stapel per period, fördelad på kategori efter distans-andel —
 * samma idé som ComboChartens veckovisa staplar (stackad belastning per
 * kategori), bara konsoliderad till en enda stapel för en hel period i
 * stället för en stapel per vecka. Bara färgade divs, ingen SVG — därför
 * ingen risk för samma <title>-hydreringsbugg som drabbat de riktiga
 * diagrammen (se ComboChart/CategoryPieChart-historiken). Flyttad hit från
 * /blocket (docs/tranarloopen.md 3.1) — hör hemma i veckokontexten. */
function CategoryDistributionBar({
  rows,
}: {
  rows: { category: ActivityCategory; km: number; seconds: number; count: number }[];
}) {
  const total = rows.reduce((sum, d) => sum + d.km, 0);
  if (rows.length === 0 || total <= 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Inga pass i perioden.</p>;
  }
  return (
    <div className="flex flex-col gap-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        {rows.map((d) => {
          const share = d.km / total;
          return (
            <div
              key={d.category}
              className="h-full"
              style={{ width: `${share * 100}%`, backgroundColor: categoryColorVar(d.category) }}
              title={`${CATEGORY_LABELS[d.category]}: ${d.km.toFixed(1)} km (${Math.round(share * 100)}%)`}
            />
          );
        })}
      </div>
      <ul className="flex flex-col gap-0.5">
        {rows.map((d) => {
          const share = d.km / total;
          return (
            <li key={d.category} className="flex items-center gap-2 text-xs">
              <span
                className="h-2 w-2 shrink-0 rounded-sm"
                style={{ backgroundColor: categoryColorVar(d.category) }}
              />
              <span className="text-zinc-600 dark:text-zinc-400">{CATEGORY_LABELS[d.category]}</span>
              <span className="ml-auto tabular-nums text-zinc-900 dark:text-zinc-100">
                {d.km.toFixed(1)} km · {formatHoursMinutes(d.seconds)} · {Math.round(share * 100)}%
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* Veckan — loopens hjärtslag (docs/tranarloopen.md).
 *
 * Veckan är den kadens träning faktiskt planeras i: en veckomall *är* en
 * vecka, och ett block mäts i veckor. Ändå fanns ingen yta som ägde den —
 * datan låg utspridd (efterlevnad i kalendern, volym på trends) och inget
 * markerade att en vecka tagit slut.
 *
 * Sidan äger en tidshorisont och svarar på båda frågorna för den: vad hände,
 * och vad händer härnäst. Därför slutar den med "planera nästa vecka" — det
 * är skillnaden mellan en rapport och en ritual. */

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

function toKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function mondayOf(dateKey: string): Date {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

export default async function VeckanPage({
  searchParams,
}: {
  searchParams: Promise<{
    vecka?: string;
    volumeCategories?: string | string[];
    volumeFiltered?: string;
    volumeMetric?: string;
  }>;
}) {
  const {
    vecka,
    volumeCategories: volumeCategoriesParam,
    volumeFiltered: volumeFilteredParam,
    volumeMetric: volumeMetricParam,
  } = await searchParams;
  const todayKey = toKey(new Date());
  // Okänt eller felstavat datum ska inte krascha sidan — fall tillbaka på
  // innevarande vecka, som är det man vill se i nio fall av tio ändå.
  const anchor = vecka && /^\d{4}-\d{2}-\d{2}$/.test(vecka) ? vecka : todayKey;

  const monday = mondayOf(anchor);
  const sunday = addDays(monday, 6);
  const from = toKey(monday);
  const to = toKey(sunday);
  const nextExclusive = toKey(addDays(sunday, 1));
  const nextMonday = toKey(addDays(monday, 7));
  const prevMonday = toKey(addDays(monday, -7));

  const volumeMetric: "distance" | "time" = volumeMetricParam === "time" ? "time" : "distance";

  // Distans-/tid-diagrammet (nedan) ska kunna avgränsas till valda
  // passkategorier — annars räknas t ex cykel och styrka in i "tränade km"
  // som om det vore löpning. Ett dolt fält (`volumeFiltered`) skiljer "inget
  // filter valt än" (formuläret aldrig skickat → visa default-urvalet) från
  // "användaren bockade ur allt" (formuläret skickat, men tomt) — annars kan
  // HTML-formulär inte skilja de fallen åt när alla kryssrutor är avbockade.
  // Default-urvalet exkluderar alternativ träning/styrka: "tränade km/tid"
  // ska i första hand betyda löpning, inte blandas ut av cykelpass eller ett
  // gympass utan volymmått. Samma mönster som /blocket använde innan
  // sektionen flyttade hit (docs/tranarloopen.md 3.1).
  const selectedVolumeCategories: Set<ActivityCategory> = volumeFilteredParam
    ? new Set(
        (Array.isArray(volumeCategoriesParam)
          ? volumeCategoriesParam
          : volumeCategoriesParam
            ? [volumeCategoriesParam]
            : []
        ).filter(isActivityCategory),
      )
    : new Set(CATEGORY_VALUES.filter((c) => c !== "cross_training" && c !== "strength"));

  // Kontextfönstret för de två flerveckorssektionerna: WEEKS_CONTEXT veckor
  // som slutar med (och inkluderar) den vecka man tittar på — inte alltid
  // idag, vecka-parametern kan peka bakåt eller framåt.
  const contextFromMonday = toKey(addDays(monday, -7 * (WEEKS_CONTEXT - 1)));
  const contextWeekSeries = buildWeekSeriesForRange(contextFromMonday, from);

  /** Bygger en /veckan-länk som behåller vald vecka, kategorifiltret och
   * metricvalet — bara det som skickas in i `overrides` ändras. Utan den
   * skulle t.ex. Distans/Tid-växlaren nollställa både veckovalet och
   * kategorifiltret varje gång man klickade. Speglar volumeHref i
   * /blocket (innan flytten, se docs/tranarloopen.md 3.1). */
  function volumeHref(overrides: Record<string, string>): string {
    const params = new URLSearchParams();
    if (vecka) params.set("vecka", vecka);
    params.set("volumeMetric", volumeMetric);
    if (volumeFilteredParam) {
      params.set("volumeFiltered", volumeFilteredParam);
      const cats = Array.isArray(volumeCategoriesParam)
        ? volumeCategoriesParam
        : volumeCategoriesParam
          ? [volumeCategoriesParam]
          : [];
      for (const c of cats) params.append("volumeCategories", c);
    }
    for (const [key, value] of Object.entries(overrides)) params.set(key, value);
    return `/veckan?${params.toString()}`;
  }

  const supabase = await createClient();
  const [
    { data: activityRows },
    { data: plannedRows },
    { data: diaryRows },
    { data: competitionRows },
    { data: availabilityRows },
    { data: dailyMetricRows },
    { data: nextWeekPlanned },
    { data: contextActivityRows },
  ] = await Promise.all([
    // activity_splits(*) nästlat: genomgången visar varvtider per pass.
    supabase
      .from("activities")
      .select(`${SESSION_ACTIVITY_COLUMNS}, activity_splits(*)`)
      .gte("start_time", from)
      .lt("start_time", nextExclusive)
      .order("start_time"),
    // planned_rep_groups(*) nästlat: planraden visar pace och vila ur K1.
    supabase
      .from("planned_workouts")
      .select(
        "id, scheduled_date, slot, workout_type, title, target_distance_meters, target_duration_seconds, planned_rep_groups(*)",
      )
      .gte("scheduled_date", from)
      .lte("scheduled_date", to)
      .order("slot"),
    supabase
      .from("diary_entries")
      .select("entry_date, day_type, notes, session_log")
      .gte("entry_date", from)
      .lte("entry_date", to),
    supabase
      .from("competitions")
      .select("id, name, competition_date, priority")
      .gte("competition_date", from)
      .lte("competition_date", to),
    supabase
      .from("availability_periods")
      .select("start_date, end_date, kind, label")
      .lte("start_date", to)
      .gte("end_date", from),
    supabase
      .from("daily_metrics")
      .select("metric_date, sleep_seconds, hrv_overnight_avg")
      .gte("metric_date", from)
      .lte("metric_date", to),
    // Är nästa vecka redan planerad? Styr om utgången nedan lyder "planera"
    // eller "se över" — och är samma signal som next-actions använder för att
    // avgöra om veckan är genomgången (docs/tranarloopen.md L2).
    supabase
      .from("planned_workouts")
      .select("id")
      .gte("scheduled_date", nextMonday)
      .lte("scheduled_date", toKey(addDays(monday, 13)))
      .limit(1),
    // Kontextfönstret för "Fördelning per kategori" och "Distans och tid per
    // vecka" (flyttade från /blocket, docs/tranarloopen.md 3.1) — en egen,
    // bredare fråga så att veckans egen genomgång ovan inte behöver dra in
    // activity_splits för elva extra veckor den inte visar.
    supabase
      .from("activities")
      .select(SESSION_ACTIVITY_COLUMNS)
      .gte("start_time", contextFromMonday)
      .lt("start_time", nextExclusive)
      .order("start_time"),
  ]);

  const sessions = groupActivitiesIntoSessions(
    (activityRows ?? []) as unknown as SessionActivity[],
  );
  const plannedWorkouts = (plannedRows ?? []) as PlannedWorkout[];

  const planMatches = matchPlanToSessions(plannedWorkouts, sessions);
  const matchesByDay = new Map<string, PlanMatch[]>();
  for (const m of planMatches) {
    const day = m.planned?.scheduled_date ?? m.session!.date;
    matchesByDay.set(day, [...(matchesByDay.get(day) ?? []), m]);
  }
  const compliance = summarizeCompliance(planMatches);

  const diaryByDay = new Map<string, AgendaDiaryDay>(
    (diaryRows ?? []).map((d) => [d.entry_date as string, d as AgendaDiaryDay]),
  );
  const dayTypeByDate = new Map<string, string | null>(
    [...diaryByDay].map(([day, entry]) => [day, entry.day_type]),
  );
  const dailyMetricsByDay = new Map<string, AgendaMetricDay>(
    (dailyMetricRows ?? []).map((m) => [m.metric_date as string, m as AgendaMetricDay]),
  );
  const competitionsByDay = new Map<string, { name: string; priority: string }[]>();
  for (const c of competitionRows ?? []) {
    const day = c.competition_date as string;
    competitionsByDay.set(day, [
      ...(competitionsByDay.get(day) ?? []),
      { name: c.name as string, priority: c.priority as string },
    ]);
  }

  // Summorna räknas på pass, inte aktiviteter — annars räknas uppvärmning och
  // nerjogg som egna pass i "antal pass" (P0.5).
  const totalKm = sessions.reduce((sum, s) => sum + s.distanceMeters, 0) / 1000;
  const totalSeconds = sessions.reduce((sum, s) => sum + s.durationSeconds, 0);
  const totalLoad = sessions.reduce((sum, s) => sum + s.trainingLoad, 0);

  const isCurrentWeek = from === toKey(mondayOf(todayKey));
  const nextWeekIsPlanned = (nextWeekPlanned ?? []).length > 0;

  // --- Fördelning per kategori och Distans/tid per vecka (flyttade från
  // /blocket, docs/tranarloopen.md 3.1) — kontext till veckan ovan: "hur
  // ligger den här veckan mot de senaste WEEKS_CONTEXT?". Räknat på samma
  // pass-enhet (P0.5) som resten av sidan, över kontextfönstret, inte bara
  // den enskilda veckan.
  const contextSessions = groupActivitiesIntoSessions(
    (contextActivityRows ?? []) as unknown as SessionActivity[],
  );

  const categoryDistributionRows: {
    category: ActivityCategory;
    km: number;
    seconds: number;
    count: number;
  }[] = (() => {
    const byCategory = new Map<ActivityCategory, { km: number; seconds: number; count: number }>();
    for (const s of contextSessions) {
      const cur = byCategory.get(s.category) ?? { km: 0, seconds: 0, count: 0 };
      cur.km += s.distanceMeters / 1000;
      cur.seconds += s.durationSeconds;
      cur.count += 1;
      byCategory.set(s.category, cur);
    }
    return CATEGORY_VALUES.map((category) => ({
      category,
      ...(byCategory.get(category) ?? { km: 0, seconds: 0, count: 0 }),
    })).filter((d) => d.km > 0);
  })();

  // Veckans distans och tid som egna lager, en per vecka i kontextfönstret.
  // En vecka utan träning är ett riktigt värde (0), inte en lucka.
  const distanceByWeek = new Map<string, number>();
  const durationByWeek = new Map<string, number>();
  for (const session of contextSessions) {
    if (!selectedVolumeCategories.has(session.category)) continue;
    const wk = isoWeekStart(session.date);
    distanceByWeek.set(wk, (distanceByWeek.get(wk) ?? 0) + session.distanceMeters / 1000);
    durationByWeek.set(wk, (durationByWeek.get(wk) ?? 0) + session.durationSeconds / 3600);
  }
  // Kontextfönstret slutar alltid med den vecka man tittar på, så den ligger
  // sist i raden — det är hur "läge mot de senaste veckorna" syns utan att
  // BarChart-komponenten stödjer att markera en enskild stapel (den har
  // ingen sådan prop, se components/charts/BarChart.tsx).
  const distanceBarData: BarDatum[] = contextWeekSeries.map((wk) => ({
    label: weekLabel(wk),
    value: distanceByWeek.get(wk) ?? 0,
  }));
  const durationBarData: BarDatum[] = contextWeekSeries.map((wk) => ({
    label: weekLabel(wk),
    value: durationByWeek.get(wk) ?? 0,
  }));

  // L3: veckans insikter. Volymserien är kontextfönstret (slutar med den
  // betraktade veckan), och kvalitetspassen per vecka räknas ur samma
  // matchning som efterlevnadskortet — inte ur en egen fråga.
  const qualityByWeek = new Map<string, number>();
  for (const m of planMatches) {
    if (m.session && QUALITY_WORKOUT_TYPES.includes(m.session.category)) {
      const wk = isoWeekStart(m.session.date);
      qualityByWeek.set(wk, (qualityByWeek.get(wk) ?? 0) + 1);
    }
  }
  const weekInsights = insightsForPhase(
    buildInsights({
      distanceKmWeekly: contextWeekSeries.map((wk) => distanceByWeek.get(wk) ?? 0),
      qualitySessionsWeekly: contextWeekSeries.map((wk) => qualityByWeek.get(wk) ?? 0),
    }),
    "vecka",
  );

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link
            href={`/veckan?vecka=${prevMonday}`}
            className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            ←
          </Link>
          <div>
            <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
              {weekLabel(from)}
              {isCurrentWeek && (
                <span className="ml-2 text-sm font-normal text-zinc-500 dark:text-zinc-400">
                  pågår
                </span>
              )}
            </h1>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              {from} – {to}
            </p>
          </div>
          <Link
            href={`/veckan?vecka=${nextMonday}`}
            className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
          >
            →
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3 text-sm">
          {!isCurrentWeek && (
            <Link
              href="/veckan"
              className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            >
              Denna vecka
            </Link>
          )}
          <Link
            href={`/calendar/vecka/${from}`}
            className="text-zinc-500 underline hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            Rutnätsvy
          </Link>
        </div>
      </div>

      {weekInsights.length > 0 && (
        <section className="flex flex-col gap-2">
          {weekInsights.map((i) => (
            <InsightCard key={i.id} headline={i.headline} detail={i.detail} href={i.href} tone={i.tone} />
          ))}
        </section>
      )}

      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[
          { label: "Pass", value: String(sessions.length) },
          { label: "Distans", value: totalKm > 0 ? `${totalKm.toFixed(1)} km` : "—" },
          { label: "Tid", value: totalSeconds > 0 ? formatDuration(totalSeconds) : "—" },
          { label: "Belastning", value: totalLoad > 0 ? String(Math.round(totalLoad)) : "—" },
        ].map((tile) => (
          <div key={tile.label} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
            <dt className="text-xs text-zinc-500 dark:text-zinc-400">{tile.label}</dt>
            <dd className="mt-0.5 text-xl font-semibold text-zinc-900 dark:text-zinc-50">
              {tile.value}
            </dd>
          </div>
        ))}
      </dl>

      <ComplianceCard
        title={`Vecka ${weekLabel(from).slice(2)}`}
        compliance={compliance}
        dayTypeByDate={dayTypeByDate}
      />

      <AvailabilityBand periods={(availabilityRows ?? []) as AvailabilityPeriod[]} />

      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Genomgång</h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            En rad per pass med planen, utfallet och dina egna ord bredvid varandra.
            Varvtiderna förklarar ofta det siffrorna annars gör till en trend.
          </p>
        </div>
        <WeekAgenda
          monday={monday}
          todayKey={todayKey}
          diaryByDay={diaryByDay}
          dailyMetricsByDay={dailyMetricsByDay}
          competitionsByDay={competitionsByDay}
          matchesByDay={matchesByDay}
        />
      </section>

      {/* ================= Fördelning per kategori ============================ */}
      {/* Flerveckorsdiagram, med flit — ger kontext åt veckan ovan i stället
          för att bara upprepa den. Flyttad från /blocket (docs/tranarloopen.md
          3.1): "hur ligger den här veckan mot de senaste WEEKS_CONTEXT?" */}
      <section className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Fördelning per kategori
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Andel av distansen per kategori, de senaste {WEEKS_CONTEXT} veckorna fram till och
            med den här veckan.
          </p>
        </div>
        <CategoryDistributionBar rows={categoryDistributionRows} />
      </section>

      {/* ================= Distans och tid per vecka ========================= */}
      <section className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
              {volumeMetric === "distance" ? "Distans per vecka" : "Träningstid per vecka"}
            </h2>
            <p className="text-sm text-zinc-500 dark:text-zinc-400">
              De senaste {WEEKS_CONTEXT} veckorna — den här veckan är stapeln längst till höger.
              Välj vilka passkategorier som ska räknas med, annars blandas t ex cykel och
              styrka in i &quot;tränade km&quot;.
            </p>
          </div>
          <div className="flex gap-2 text-sm">
            {(["distance", "time"] as const).map((m) => (
              <Link
                key={m}
                href={volumeHref({ volumeMetric: m })}
                className={`rounded px-3 py-1 ${
                  volumeMetric === m
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {m === "distance" ? "Distans" : "Tid"}
              </Link>
            ))}
          </div>
        </div>

        <form method="get" className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          {vecka && <input type="hidden" name="vecka" value={vecka} />}
          <input type="hidden" name="volumeFiltered" value="1" />
          <input type="hidden" name="volumeMetric" value={volumeMetric} />
          {CATEGORY_VALUES.map((c) => (
            <label key={c} className="inline-flex items-center gap-1.5">
              <input
                type="checkbox"
                name="volumeCategories"
                value={c}
                defaultChecked={selectedVolumeCategories.has(c)}
              />
              {CATEGORY_LABELS[c]}
            </label>
          ))}
          <button
            type="submit"
            className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Uppdatera
          </button>
        </form>

        {volumeMetric === "distance" ? (
          <BarChart data={distanceBarData} formatKind="km" emptyLabel="Inga pass i perioden." />
        ) : (
          <BarChart data={durationBarData} formatKind="hours" emptyLabel="Inga pass i perioden." />
        )}
      </section>

      {/* Loopens utgång: sidan slutar med nästa steg, inte med söndagen. Det
          är skillnaden mellan en rapport och en ritual. */}
      <div className="flex flex-wrap items-center gap-4 rounded border border-zinc-200 p-4 dark:border-zinc-800">
        <div className="flex-1">
          <p className="font-medium text-zinc-900 dark:text-zinc-100">
            {nextWeekIsPlanned ? "Nästa vecka är planerad" : "Planera nästa vecka"}
          </p>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            {nextWeekIsPlanned
              ? "Se över den om något behöver justeras efter den här veckan."
              : "Veckomallarna rullas ut automatiskt i blocken — här justerar du det som ska avvika."}
          </p>
        </div>
        <Link
          href={`/sasongen?vecka=${nextMonday}`}
          className="rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
        >
          {nextWeekIsPlanned ? "Se nästa vecka →" : "Planera nästa vecka →"}
        </Link>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Utfallet visas per pass, inte per Garmin-aktivitet: uppvärmning, huvudpass och
        nerjogg slås ihop till ett pass. Två pass samma dag hålls isär när det skiljer mer
        än ett par timmar mellan dem.
      </p>
    </div>
  );
}
