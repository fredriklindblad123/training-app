import { workoutTypeColorVar } from "@/lib/planning";

/**
 * Ihålig ring = planerat (en avsikt), fylld prick = genomfört (något som
 * hänt). Skillnaden bär hela informationen, så den ska gå att uppfatta utan
 * att läsa någon etikett — delad av vecko- och månadsvyn (2026-08-13) så att
 * samma symbol betyder samma sak i båda.
 */
export function PassMarker({ type, planned }: { type: string | null; planned: boolean }) {
  const color = type ? workoutTypeColorVar(type) : null;
  return (
    <span
      className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
      style={
        planned
          ? {
              // Ring i passets färg, ihålig mitt. Vila saknar färg och blir
              // streckad i stället.
              border: color ? `2px solid ${color}` : "1.5px dashed currentColor",
              backgroundColor: "transparent",
            }
          : { backgroundColor: color ?? "currentColor" }
      }
      aria-hidden="true"
    />
  );
}
