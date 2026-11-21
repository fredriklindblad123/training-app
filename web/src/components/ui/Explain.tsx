import type { ReactNode } from "react";

/* De tre små byggstenarna som bär tonen i appen (B2/B5, 2026-11-21).
 *
 * HowCalculated — "Hur räknas det?" hopfällt under en sektion. Förklaringen
 * fanns förr som långa stycken ovanför graferna (Resultat hade femton rader
 * innan första grafen). Den som vill veta fäller ut; den som bara vill se
 * siffran slipper läsa sig dit.
 *
 * Observations — en ruta med korta meningar om vad som hände. Observation,
 * aldrig betyg (CLAUDE.md, Ton mot adepterna): inga färger, inga pilar, och
 * underlaget står under när det är självskattat.
 *
 * EmptyState — säger vad som saknas och varför, i stället för en nolla som
 * ser ut som ett resultat. */

export function HowCalculated({
  children,
  summary = "Hur räknas det?",
}: {
  children: ReactNode;
  summary?: string;
}) {
  return (
    <details className="group text-sm text-[var(--ink-2)]">
      <summary className="flex min-h-9 cursor-pointer list-none items-center gap-1.5 text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
        <span aria-hidden className="text-[var(--ink-3)] transition-transform group-open:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="mt-1 flex max-w-3xl flex-col gap-2 pl-4">{children}</div>
    </details>
  );
}

export function Observations({
  title,
  items,
  source,
}: {
  title?: string;
  /** En mening per rad. */
  items: ReactNode[];
  /** Var siffrorna kommer ifrån, t.ex. "ur klockan och dagboken · självskattat". */
  source?: ReactNode;
}) {
  if (items.length === 0) return null;
  return (
    <div
      className="flex flex-col gap-2 rounded-[14px] px-4 py-3.5"
      style={{ backgroundColor: "var(--surface-insight)" }}
    >
      {title && (
        <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-2)] uppercase">
          {title}
        </span>
      )}
      {items.length === 1 ? (
        <p className="text-[0.9375rem] leading-snug text-[var(--foreground)]">{items[0]}</p>
      ) : (
        <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[0.9375rem] leading-snug text-[var(--foreground)]">
          {items.map((it, i) => (
            <li key={i}>{it}</li>
          ))}
        </ul>
      )}
      {source && <p className="text-xs text-[var(--ink-2)]">{source}</p>}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1 rounded-[14px] border border-dashed border-[var(--line)] px-4 py-3.5">
      <span className="font-semibold text-[var(--foreground)]">{title}</span>
      {children && <span className="text-sm text-[var(--ink-2)]">{children}</span>}
    </div>
  );
}

/** Liten versal etikett ovanför en grupp — "DAGENS PASS", "LÄGET". */
export function Eyebrow({ children }: { children: ReactNode }) {
  return (
    <h2 className="display text-xs font-semibold tracking-[0.08em] text-[var(--ink-3)] uppercase">
      {children}
    </h2>
  );
}
