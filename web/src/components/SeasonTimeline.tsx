/* Tidslinjen visar BLOCKEN, inget annat (2026-09-16).
 *
 * Full vy: EN RAD PER BLOCK sedan 2026-09-16. Blocken låg tidigare staplade i
 * ett enda band, och det var bandets grundfel — ett block på tre veckor blir
 * några procent brett på ett år, och namnet klipptes till ingenting. Man såg
 * färgade fält utan att kunna läsa vad de var. Nu står namn och fas i en egen
 * kolumn som aldrig klipps, och stapeln får göra det den är bra på: visa när
 * och hur länge.
 *
 * Kompakt vy (översiktens rad per löpare) behåller ett band: där ÄR raden
 * löparen, och blocken måste samsas på samma höjd.
 *
 * Båda lägena har ett månadsrutnät bakom staplarna. Tidigare fanns bara en
 * tunn axel under bandet, och blicken fick vandra fram och tillbaka mellan
 * stapel och etikett för att avgöra när något började.
 *
 * Tävlingarna låg tidigare som roterade romber under bandet, med en etikett
 * under varje. Rapporterat två gånger som svårläst, och orsaken är formatet
 * snarare än detaljerna: ett band som spänner ett år är några hundra pixlar
 * brett, och ett tiotal tävlingar med namn, prioritet och datum får inte plats
 * där utan att skriva över varandra. Att krympa symbolerna hade gjort dem
 * oläsliga i stället för överlappande.
 *
 * Tävlingarna visas i stället som kort och text bredvid tidslinjen, i samma
 * form som resten av appen använder — översiktens rader har "Nästa
 * A-tävling" utskrivet, och blocköversikten har en egen tävlingssektion.
 * Bandet får därmed göra en sak: visa när blocken börjar och slutar.
 */
import {
  PHASE_COLOR_VARS,
  PHASE_LABELS,
  groupBlocksBySeason,
  type PeriodType,
  type PhaseType,
  type Priority,
  type SeasonKind,
} from "@/lib/planning";

/* Säsongsöversikt: block som ett band över tiden, med tävlingar som markörer.
 *
 * Poängen är att se periodiseringen mot tävlingarna i ett svep — ligger
 * nedtrappningen verkligen före A-tävlingen, och finns det en lucka i
 * planeringen mitt i säsongen? Det är svårt att se i en lista och lätt att se
 * i ett band. */

export type TimelineBlock = {
  id: string;
  name: string;
  period: PeriodType;
  phase: PhaseType;
  season: SeasonKind | null;
  start_date: string;
  end_date: string;
};

export type TimelineCompetition = {
  id: string;
  name: string;
  competition_date: string;
  priority: Priority;
  venue: SeasonKind | null;
};

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function dayNumber(dateKey: string): number {
  return Math.floor(new Date(`${dateKey}T00:00:00`).getTime() / 864e5);
}

