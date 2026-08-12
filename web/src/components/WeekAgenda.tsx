import Link from "next/link";
import type { ReactNode } from "react";
import { DaySection } from "@/components/DaySection";
import { CATEGORY_LABELS, isActivityCategory } from "@/lib/categories";
import { WORKOUT_LABELS, workoutTypeColorVar, type WorkoutType } from "@/lib/planning";
import type { PlanMatch, PlannedWorkout } from "@/lib/plan-matching";
import type { TrainingSession } from "@/lib/sessions";
import type { SignatureLap } from "@/lib/session-signature";
import {
  formatPlanLine,
  formatOutcomeLine,
  formatFootParts,
  type AgendaRepGroup,
} from "@/lib/week-agenda";
import { SV_MONTHS, SV_WEEKDAYS_SHORT, STATUS_COLOR, STATUS_LABEL, type DayStatus } from "@/lib/calendar-utils";

/* Veckans genomgång: en rad per dag, kronologiskt, i stället för rutnätets
 * sju celler (K4 i docs/tranarperspektiv.md).
 *
 * Låg 2026-08-03 inne i veckokalendern som ett växlingsbart läge, men flyttade
 * till /veckan när sidorna delades om efter kadens (docs/tranarloopen.md L1).
 * Två hem för samma vy var förvirrande: kalendern är uppslagsverket där man
 * slår upp en specifik dag, /veckan är ritualen där man går igenom veckan och
 * planerar nästa.
 *
 * Hopfällt (2026-08-12): en dagrad visade tidigare plan, utfall, varvtider,
 * Alices egna ord och känsla/ansträngning samtidigt — sju sådana rader blev
 * en sida man var tvungen att scrolla igenom för att hitta något. Den
 * hopfällda raden visar bara passtyp + en markör för om utfallet matchar
 * planen (DaySection, samma <details>/<summary>-mönster som kalenderns
 * dagvy) — resten fälls ut vid klick.
 *
 * Läsande bara. Att skriva nästa vecka hör hemma i veckomallen; varje dag
 * länkar till dagvyn för den som vill ändra något. */

export type AgendaDiaryDay = {
  day_type: string | null;
  notes: string | null;
  session_log: string | null;
};

export type AgendaMetricDay = {
  sleep_seconds: number | null;
  hrv_overnight_avg: number | null;
};

function typeLabel(type: string): string {
  if (isActivityCategory(type)) return CATEGORY_LABELS[type];
  return WORKOUT_LABELS[type as WorkoutType] ?? type;
}

/** Varvtiderna hör till det fragment som avgjorde passets kategori
 * (dominantActivity, lib/sessions.ts). Fältet finns inte i SessionActivity —
 * bara de vyer som hämtar `activity_splits(*)` nästlat har det — därför den
 * lokala castningen i stället för att bredda typen för alla anropare. */
function lapsFor(session: TrainingSession): SignatureLap[] {
  return (
    (session.dominantActivity as unknown as { activity_splits?: SignatureLap[] })
      .activity_splits ?? []
  );
}

function addDays(d: Date, n: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + n);
  return next;
}

function toKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Tre lägen, inte fyra — "avvikande typ" (genomfört, men en annan sorts
 * pass än planerat) räknas som "Enligt plan" här: det VAR både planerat och
 * genomfört den dagen, vilket är vad den hopfällda raden ska svara på i ett
 * enda ord. Vilken typ som faktiskt planerades vs genomfördes står kvar,
 * tydligt, i PlanRow/OutcomeRow när dagen fälls ut. Fylld bricka (samma
 * mönster som sjuk-/skada-/tävlingsmärkena ovanför) i stället för en liten
 * kulör symbol — den förra versionen var för otydlig för att läsa i ett
 * ögonkast. */
const OUTCOME_BADGE: Record<PlanMatch["outcome"], { label: string; className: string }> = {
  genomfört: { label: "Enligt plan", className: "bg-emerald-600 text-white" },
  "avvikande typ": { label: "Enligt plan", className: "bg-emerald-600 text-white" },
  "ej genomfört": { label: "Ej genomfört", className: "bg-red-500 text-white" },
  oplanerat: { label: "Oplanerat", className: "bg-zinc-500 text-white" },
};

/** "ej genomfört" betyder bara något faktiskt uteblev för dagar som redan
 * hänt — `outcomeFor` (lib/plan-matching.ts) bryr sig inte om datum, så ett
 * planerat pass nästa vecka fick samma etikett som ett missat pass förra
 * veckan tills den här särskiljningen fanns. Ingen dom kan fällas över
 * något som inte hänt än, därför en neutral "Planerat"-bricka i stället. */
const PLANNED_UPCOMING_BADGE = {
  label: "Planerat",
  className: "border border-zinc-300 text-zinc-600 dark:border-zinc-700 dark:text-zinc-400",
};

/** Passtyp + tydlig bricka för planerat/genomfört-status — den hopfällda
 * radens enda innehåll för ett pass. Typen är utfallets kategori när passet
 * genomfördes, annars planens typ (en missad dag har bara planen att visa
 * typ ur). */
