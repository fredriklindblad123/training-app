"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { usePathname, useSearchParams } from "next/navigation";

/* Hopfällbar meny som stänger sig själv när man valt något.
 *
 * Byggd på <details> för att den är native: fungerar utan JavaScript, har
 * tangentbord och skärmläsarstöd gratis, och kräver inget bibliotek.
 *
 * Men <details> stänger sig INTE av sig själv. Jag antog först att en
 * navigering skulle nollställa den — det är fel: Next navigerar på klienten,
 * DOM:en lever vidare, och menyn blev hängande öppen över sidan man just gått
 * till. Rapporterat, och helt riktigt.
 *
 * Därför den här: en effekt som stänger så fort adressen ändras. Både
 * pathname OCH query-strängen bevakas — att byta löpare ändrar bara
 * ?athlete=, och den menyn måste stängas lika mycket som en som byter sida.
 *
 * Effekten är också hela anledningen att det är en klientkomponent. Det som
 * ligger INUTI får fortfarande vara serverrenderat: children skickas in som
 * färdig markup.
 */
export function Dropdown({
  label,
  align = "left",
  width = "w-56",
  className = "",
  children,
}: {
  /** Vad knappen visar i hopfällt läge. Ska bära tillståndet — vilken sida
   * man är på, vilken löpare man tittar på — annars kostar hopfällningen
   * svaret som den öppna versionen gav gratis. */
  label: ReactNode;
  align?: "left" | "right";
  width?: string;
  className?: string;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDetailsElement>(null);
  const pathname = usePathname();
  const search = useSearchParams().toString();

  useEffect(() => {
    if (ref.current) ref.current.open = false;
  }, [pathname, search]);

  return (
    <details ref={ref} className={`display group relative text-sm ${className}`}>
      {/* list-none räcker inte i Safari — den ritar sin triangel via
          ::-webkit-details-marker, som måste döljas separat. Utan det får man
          två pilar på iPhone: systemets och vår egen. */}
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md border border-[var(--line)] px-2.5 py-1.5 font-medium text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="inline-block h-2 w-2 shrink-0 rotate-45 border-r-2 border-b-2 border-current transition-transform group-open:-rotate-135"
        />
        <span className="truncate">{label}</span>
      </summary>
      <div
        className={`absolute ${align === "right" ? "right-0" : "left-0"} z-50 mt-2 flex ${width} flex-col gap-1 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-2 shadow-lg`}
      >
        {children}
      </div>
    </details>
  );
}
