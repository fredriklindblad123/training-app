import Link from "next/link";

/* Periodväljaren — en komponent för hela appen (B2, 2026-11-21).
 *
 * Före den fanns fyra varianter: ramade knappar på Form, svarta segment på
 * Analys, flikar på Uppföljning och Dag/Vecka/Månad i Kalendern. Samma val
 * såg olika ut på varje sida, och den som bytte sida fick leta efter det.
 *
 * Alternativen är länkar, inte knappar: valet ligger i URL:en så att en
 * sida kan delas och laddas om utan att tappa det. scroll={false} så att
 * sidan inte hoppar till toppen när man byter. Varje alternativ är minst 40 px
 * högt — ett tumtryck ska träffa. */

export type SegmentOption = {
  key: string;
  label: string;
  href: string;
  active: boolean;
  /** Visas men går inte att välja, t.ex. ett mått planen saknar. */
  disabled?: boolean;
};

export function Segmented({
  options,
  label,
  showLabel = false,
}: {
  options: SegmentOption[];
  /** Tillgänglighetsnamn, och synlig rubrik om showLabel är satt. */
  label: string;
  showLabel?: boolean;
}) {
  const cols = Math.min(options.length, 5);
  return (
    <div className="flex flex-col gap-1.5">
      {showLabel && <span className="text-xs text-[var(--ink-3)]">{label}</span>}
      <div
        role="group"
        aria-label={label}
        className="grid gap-0.5 rounded-[10px] bg-[var(--surface-raised)] p-[3px]"
        style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}
      >
        {options.map((o) =>
          o.disabled ? (
            <span
              key={o.key}
              aria-disabled
              className="flex min-h-10 items-center justify-center rounded-lg px-2 text-center text-sm text-[var(--ink-3)] opacity-60"
            >
              {o.label}
            </span>
          ) : (
            <Link
              key={o.key}
              href={o.href}
              scroll={false}
              aria-current={o.active ? "true" : undefined}
              className={`flex min-h-10 items-center justify-center rounded-lg px-2 text-center text-sm leading-tight ${
                o.active
                  ? "bg-[var(--foreground)] font-semibold text-[var(--background)]"
                  : "text-[var(--ink-2)] hover:text-[var(--foreground)]"
              }`}
            >
              {o.label}
            </Link>
          ),
        )}
      </div>
    </div>
  );
}
