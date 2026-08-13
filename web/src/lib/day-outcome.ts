import { STATUS_COLOR, STATUS_LABEL } from "@/lib/calendar-utils";
import { CATEGORY_LABELS, isActivityCategory } from "@/lib/categories";
import { WORKOUT_LABELS, type WorkoutType } from "@/lib/planning";

/* Delad mellan dag-, vecko-, månads- och årsvyn så att en tävlingsdag, ett
 * planerat pass eller ett sjuk/skadad-utfall alltid ser likadant ut och
 * heter samma sak oavsett vilken tidshorisont man tittar i. */

/** Tävlade är ett eget utfall vid sidan om dagbokens day_type
 * (STATUS_COLOR/STATUS_LABEL i calendar-utils.ts) — en egen violett färg,
 * skild från tränades grönt. Passkategorin "race" (--cat-race) ligger för
 * nära emerald för att gå att skilja från "tränade" i en liten ruta. */
export const COMPETED_COLOR = "bg-violet-600";
export const COMPETED_BADGE_COLOR =
  "bg-violet-100 text-violet-800 dark:bg-violet-950/40 dark:text-violet-300";
export const COMPETED_LABEL = "Tävlade";

export type YearOutcome = "trained" | "competed" | "sick" | "injured";

export const OUTCOME_COLOR: Record<YearOutcome, string> = {
  trained: STATUS_COLOR.training,
  competed: COMPETED_COLOR,
  sick: STATUS_COLOR.sick,
  injured: STATUS_COLOR.injured,
};

export const OUTCOME_LABEL: Record<YearOutcome, string> = {
  trained: STATUS_LABEL.training,
  competed: COMPETED_LABEL,
  sick: STATUS_LABEL.sick,
  injured: STATUS_LABEL.injured,
};

/** Läsbar etikett för en passtyp — samma slag av sträng dyker upp både som
 * `activities.category` (genomfört) och `planned_workouts.workout_type`
 * (planerat), se lib/planning.ts. */
export function typeLabel(type: string): string {
  if (isActivityCategory(type)) return CATEGORY_LABELS[type];
  return WORKOUT_LABELS[type as WorkoutType] ?? type;
}

/**
 * Tävlingar (competitions-tabellen) som inte redan syns via ett
 * race-kategoriserat pass samma dag. Utan det här dubbleras samma
 * information — en gång som passets egen "Tävling"-badge (kategorifärgen),
 * en gång som en separat tävlingsbadge.
 */
export function unmatchedCompetitions<T>(
  daySessions: { category: string | null }[],
  competitions: T[],
): T[] {
  if (competitions.length === 0) return [];
  return daySessions.some((s) => s.category === "race") ? [] : competitions;
}
