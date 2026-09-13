import type { ReactNode } from "react";

/* Kortytan.
 *
 * Ersätter mönstret `rounded border border-zinc-200 p-4 dark:border-zinc-800`,
 * som låg utskrivet på 24 ställen i appen. Skillnaden mot det gamla mönstret
 * är inte formen utan att kortet faktiskt har en YTA: tidigare hade appen noll
 * ytnivåer — allt låg kant i kant mot bakgrunden med bara en hårfin ram, och
 * det är den enskilt största orsaken till att den läste som ett kalkylblad i
 * stället för ett instrument.
 *
 * Färgerna kommer ur --surface/--line i globals.css, som är definierade i båda
 * teman. Inga zinc-klasser här: de fanns i två varianter per element (ljus +
 * dark:) och gick isär så fort någon glömde den ena.
 */

type CardProps = {
  children: ReactNode;
  /** Upphöjd yta — för kort som ligger PÅ ett annat kort, eller för det som
   * ska läsa som en åtgärd snarare än data. Sparsamt: två nivåer räcker, en
   * tredje gör att ingen av dem betyder något. */
  raised?: boolean;
  /** Extra klasser. Layout (flex, gap, grid) hör hemma här — kortet äger bara
   * yta, ram, rundning och innerkant. */
  className?: string;
};

export function Card({ children, raised = false, className = "" }: CardProps) {
  return (
    <div
      className={`rounded-lg border border-[var(--line)] p-4 ${
        raised ? "bg-[var(--surface-raised)]" : "bg-[var(--surface)]"
      } ${className}`}
    >
      {children}
    </div>
  );
}

/** Kortets rubrikrad: titel till vänster, valfri detalj högerställd.
 *
 * Egen komponent för att rad-för-rad-varianten (`flex items-baseline
 * justify-between`) annars skrivs om lite olika varje gång och gör att
 * rubrikerna hamnar på olika höjd mellan korten. `items-baseline` är
 * medvetet: titel och detalj har olika storlek och ska ändå stå på samma
 * grundlinje. */
export function CardHeader({ title, detail }: { title: ReactNode; detail?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="text-sm font-semibold text-[var(--foreground)]">{title}</h3>
      {detail && <span className="text-xs text-[var(--ink-3)]">{detail}</span>}
    </div>
  );
}
