import { formatDuration, formatHoursMinutes, formatKm, formatPace } from "@/lib/format";
import { ZONE_DESCRIPTIONS, ZONE_LABELS, zoneColorVar } from "@/lib/intensity";

/* Vad ett genomfört pass FAKTISKT innehöll — varvtider eller fart och puls.
 *
 * Ligger inuti dagens pass sedan 2026-09-16 (begärt), inte i en egen sektion.
 * Två rubriker för samma dag, "Dagens pass" och "Senaste passet", gjorde att
 * man fick läsa två ställen för att veta vad man gjort — och de kunde dessutom
 * visa olika dagar, eftersom den ena var låst till idag och den andra till
 * senaste passet oavsett när det var.
 *
 *
 * Datan har funnits i activity_splits hela tiden — 2 475 aktiva varv över 289
 * pass — och visades ingenstans i appen. För en medeldistanslöpare är
 * varvtiderna det mest intressanta som finns: ett intervallpass ÄR sina varv,
 * och "8,2 km på 41 min" säger ingenting om hur det gick.
 *
 * Bara `active`-varven. Vilorna finns också i tabellen, men de är inte det man
 * jämför — och att blanda in dem hade gjort det snabbaste varvet svårt att
 * hitta bland dubbelt så många staplar.
 *
 * Stapelns längd är TIDEN, inte prestationen, och skalan går från noll. Ett
 * kort varv är en kort stapel. Att i stället skala mot "bästa varvet = full
 * längd" hade förstorat skillnader på någon sekund till dramatiska hopp,
 * vilket är precis vad en 16-åring inte behöver läsa in i ett vardagspass.
 */

export type SplitRow = {
  splitIndex: number;
  distanceMeters: number | null;
  durationSeconds: number | null;
  /** Sträckan varvet räknas som, eller null när det inte är en riktig sträcka
   * utan bara hur långt man hann. Kommer från databasen, se migrationen
   * record_only_for_real_distances. */
  canonicalDistance: number | null;
};

/* Vilka varv som faktiskt ÄR repetitionerna, och vad de ska kallas.
 *
 * Ett Garmin-pass är inte en ren lista repetitioner. Ett verkligt pass såg ut
 * så här: tre kilometer uppvärmning, ett varv på 63 m, sex varv på exakt 181
 * sekunder, fem joggvilor på 90 sekunder — alla märkta "active" av klockan —
 * och sedan nedjogg. Att rita alla sjutton som likvärdiga staplar och kalla
 * dem "17 varv" säger inget om vad passet var.
 *
 * Regeln: hitta den största gruppen varv som hör ihop, och visa bara den.
 *
 *   TID först. Ligger flera varv på samma sekund är passet tidsbaserat —
 *   "6×3 min" — och distansen är ett utfall, inte ett mål. Det var precis den
 *   feltolkningen som rapporterades: appen påstod personbästa på 750 m när
 *   målet var tre minuter och tiden per definition inte kunde bli bättre.
 *
 *   DISTANS annars, och bara på en riktig sträcka (canonicalDistance från
 *   databasen). 757 m är ingen sträcka, det är hur långt man hann.
 *
 * Hittas ingen grupp visas alla varv och etiketten säger bara antalet — ett
 * ärligt "det här är vad klockan spelade in".
 */

/** Grupperar på ett värde med 2% tolerans och returnerar den största gruppen. */
function largestCluster(
  splits: SplitRow[],
  valueOf: (s: SplitRow) => number | null,
): SplitRow[] {
  let best: SplitRow[] = [];
  for (const anchor of splits) {
    const v = valueOf(anchor);
    if (v == null || v <= 0) continue;
    const group = splits.filter((s) => {
      const w = valueOf(s);
      return w != null && Math.abs(w - v) <= v * 0.02;
    });
    if (group.length > best.length) best = group;
  }
  return best;
}

function minutesLabel(seconds: number): string {
  const m = seconds / 60;
  // Hela minuter är det normala (3 min, 90 sek skrivs som 1,5 min).
  return Number.isInteger(Math.round(m * 10) / 10) && Math.abs(m - Math.round(m)) < 0.02
    ? `${Math.round(m)} min`
    : `${(Math.round(m * 10) / 10).toFixed(1).replace(".", ",")} min`;
}

