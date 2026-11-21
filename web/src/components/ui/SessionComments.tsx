/* Löparens egen kommentar på passet, ur Garmin Connect (2026-11-21).
 *
 * Visas ordagrant och oredigerad, med radbrytningarna kvar — det är hennes
 * ord, inte appens tolkning. "Självskattat" behöver inte sägas: det är
 * uppenbart att en kommentar är hennes egen. `compact` kortar av till två
 * rader där utrymmet är litet (veckovyn); hela texten finns i dagvyn. */

export function SessionComments({ comments, compact = false }: { comments: string[]; compact?: boolean }) {
  if (comments.length === 0) return null;
  return (
    <div className="flex flex-col gap-1">
      {comments.map((c, i) => (
        <p
          key={i}
          className={`border-l-2 border-[var(--line)] pl-2 whitespace-pre-line text-[var(--ink-2)] ${
            compact ? "line-clamp-2 text-[11px] leading-snug italic" : "text-sm leading-snug"
          }`}
        >
          {compact ? `”${c}”` : c}
        </p>
      ))}
    </div>
  );
}
