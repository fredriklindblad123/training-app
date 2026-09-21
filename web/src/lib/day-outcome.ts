import { STATUS_COLOR, STATUS_LABEL } from "@/lib/calendar-utils";
import { CATEGORY_LABELS, isActivityCategory } from "@/lib/categories";
import { WORKOUT_LABELS, type WorkoutType } from "@/lib/planning";

/* Delad mellan dag-, vecko-, månads- och årsvyn så att en tävlingsdag, ett
 * planerat pass eller ett sjuk/skadad-utfall alltid ser likadant ut och
 * heter samma sak oavsett vilken tidshorisont man tittar i. */

/** Tävlade är ett eget utfall vid sidan om dagbokens day_type
 * (STATUS_COLOR/STATUS_LABEL i calendar-utils.ts) och får passkategorin
 * "race" egna magenta, --cat-race. Den färgen betyder redan tävling på tio
 * andra ytor — säsongstidslinjen, dagvyn, detaljplanen, formkurvan — så en
 * egen violett här gjorde bara att samma sak hade två färger. Violetten var
 * dessutom styrkepassens (--cat-strength), vilket satte en tävlingsruta och
 * en styrkemarkör i samma kulör i veckovyn. Magentan går utmärkt att skilja
 * från tränades emerald. */
export const COMPETED_COLOR = "bg-[var(--cat-race)]";
export const COMPETED_BADGE_COLOR =
  "bg-[color-mix(in_oklab,var(--cat-race)_16%,transparent)] text-[var(--cat-race)]";
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