function shortDate(dateKey: string): string {
  const d = new Date(`${dateKey}T00:00:00`);
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

function toKey(d: Date): string {
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

/** Den 1:a i varje månad inom [fromKey, toKey], som markeringar på tidsaxeln.
 *
 * Utan en synlig axel gick datumen bara att nå genom att hovra över ett band
 * — man såg ATT ett block låg någonstans i mitten, aldrig NÄR (rapporterat
 * 2026-08-27). Månadssteg är rätt upplösning här: banden är veckor till
 * månader långa, så dagmarkeringar vore brus och årsmarkeringar för grovt.
 *
 * Januari bär årtalet. Det är den enda punkt där årtalet ändras, och en
 * säsong som spänner ett årsskifte är normalfallet för en friidrottare
 * (inomhus- och utomhussäsong hör till samma träningsår). */
function monthTicks(fromKey: string, toKey_: string): { key: string; label: string }[] {
  const from = new Date(`${fromKey}T00:00:00`);
  const to = new Date(`${toKey_}T00:00:00`);
  const ticks: { key: string; label: string }[] = [];
  const cursor = new Date(from.getFullYear(), from.getMonth(), 1);
  if (cursor < from) cursor.setMonth(cursor.getMonth() + 1);
  while (cursor <= to) {
    ticks.push({
      key: toKey(cursor),
      label:
        cursor.getMonth() === 0
          ? `${MONTHS[0]} ${String(cursor.getFullYear()).slice(2)}`
          : MONTHS[cursor.getMonth()],
    });
    cursor.setMonth(cursor.getMonth() + 1);
  }
  return ticks;
}

/** Månadsstrecken med färdigt uträknad x-position och etikettgallring.
 *
 * Egen funktion på modulnivå, inte en loop inuti JSX: gallringen behöver ett
 * löpande "senast etiketterade position", och att mutera en variabel inne i
 * en render-callback är precis vad React Compiler (med rätta) underkänner.
 * Här är den en lokal variabel i en ren funktion — samma resultat, inget
 * tillstånd som läcker mellan renderingar. */
function axisTicks(
  minKey: string,
  maxKey: string,
  pct: (dateKey: string) => number,
  minLabelGap: number,
): { key: string; label: string; left: number; showLabel: boolean }[] {
  let lastLabelPct = -Infinity;
  return monthTicks(minKey, maxKey).map((t) => {
    const left = pct(t.key);
    const showLabel = left - lastLabelPct >= minLabelGap;
    if (showLabel) lastLabelPct = left;
    return { ...t, left, showLabel };
  });
}

/** Förklaringen till bandets grafik: fasfärger, tävlingsprioriteter och
 * idag-strecket.
 *
 * Egen exporterad komponent sedan 2026-08-27, för att översiktsvyn ska kunna
 * rita den EN gång ovanför alla löparrader i stället för en gång per rad.
 * Tidigare fanns legenden bara i det icke-kompakta läget, vilket betydde att
 * översikten — den vy där flest romber trängs — var den enda som inte
 * förklarade vad de betydde. */
export function SeasonTimelineLegend({ phases }: { phases: PhaseType[] }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-[var(--ink-3)]">
      {phases.map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: PHASE_COLOR_VARS[t] }}
          />
          {PHASE_LABELS[t]}
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-0.5 bg-[var(--foreground)]" />
        Idag
      </span>
    </div>
  );
}

