import Link from "next/link";
import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";
import { WORKOUT_LABELS, workoutTypeColorVar, type WorkoutType } from "@/lib/planning";
import { formatHoursMinutes, formatKm } from "@/lib/format";
import { describePlannedWorkout, type RepGroupLike } from "@/lib/workout-summary";
import { LinkPending } from "@/components/ui/LinkPending";

/* Dagens pass, överst på adeptens dashboard.
 *
 * Det här är den första frågan en löpare har när hon öppnar appen: vad ska
 * jag göra idag, eller vad blev det av det jag gjorde? Kortet låg tidigare
 * längst NED på sidan, under tre ringsektioner och statusrutan — man fick
 * scrolla förbi allt som besvarar långsiktiga frågor för att nå den enda som
 * gäller nu. Flyttat överst 2026-09-15 på uttrycklig begäran.
 *
 * Kortet visar både planerat och genomfört, och det är avsiktligt att båda
 * ryms: mitt på dagen är det vanliga läget att passet är ordinerat men inte
 * kört, och på kvällen att det är kört. Ett kort som bara visade det ena hade
 * varit tomt halva tiden.
 *
 * Hela kortet är en länk till dagen i kalendern — där man loggar, rättar och
 * skriver om passet. Att göra kortet klickbart i stället för att lägga en
 * liten länk i hörnet: den som vill till dagvyn siktar på passet, inte på
 * ordet "öppna".
 */

export type TodayPlanned = {
  id: string;
  slot: number | null;
  workout_type: string;
  title: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  planned_rep_groups: RepGroupLike[] | null;
};

export type TodayDone = {
  id: string;
  category: string;
  name: string | null;
  distanceMeters: number;
  durationSeconds: number;
};

/** Färgstapeln som bär passets typ, i full radhöjd. Vila, test och häck har
 * ingen kategorifärg — de får linjens, samma regel som workoutTypeColorVar. */
function Bar({ colorVar }: { colorVar: string | null }) {
  return (
    <span
      aria-hidden
      className="w-[3px] shrink-0 self-stretch rounded-full"
      style={{ backgroundColor: colorVar ?? "var(--line)", minHeight: "2.25rem" }}
    />
  );
}

export function TodaySession({
  planned,
  done,
  href,
}: {
  planned: TodayPlanned[];
  done: TodayDone[];
  /** Dagens datum i kalendern. */
  href: string;
}) {
  const empty = planned.length === 0 && done.length === 0;

  return (
    <Link
      href={href}
      className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--ink-3)]"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Idag
        </h2>
        <span className="display text-xs text-[var(--ink-3)]">
          Öppna i kalendern
          <LinkPending />
        </span>
      </div>

      {/* Tomt läge sägs rakt ut. En vilodag är ett giltigt svar på "vad ska
          jag göra idag", och ska inte se ut som att något saknas. */}
      {empty && (
        <p className="text-sm text-[var(--ink-3)]">
          Inget pass planerat eller loggat idag.
        </p>
      )}

      {/* Planerat först: det är instruktionen. Genomfört är kvittot. */}
      {planned.map((p) => {
        const label = WORKOUT_LABELS[p.workout_type as WorkoutType] ?? p.workout_type;
        const detail = describePlannedWorkout(p);
        return (
          <div key={p.id} className="flex items-stretch gap-3">
            <Bar colorVar={workoutTypeColorVar(p.workout_type)} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="display text-lg leading-tight font-semibold text-[var(--foreground)]">
                  {label}
                </span>
                {p.title && <span className="text-sm text-[var(--ink-2)]">{p.title}</span>}
              </div>
              <span className="tabular text-sm text-[var(--ink-3)]">
                {detail ?? "Planerat"}
              </span>
            </div>
          </div>
        );
      })}

      {done.map((d) => {
        const label = isActivityCategory(d.category)
          ? CATEGORY_LABELS[d.category]
          : (d.name ?? "Pass");
        return (
          <div key={d.id} className="flex items-stretch gap-3">
            <Bar colorVar={isActivityCategory(d.category) ? categoryColorVar(d.category) : null} />
            <div className="flex min-w-0 flex-col gap-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className="display text-lg leading-tight font-semibold text-[var(--foreground)]">
                  {label}
                </span>
                <span className="display rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--ink-2)]">
                  Genomfört
                </span>
              </div>
              <span className="tabular text-sm text-[var(--ink-3)]">
                {[
                  d.distanceMeters > 0 ? formatKm(d.distanceMeters) : null,
                  d.durationSeconds > 0 ? formatHoursMinutes(d.durationSeconds) : null,
                ]
                  .filter(Boolean)
                  .join(" · ") || "Loggat"}
              </span>
            </div>
          </div>
        );
      })}
    </Link>
  );
}
