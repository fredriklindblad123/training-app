import Link from "next/link";
import type { ReactNode } from "react";
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

/* Veckans genomgång: en rad per pass, kronologiskt, i stället för rutnätets
 * sju celler (K4 i docs/tranarperspektiv.md).
 *
 * Låg 2026-08-03 inne i veckokalendern som ett växlingsbart läge, men flyttade
 * till /veckan när sidorna delades om efter kadens (docs/tranarloopen.md L1).
 * Två hem för samma vy var förvirrande: kalendern är uppslagsverket där man
 * slår upp en specifik dag, /veckan är ritualen där man går igenom veckan och
 * planerar nästa.
 *
 * Läsande bara. Att skriva nästa vecka hör hemma i veckomallen; varje dag
 * länkar till dagvyn för den som vill ändra något. */

export type AgendaDiaryDay = {
  day_type: string | null;
  notes: string | null;
  session_log: string | null;
  feeling: number | null;
  rpe: number | null;
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
    <div className="flex flex-col gap-4">
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

        const footParts = formatFootParts({
          feeling: diary?.feeling ?? null,
          rpe: diary?.rpe ?? null,
          sleepSeconds: metric?.sleep_seconds ?? null,
          hrv: metric?.hrv_overnight_avg ?? null,
        });
        const note = diary?.notes || diary?.session_log || null;

        // Komprimerad rad när dagen varken har pass, dagbokstext eller
        // mätvärden. En vilodag ska inte ta lika mycket plats som ett
        // tröskelpass (K4, fallgropen i docs/tranarperspektiv.md).
        const hasContent = matches.length > 0 || !!note || footParts.length > 0;

        if (!hasContent) {
          return (
            <Link
              key={key}
              href={dayHref}
              className="flex items-baseline gap-2 text-sm text-zinc-400 hover:text-zinc-600 dark:text-zinc-600 dark:hover:text-zinc-400"
            >
              <span className="font-medium">{dateLabel}</span>
              <span>inget loggat</span>
            </Link>
          );
        }

        return (
          <div
            key={key}
            className={`flex flex-col gap-1.5 rounded border p-3 ${
              isToday
                ? "border-zinc-900 dark:border-zinc-100"
                : "border-zinc-200 dark:border-zinc-800"
            }`}
          >
            <div className="flex flex-wrap items-baseline gap-2">
              <Link
                href={dayHref}
                className="text-sm font-semibold text-zinc-900 hover:underline dark:text-zinc-100"
              >
                {dateLabel}
              </Link>
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
            </div>

            <div className="flex flex-col gap-1">
              {matches.map((m, mi) => (
                <div key={mi} className="flex flex-col gap-0.5">
                  {m.planned && <PlanRow planned={m.planned} outcome={m.outcome} />}
                  {m.session && <OutcomeRow session={m.session} outcome={m.outcome} />}
                </div>
              ))}
            </div>

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
          </div>
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
}: {
  planned: PlannedWorkout;
  outcome: PlanMatch["outcome"];
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
      {outcome === "ej genomfört" && (
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