export function SeasonTimeline({
  blocks,
  races = [],
  compact,
  rangeStart,
  rangeEnd,
}: {
  blocks: TimelineBlock[];
  /* Tävlingar löparen är taggad på, i EGEN BANA under blockstaplarna.
   *
   * Egen bana och inte markörer ovanpå staplarna, och det är hela lärdomen
   * från förra försöket: romber ovanpå blockbandet med etiketter under blev
   * oläsliga och togs bort. I en egen rad konkurrerar de inte med blocken om
   * ytan, och etiketterna får dessutom banfördelning sinsemellan — samma
   * grepp som RaceTimeline på tävlingssidan.
   *
   * Bara i den fulla vyn. Kompaktläget är sex pixlar högt och rymmer inte en
   * rad till. */
  races?: { name: string; date: string; priority: string }[];
  /** Mindre band, inga tävlingsetiketter/förklaring under — för
   * översiktskorten (Alla-läget på /sasongsoversikt) där flera löpares tidslinjer
   * visas sida vid sida. */
  compact?: boolean;
  /** Fast datumintervall för skalan, i stället för att härleda min/max ur
   * blocken — så flera löpares tidslinjer i Alla-läget delar
   * exakt samma axel och går att jämföra rakt av (annars auto-skalar varje
   * kort till sin egen data, och samma kalendermånad hamnar på olika
   * x-positioner för olika löpare). Utelämnad = samma auto-skalning som
   * innan (ensam-löpar-vyn, som bara visar en tidslinje i taget). */
  rangeStart?: string;
  rangeEnd?: string;
}) {
  if (!rangeStart && blocks.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-3)]">
        {compact
          ? "Ingen planering ännu."
          : "Ingen planering ännu. Lägg till en A-tävling och låt appen föreslå en periodisering, eller skapa block för hand nedan."}
      </p>
    );
  }

  const minKey =
    rangeStart ??
    blocks.map((b) => b.start_date).reduce(
      (a, b) => (a < b ? a : b),
    );
  const maxKey =
    rangeEnd ??
    blocks.map((b) => b.end_date).reduce(
      (a, b) => (a > b ? a : b),
    );
  const min = dayNumber(minKey);
  const max = dayNumber(maxKey);
  const span = Math.max(1, max - min);

  const pct = (dateKey: string) => ((dayNumber(dateKey) - min) / span) * 100;
  const todayKey = new Date().toISOString().slice(0, 10);
  const todayPct = pct(todayKey);
  const todayVisible = todayPct >= 0 && todayPct <= 100;

  // Sorterade så att banden ritas i kronologisk ordning.
  const sortedBlocks = [...blocks].sort((a, b) => a.start_date.localeCompare(b.start_date));


  /* Månadsrutnätet. Strecken ritas bakom banden så att man kan läsa AV var ett
   * block börjar, inte bara att det ligger "någonstans i mitten". Tidigare
   * fanns bara en tunn axel under bandet, och blicken fick vandra fram och
   * tillbaka mellan stapel och etikett. */
  const ticks = axisTicks(minKey, maxKey, pct, compact ? 14 : 7);

  const grid = (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      {ticks.map((tick) => (
        <span
          key={tick.key}
          className="absolute top-0 bottom-0 w-px bg-[var(--line)]"
          style={{ left: `${tick.left}%` }}
        />
      ))}
      {todayVisible && (
        <span
          className="absolute top-0 bottom-0 w-0.5 bg-[var(--foreground)]"
          style={{ left: `${todayPct}%` }}
        />
      )}
    </div>
  );

  const monthAxis = (
    <div className="relative mt-1 h-4">
      {ticks.map((tick) => (
        <span
          key={tick.key}
          className="absolute top-0 -translate-x-1/2 whitespace-nowrap text-[10px] text-[var(--ink-3)]"
          style={{ left: `${tick.left}%` }}
        >
          {tick.showLabel ? tick.label : ""}
        </span>
      ))}
    </div>
  );

  /* ---- Kompakt: ETT band, en rad per löpare i översikten ----
     Där är raden i sig löparen, och blocken måste därför samsas på samma
     höjd. Namnen får inte plats och står i tooltipen. */
  if (compact) {
    return (
      <div className="relative">
        <div className="relative h-6 overflow-hidden rounded bg-[var(--surface-raised)]">
          {grid}
          {sortedBlocks.map((b) => {
            const left = pct(b.start_date);
            const width = Math.max(1.5, pct(b.end_date) - left);
            return (
              <div
                key={b.id}
                className="absolute top-0 h-6 rounded-sm"
                style={{
                  left: `${left}%`,
                  width: `${width}%`,
                  backgroundColor: PHASE_COLOR_VARS[b.phase],
                }}
                title={`${b.name} — ${PHASE_LABELS[b.phase]}, ${shortDate(b.start_date)}–${shortDate(b.end_date)}`}
              />
            );
          })}
        </div>
      </div>
    );
  }

  /* ---- Full: EN RAD PER BLOCK ----
   *
   * Blocken låg tidigare staplade i ett enda band, och det var bandets
   * grundfel: ett block på tre veckor blir några procent brett på ett år, och
   * namnet klipptes till ingenting. Man såg färgade fält utan att kunna läsa
   * vad de var — rapporterat som svårläst.
   *
   * Med en rad per block står namn, fas och längd i en egen kolumn till
   * vänster och kan aldrig klippas, medan stapeln får göra det den är bra på:
   * visa NÄR och HUR LÄNGE. Raderna delar samma axel, så blocken går
   * fortfarande att läsa mot varandra.
   */
  return (
    <div className="flex flex-col gap-3">
      <div className="overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3">
        <div className="min-w-[36rem]">
          {/* SÄSONGSBANDET, överst och på samma axel som blocken.
              Säsongerna låg tidigare som rubriker mellan blockraderna, alltså
              som grupper i en lista. Det bröt kronologin: "Återhämtning ht
              2027" hamnade före "2027 ute", som ligger maj till september, och
              staplarna hoppade bakåt i tiden. Rapporterat.
              En säsong ÄR ett tidsspann, så den hör hemma på axeln. Blocken
              kan då ligga i en enda kronologisk lista, och man ser ändå vilken
              säsong varje stapel faller inom genom att titta rakt upp. */}
          {(() => {
            const groups = groupBlocksBySeason(sortedBlocks);
            return (
              <div className="mb-2 flex items-center gap-3">
                <div className="w-44 shrink-0" />
                <div className="relative h-6 flex-1">
                  {groups.map((g) => {
                    const from = g.blocks.reduce(
                      (m, b) => (b.start_date < m ? b.start_date : m),
                      g.blocks[0].start_date,
                    );
                    const to = g.blocks.reduce(
                      (m, b) => (b.end_date > m ? b.end_date : m),
                      g.blocks[0].end_date,
                    );
                    const left = pct(from);
                    const width = Math.max(2, pct(to) - left);
                    const isSeason = g.key.endsWith("indoor") || g.key.endsWith("outdoor");
                    return (
                      <div
                        key={g.key}
                        className={`absolute top-0 flex h-6 items-center overflow-hidden rounded px-2 ${
                          isSeason
                            ? "bg-[var(--surface-raised)] ring-1 ring-[var(--line)]"
                            : "border border-dashed border-[var(--line)]"
                        }`}
                        style={{ left: `${left}%`, width: `${width}%` }}
                        title={`${g.label}: ${shortDate(from)}–${shortDate(to)}`}
                      >
                        <span className="display truncate text-[0.6875rem] font-bold tracking-[0.08em] text-[var(--ink-2)] uppercase">
                          {g.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          <div className="flex flex-col gap-1.5">
            {sortedBlocks.map((b) => {
              const left = pct(b.start_date);
              const width = Math.max(1, pct(b.end_date) - left);
              const weeks = Math.max(
                1,
                Math.round((dayNumber(b.end_date) - dayNumber(b.start_date) + 1) / 7),
              );
              const current = b.start_date <= todayKey && todayKey <= b.end_date;
              return (
                <div key={b.id} className="flex items-center gap-3">
                  {/* Etikettkolumnen har fast bredd så att alla staplar
                      börjar på samma x — annars flyttar sig axeln beroende på
                      hur långt ett blocknamn råkar vara. */}
                  <div className="flex w-44 shrink-0 flex-col leading-tight">
                    <span
                      className={`display truncate text-sm font-semibold ${
                        current ? "text-[var(--foreground)]" : "text-[var(--ink-2)]"
                      }`}
                      title={b.name}
                    >
                      {b.name}
                    </span>
                    <span className="flex items-center gap-1.5 text-[11px] text-[var(--ink-3)]">
                      <span
                        aria-hidden
                        className="inline-block h-2 w-2 shrink-0 rounded-sm"
                        style={{ backgroundColor: PHASE_COLOR_VARS[b.phase] }}
                      />
                      <span className="truncate">{PHASE_LABELS[b.phase]}</span>
                    </span>
                  </div>

                  <div className="relative h-7 flex-1">
                    {grid}
                    <div
                      className="absolute top-0 flex h-7 items-center overflow-hidden rounded px-2"
                      style={{
                        left: `${left}%`,
                        width: `${width}%`,
                        backgroundColor: PHASE_COLOR_VARS[b.phase],
                        // Det pågående blocket får en ram i förgrundsfärg —
                        // samma markör som "idag"-strecket, så de läses ihop.
                        outline: current ? "2px solid var(--foreground)" : undefined,
                        outlineOffset: current ? "-2px" : undefined,
                      }}
                      title={`${b.name} — ${shortDate(b.start_date)}–${shortDate(b.end_date)}, ${weeks} v`}
                    >
                      {/* Veckorna i stapeln: det är blockets längd, och den är
                          det man jämför block med. Datumen står i tooltipen —
                          två rader text i en 28 px stapel blir oläsligt. */}
                      <span className="tabular truncate text-[11px] font-medium text-white drop-shadow-sm">
                        {weeks} v
                      </span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* ---- Tävlingarna: punkter på axeln, namnen i en lista ----
              Etiketter i bandet har provats två gånger och fallit båda:
              namnen skriver över varandra, och med banfördelning krävdes åtta
              rader för tolv lopp — sjutton rem bara till tävlingar.
              Bandet är bra på EN sak: att visa NÄR något ligger och om det
              klumpar ihop sig. Namn och datum är text, och text läses i en
              lista. Punkten och raden delar färg, så man kopplar ihop dem. */}
          {(() => {
            const inRange = races
              .filter((r) => r.date >= minKey && r.date <= maxKey)
              .sort((a, b) => a.date.localeCompare(b.date));
            if (inRange.length === 0) return null;

            return (
              <div className="mt-2 flex items-center gap-3 border-t border-[var(--line)] pt-2">
                <div className="display w-44 shrink-0 text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
                  Tävlingar
                </div>
                <div className="relative h-5 flex-1">
                  {grid}
                  {inRange.map((r) => (
                    <span
                      key={`${r.date}|${r.name}`}
                      title={`${r.name} — ${shortDate(r.date)}`}
                      className="absolute top-1.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full ring-2 ring-[var(--surface)]"
                      style={{
                        left: `${pct(r.date)}%`,
                        backgroundColor:
                          r.priority === "A" ? "var(--cat-race)" : "var(--status-watch)",
                      }}
                    />
                  ))}
                </div>
              </div>
            );
          })()}

          {/* Axeln under staplarna, inskjuten lika mycket som etikettkolumnen
              så att månaderna står i linje med rutnätet ovanför. */}
          <div className="flex">
            <div className="w-44 shrink-0" />
            <div className="flex-1">{monthAxis}</div>
          </div>
        </div>
      </div>

      {/* Tävlingarna i klartext under bandet. Kronologiskt, samma ordning som
          punkterna ovanför, och färgen kopplar ihop rad och punkt. Ett rutnät
          i stället för en rad per tävling: tolv lopp som en lodrät lista hade
          blivit lika högt som hela tidslinjen. */}
      {races.filter((r) => r.date >= minKey && r.date <= maxKey).length > 0 && (
        <div className="flex flex-col gap-1.5">
          <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
            Planerade tävlingar
          </span>
          <div className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
            {races
              .filter((r) => r.date >= minKey && r.date <= maxKey)
              .sort((a, b) => a.date.localeCompare(b.date))
              .map((r) => (
                <span
                  key={`${r.date}|${r.name}`}
                  className="flex items-baseline gap-2 text-xs"
                >
                  <span
                    aria-hidden
                    className="mt-1 inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{
                      backgroundColor:
                        r.priority === "A" ? "var(--cat-race)" : "var(--status-watch)",
                    }}
                  />
                  <span className="tabular w-16 shrink-0 text-[var(--ink-3)]">
                    {shortDate(r.date)}
                  </span>
                  <span className="truncate text-[var(--foreground)]">{r.name}</span>
                  {r.priority === "A" && (
                    <span className="display shrink-0 text-[10px] font-semibold text-[var(--cat-race)]">
                      A
                    </span>
                  )}
                </span>
              ))}
          </div>
        </div>
      )}

      <SeasonTimelineLegend phases={[...new Set(sortedBlocks.map((b) => b.phase))]} />
    </div>
  );
}

/* En löpares SÄSONGER som ett liggande band — inte hennes block.
 *
 * Översikten visade tidigare gruppens alla block i en full tidslinje plus en
 * blockremsa per löpare. Det var för mycket för en förstavy: adepterna delar
 * samma block, så raderna blev nästan identiska och detaljerna hörde hemma
 * först när man zoomar in på en löpare (begärt 2026-09-17).
 *
 * Här är varje segment en SÄSONG — "2027 inne", "2027 ute" — beräknad ur
 * löparens egna block via samma seasonSectionKey som resten av appen. Spannet
 * går från säsongens första block till dess sista, så bandet visar när hon är
 * i vilken säsong och var glappen ligger.
 *
 * Ett fast datumspann utifrån, inte auto-skalning: annars hamnar samma månad
 * på olika x för olika löpare och banden går inte att läsa mot varandra.
 */
export function AthleteSeasonBand({
  blocks,
  rangeStart,
  rangeEnd,
}: {
  blocks: TimelineBlock[];
  rangeStart: string;
  rangeEnd: string;
}) {
  const min = dayNumber(rangeStart);
  const max = dayNumber(rangeEnd);
  const span = Math.max(1, max - min);
  const pct = (dateKey: string) => ((dayNumber(dateKey) - min) / span) * 100;

  if (blocks.length === 0) {
    return (
      <div className="h-9 rounded bg-[var(--surface-raised)]" aria-hidden />
    );
  }

  const groups = groupBlocksBySeason(blocks).map((g) => {
    const from = g.blocks.reduce((m, b) => (b.start_date < m ? b.start_date : m), g.blocks[0].start_date);
    const to = g.blocks.reduce((m, b) => (b.end_date > m ? b.end_date : m), g.blocks[0].end_date);
    return { ...g, from, to };
  });

  const todayKey = new Date().toISOString().slice(0, 10);
  const todayPct = pct(todayKey);

  return (
    <div className="relative h-9 overflow-hidden rounded bg-[var(--surface-raised)]">
      {groups.map((g) => {
        const left = pct(g.from);
        const width = Math.max(2, pct(g.to) - left);
        /* Tävlingssäsongerna är fyllda, perioderna mellan dem streckade. En
         * säsong är det man toppar mot; förberedelse och återhämtning är
         * vägen dit, och ska inte läsas som samma sorts sak. */
        const isSeason = g.key.endsWith("indoor") || g.key.endsWith("outdoor");
        const isIndoor = g.key.endsWith("indoor");
        return (
          <div
            key={g.key}
            className={`absolute top-0 flex h-9 flex-col justify-center overflow-hidden px-2 ${
              isSeason ? "rounded" : "rounded border border-dashed border-[var(--line)]"
            }`}
            style={{
              left: `${left}%`,
              width: `${width}%`,
              backgroundColor: isSeason
                ? isIndoor
                  ? "color-mix(in oklab, var(--zone-3) 45%, var(--surface))"
                  : "color-mix(in oklab, var(--cat-threshold) 45%, var(--surface))"
                : "transparent",
            }}
            title={`${g.label}: ${shortDate(g.from)}–${shortDate(g.to)}`}
          >
            <span className="display truncate text-[0.6875rem] font-bold tracking-[0.06em] text-[var(--foreground)] uppercase">
              {g.label}
            </span>
            {/* Datumen i bandet när segmentet är brett nog. Under det blir de
                tre tecken och oläsliga — då räcker tooltipen och den
                gemensamma månadsaxeln under listan. */}
            {width > 14 && (
              <span className="tabular truncate text-[10px] text-[var(--ink-2)]">
                {shortDate(g.from)}–{shortDate(g.to)}
              </span>
            )}
          </div>
        );
      })}

      {todayPct >= 0 && todayPct <= 100 && (
        <span
          aria-hidden
          className="absolute top-0 h-9 w-0.5 bg-[var(--foreground)]"
          style={{ left: `${todayPct}%` }}
        />
      )}
    </div>
  );
}

/** Månadsaxeln under en lista av band, ritad EN gång. */
export function SeasonBandAxis({
  rangeStart,
  rangeEnd,
}: {
  rangeStart: string;
  rangeEnd: string;
}) {
  const min = dayNumber(rangeStart);
  const max = dayNumber(rangeEnd);
  const span = Math.max(1, max - min);
  const pct = (dateKey: string) => ((dayNumber(dateKey) - min) / span) * 100;

  return (
    <div className="relative h-4">
      {axisTicks(rangeStart, rangeEnd, pct, 7).map((t) => (
        <span
          key={t.key}
          className="absolute top-0 -translate-x-1/2 text-[10px] whitespace-nowrap text-[var(--ink-3)]"
          style={{ left: `${t.left}%` }}
        >
          {t.showLabel ? t.label : ""}
        </span>
      ))}
    </div>
  );
}