function selectReps(splits: SplitRow[]): { reps: SplitRow[]; label: string } {
  const byTime = largestCluster(splits, (s) => s.durationSeconds);
  if (byTime.length >= 3) {
    const secs = byTime[0].durationSeconds as number;
    return { reps: byTime, label: `${byTime.length}×${minutesLabel(secs)}` };
  }

  const byDistance = largestCluster(splits, (s) => s.canonicalDistance ?? null);
  if (byDistance.length >= 2) {
    const d = byDistance[0].canonicalDistance as number;
    return {
      reps: byDistance,
      label:
        d >= 2000
          ? `${byDistance.length}×${(d / 1000).toFixed(1).replace(".", ",")} km`
          : `${byDistance.length}×${d} m`,
    };
  }

  return { reps: splits, label: `${splits.length} varv` };
}

/** Kategorier där varvtider ÄR innehållet. Allt annat beskrivs bättre av
 * fart, tid och puls. */
function latestCategoryIsInterval(category: string): boolean {
  return category === "interval";
}

/** Zonen passet faktiskt tillbringades i.
 *
 * Härledd ur klockans egna zontider, inte ur beräknade gränser: gränserna
 * finns inte lagrade i appen (profiles har max_hr och tröskelpuls, men inte
 * zonindelningen), och att räkna fram egna ur maxpuls hade kunnat motsäga de
 * tider Garmin redan rapporterat.
 *
 * Det svarar strikt på "var låg tyngdpunkten", inte "i vilken zon hamnar
 * medelpulsen" — för ett jämnt distanspass är det samma sak, och andelen
 * står utskriven så att man ser hur entydigt det är. */
function dominantZone(
  zoneSeconds: [number, number, number, number, number],
): { index: number; share: number } | null {
  const total = zoneSeconds.reduce((a, b) => a + b, 0);
  if (total <= 0) return null;
  let index = 0;
  for (let i = 1; i < 5; i++) if (zoneSeconds[i] > zoneSeconds[index]) index = i;
  return { index, share: zoneSeconds[index] / total };
}

/** Ett nyckeltal i sammanfattningen för ett distanspass. */
function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
        {label}
      </span>
      <span className="display tabular text-2xl leading-none font-bold text-[var(--foreground)]">
        {value}
      </span>
    </div>
  );
}

