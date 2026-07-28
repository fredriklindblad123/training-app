"use client";

import { useMemo, useState } from "react";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  categoryColorVar,
  type ActivityCategory,
} from "@/lib/categories";
import { formatMetricValue, type MetricFormatKind } from "@/lib/format";
import {
  baselineDeviation,
  niceCeil,
  rollingBaseline,
  type Baseline,
} from "@/lib/stats-utils";

/* ------------------------------------------------------------------------ *
 * ComboChart — "Belastning vs återhämtning" (P1.1 i docs/insikter-roadmap.md)
 *
 * Ren SVG, inga diagrambibliotek, samma mönster som LineChart/BarChart.
 *
 * ── Designval 1: två paneler, inte två y-axlar ovanpå varandra ────────────
 * Kravet är "belastning + återhämtning i en vy". Den naiva lösningen är att
 * lägga linjerna ovanpå staplarna med en egen höger-axel, men då bestäms
 * kurvornas inbördes läge av hur man råkar skala axlarna — grafen kan få
 * vilken korrelation som helst att se ut som ett samband. Roadmapen varnar
 * uttryckligen för det ("dubbla y-axlar är visuellt vilseledande om de skalas
 * godtyckligt").
 *
 * Därför delas plotytan i två band som delar x-axel: staplarna överst med
 * sin egen nollförankrade axel till vänster, återhämtningslinjerna under med
 * sin egen axel till höger. Samma tidslinje, samma hover, samma detaljpanel —
 * men ingen påhittad överlagring. Det är fortfarande "en sekundär y-axel",
 * den ligger bara i sitt eget band i stället för ovanpå staplarna.
 *
 * ── Designval 2: återhämtningsaxeln är förankrad i baslinjen ──────────────
 * Sekundäraxeln visar inte råvärden utan **avvikelse i SD-enheter mot varje
 * series egen personliga baslinje** (2.4: "visa aldrig ett rått HRV-tal som
 * en bedömning"). Det ger tre saker på köpet:
 *
 *   1. Axeln kan inte skalas godtyckligt. 0 = din baslinje, ±1 = kanten på
 *      ditt normalintervall. Nollan sitter alltid mitt i bandet, oavsett data.
 *   2. Flera markörer med helt olika enheter (ms, slag/min, timmar, RPE) får
 *      dela axel utan att man jämför äpplen och päron — det är precis den
 *      "index to a common base"-lösning som dataviz-riktlinjerna föreskriver
 *      i stället för dubbla axlar.
 *   3. Baslinjebandet blir **ett enda** band vid ±1 SD som gäller alla
 *      serier samtidigt, i stället för N överlappande tvättar som grumlar
 *      ytan. Bandet är sant per definition av axeln.
 *
 * Råvärdena försvinner inte: de visas i detaljpanelen och i tabellvyn med
 * respektive `formatKind`. Plotten visar avvikelsen, siffrorna visar nivån.
 *
 * Geometrin vänds aldrig efter "bra/dåligt" — en stigande vilopuls ritas
 * uppåt även om det är en försämring. `higherIsBetter` styr bara ordval i
 * text. Att tyst spegla en serie gör grafen omöjlig att lita på.
 * ------------------------------------------------------------------------ */

/** En tidsperiod på x-axeln — normalt en vecka, men komponenten bryr sig inte. */
export type ComboPeriod = {
  /** Stabil nyckel, t.ex. måndagsdatum "2026-07-20". Används av `ComboEvent`. */
  key: string;
  /** Kort etikett på axeln, t.ex. "V.30". */
  label: string;
  /** Längre etikett i detaljpanel/tabell, t.ex. "Vecka 30, 20–26 juli". */
  fullLabel?: string;
  /** Dagbokens egna ord för perioden. Kopplingen siffra ↔ text är hela poängen. */
  note?: string | null;
};

/** Belastning per kategori för en period. Index-parallell med `periods`. */
export type ComboLoadStack = Partial<Record<ActivityCategory, number>>;

/**
 * Hur en series personliga baslinje bestäms.
 * - `rolling`: bakåtblickande fönster, centrum = median, spridning = SD.
 *   Positioner utan tillräckligt underlag får ingen punkt alls (se nedan).
 * - `fixed`: baslinjen är redan uträknad på annat håll (t.ex. över 60 dagars
 *   daglig data i stället för över veckoaggregaten som ritas här).
 */
