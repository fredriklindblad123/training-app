import Link from "next/link";

/* L4 i docs/tranarloopen.md: "Insikt"-korttypen. Byggs här i L2/L4, tas i
 * bruk först av L3 (lib/insights.ts) — se dess kommentar för reglerna som
 * producerar `headline`/`detail`/`tone`.
 *
 * Påståendet är rubriken, siffran är sekundär, och den utfällbara detaljen
 * (`<details>`, som KpiRing redan använder) är där den som vill se mer
 * klickar sig in. `tone` styr bara en liten diskret markör — inte kortets
 * bakgrund eller textfärg — så att en "att bevaka"-insikt aldrig läses som
 * en varning. Markören återanvänder --status-* (redan CVD-validerad) i
 * stället för att uppfinna en ny, mindre genomtänkt palett. */

export type InsightTone = "positiv" | "neutral" | "att-bevaka";

const TONE_MARKER_VAR: Record<InsightTone, string> = {
  positiv: "var(--status-good)",
  neutral: "var(--status-neutral)",
  "att-bevaka": "var(--status-watch)",
};

const TONE_LABEL: Record<InsightTone, string> = {
  positiv: "Positivt",
  neutral: "Läge",
  "att-bevaka": "Att bevaka",
};

export function InsightCard({
  headline,
  detail,
  href,
  tone,
}: {
  /** Påståendet, t.ex. "Formkurvan har stigit fyra veckor i rad." */
  headline: string;
  /** Siffran/underlaget bakom påståendet, för den som fäller ut det. */
  detail: string;
  href: string;
  tone: InsightTone;
}) {
  return (
    <details
      className="group rounded border border-[var(--line)] px-4 py-3"
      style={{ backgroundColor: "var(--surface-insight)" }}
    >
      <summary className="flex cursor-pointer list-none items-start gap-2 [&::-webkit-details-marker]:hidden">
        <span
          aria-hidden
          className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: TONE_MARKER_VAR[tone] }}
          title={TONE_LABEL[tone]}
        />
        <span className="text-sm font-medium text-[var(--foreground)]">{headline}</span>
      </summary>
      <div className="mt-2 flex flex-col items-start gap-2 pl-3.5">
        <p className="text-xs text-[var(--ink-3)]">{detail}</p>
        <Link
          href={href}
          className="text-xs underline text-[var(--ink-2)] hover:text-[var(--foreground)]"
        >
          Läs mer →
        </Link>
      </div>
    </details>
  );
}
