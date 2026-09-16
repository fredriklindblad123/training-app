/** Den gemensamma formen för toppradens handlingar: en cirkel lika stor som
 * en adepts avatar.
 *
 * Egen klass och inte en upprepad klasslista på fyra ställen — hela poängen
 * med raden är att elementen ser likadana ut, och fyra kopior hade glidit isär
 * vid första justeringen. */
export const circleButtonClass =
  "display flex h-8 w-8 shrink-0 items-center justify-center rounded-full border " +
  "border-[var(--line)] bg-[var(--surface)] text-[var(--ink-2)] transition-colors " +
  "hover:border-[var(--ink-3)] hover:text-[var(--foreground)] " +
  "disabled:cursor-progress disabled:opacity-60";