export type ComboBaselineSpec =
  | { kind: "rolling"; window?: number; minPoints?: number }
  | { kind: "fixed"; center: number; sd: number };

/**
 * En återhämtnings-/formserie = ett växlingsbart lager.
 *
 * Almgrens fyra mätvärden (2.3: fart, laktat, puls, känsla) modelleras som
 * fyra `ComboSeries`. Sidan bestämmer vilka lager som finns och vilka som är
 * tända från start; komponenten håller antalet samtidigt tända nere
 * (`maxVisibleSeries`) eftersom fyra kurvor samtidigt blir oläsligt.
 */
export type ComboSeries = {
  /** Stabil identitet. Stil/markör följer serien, inte dess plats i urvalet. */
  id: string;
  label: string;
  /** Råvärden, index-parallella med `periods`. `null` = lucka, aldrig 0. */
  values: (number | null)[];
  /** Format för råvärdet i panel och tabell. */
  formatKind: MetricFormatKind;
  /** Default: rullande 8 perioder, minst 4 mätvärden. */
  baseline?: ComboBaselineSpec;
  /** Tänd från start. Deklarerar ingen serie detta tänds de två första. */
  defaultVisible?: boolean;
  /** Styr bara formuleringen ("över/under ditt normala"), aldrig geometrin. */
  higherIsBetter?: boolean;
  /** Frivillig egen färg. Utan den ritas serien i bläck (se KOMMENTAR om färg). */
  color?: string;
};

export type ComboEventKind = "sick" | "injured" | "race";

/** Händelsemarkör på tidsaxeln. `periodKey` matchar `ComboPeriod.key`. */
export type ComboEvent = {
  periodKey: string;
  kind: ComboEventKind;
  /** Kort beskrivning, t.ex. "Sjuk 3 dagar" eller "1500 m, Sollentuna". */
  label: string;
};

export type ComboChartProps = {
  periods: ComboPeriod[];
  /** Stackad belastning per period. Kortare array än `periods` tolkas som tomma perioder. */
  load: ComboLoadStack[];
  /** Begränsa vilka kategorier som ritas. Ritordningen är alltid CATEGORY_VALUES. */
  categories?: readonly ActivityCategory[];
  series?: ComboSeries[];
  events?: ComboEvent[];
  /** Rubrik för vänsteraxeln. */
  loadLabel?: string;
  loadFormatKind?: MetricFormatKind;
  /** Max antal samtidigt tända lager. Fler än 3 blir oläsligt. */
  maxVisibleSeries?: number;
  /** Höjd i SVG-enheter (viewBox skalas responsivt till containerbredden). */
  height?: number;
  emptyLabel?: string;
  ariaLabel?: string;
};

/* ---------------------------------- layout -------------------------------- */

const WIDTH = 800;
const PAD_TOP = 10;
const PAD_LEFT = 46;
const PAD_RIGHT = 46;
const X_AXIS_H = 20;
const EVENT_RAIL_H = 22;
const PANEL_GAP = 20;
/** Ytgap mellan stackade segment — vitt utrymme separerar, aldrig en kantlinje. */
const STACK_GAP = 2;
const MAX_BAR_WIDTH = 24;
const LOAD_PANEL_SHARE = 0.56;

/* ---------------------------------- stilar -------------------------------- */

/**
 * KOMMENTAR om färg: staplarna äger hela den kategoriska 8-färgspaletten
 * (CATEGORY_COLORS är CVD-validerad och ordningen får inte röras). Att ge
 * linjerna hues ur samma palett skulle betyda att "HRV-blå" och "lugn
 * distans-blå" står i samma legend — identiteten blir tvetydig. Linjerna
 * ritas därför i bläck och får sin identitet av **streckmönster + markörform**
 * (två kanaler som överlever både färgblindhet och gråskaleutskrift), med
 * legend som alltid är utskriven. Sidan kan sätta `color` per serie om den
 * vill, men default är avsiktligt färglöst.
 */
const SERIES_STYLES = [
  { dash: undefined, marker: "circle", strong: true },
  { dash: "8 4", marker: "square", strong: true },
  { dash: "1.5 4", marker: "diamond", strong: false },
  { dash: "10 3 2 3", marker: "triangle", strong: false },
] as const;

