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
          {/* Indelat efter SÄSONG, inte bara kronologiskt (2026-09-17, begärt).
              Simbanor: inomhussäsongens block för sig, utomhussäsongens för
              sig, och däremellan de som inte hör till någon — förberedelse och
              återhämtning. Alla på samma axel, så man ser både vad som hör
              ihop och när det ligger.
              Uppmätt på Alices plan: sex utomhusblock, två inomhus och tre
              utan säsong. Den tredje gruppen är alltså inget kantfall och får
              ett eget namn i stället för att tigas ihjäl eller klumpas in i
              fel säsong.
              Grupperna ordnas efter när de BÖRJAR, så läsningen uppifrån och
              ned fortfarande följer tiden. */}
          {(() => {
            const groups: { key: string; label: string; blocks: TimelineBlock[] }[] = [];
            for (const b of sortedBlocks) {
              const key = b.season ?? "none";
              const label =
                b.season === "indoor"
                  ? "Inomhussäsong"
                  : b.season === "outdoor"
                    ? "Utomhussäsong"
                    : "Mellan säsongerna";
              const found = groups.find((g) => g.key === key);
              if (found) found.blocks.push(b);
              else groups.push({ key, label, blocks: [b] });
            }
            return groups.map((group) => (
              <div key={group.key} className="flex flex-col gap-1.5">
                <div className="flex items-center gap-3">
                  <div className="display w-44 shrink-0 text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
                    {group.label}
                  </div>
                  <div className="h-px flex-1 bg-[var(--line)]" aria-hidden />
                </div>
                {group.blocks.map((b) => {
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
            ));
          })()}

          {/* ---- Tävlingsbanan ---- */}
          {(() => {
            const inRange = races
              .filter((r) => r.date >= minKey && r.date <= maxKey)
              .sort((a, b) => a.date.localeCompare(b.date));
            if (inRange.length === 0) return null;

            /* Etikettbredd som andel av bandet. Exakt pixelbredd är inte känd
             * på servern; tilltaget i överkant, hellre en extra rad än två
             * namn ovanpå varandra. */
            const LABEL_PCT = 18;
            /* Tak på antalet banor, och det är nödvändigt. Simulerat mot
             * Alices tolv kommande lopp över ett femtonmånadersband: utan tak
             * krävs ÅTTA banor, alltså sjutton rem bara till tävlingar. Det är
             * precis den gröt som fick markörerna borttagna från bandet en
             * gång. */
            const MAX_LANES = 3;

            /* A-loppen fördelas FÖRST, så de alltid får en etikett. Får något
             * inte plats är det ett B-lopp som blir en omärkt punkt, inte
             * säsongens huvudmål. Kronologiskt inom varje prioritet. */
            const byImportance = [...inRange].sort((a, b) => {
              if (a.priority !== b.priority) return a.priority === "A" ? -1 : 1;
              return a.date.localeCompare(b.date);
            });

            const laneEnds: number[] = [];
            const labelled: { race: (typeof inRange)[number]; left: number; lane: number }[] = [];
            const dots: { race: (typeof inRange)[number]; left: number }[] = [];

            for (const r of byImportance) {
              const left = pct(r.date);
              let lane = laneEnds.findIndex((end) => left > end);
              if (lane === -1) {
                if (laneEnds.length >= MAX_LANES) {
                  // Ryms inte: punkt utan etikett, med namnet i tooltipen.
                  dots.push({ race: r, left });
                  continue;
                }
                lane = laneEnds.length;
                laneEnds.push(0);
              }
              laneEnds[lane] = left + LABEL_PCT;
              labelled.push({ race: r, left, lane });
            }
            const lanes = Math.max(1, laneEnds.length);
            const placed = labelled;

            return (
              <div className="mt-2 flex items-start gap-3 border-t border-[var(--line)] pt-2">
                <div className="display w-44 shrink-0 text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
                  Tävlingar
                </div>
                <div
                  className="relative flex-1"
                  style={{ height: `${lanes * 2.1 + (dots.length > 0 ? 0.9 : 0)}rem` }}
                >
                  {grid}

                  {/* De som inte fick etikett, som punkter på en egen rad
                      längst ned. De försvinner inte — man ser ATT det ligger
                      lopp där, och namnet finns i tooltipen. */}
                  {dots.map(({ race, left }) => (
                    <span
                      key={`dot-${race.date}-${race.name}`}
                      title={`${race.name} — ${shortDate(race.date)}`}
                      className="absolute h-2 w-2 -translate-x-1/2 rounded-full"
                      style={{
                        left: `${left}%`,
                        top: `${lanes * 2.1}rem`,
                        backgroundColor:
                          race.priority === "A" ? "var(--cat-race)" : "var(--status-watch)",
                      }}
                    />
                  ))}
                  {placed.map(({ race, left, lane }) => (
                    <div
                      key={`${race.date}|${race.name}`}
                      className="absolute flex flex-col"
                      style={{
                        left: `${left}%`,
                        top: `${lane * 2.1}rem`,
                        maxWidth: `${Math.max(14, 100 - left)}%`,
                      }}
                      title={`${race.name} — ${shortDate(race.date)}`}
                    >
                      <span className="flex items-center gap-1">
                        <span
                          aria-hidden
                          className="inline-block h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              race.priority === "A" ? "var(--cat-race)" : "var(--status-watch)",
                          }}
                        />
                        <span className="truncate text-[11px] font-medium text-[var(--foreground)]">
                          {race.name}
                        </span>
                      </span>
                      <span className="tabular truncate pl-3 text-[10px] text-[var(--ink-3)]">
                        {shortDate(race.date)}
                      </span>
                    </div>
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

      <SeasonTimelineLegend phases={[...new Set(sortedBlocks.map((b) => b.phase))]} />
    </div>
  );
}
