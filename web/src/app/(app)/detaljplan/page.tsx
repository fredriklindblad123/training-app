import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, viewableAthletes, type AthleteOption } from "@/lib/auth-scope";
import {
  SLOT_LABELS,
  WEEKDAY_LABELS,
  WORKOUT_LABELS,
  workoutTypeColorVar,
  type WorkoutType,
} from "@/lib/planning";
import { formatKm, formatHoursMinutes } from "@/lib/format";
import {
  buildPlanWeeks,
  outcomeKey,
  type CompetitionRow,
  type PassGroup,
  type PlannedPassRow,
} from "@/lib/plan-weeks";
import {
  groupActivitiesIntoSessions,
  SESSION_ACTIVITY_COLUMNS,
  type SessionActivity,
} from "@/lib/sessions";
import { matchPlanToSessions, type PlannedWorkout, type PlanOutcome } from "@/lib/plan-matching";
import { LinkPending } from "@/components/ui/LinkPending";

/* Detaljplan: EN vecka, innevarande som standard (2026-09-15).
 *
 * Tränarens vanligaste ärende är inte att överblicka ett helt block — det är
 * att titta på veckan som gäller nu, öppna ett pass och skriva till löparna.
 * Blockplanen (som hette Detaljplan fram till idag) visar blockets ALLA
 * veckor staplade, vilket är rätt när man lägger upp ett block och fel när
 * man jobbar i det: veckan man faktiskt är i ligger någonstans mitt i en lång
 * lista och måste letas fram varje gång.
 *
 * Skillnaden mot blockplanen är alltså inte innehållet utan urvalet och
 * formen: en vecka åt gången, dagarna som kolumner i stället för en rad i ett
 * rutnät, och veckan man står i vald åt en.
 *
 * Datamodellen delas — buildPlanWeeks är samma funktion som blockplanen
 * använder, anropad med veckans start och slut som "blockspann". Passen
 * grupperas därmed på exakt samma sätt (en ruta per datum och slot, med alla
 * löpare som har raden), så de två vyerna kan aldrig visa olika pass.
 */

/** Måndagen i veckan ett datum ligger i. UTC genomgående: nycklarna är rena
 * datum utan tid, och lokal tolkning skulle flytta gränsen ett dygn i fel
 * riktning öster om Greenwich — samma fälla som shiftDays i lib/daily-status
 * gick i. */
function mondayOf(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const shift = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - shift);
  return d.toISOString().slice(0, 10);
}

