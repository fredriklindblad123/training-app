import Link from "next/link";

/* L4 i docs/tranarloopen.md: "Åtgärd"-korttypen. Färgad vänsterkant, rubrik i
 * imperativ, `why` som kort underrad, hela kortet är länken. Fallgropen i
 * L4 är uttrycklig: alla åtgärder får samma dämpade accent (--surface-action)
 * oavsett prioritet — ordningen i listan bär brådskan, aldrig färgen. Ett
 * rött kort på "skriv om gårdagens pass" vore precis den sortens gnäll
 * avsnitt 6 förbjuder. */
export function ActionCard({
  title,
  why,
  href,
}: {
  /** Imperativ, t.ex. "Checka in för idag". */
  title: string;
  /** En mening, aldrig tillrättavisande. */
  why: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="flex flex-col gap-0.5 rounded border-y border-r border-l-4 border-zinc-200 px-4 py-3 transition-colors hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
      style={{ borderLeftColor: "var(--surface-action)" }}
    >
      <span className="text-sm font-medium text-zinc-900 dark:text-zinc-100">{title}</span>
      <span className="text-xs text-zinc-500 dark:text-zinc-400">{why}</span>
    </Link>
  );
}
