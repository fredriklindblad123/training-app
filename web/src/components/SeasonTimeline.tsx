import {
  PHASE_COLOR_VARS,
  PHASE_LABELS,
  PRIORITY_SHORT,
  SEASON_LABELS,
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

/** Tävlingar som ligger för tätt för att gå att skilja åt slås ihop till en
 * markör med antal.
 *
 * Bakgrunden (rapporterat 2026-08-27): i översiktens kompakta rader låg
 * markörerna så tätt att de blev en grå klump — man såg att NÅGOT hände i
 * juli, men inte vad eller hur många. En 8 px romb kan inte stå bredvid en
 * annan på tre dagars avstånd i ett band som spänner ett helt år.
 *
 * Klustret ärver den HÖGSTA prioriteten i gruppen (A före B före C). Det är
 * medvetet: döljer man en A-tävling bakom färgen för en träningstävling
 * försvinner just det man behöver se. Samma rangordning som Detaljplanens
 * veckovy redan använder för sina tävlingsetiketter.
 *
 * `minGapPct` är i procent av bandets bredd och därmed beroende av hur brett
 * bandet råkar renderas — men bandets pixelbredd är inte känd på servern, och
 * att mäta den i klienten vore en helt ny sorts komplexitet för en
 * tröskel som bara avgör när två romber råkar nudda varandra. */
function clusterCompetitions(
  competitions: TimelineCompetition[],
  pct: (dateKey: string) => number,
  minGapPct: number,
): { key: string; left: number; items: TimelineCompetition[]; priority: Priority }[] {
  const sorted = [...competitions].sort((a, b) =>
    a.competition_date.localeCompare(b.competition_date),
  );
  const clusters: { key: string; left: number; items: TimelineCompetition[]; priority: Priority }[] =
    [];

  for (const c of sorted) {
    const left = pct(c.competition_date);
    const last = clusters[clusters.length - 1];
    if (last && left - last.left < minGapPct) {
      last.items.push(c);
      if (PRIORITY_RANK[c.priority] > PRIORITY_RANK[last.priority]) last.priority = c.priority;
    } else {
      clusters.push({ key: c.id, left, items: [c], priority: c.priority });
    }
  }
  return clusters;
}

/** A högst — se motiveringen i clusterCompetitions. */
const PRIORITY_RANK: Record<Priority, number> = { A: 3, B: 2, C: 1 };

const PRIORITY_COLOR: Record<Priority, string> = {
  A: "bg-red-600",
  B: "bg-amber-500",
  C: "bg-zinc-400",
};

/** Förklaringen till bandets grafik: fasfärger, tävlingsprioriteter och
 * idag-strecket.
 *
 * Egen exporterad komponent sedan 2026-08-27, för att översiktsvyn ska kunna
 * rita den EN gång ovanför alla löparrader i stället för en gång per rad.
 * Tidigare fanns legenden bara i det icke-kompakta läget, vilket betydde att
 * översikten — den vy där flest romber trängs — var den enda som inte
 * förklarade vad de betydde. */
export function SeasonTimelineLegend({
  phases,
  hasCompetitions,
}: {
  phases: PhaseType[];
  hasCompetitions: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-zinc-500 dark:text-zinc-400">
      {phases.map((t) => (
        <span key={t} className="flex items-center gap-1.5">
          <span
            className="inline-block h-2.5 w-2.5 rounded-sm"
            style={{ backgroundColor: PHASE_COLOR_VARS[t] }}
          />
          {PHASE_LABELS[t]}
        </span>
      ))}
      {hasCompetitions && (
        <>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-red-600" />
            A-tävling
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-amber-500" />
            B-tävling
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-zinc-400" />
            C · träningstävling
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rotate-45 bg-zinc-400" />
            <span className="-ml-1 text-[10px]">2</span>
            flera samma vecka
          </span>
        </>
      )}
      <span className="flex items-center gap-1.5">
        <span className="inline-block h-3 w-0.5 bg-zinc-900 dark:bg-zinc-50" />
        Idag
      </span>
    </div>
  );
}

export function SeasonTimeline({
  blocks,
  competitions,
  compact,
  rangeStart,
  rangeEnd,
}: {
  blocks: TimelineBlock[];
  competitions: TimelineCompetition[];
  /** Mindre band, inga tävlingsetiketter/förklaring under — för
   * översiktskorten (Alla-läget på /blockplan) där flera löpares tidslinjer
   * visas sida vid sida. */
  compact?: boolean;
  /** Fast datumintervall för skalan, i stället för att härleda min/max ur
   * blocks/competitions — så flera löpares tidslinjer i Alla-läget delar
   * exakt samma axel och går att jämföra rakt av (annars auto-skalar varje
   * kort till sin egen data, och samma kalendermånad hamnar på olika
   * x-positioner för olika löpare). Utelämnad = samma auto-skalning som
   * innan (ensam-löpar-vyn, som bara visar en tidslinje i taget). */
  rangeStart?: string;
  rangeEnd?: string;
}) {
  if (!rangeStart && blocks.length === 0 && competitions.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        {compact
          ? "Ingen planering ännu."
          : "Ingen planering ännu. Lägg till en A-tävling och låt appen föreslå en periodisering, eller skapa block för hand nedan."}
      </p>
    );
  }

  const minKey =
    rangeStart ??
    [...blocks.map((b) => b.start_date), ...competitions.map((c) => c.competition_date)].reduce(
      (a, b) => (a < b ? a : b),
    );
  const maxKey =
    rangeEnd ??
    [...blocks.map((b) => b.end_date), ...competitions.map((c) => c.competition_date)].reduce(
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

  const bandHeight = compact ? "h-6" : "h-12";

  return (
    <div className="flex flex-col gap-3">
      <div className="relative overflow-x-auto">
        <div className={compact ? "min-w-[12rem]" : "min-w-[32rem]"}>
          {/* Blockband */}
          <div className={`relative ${bandHeight} rounded bg-zinc-100 dark:bg-zinc-900`}>
            {sortedBlocks.map((b) => {
              const left = pct(b.start_date);
              const width = Math.max(1.5, pct(b.end_date) - left);
              return (
                <div
                  key={b.id}
                  className={`absolute top-0 flex ${bandHeight} items-center overflow-hidden rounded px-2`}
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    backgroundColor: PHASE_COLOR_VARS[b.phase],
                  }}
                  title={`${b.name} — ${PHASE_LABELS[b.phase]}, ${shortDate(b.start_date)}–${shortDate(b.end_date)}`}
                >
                  {!compact && (
                    /* Namn OCH datumspann i bandet. Bandet är h-12, så två
                       rader får plats; datumen var tidigare bara nåbara via
                       tooltipen, vilket gjorde att man såg att ett block låg
                       "någonstans i mitten" men aldrig när det började. */
                    <span className="flex min-w-0 flex-col leading-tight">
                      <span className="truncate text-xs font-medium text-white drop-shadow-sm">
                        {b.name}
                      </span>
                      <span className="truncate text-[10px] text-white/85 drop-shadow-sm">
                        {shortDate(b.start_date)}–{shortDate(b.end_date)}
                      </span>
                    </span>
                  )}
                </div>
              );
            })}

            {todayVisible && (
              <div
                className={`absolute top-0 ${bandHeight} w-0.5 bg-zinc-900 dark:bg-zinc-50`}
                style={{ left: `${todayPct}%` }}
                title={`Idag ${todayKey}`}
              />
            )}
          </div>

          {/* Tidsaxel: månadsstreck med etikett. Ritas mellan blockbandet och
              tävlingsmarkörerna så att den ligger närmast det den förklarar.
              Etiketter gallras när de skulle trängas — se `minLabelGap`. */}
          <div className="relative mt-0.5 h-4">
            {/* Minsta avstånd mellan två etiketter: ett band över två år har
                ~24 månadsstreck, och alla utskrivna vore en gröt. Strecken
                ritas ändå — bara etiketterna gallras. */}
            {axisTicks(minKey, maxKey, pct, compact ? 14 : 7).map((t) => (
              <div
                key={t.key}
                className="absolute top-0 flex flex-col items-center"
                style={{ left: `${t.left}%` }}
              >
                <span className="h-1 w-px bg-zinc-300 dark:bg-zinc-700" aria-hidden />
                {t.showLabel && (
                  <span className="-translate-x-1/2 whitespace-nowrap text-[10px] text-zinc-500 dark:text-zinc-400">
                    {t.label}
                  </span>
                )}
              </div>
            ))}
          </div>

          {/* Tävlingsmarkörer, hopslagna när de ligger för tätt (se
              clusterCompetitions). Tröskeln är större i kompaktläget: där är
              bandet smalare, så samma antal dagar blir färre pixlar. */}
          <div className={`relative mt-1 ${compact ? "h-3" : "h-10"}`}>
            {clusterCompetitions(competitions, pct, compact ? 3 : 1.5).map((cluster) => {
              const many = cluster.items.length > 1;
              /* Tooltipen listar hela klustret, en rad per tävling, med
                 prioritet och datum — det är den enda platsen det går att se
                 VAD en hopslagen markör innehåller. */
              const title = cluster.items
                .map(
                  (c) =>
                    `${PRIORITY_SHORT[c.priority]} ${shortDate(c.competition_date)} — ${c.name}${
                      c.venue ? ` (${SEASON_LABELS[c.venue]})` : ""
                    }`,
                )
                .join("\n");
              return (
                <div
                  key={cluster.key}
                  className="absolute flex -translate-x-1/2 flex-col items-center"
                  style={{ left: `${cluster.left}%` }}
                  title={title}
                >
                  <div className="flex items-center gap-0.5">
                    <div
                      className={`${compact ? "h-2 w-2" : "h-3 w-3"} rotate-45 ${PRIORITY_COLOR[cluster.priority]}`}
                    />
                    {many && (
                      <span
                        className={`${compact ? "text-[9px]" : "text-[10px]"} font-medium text-zinc-500 dark:text-zinc-400`}
                      >
                        {cluster.items.length}
                      </span>
                    )}
                  </div>
                  {!compact && (
                    <span className="mt-0.5 whitespace-nowrap text-[10px] text-zinc-500 dark:text-zinc-400">
                      {many
                        ? `${cluster.items.length} tävlingar`
                        : `${PRIORITY_SHORT[cluster.items[0].priority]} ${shortDate(cluster.items[0].competition_date)}`}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {!compact && (
        <SeasonTimelineLegend
          phases={[...new Set(sortedBlocks.map((b) => b.phase))]}
          hasCompetitions={competitions.length > 0}
        />
      )}
    </div>
  );
}
