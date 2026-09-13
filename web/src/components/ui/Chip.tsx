import type { ReactNode } from "react";

/* Chip: en liten etikett som bär ett tillstånd eller en kategori.
 *
 * Färgen sitter i en prick bredvid texten, aldrig i texten själv. Det är
 * dataviz-regeln att text bär textfärg och en färgad markör intill bär
 * identiteten: färgad text tappar kontrast mot ytan så fort kategorifärgen är
 * ljus, och den som inte skiljer hue:erna åt får ingenting alls. Med prick +
 * ord finns identiteten i två kanaler.
 *
 * `ghost` är det tomma-men-korrekta tillståndet — "väntar på data", inte ett
 * fel. Streckad ram i stället för en varningsfärg, av samma skäl som
 * ActionCard aldrig färgar efter brådska (docs/tranarloopen.md, L4).
 */

export function Chip({
  children,
  colorVar,
  ghost = false,
}: {
  children: ReactNode;
  /** CSS-variabel för prickens färg, t.ex. `var(--cat-easy)`. Utan den visas
   * ingen prick alls — en chip utan kategori ska inte ha en färglös cirkel
   * som ser ut som en trasig ikon. */
  colorVar?: string;
  ghost?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs font-medium whitespace-nowrap ${
        ghost
          ? "border-dashed border-[var(--line)] text-[var(--ink-3)]"
          : "border-[var(--line)] text-[var(--ink-2)]"
      }`}
    >
      {colorVar && (
        <span
          aria-hidden
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: colorVar }}
        />
      )}
      {children}
    </span>
  );
}

/** Den smala färgstapeln längst till vänster i en listrad.
 *
 * Bär passets kategori utan att ta plats, och sträcker sig över hela radens
 * höjd så att en rad med två textrader inte får en prick som svävar vid den
 * översta. `--line` som fallback när kategorin saknar färg (vila, test, häck —
 * de har ingen motsvarighet bland genomförda pass, se workoutTypeColorVar). */
export function Swatch({ colorVar }: { colorVar?: string | null }) {
  return (
    <span
      aria-hidden
      className="w-[3px] shrink-0 self-stretch rounded-full"
      style={{ backgroundColor: colorVar ?? "var(--line)", minHeight: "1.75rem" }}
    />
  );
}