function addDaysKey(dateKey: string, days: number): string {
  const d = new Date(`${dateKey}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Dagens datum i svensk tid. Servern kör UTC på Vercel, och strax före
 * midnatt svensk tid är UTC fortfarande gårdagen — "innevarande vecka" hade
 * då kunnat bli fel vecka under ett par timmar varje kväll. */
function todayKeyStockholm(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
}

const DATE_KEY = /^\d{4}-\d{2}-\d{2}$/;

function targetsLabel(g: PassGroup): string | null {
  const parts = [
    g.rows[0]?.target_distance_meters ? formatKm(g.rows[0].target_distance_meters) : null,
    g.targetDurationSeconds ? formatHoursMinutes(g.targetDurationSeconds) : null,
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(" · ") : null;
}

const OUTCOME_TONE: Record<string, string> = {
  done: "var(--status-good)",
  partial: "var(--status-watch)",
  missed: "var(--status-concern)",
};

function PassCard({
  group,
  namesById,
  href,
}: {
  group: PassGroup;
  namesById: Map<string, string>;
  href: string;
}) {
  const label = WORKOUT_LABELS[group.workoutType as WorkoutType] ?? group.workoutType;
  const targets = targetsLabel(group);
  /* Kommentaren till löparna. Det är description-fältet på passet — samma
   * fält som passformulärets "Beskrivning" skriver. Den visas här i klartext
   * och inte bara bakom en redigeringsvy, för att hela poängen med att skriva
   * den är att någon ska läsa den. */
  const comment = group.rows.find((r) => (r.description ?? "").trim())?.description?.trim() ?? null;

  return (
    <Link
      href={href}
      className="flex flex-col gap-1.5 rounded-md border border-[var(--line)] bg-[var(--surface)] p-2 transition-colors hover:border-[var(--ink-3)]"
    >
      <div className="flex items-start gap-2">
        <span
          aria-hidden
          className="mt-0.5 w-[3px] shrink-0 self-stretch rounded-full"
          style={{ backgroundColor: workoutTypeColorVar(group.workoutType) ?? "var(--line)" }}
        />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="display text-sm leading-tight font-semibold text-[var(--foreground)]">
            {label}
          </span>
          {group.title && (
            <span className="text-xs leading-tight text-[var(--ink-2)]">{group.title}</span>
          )}
          {targets && <span className="tabular text-xs text-[var(--ink-3)]">{targets}</span>}
          {(group.slot ?? 1) > 1 && (
            <span className="text-[11px] text-[var(--ink-3)]">
              {SLOT_LABELS[group.slot] ?? `Pass ${group.slot}`}
            </span>
          )}
        </span>
      </div>

      {comment && (
        <p className="border-l-2 border-[var(--line)] pl-2 text-xs leading-snug text-[var(--ink-2)]">
          {comment}
        </p>
      )}

      {/* Löparchips: vilka passet gäller. Utan dem säger rutan vad som ska
          göras men inte av vem, och en veckovy för en hel grupp blir då
          oläsbar. */}
      <div className="flex flex-wrap gap-1">
        {group.athleteIds.map((id) => {
          const outcome = group.outcomeByAthlete[id];
          const tone = outcome ? OUTCOME_TONE[outcome] : undefined;
          return (
            <span
              key={id}
              className="display inline-flex items-center gap-1 rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[11px] text-[var(--ink-2)]"
            >
              {tone && (
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: tone }}
                />
              )}
              {namesById.get(id) ?? "Okänd"}
            </span>
          );
        })}
      </div>

      {group.diverges && (
        <span className="text-[11px] text-[var(--status-watch)]">Löparna har olika innehåll</span>
      )}
    </Link>
  );
}

export default async function DetaljplanPage({
  searchParams,
}: {
  /** `week` är veckans MÅNDAG (YYYY-MM-DD). Ingen param = innevarande vecka,
   * vilket är hela poängen med sidan — man ska aldrig behöva navigera dit. */
  searchParams: Promise<{ week?: string }>;
}) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;

  const { week } = await searchParams;
  const today = todayKeyStockholm();
  // Normaliseras till måndag även om någon skickar in en torsdag: annars
  // skulle "nästa vecka" kunna hoppa fel antal dagar.
  const weekStart = mondayOf(DATE_KEY.test(week ?? "") ? (week as string) : today);
  const weekEnd = addDaysKey(weekStart, 6);
  const thisMonday = mondayOf(today);

  /* En löpare ser sin egen vecka; en coach ser sina adepter. Coachens EGEN
   * träning hör inte hit — den är en logg, inte en planering hen coachar, och
   * finns i löparläget. Samma avgränsning som viewableAthletes gör för
   * väljaren. */
  const athletes: AthleteOption[] =
    scoped.role === "coach"
      ? viewableAthletes(scoped)
      : [{ id: scoped.userId, fullName: null }];
  const athleteIds = athletes.map((a) => a.id);
  const namesById = new Map(athletes.map((a) => [a.id, a.fullName ?? "Namnlös"]));

  let passes: PlannedPassRow[] = [];
  let competitions: CompetitionRow[] = [];
  const outcomes = new Map<string, PlanOutcome>();

  if (athleteIds.length > 0) {
    const [{ data: plannedRows }, { data: competitionRows }, { data: activityRows }] =
      await Promise.all([
        supabase
          .from("planned_workouts")
          .select(
            "id, user_id, scheduled_date, slot, workout_type, title, description, target_distance_meters, target_duration_seconds, training_factor, status",
          )
          .in("user_id", athleteIds)
          .gte("scheduled_date", weekStart)
          .lte("scheduled_date", weekEnd),
        supabase
          .from("competitions")
          .select("id, user_id, competition_date, name, priority")
          .in("user_id", athleteIds)
          .gte("competition_date", weekStart)
          .lte("competition_date", weekEnd),
        /* Utfallet räknas i läsvägen, precis som i blockplanen och kalendern:
           planned_workouts.status skrivs aldrig, så "genomfört" måste härledas
           ur de faktiska aktiviteterna. Ett dygn extra i slutet eftersom
           start_time är en tidpunkt, inte ett datum. */
        supabase
          .from("activities")
          .select(SESSION_ACTIVITY_COLUMNS)
          .in("user_id", athleteIds)
          .gte("start_time", weekStart)
          .lte("start_time", addDaysKey(weekEnd, 1))
          .order("start_time"),
      ]);

    passes = (plannedRows ?? []) as PlannedPassRow[];
    competitions = (competitionRows ?? []) as CompetitionRow[];

    // Per löpare, aldrig blandat: matchPlanToSessions parar ihop plan och
    // utfall inom en dag, och två löpares dagar i samma anrop hade parat
    // den enas pass med den andras aktivitet.
    const plannedByAthlete = new Map<string, (PlannedWorkout & { user_id: string })[]>();
    for (const row of passes) {
      plannedByAthlete.set(row.user_id, [...(plannedByAthlete.get(row.user_id) ?? []), row]);
    }
    const activitiesByAthlete = new Map<string, SessionActivity[]>();
    for (const a of (activityRows ?? []) as unknown as (SessionActivity & { user_id: string })[]) {
      activitiesByAthlete.set(a.user_id, [...(activitiesByAthlete.get(a.user_id) ?? []), a]);
    }
    for (const [athleteId, planned] of plannedByAthlete) {
      const sessions = groupActivitiesIntoSessions(activitiesByAthlete.get(athleteId) ?? []);
      for (const m of matchPlanToSessions(planned, sessions)) {
        if (!m.planned) continue;
        outcomes.set(outcomeKey(athleteId, m.planned.scheduled_date, m.planned.slot ?? 1), m.outcome);
      }
    }
  }

  // Veckospannet skickas som "blockspann" — buildPlanWeeks ger då exakt en
  // vecka, med samma gruppering som blockplanen.
  const planWeek = buildPlanWeeks(weekStart, weekEnd, passes, competitions, outcomes)[0];

  /* En tom vecka ser ut som ett fel, och behöver säga att den inte är det.
   *
   * Det är inte ett kantfall: när sidan byggdes låg gruppen i en lugn period
   * efter tävlingssäsongen och nästa planerade pass låg nästan två veckor
   * fram, så innevarande vecka var tom vid första besöket. Sju streck utan
   * förklaring hade lästs som att vyn inte hittade något.
   *
   * Frågan ställs bara när veckan faktiskt är tom, alltså aldrig i det
   * normala fallet. */
  const empty = planWeek.days.every((d) => d.passes.length === 0 && d.competitions.length === 0);
  let nextPlannedWeek: string | null = null;
  if (empty && athleteIds.length > 0) {
    const { data } = await supabase
      .from("planned_workouts")
      .select("scheduled_date")
      .in("user_id", athleteIds)
      .gt("scheduled_date", weekEnd)
      .order("scheduled_date")
      .limit(1)
      .maybeSingle();
    const next = (data?.scheduled_date as string | undefined) ?? null;
    nextPlannedWeek = next ? mondayOf(next) : null;
  }

  const prevHref = `/detaljplan?week=${addDaysKey(weekStart, -7)}`;
  const nextHref = `/detaljplan?week=${addDaysKey(weekStart, 7)}`;
  const navClass =
    "display rounded-md border border-[var(--line)] px-2.5 py-1.5 text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--ink-3)]";

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">
            Detaljplan
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Vecka {planWeek.isoWeekNumber} · {weekStart} till {weekEnd}. Öppna ett pass för att
            skriva till löparna.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Link href={prevHref} className={navClass} aria-label="Föregående vecka">
            ←<LinkPending />
          </Link>
          {weekStart !== thisMonday && (
            <Link href="/detaljplan" className={navClass}>
              Denna vecka
              <LinkPending />
            </Link>
          )}
          <Link href={nextHref} className={navClass} aria-label="Nästa vecka">
            →<LinkPending />
          </Link>
        </div>
      </div>

      {empty && athleteIds.length > 0 && (
        <p className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--ink-2)]">
          Ingen planering den här veckan.
          {nextPlannedWeek ? (
            <>
              {" "}Nästa vecka med planerade pass börjar{" "}
              <Link href={`/detaljplan?week=${nextPlannedWeek}`} className="underline">
                {nextPlannedWeek}
              </Link>
              .
            </>
          ) : (
            " Det finns inga planerade pass framåt än — lägg upp dem i Blockplan."
          )}
        </p>
      )}

      {athleteIds.length === 0 ? (
        <p className="text-sm text-[var(--ink-3)]">
          Inga löpare kopplade ännu — planeringen visas här så fort du följer någon.
        </p>
      ) : (
        /* Dagarna som kolumner, inte som ett rutnät med veckor på raderna.
           En enda vecka i blockplanens rutnät hade blivit en ensam rad med
           sju smala celler; som kolumner får varje dag hela höjden och kan
           bära flera pass med kommentarer under varandra. Staplar på smal
           skärm. */
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
          {planWeek.days.map((day, i) => {
            const isToday = day.date === today;
            return (
              <section
                key={day.date}
                className={`flex flex-col gap-2 rounded-lg border p-2 ${
                  isToday
                    ? "border-[var(--foreground)] bg-[var(--surface-raised)]"
                    : "border-[var(--line)] bg-[var(--surface-raised)]/40"
                }`}
              >
                <div className="flex items-baseline justify-between gap-2 px-0.5">
                  <span className="display text-sm font-semibold text-[var(--foreground)]">
                    {WEEKDAY_LABELS[i]}
                  </span>
                  <span className="tabular text-[11px] text-[var(--ink-3)]">
                    {day.date.slice(8)}/{day.date.slice(5, 7)}
                  </span>
                </div>

                {day.competitions.map((c) => (
                  <div
                    key={c.key}
                    className="rounded-md border border-[var(--cat-race)] px-2 py-1.5 text-xs"
                  >
                    <span className="display font-semibold text-[var(--foreground)]">{c.name}</span>
                    <span className="ml-1 text-[var(--ink-3)]">{c.priority}-lopp</span>
                  </div>
                ))}

                {day.passes.length === 0 && day.competitions.length === 0 ? (
                  <span className="px-0.5 text-xs text-[var(--ink-3)]">—</span>
                ) : (
                  day.passes.map((g) => (
                    <PassCard
                      key={g.key}
                      group={g}
                      namesById={namesById}
                      /* Dagsvyn för alla löpare samtidigt: där bor
                         passformuläret med Beskrivning, och där ser man hela
                         dagen i stället för bara rutan man klickade på. */
                      href={`/blockplan/pass?date=${day.date}`}
                    />
                  ))
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