type SeriesStyle = (typeof SERIES_STYLES)[number];

const STRONG_INK = {
  stroke: "stroke-zinc-900 dark:stroke-zinc-100",
  fill: "fill-zinc-900 dark:fill-zinc-100",
};
const SOFT_INK = {
  stroke: "stroke-zinc-500 dark:stroke-zinc-400",
  fill: "fill-zinc-500 dark:fill-zinc-400",
};

/** Statusfärger (fast palett, aldrig tematiserad) + kategorifärg för tävling,
 * så att tävlingsmarkören och tävlingsstapeln är samma entitet i samma färg. */
const EVENT_STYLES: Record<ComboEventKind, { color: string; label: string }> = {
  sick: { color: "#fab219", label: "Sjuk" },
  injured: { color: "#d03b3b", label: "Skadad" },
  race: { color: categoryColorVar("race"), label: "Tävling" },
};

/* --------------------------------- hjälpare ------------------------------- */

/** Stapelväg med rundad överkant och rak fot (data-end rundas, baslinjen inte). */
function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return (
    `M ${x} ${y + h} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} ` +
    `L ${x + w - rr} ${y} Q ${x + w} ${y} ${x + w} ${y + rr} L ${x + w} ${y + h} Z`
  );
}

/** "+0.8" / "-1.2" — tecknet är hela informationen på en avvikelseskala. */
function formatSigned(value: number, decimals = 1): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(decimals)}`;
}

function markerPath(shape: SeriesStyle["marker"], cx: number, cy: number, r: number): string {
  switch (shape) {
    case "square":
      return `M ${cx - r} ${cy - r} H ${cx + r} V ${cy + r} H ${cx - r} Z`;
    case "diamond":
      return `M ${cx} ${cy - r * 1.3} L ${cx + r * 1.3} ${cy} L ${cx} ${cy + r * 1.3} L ${cx - r * 1.3} ${cy} Z`;
    case "triangle":
      return `M ${cx} ${cy - r * 1.25} L ${cx + r * 1.2} ${cy + r} L ${cx - r * 1.2} ${cy + r} Z`;
    default: {
      // Cirkel som path, så alla markörer kan renderas av samma element.
      return (
        `M ${cx - r} ${cy} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`
      );
    }
  }
}

function baselinesFor(serie: ComboSeries): (Baseline | null)[] {
  const spec = serie.baseline ?? { kind: "rolling" as const };
  if (spec.kind === "fixed") {
    const fixed: Baseline = { center: spec.center, sd: spec.sd, n: serie.values.length };
    return serie.values.map(() => (spec.sd > 0 ? fixed : null));
  }
  return rollingBaseline(serie.values, { window: spec.window, minPoints: spec.minPoints });
}

function initialVisible(series: ComboSeries[], max: number): string[] {
  const explicit = series.filter((s) => s.defaultVisible).map((s) => s.id);
  if (explicit.length > 0) return explicit.slice(0, max);
  return series.slice(0, Math.min(2, max)).map((s) => s.id);
}

/* -------------------------------- komponent ------------------------------- */

export function ComboChart({
  periods,
  load,
  categories,
  series = [],
  events = [],
  loadLabel = "Träningsbelastning",
  loadFormatKind = "decimal0",
  maxVisibleSeries = 3,
  height = 340,
  emptyLabel = "Ingen data i perioden.",
  ariaLabel = "Belastning och återhämtning över tid",
}: ComboChartProps) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [visibleIds, setVisibleIds] = useState<string[]>(() =>
    initialVisible(series, maxVisibleSeries),
  );

  /** Lagerväxling: vid taket släcks det äldst tända (FIFO) i stället för att
   * knappen slutar svara — annars måste man alltid släcka innan man tänder. */
  const toggleSeries = (id: string) => {
    setVisibleIds((current) => {
      if (current.includes(id)) return current.filter((x) => x !== id);
      const next = [...current, id];
      return next.length > maxVisibleSeries ? next.slice(next.length - maxVisibleSeries) : next;
    });
  };

  const allowed = useMemo(
    () => new Set<ActivityCategory>(categories ?? CATEGORY_VALUES),
    [categories],
  );

  /** Kategorier med faktisk belastning, alltid i CATEGORY_VALUES ordning.
   * Slot-ordningen är CVD-mekanismen och får inte sorteras om efter storlek. */
  const presentCategories = useMemo(() => {
    const totals = new Map<ActivityCategory, number>();
    for (const stack of load) {
      for (const category of CATEGORY_VALUES) {
        const v = stack?.[category];
        if (v) totals.set(category, (totals.get(category) ?? 0) + v);
      }
    }
    return CATEGORY_VALUES.filter((c) => allowed.has(c) && (totals.get(c) ?? 0) > 0);
  }, [load, allowed]);

  const totals = useMemo(
    () =>
      periods.map((_, i) =>
        presentCategories.reduce((sum, c) => sum + (load[i]?.[c] ?? 0), 0),
      ),
    [periods, load, presentCategories],
  );

  /** Serier med baslinje + avvikelse uträknad. Stilindex följer seriens plats i
   * `series` (entiteten), inte i urvalet — att släcka ett lager får aldrig
   * måla om de som är kvar. */
  const resolved = useMemo(
    () =>
      series.map((serie, index) => {
        const baselines = baselinesFor(serie);
        return {
          serie,
          baselines,
          deviations: serie.values.map((v, i) => baselineDeviation(v, baselines[i])),
          style: SERIES_STYLES[index % SERIES_STYLES.length],
        };
      }),
    [series],
  );

  const visible = useMemo(
    () => resolved.filter((r) => visibleIds.includes(r.serie.id)),
    [resolved, visibleIds],
  );

  const eventsByPeriod = useMemo(() => {
    const map = new Map<string, ComboEvent[]>();
    for (const event of events) {
      const list = map.get(event.periodKey);
      if (list) list.push(event);
      else map.set(event.periodKey, [event]);
    }
    return map;
  }, [events]);

  if (periods.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>;
  }

  /* ----------------------------- skalor & geometri ------------------------ */

  const hasRecovery = visible.length > 0;
  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const bodyHeight = height - PAD_TOP - X_AXIS_H - EVENT_RAIL_H;
  const loadHeight = hasRecovery
    ? Math.round((bodyHeight - PANEL_GAP) * LOAD_PANEL_SHARE)
    : bodyHeight;
  const recoveryHeight = hasRecovery ? bodyHeight - PANEL_GAP - loadHeight : 0;

  const loadTop = PAD_TOP;
  const loadBottom = loadTop + loadHeight;
  const recoveryTop = loadBottom + PANEL_GAP;
  const recoveryBottom = recoveryTop + recoveryHeight;
  const recoveryMid = recoveryTop + recoveryHeight / 2;
  const plotBottom = hasRecovery ? recoveryBottom : loadBottom;
  const eventY = plotBottom + EVENT_RAIL_H / 2;

  const step = plotWidth / periods.length;
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(3, step - 6));
  const xCenter = (i: number) => PAD_LEFT + (i + 0.5) * step;

  const loadMax = niceCeil(Math.max(0, ...totals));
  const yLoad = (v: number) => loadBottom - (v / loadMax) * loadHeight;

  /** Symmetrisk domän kring baslinjen. Nollan sitter alltid mitt i bandet;
   * bara ytterkanterna växer om någon vecka sticker ut mer än ±2.5 SD. */
  const maxAbsDeviation = Math.max(
    0,
    ...visible.flatMap((r) => r.deviations.map((d) => (d == null ? 0 : Math.abs(d)))),
  );
  const deviationMax = Math.max(2.5, Math.ceil(maxAbsDeviation * 2) / 2);
  const yDeviation = (z: number) => recoveryMid - (z / deviationMax) * (recoveryHeight / 2);

  const labelStep = Math.max(1, Math.ceil(periods.length / 12));
  const loadTicks = 4;

  /* --------------------------------- render ------------------------------- */

  const formatLoad = (v: number) => formatMetricValue(loadFormatKind, v);

  const hoveredPeriod = hovered != null ? periods[hovered] : null;
  const hoveredEvents = hoveredPeriod ? (eventsByPeriod.get(hoveredPeriod.key) ?? []) : [];

  return (
    <div className="flex w-full max-w-full flex-col gap-3">
      {/* Lagerväljare. Ligger ovanför diagrammet, inte inuti plotytan. */}
      {series.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {resolved.map(({ serie, style }) => {
            const isOn = visibleIds.includes(serie.id);
            const ink = style.strong ? STRONG_INK : SOFT_INK;
            return (
              <button
                key={serie.id}
                type="button"
                aria-pressed={isOn}
                onClick={() => toggleSeries(serie.id)}
                className={`inline-flex items-center gap-1.5 rounded border px-2 py-1 text-xs transition-colors ${
                  isOn
                    ? "border-zinc-400 text-zinc-900 dark:border-zinc-500 dark:text-zinc-50"
                    : "border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600"
                }`}
              >
                {/* Legendnyckeln speglar märket: en linje med samma streckmönster. */}
                <svg width={22} height={10} aria-hidden="true" className="shrink-0">
                  <line
                    x1={1}
                    y1={5}
                    x2={21}
                    y2={5}
                    strokeWidth={2}
                    strokeDasharray={style.dash}
                    strokeLinecap="round"
                    className={isOn ? ink.stroke : "stroke-zinc-300 dark:stroke-zinc-700"}
                    style={isOn && serie.color ? { stroke: serie.color } : undefined}
                  />
                  <path
                    d={markerPath(style.marker, 11, 5, 3)}
                    className={isOn ? ink.fill : "fill-zinc-300 dark:fill-zinc-700"}
                    style={isOn && serie.color ? { fill: serie.color } : undefined}
                  />
                </svg>
                {serie.label}
              </button>
            );
          })}
          <span className="text-xs text-zinc-500 dark:text-zinc-400">
            max {maxVisibleSeries} lager samtidigt
          </span>
        </div>
      )}

      <svg
        viewBox={`0 0 ${WIDTH} ${height}`}
        className="h-auto w-full"
        role="img"
        aria-label={ariaLabel}
        onPointerLeave={() => setHovered(null)}
      >
        {/* --- vänster axel: belastning, alltid nollförankrad --- */}
        {Array.from({ length: loadTicks + 1 }, (_, i) => {
          const v = (loadMax / loadTicks) * i;
          const y = yLoad(v);
          return (
            <g key={`load-tick-${i}`}>
              <line
                x1={PAD_LEFT}
                x2={WIDTH - PAD_RIGHT}
                y1={y}
                y2={y}
                className="stroke-zinc-200 dark:stroke-zinc-800"
                strokeWidth={1}
              />
              <text
                x={PAD_LEFT - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-zinc-500 tabular-nums dark:fill-zinc-400"
                style={{ fontSize: 10 }}
              >
                {Math.round(v)}
              </text>
            </g>
          );
        })}
        <text
          x={PAD_LEFT}
          y={loadTop - 1}
          className="fill-zinc-500 dark:fill-zinc-400"
          style={{ fontSize: 10 }}
        >
          {loadLabel}
        </text>

        {/* --- markörperioder: svag lodrät hårlinje så avbrotten syns i sammanhang --- */}
        {periods.map((period, i) =>
          eventsByPeriod.has(period.key) ? (
            <line
              key={`event-rule-${period.key}`}
              x1={xCenter(i)}
              x2={xCenter(i)}
              y1={loadTop}
              y2={plotBottom}
              className="stroke-zinc-200 dark:stroke-zinc-800"
              strokeWidth={1}
            />
          ) : null,
        )}

        {/* --- stackade staplar --- */}
        {periods.map((period, i) => {
          const stack = load[i] ?? {};
          const segments = presentCategories
            .map((category) => ({ category, value: stack[category] ?? 0 }))
            .filter((s) => s.value > 0);
          let cumulative = 0;
          const x = xCenter(i) - barWidth / 2;
          return (
            <g key={`bar-${period.key}`}>
              {segments.map((segment, segmentIndex) => {
                const yTop = yLoad(cumulative + segment.value);
                const yBottom = yLoad(cumulative);
                cumulative += segment.value;
                const isBottom = segmentIndex === 0;
                const isTop = segmentIndex === segments.length - 1;
                const rawHeight = yBottom - yTop;
                // Gapet tas ur segmentets underkant, utom längst ned där
                // stapeln ska sitta på nollinjen.
                const h = rawHeight - (isBottom ? 0 : STACK_GAP);
                if (h <= 0.5) return null;
                const d = isTop
                  ? topRoundedRect(x, yTop, barWidth, h, 4)
                  : topRoundedRect(x, yTop, barWidth, h, 0);
                return (
                  <path
                    key={segment.category}
                    d={d}
                    style={{
                      fill: categoryColorVar(segment.category),
                      opacity: hovered == null || hovered === i ? 1 : 0.55,
                      transition: "opacity 120ms",
                    }}
                  >
                    <title>{`${period.fullLabel ?? period.label} — ${CATEGORY_LABELS[segment.category]}: ${formatLoad(segment.value)}`}</title>
                  </path>
                );
              })}
            </g>
          );
        })}

        {/* --- höger axel: avvikelse mot baslinjen --- */}
        {hasRecovery && (
          <g>
            {/* Normalintervallet ±1 SD. Ett band för alla serier — det är sant
                per definition när axeln mäts i SD-enheter. */}
            <rect
              x={PAD_LEFT}
              y={yDeviation(1)}
              width={plotWidth}
              height={yDeviation(-1) - yDeviation(1)}
              className="fill-zinc-400 dark:fill-zinc-500"
              opacity={0.14}
            />
            <line
              x1={PAD_LEFT}
              x2={WIDTH - PAD_RIGHT}
              y1={yDeviation(0)}
              y2={yDeviation(0)}
              className="stroke-zinc-300 dark:stroke-zinc-700"
              strokeWidth={1}
            />
            {[1, 0, -1].map((z) => (
              <text
                key={`dev-tick-${z}`}
                x={WIDTH - PAD_RIGHT + 6}
                y={yDeviation(z)}
                dominantBaseline="middle"
                className="fill-zinc-500 tabular-nums dark:fill-zinc-400"
                style={{ fontSize: 10 }}
              >
                {z === 0 ? "0" : formatSigned(z, 0)}
              </text>
            ))}
            <text
              x={PAD_LEFT}
              y={recoveryTop - 4}
              className="fill-zinc-500 dark:fill-zinc-400"
              style={{ fontSize: 10 }}
            >
              Avvikelse mot baslinje (SD)
            </text>
          </g>
        )}

        {/* --- hover-hårkors över båda panelerna --- */}
        {hovered != null && (
          <line
            x1={xCenter(hovered)}
            x2={xCenter(hovered)}
            y1={loadTop}
            y2={plotBottom}
            className="stroke-zinc-400 dark:stroke-zinc-500"
            strokeWidth={1}
          />
        )}

        {/* --- återhämtningslinjer --- */}
        {visible.map(({ serie, deviations, style }) => {
          const ink = style.strong ? STRONG_INK : SOFT_INK;
          let d = "";
          let penDown = false;
          deviations.forEach((z, i) => {
            if (z == null) {
              // Luckor interpoleras aldrig: pennan lyfts och linjen bryts.
              penDown = false;
              return;
            }
            d += `${penDown ? "L" : "M"} ${xCenter(i)} ${yDeviation(z)} `;
            penDown = true;
          });

          // Markörer sätts sparsamt: sista punkten, hovrad punkt, och
          // isolerade punkter (som annars vore osynliga i en bruten linje).
          const lastIndex = deviations.reduce((acc, z, i) => (z != null ? i : acc), -1);
          const markerIndices = deviations
            .map((z, i) => {
              if (z == null) return -1;
              const isolated = deviations[i - 1] == null && deviations[i + 1] == null;
              if (isolated || i === lastIndex || i === hovered) return i;
              return -1;
            })
            .filter((i) => i >= 0);

          return (
            <g key={serie.id}>
              <path
                d={d}
                fill="none"
                strokeWidth={2}
                strokeDasharray={style.dash}
                strokeLinecap="round"
                strokeLinejoin="round"
                className={serie.color ? undefined : ink.stroke}
                style={serie.color ? { stroke: serie.color } : undefined}
              />
              {markerIndices.map((i) => (
                <path
                  key={`${serie.id}-marker-${i}`}
                  d={markerPath(style.marker, xCenter(i), yDeviation(deviations[i] as number), 4)}
                  className={`${serie.color ? "" : ink.fill} stroke-white dark:stroke-zinc-950`}
                  strokeWidth={2}
                  paintOrder="stroke"
                  style={serie.color ? { fill: serie.color } : undefined}
                >
                  <title>{`${periods[i].fullLabel ?? periods[i].label} — ${serie.label}: ${formatMetricValue(serie.formatKind, serie.values[i] as number)} (${formatSigned(deviations[i] as number)} SD)`}</title>
                </path>
              ))}
            </g>
          );
        })}

        {/* --- händelsemarkörer på tidsaxeln --- */}
        {periods.map((period, i) => {
          const periodEvents = eventsByPeriod.get(period.key);
          if (!periodEvents || periodEvents.length === 0) return null;
          const shown = periodEvents.slice(0, 3);
          const spread = 9;
          const startX = xCenter(i) - ((shown.length - 1) * spread) / 2;
          return (
            <g key={`events-${period.key}`}>
              {shown.map((event, j) => {
                const cx = startX + j * spread;
                return (
                  <path
                    key={`${event.kind}-${j}`}
                    d={`M ${cx} ${eventY - 5} L ${cx + 5} ${eventY + 4} L ${cx - 5} ${eventY + 4} Z`}
                    style={{ fill: EVENT_STYLES[event.kind].color }}
                    className="stroke-white dark:stroke-zinc-950"
                    strokeWidth={1.5}
                    paintOrder="stroke"
                  >
                    <title>{`${EVENT_STYLES[event.kind].label}: ${event.label} (${period.fullLabel ?? period.label})`}</title>
                  </path>
                );
              })}
            </g>
          );
        })}

        {/* --- x-axeletiketter --- */}
        {periods.map((period, i) =>
          i % labelStep === 0 ? (
            <text
              key={`x-${period.key}`}
              x={xCenter(i)}
              y={height - 5}
              textAnchor="middle"
              className="fill-zinc-500 dark:fill-zinc-400"
              style={{ fontSize: 10 }}
            >
              {period.label}
            </text>
          ) : null,
        )}

        {/* --- hit-ytor sist, så de ligger överst. En per period, full höjd:
                man siktar på en vecka, aldrig på en 2px linje. --- */}
        {periods.map((period, i) => (
          <rect
            key={`hit-${period.key}`}
            x={PAD_LEFT + i * step}
            y={loadTop}
            width={step}
            height={plotBottom - loadTop + EVENT_RAIL_H}
            fill="transparent"
            tabIndex={0}
            onPointerEnter={() => setHovered(i)}
            onPointerMove={() => setHovered(i)}
            onFocus={() => setHovered(i)}
            onBlur={() => setHovered(null)}
            style={{ cursor: "pointer", outline: "none" }}
          />
        ))}
      </svg>

      {/* --- legend för staplarna: identitet får aldrig vila på färg ensam --- */}
      {presentCategories.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
          {presentCategories.map((category) => (
            <span key={category} className="inline-flex items-center gap-1.5">
              <span
                className="h-2.5 w-2.5 shrink-0 rounded-sm"
                style={{ backgroundColor: categoryColorVar(category) }}
              />
              {CATEGORY_LABELS[category]}
            </span>
          ))}
          {events.length > 0 &&
            (Object.keys(EVENT_STYLES) as ComboEventKind[])
              .filter((kind) => events.some((e) => e.kind === kind))
              .map((kind) => (
                <span key={kind} className="inline-flex items-center gap-1.5">
                  <svg width={10} height={10} aria-hidden="true" className="shrink-0">
                    <path d="M 5 1 L 9.5 9 L 0.5 9 Z" style={{ fill: EVENT_STYLES[kind].color }} />
                  </svg>
                  {EVENT_STYLES[kind].label}
                </span>
              ))}
        </div>
      )}

      {/* --- detaljpanel: veckans siffror, förändring mot föregående vecka,
              och dagbokens egna ord --- */}
      {hoveredPeriod && hovered != null && (
        <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {hoveredPeriod.fullLabel ?? hoveredPeriod.label}
          </div>

          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-zinc-500 dark:text-zinc-400">{loadLabel}</span>
            <span className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
              {formatLoad(totals[hovered])}
            </span>
            {hovered > 0 && (
              <span className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                ({formatSigned(totals[hovered] - totals[hovered - 1], 0)} mot föregående)
              </span>
            )}
          </div>

          {presentCategories.some((c) => (load[hovered]?.[c] ?? 0) > 0) && (
            <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
              {presentCategories
                .filter((c) => (load[hovered]?.[c] ?? 0) > 0)
                .map((c) => (
                  <span key={c} className="inline-flex items-center gap-1.5">
                    <span
                      className="h-2 w-2 shrink-0 rounded-sm"
                      style={{ backgroundColor: categoryColorVar(c) }}
                    />
                    {CATEGORY_LABELS[c]} {formatLoad(load[hovered]?.[c] ?? 0)}
                  </span>
                ))}
            </div>
          )}

          {visible.length > 0 && (
            <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2">
              {visible.map(({ serie, deviations }) => {
                const raw = serie.values[hovered];
                const dev = deviations[hovered];
                return (
                  <div key={serie.id} className="flex flex-wrap items-baseline gap-x-2">
                    <dt className="text-zinc-500 dark:text-zinc-400">{serie.label}</dt>
                    <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                      {raw != null ? formatMetricValue(serie.formatKind, raw) : "–"}
                    </dd>
                    <dd className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                      {dev != null
                        ? `${formatSigned(dev)} SD${Math.abs(dev) > 1 ? " — utanför ditt normala" : ""}`
                        : "baslinje saknas"}
                    </dd>
                  </div>
                );
              })}
            </dl>
          )}

          {hoveredEvents.length > 0 && (
            <ul className="flex flex-col gap-1 text-xs">
              {hoveredEvents.map((event, i) => (
                <li key={i} className="inline-flex items-center gap-1.5">
                  <svg width={10} height={10} aria-hidden="true" className="shrink-0">
                    <path
                      d="M 5 1 L 9.5 9 L 0.5 9 Z"
                      style={{ fill: EVENT_STYLES[event.kind].color }}
                    />
                  </svg>
                  <span className="text-zinc-700 dark:text-zinc-300">
                    {EVENT_STYLES[event.kind].label}: {event.label}
                  </span>
                </li>
              ))}
            </ul>
          )}

          {hoveredPeriod.note && (
            <p className="border-l-2 border-zinc-200 pl-3 text-sm text-zinc-600 italic dark:border-zinc-700 dark:text-zinc-400">
              {hoveredPeriod.note}
            </p>
          )}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowTable((v) => !v)}
        className="w-fit text-xs text-zinc-500 underline hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
      >
        {showTable ? "Dölj tabell" : "Visa som tabell"}
      </button>

      {/* Tabellvyn är a11y-tvillingen. Den scrollar i sin egen box så att
          sidan aldrig får horisontell scroll på mobil. */}
      {showTable && (
        <div className="w-full max-w-full overflow-x-auto">
          <table className="w-full min-w-max text-left text-sm">
            <thead>
              <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                <th scope="col" className="py-1 pr-4 font-normal">
                  Period
                </th>
                {presentCategories.map((c) => (
                  <th key={c} scope="col" className="py-1 pr-4 font-normal">
                    {CATEGORY_LABELS[c]}
                  </th>
                ))}
                <th scope="col" className="py-1 pr-4 font-normal">
                  Totalt
                </th>
                {visible.map(({ serie }) => (
                  <th key={serie.id} scope="col" className="py-1 pr-4 font-normal">
                    {serie.label}
                  </th>
                ))}
                <th scope="col" className="py-1 font-normal">
                  Händelser
                </th>
              </tr>
            </thead>
            <tbody>
              {periods.map((period, i) => (
                <tr key={period.key} className="border-t border-zinc-100 dark:border-zinc-800">
                  <th scope="row" className="py-1 pr-4 font-normal">
                    {period.fullLabel ?? period.label}
                  </th>
                  {presentCategories.map((c) => (
                    <td key={c} className="py-1 pr-4 tabular-nums">
                      {load[i]?.[c] ? formatLoad(load[i][c] as number) : "–"}
                    </td>
                  ))}
                  <td className="py-1 pr-4 tabular-nums">{formatLoad(totals[i])}</td>
                  {visible.map(({ serie, deviations }) => {
                    const raw = serie.values[i];
                    const dev = deviations[i];
                    return (
                      <td key={serie.id} className="py-1 pr-4 tabular-nums">
                        {raw != null ? formatMetricValue(serie.formatKind, raw) : "–"}
                        {dev != null && (
                          <span className="text-zinc-500 dark:text-zinc-400">
                            {" "}
                            ({formatSigned(dev)} SD)
                          </span>
                        )}
                      </td>
                    );
                  })}
                  <td className="py-1">
                    {(eventsByPeriod.get(period.key) ?? [])
                      .map((e) => `${EVENT_STYLES[e.kind].label}: ${e.label}`)
                      .join(", ") || "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