function MatchSummary({ match, isPastDay }: { match: PlanMatch; isPastDay: boolean }) {
  const type = match.session
    ? typeLabel(match.session.category)
    : match.planned
      ? typeLabel(match.planned.workout_type)
      : "Pass";
  const badge =
    match.outcome === "ej genomfört" && !isPastDay
      ? PLANNED_UPCOMING_BADGE
      : OUTCOME_BADGE[match.outcome];
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-zinc-700 dark:text-zinc-300">{type}</span>
      <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${badge.className}`}>
        {badge.label}
      </span>
    </span>
  );
}

export function WeekAgenda({
  monday,
  todayKey,
  diaryByDay,
  dailyMetricsByDay,
  competitionsByDay,
  matchesByDay,
}: {
  monday: Date;
  todayKey: string;
  diaryByDay: Map<string, AgendaDiaryDay>;
  dailyMetricsByDay: Map<string, AgendaMetricDay>;
  competitionsByDay: Map<string, { name: string; priority: string }[]>;
  matchesByDay: Map<string, PlanMatch[]>;
}) {
  return (
    <div className="flex flex-col gap-2">
      {Array.from({ length: 7 }, (_, i) => {
        const d = addDays(monday, i);
        const key = toKey(d);
        const diary = diaryByDay.get(key);
        const metric = dailyMetricsByDay.get(key);
        const comps = competitionsByDay.get(key) ?? [];
        // matchesByDay driver hela dagraden — den täcker redan både planerat
        // och genomfört (matchPlanToSessions parar dem, K2), så "har dagen
        // något pass" är bara "har dagen någon match".
        const matches = matchesByDay.get(key) ?? [];
        const dayHref = `/calendar/${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
        const isToday = key === todayKey;
        const dateLabel = `${SV_WEEKDAYS_SHORT[i]} ${d.getDate()} ${SV_MONTHS[d.getMonth()]
          .slice(0, 3)
          .toLowerCase()}`;

        const diaryStatus = (
          diary?.day_type === "rest" ? null : (diary?.day_type ?? null)
        ) as DayStatus | null;
        const showStatus =
          diaryStatus != null &&
          (diaryStatus !== "training" || matches.some((m) => m.session != null));

        // Känsla/ansträngning kom tidigare från den dagliga incheckningen
        // (diary_entries.feeling/rpe), borttagen 2026-08-12. Källan är nu
        // Alices egen skattning i Garmin Connect-appen, läst av dagens
        // dominerande pass (samma fragment som redan avgör kategori/varv på
        // raderna ovan) — se lib/sessions.ts och migration
        // 20260812100000_garmin_feel_rpe.sql.
        const daySession = matches.find((m) => m.session != null)?.session ?? null;
        const footParts = formatFootParts({
          feeling: daySession?.dominantActivity.garmin_feel ?? null,
          rpe: daySession?.dominantActivity.garmin_rpe ?? null,
          sleepSeconds: metric?.sleep_seconds ?? null,
          hrv: metric?.hrv_overnight_avg ?? null,
        });
        const note = diary?.notes || diary?.session_log || null;
        const hasContent = matches.length > 0 || !!note || footParts.length > 0;

        // "ej genomfört" (lib/plan-matching.ts) bryr sig inte om datum — ett
        // planerat pass nästa vecka och ett missat pass förra veckan får
        // samma outcome. Särskiljningen görs här i stället: bara dagar som
        // redan hänt kan ha "missat" något.
        const isPastDay = key < todayKey;

        // Kantfärgen (DaySection) blir en sjunde, ordlös signal utöver
        // brickorna. Grön bara när allt som hänt gick enligt plan — ett
        // planerat pass längre fram ska inte se ut som ett missat pass bara
        // för att det ligger i samma vecka.
        const hasMissedPast = matches.some((m) => m.outcome === "ej genomfört" && isPastDay);
        const allGoodOrUnplanned = matches.every(
          (m) => m.outcome === "genomfört" || m.outcome === "avvikande typ",
        );
        const hasData =
          matches.length === 0 ? undefined : hasMissedPast ? false : allGoodOrUnplanned ? true : undefined;

        return (
          <DaySection
            key={key}
            title={dateLabel}
            hasData={hasData}
            summary={
              <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
                {isToday && (
                  <span className="rounded border border-zinc-300 px-1.5 py-0.5 text-[10px] text-zinc-600 dark:border-zinc-700 dark:text-zinc-400">
                    Idag
                  </span>
                )}
                {showStatus && diaryStatus && (
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] text-white ${STATUS_COLOR[diaryStatus]}`}
                  >
                    {diaryStatus === "training" ? "Ej loggat" : STATUS_LABEL[diaryStatus]}
                  </span>
                )}
                {comps.map((c, ci) => (
                  <span
                    key={ci}
                    className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800 dark:bg-red-950/40 dark:text-red-300"
                  >
                    {c.priority} · {c.name}
                  </span>
                ))}
                {matches.length > 0 ? (
                  matches.map((m, mi) => (
                    <MatchSummary key={mi} match={m} isPastDay={isPastDay} />
                  ))
                ) : (
                  <span className="text-zinc-400 dark:text-zinc-600">Inget loggat</span>
                )}
              </span>
            }
          >
            {matches.length > 0 ? (
              <div className="flex flex-col gap-1">
                {matches.map((m, mi) => (
                  <div key={mi} className="flex flex-col gap-0.5">
                    {m.planned && <PlanRow planned={m.planned} outcome={m.outcome} isPastDay={isPastDay} />}
                    {m.session && <OutcomeRow session={m.session} outcome={m.outcome} />}
                  </div>
                ))}
              </div>
            ) : (
              !hasContent && (
                <p className="text-sm text-zinc-500 dark:text-zinc-400">
                  Inget planerat eller genomfört den här dagen.
                </p>
              )
            )}

            {note && (
              <AgendaRow label="Alice">
                <span className="italic text-zinc-600 dark:text-zinc-400">
                  &ldquo;{note}&rdquo;
                </span>
              </AgendaRow>
            )}

            {footParts.length > 0 && (
              <p className="pl-16 text-xs text-zinc-500 dark:text-zinc-400">
                — {footParts.join(" · ")}
              </p>
            )}

            <Link
              href={dayHref}
              className="w-fit text-xs text-zinc-500 underline hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
            >
              Till dagvyn →
            </Link>
          </DaySection>
        );
      })}
    </div>
  );
}

/** Etikettkolumn ("Plan"/"Utfall"/"Alice") + innehåll, samma bredd på alla
 * tre så raderna hamnar i linje under varandra. */
function AgendaRow({
  label,
  tone,
  children,
}: {
  label: string;
  tone?: "strong";
  children: ReactNode;
}) {
  return (
    <div
      className={`flex items-baseline gap-2 text-sm ${
        tone === "strong"
          ? "text-zinc-900 dark:text-zinc-100"
          : "text-zinc-500 dark:text-zinc-400"
      }`}
    >
      <span className="w-14 shrink-0 text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
        {label}
      </span>
      <span>{children}</span>
    </div>
  );
}

/** `planned_rep_groups` läses via en lokal cast — PlanMatch bär bastypen
 * PlannedWorkout, men objektet är samma referens som kom ur
 * `.select(..., planned_rep_groups(*))`, så fältet finns på runtime-objektet
 * trots att typen inte deklarerar det. */
function PlanRow({
  planned,
  outcome,
  isPastDay,
}: {
  planned: PlannedWorkout;
  outcome: PlanMatch["outcome"];
  isPastDay: boolean;
}) {
  const repGroups =
    (planned as unknown as { planned_rep_groups?: AgendaRepGroup[] | null })
      .planned_rep_groups ?? [];
  const line = formatPlanLine(planned, repGroups);
  // Typbadgen upprepar bara passtypen — meningsfull när titeln är en
  // repsignatur eller fritextrubrik ("5×1000 m [tröskel]"), men ett tomt eko
  // när titeln redan ÄR typetiketten (en vilodag utan rubrik: "Vila").
  const showTypeBadge = line.title !== typeLabel(planned.workout_type);
  return (
    <AgendaRow label="Plan">
      {line.title}
      {line.target && (
        <span className="text-zinc-400 dark:text-zinc-500"> · {line.target}</span>
      )}
      {showTypeBadge && (
        <>
          {" "}
          <span
            className="text-xs"
            style={{ color: workoutTypeColorVar(planned.workout_type) ?? undefined }}
          >
            [{typeLabel(planned.workout_type)}]
          </span>
        </>
      )}
      {/* Ett planerat pass som ligger framåt i tiden är inte "ej genomfört"
          än — bara dagar som redan hänt kan ha missat något, se
          isPastDay-kommentaren vid huvudloopen. */}
      {outcome === "ej genomfört" && isPastDay && (
        <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-600">— ej genomfört</span>
      )}
    </AgendaRow>
  );
}

/** Varvtiderna kommer ur `dominantActivity.activity_splits` (lapsFor ovan) —
 * saknas splits faller formatOutcomeLine tillbaka på distans/tid. */
function OutcomeRow({
  session,
  outcome,
}: {
  session: TrainingSession;
  outcome: PlanMatch["outcome"];
}) {
  return (
    <AgendaRow label="Utfall" tone="strong">
      <span className="font-medium">
        {session.category ? typeLabel(session.category) : "Pass"}
      </span>{" "}
      {formatOutcomeLine(session, lapsFor(session))}
      {outcome === "avvikande typ" && (
        <span className="ml-1 text-xs text-amber-700 dark:text-amber-400">
          — annan typ än planerat
        </span>
      )}
      {outcome === "oplanerat" && (
        <span className="ml-1 text-xs text-zinc-400 dark:text-zinc-600">— oplanerat</span>
      )}
    </AgendaRow>
  );
}
