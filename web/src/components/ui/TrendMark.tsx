import type { RingStatus } from "@/lib/kpi-ring";

/* Den färgsatta symbolen på varje kort (begärd 2026-09-15).
 *
 * Bär två oberoende saker, med flit åtskilda:
 *
 *   RIKTNINGEN ligger i pilen — bokstavligt om talet gått upp eller ner.
 *   BEDÖMNINGEN ligger i färgen — grön om det är bra, röd om inte.
 *
 * Att skilja dem är inte finlir. En vilopuls UNDER baslinjen är en pil nedåt
 * och samtidigt grön; en belastning som stiger är en pil uppåt men inte
 * självklart grön. Hade färgen ensam fått betyda "uppåt" vore just de korten
 * obegripliga. Samma resonemang stod redan i MarkerCard innan symbolen blev
 * delad — nu gäller det alla kort på dashboarden.
 *
 * Pilen är ritad som SVG och inte som tecknet ↑. Glyferna finns inte i alla
 * vikter av Barlow och faller då tillbaka på en systemfont, vilket ger en pil
 * som hoppar i storlek och grundlinje mellan korten.
 *
 * Färgen räcker inte ensam — pilen är formen som bär samma besked för den som
 * inte skiljer grönt från rött, och texten säger det i klartext.
 */

export type TrendDirection = "up" | "down" | "flat";

/* Två kulörer per status, med flit. Plattan får grundtonen, texten en
 * mörkare variant i ljust läge — grundtonerna är valda för att duga som
 * ringlinje och platta, och klarar uppmätt bara 2,75–3,89:1 som 12 px text
 * mot sin egen platta. Se motiveringen vid --status-*-ink i globals.css. */
const PLATE: Record<RingStatus, string> = {
  good: "var(--status-good)",
  watch: "var(--status-watch)",
  concern: "var(--status-concern)",
  // Grått, inte lila (ändrat 2026-09-15 efter rapport). --status-neutral är
  // indigo, och en läsare som ser grönt, gult, rött och lila bredvid varandra
  // läser lila som en fjärde bedömning och letar efter vilken. Den betyder
  // motsatsen: att det INTE finns någon bedömning att göra. Grått säger det
  // direkt. Tonen sitter bara här och i KpiRing — /trender:s InsightCard
  // använder fortfarande --status-neutral som avsett, där den är en av tre
  // jämbördiga toner och inte konkurrerar med ett trafikljus.
  neutral: "var(--ink-3)",
  unknown: "var(--ink-3)",
};

const INK: Record<RingStatus, string> = {
  good: "var(--status-good-ink)",
  watch: "var(--status-watch-ink)",
  concern: "var(--status-concern-ink)",
  // --ink-2 och inte --ink-3: uppmätt ger ink-3 på sin egen platta 3,23:1
  // (ljust) och 4,10:1 (mörkt), båda under 4,5. Med ink-2 blir det 6,13 och
  // 6,86.
  neutral: "var(--ink-2)",
  unknown: "var(--ink-2)",
};

function Glyph({ direction }: { direction: TrendDirection }) {
  return (
    <svg viewBox="0 0 10 10" className="h-2.5 w-2.5 shrink-0" fill="currentColor" aria-hidden>
      {direction === "up" && <path d="M5 1.5 9 8 H1 Z" />}
      {direction === "down" && <path d="M5 8.5 1 2 H9 Z" />}
      {/* Oförändrat är ett streck och inte en pil — en vågrät pil läses lätt
          som "åt höger", alltså en riktning, vilket är precis vad den inte är. */}
      {direction === "flat" && <rect x="1" y="4.25" width="8" height="1.5" rx="0.75" />}
    </svg>
  );
}

export function TrendMark({
  status,
  direction,
  text,
  /** Vad symbolen betyder, för skärmläsare. Utan den läses "↑ +3,2%" som
   * lösryckta tecken utan koppling till måttet ovanför. */
  srLabel,
}: {
  status: RingStatus;
  direction: TrendDirection;
  text: string;
  srLabel: string;
}) {
  return (
    <span
      className="display tabular inline-flex shrink-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-xs font-semibold"
      style={{
        color: INK[status],
        // Tonad platta i samma kulör. color-mix och inte en egen token per
        // status: tonen ska följa med automatiskt när mörkt läge byter
        // --status-*, och en hårdkodad ljus platta hade lyst i mörkt läge.
        backgroundColor: `color-mix(in oklab, ${PLATE[status]} 14%, transparent)`,
      }}
    >
      <Glyph direction={direction} />
      <span aria-hidden>{text}</span>
      <span className="sr-only">{srLabel}</span>
    </span>
  );
}
