import type { SessionReview } from "@/lib/session-review";
import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";

/* "Så gick passet" — läsningen av dagens genomförda pass.
 *
 * Ligger högst upp i dagvyn, före siffrorna och varvtabellen: frågan man
 * kommer till dagen med är "hur gick det", och den ska besvaras innan man
 * behöver tolka en tabell själv.
 *
 * Medvetet färgfattig. Tonen återanvänder --status-* (hur ett MÄTVÄRDE
 * ligger), inte --day-* (vad som hände med dagen) och inte --cat-*
 * (vilken sorts pass det var) — se globals.css för varför de tre är skilda
 * system. Och ingen --status-concern: ett genomfört pass får aldrig läsas
 * som ett larm. Skalan går från "det här såg bra ut" till "värt att
 * notera", inte ner i rött.
 *
 * Saknas underlag ritas ingenting alls. Ett pass utan pulsdata, eller utan
 * varv, ska inte få ett omdöme byggt på gissningar — och en tom ruta som
 * säger "kunde inte bedömas" är sämre än ingen ruta. */

const TONE_COLOR: Record<SessionReview["tone"], string> = {
  good: "var(--status-good)",
  neutral: "var(--ink-3)",
  note: "var(--status-watch)",
};

export function SessionReviewCard({
  reviews,
}: {
  reviews: { sessionId: string; category: string | null; review: SessionReview }[];
}) {
  if (reviews.length === 0) return null;

  return (
    <section className="flex flex-col gap-3">
      <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
        Så gick passet
      </h2>

      <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)]">
        {reviews.map(({ sessionId, category, review }) => (
          <div key={sessionId} className="flex flex-col gap-1.5 bg-[var(--surface)] px-4 py-3">
            <span className="flex items-center gap-2">
              {category && isActivityCategory(category) && (
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: categoryColorVar(category) }}
                />
              )}
              <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
                {category && isActivityCategory(category) ? CATEGORY_LABELS[category] : "Pass"}
              </span>
            </span>

            <p
              className="text-sm font-medium"
              style={{ color: TONE_COLOR[review.tone] }}
            >
              {review.headline}
            </p>

            {review.lines.map((line, i) => (
              <p key={i} className="text-sm text-[var(--ink-2)]">
                {line}
              </p>
            ))}

            {review.caveat && (
              <p className="text-xs text-[var(--ink-3)]">{review.caveat}</p>
            )}
          </div>
        ))}
      </div>

      {/* Var gränsen går för vad ett enskilt pass kan säga. Utan den här
          raden läses kortet som en formdom, vilket är precis vad det inte
          är — se lib/session-review.ts för mätningarna bakom. */}
      <p className="text-xs text-[var(--ink-3)]">
        Det här beskriver hur passet utfördes, inte hur formen ligger. Ett enskilt pass varierar för
        mycket för att säga något om formen — den läses över fyra veckor under{" "}
        <a href="/trender" className="underline">
          Form
        </a>
        .
      </p>
    </section>
  );
}