export function SessionDetail({
  splits,
  summary,
  category,
}: {
  splits: SplitRow[];
  /** Passet i helhet. Bär sektionen när det inte finns några repetitioner —
   * se motiveringen nedan. */
  summary: {
    distanceMeters: number;
    durationSeconds: number;
    avgHr: number | null;
    /** Sekunder i zon 1–5, från klockan. */
    zoneSeconds: [number, number, number, number, number];
  } | null;
  /** Passets kategori. AVGÖR vilken vy som visas — se nedan. */
  category: string;
}) {
  const all = splits.filter((s) => (s.durationSeconds ?? 0) > 0);

  /* KATEGORIN avgör, inte om det råkar finnas varv (rättat 2026-09-16).
   *
   * Ett distanspass har nästan alltid varv ändå: klockan tar ett autovarv per
   * kilometer. Den gamla regeln letade efter en grupp varv som hörde ihop,
   * hittade "10×1000 m" i ett lugnt niokilometerspass och ritade
   * kilometerstaplar — precis den vilseledande vyn som skulle bort.
   * Rapporterat på Daniels distanspass.
   *
   * Tröskelpass får gå på gruppregeln, för de är verkligen två olika saker:
   * ett löpande tempopass har inga repetitioner, "6×3 min" har det. */
  const repBased =
    latestCategoryIsInterval(category) ||
    (category === "threshold" && all.length >= 2 && !selectReps(all).label.endsWith("varv"));

  const found = repBased && all.length >= 2 ? selectReps(all) : null;

  /* Ett DISTANSPASS har inga repetitioner, och varvtider säger inget om det.
   *
   * Det man vill veta efter ett lugnt eller långt pass är farten och pulsen —
   * inte hur lång tid varje kilometer tog. Kilometerstaplar för ett
   * distanspass är dessutom aktivt vilseledande: de ser ut som repetitioner
   * och inbjuder till att jämföra varv som aldrig var tänkta att jämföras.
   * Rapporterat.
   *
   * Sektionen byter därför innehåll efter vad passet var, inte efter vilken
   * data som råkar finnas. */
  if (!found) {
    if (!summary || summary.distanceMeters <= 0 || summary.durationSeconds <= 0) return null;
    const paceSeconds = summary.durationSeconds / (summary.distanceMeters / 1000);
    const zone = dominantZone(summary.zoneSeconds);
    return (
      <div className="flex flex-wrap gap-x-8 gap-y-4">
        <Metric label="Distans" value={formatKm(summary.distanceMeters)} />
        <Metric label="Fart" value={formatPace(paceSeconds)} />
        <Metric label="Tid" value={formatHoursMinutes(summary.durationSeconds)} />
        {summary.avgHr != null && <Metric label="Medelpuls" value={`${summary.avgHr}`} />}
        {/* Zonen bredvid pulsen: 144 slag säger inget utan att man vet vad
            det är för den här löparen. Punkten bär zonens egen färg, samma
            som i diagrammen på /trender. */}
        {zone && (
          <div className="flex flex-col gap-0.5">
            <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
              Pulszon
            </span>
            <span className="display flex items-center gap-1.5 text-2xl leading-none font-bold text-[var(--foreground)]">
              <span
                aria-hidden
                className="inline-block h-3 w-3 shrink-0 rounded-sm"
                style={{ backgroundColor: zoneColorVar(zone.index) }}
              />
              {ZONE_LABELS[zone.index]}
            </span>
            <span className="text-xs text-[var(--ink-3)]">
              {ZONE_DESCRIPTIONS[zone.index]} · {Math.round(zone.share * 100)}% av tiden
            </span>
          </div>
        )}
      </div>
    );
  }

  const { reps: timed, label: repsText } = found;
  const max = Math.max(...timed.map((s) => s.durationSeconds as number));
  const fastest = Math.min(...timed.map((s) => s.durationSeconds as number));

  return (
    <div className="flex flex-col gap-2">
      <div className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
        {repsText}
      </div>

      {timed.map((s) => {
        const secs = s.durationSeconds as number;
        const best = secs === fastest;
        return (
          <div key={s.splitIndex} className="flex items-center gap-2">
            {/* Garmin numrerar varven från noll, och numret räknas dessutom
                över HELA passet — uppvärmning och vilor inräknade. Här räknas
                det inom de varv som faktiskt visas, så första repetitionen
                heter 1. */}
            <span className="tabular w-5 shrink-0 text-xs text-[var(--ink-3)]">
              {timed.indexOf(s) + 1}
            </span>
            {/* Stapeln ligger i ett EGET spår som får resten av bredden.
                Procenten räknades först direkt på stapeln, som då satt i samma
                flexrad som varvnumret och tiden — 100% av raden PLUS två
                textkolumner blev bredare än kortet, och staplarna gick
                utanför. */}
            <span className="flex h-2.5 min-w-0 flex-1 overflow-hidden rounded-sm bg-[var(--surface-raised)]">
              <span
                className="h-full rounded-sm"
                style={{
                  // Minst 6% så att även det snabbaste varvet syns som en
                  // stapel och inte som ett streck.
                  width: `${Math.max(6, (secs / max) * 100)}%`,
                  backgroundColor: best ? "var(--status-watch)" : "var(--cat-interval)",
                }}
              />
            </span>
            <span
              className={`tabular w-12 shrink-0 text-right text-xs ${
                best ? "font-semibold text-[var(--status-watch-ink)]" : "text-[var(--ink-2)]"
              }`}
            >
              {formatDuration(secs)}
            </span>
          </div>
        );
      })}
    </div>
  );
}
