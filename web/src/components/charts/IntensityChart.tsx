"use client";

import { useMemo, useState } from "react";
import {
  ALMGREN_THRESHOLD_BAND,
  BAND_COLOR_VARS,
  BAND_LABELS,
  INTENSITY_MODELS,
  ZONE_DESCRIPTIONS,
  ZONE_INDEXES,
  ZONE_LABELS,
  bandsFromZones,
  emptyZoneSeconds,
  hasPersonalThresholds,
  zoneColorVar,
  zoneTotal,
  type BandKey,
  type ThresholdProfile,
  type ZoneSeconds,
} from "@/lib/intensity";

/* ------------------------------------------------------------------------ *
 * IntensityChart — intensitetsfördelning (P1.3 i docs/insikter-roadmap.md)
 *
 * ── Designval 1: staplar, inte area ───────────────────────────────────────
 * Roadmapen skissar en stackad *area* över tid. En area binder ihop punkter
 * med en lutning, och lutningen är en påstådd övergång mellan två veckor. Här
 * finns veckor helt utan träning (sjukvecka, tävlingsvila) — och en area
 * skulle rita en mjuk ramp rakt igenom dem, vilket är precis den
 * interpolation som roadmapen förbjuder ("luckor får aldrig interpoleras").
 * Veckorna är dessutom diskreta hinkar, inte sampel ur ett kontinuerligt
 * förlopp. Därför 100 %-stackade *kolumner*: en vecka utan zondata blir ett
 * tomt fack, inte en uppfunnen linje.
 *
 * ── Designval 2: ordinal ramp, inte kategorisk palett ─────────────────────
 * Zon 1–5 är ordnade efter intensitet. Att ge dem fem olika hues ur den
 * kategoriska paletten skulle säga "fem olika saker" när sanningen är "samma
 * sak, fem nivåer". Zonerna får därför en enhue-ramp (--zone-1..5), validerad
 * som ordinal ramp i båda lägena, och den kategoriska paletten lämnas åt
 * passkategorierna i huvudgrafen.
 *
 * ── Designval 3: 100 %, inte absolut tid ──────────────────────────────────
 * Frågan är *fördelningen*, inte volymen — volymen står redan i huvudgrafen.
 * Normaliserat till 100 % blir en lugn återhämtningsvecka jämförbar med en
 * hård vecka, vilket är hela poängen med att titta på fördelning.
 * ------------------------------------------------------------------------ */

export type IntensityWeek = {
  key: string;
  label: string;
  fullLabel: string;
  zoneSeconds: ZoneSeconds;
};

const WIDTH = 800;
const HEIGHT = 210;
const PAD_TOP = 10;
const PAD_LEFT = 38;
const PAD_RIGHT = 8;
const X_AXIS_H = 20;
const STACK_GAP = 2;
const MAX_BAR_WIDTH = 24;

const PLOT_H = HEIGHT - PAD_TOP - X_AXIS_H;

function topRoundedRect(x: number, y: number, w: number, h: number, r: number): string {
  const rr = Math.max(0, Math.min(r, w / 2, h));
  return (
    `M ${x} ${y + h} L ${x} ${y + rr} Q ${x} ${y} ${x + rr} ${y} ` +
    `L ${x + w - rr} ${y} Q ${x + w} ${y} ${x + w} ${y + rr} L ${x + w} ${y + h} Z`
  );
}

function formatHoursMinutesShort(seconds: number): string {
  const total = Math.round(seconds / 60);
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? `${h} h ${m} min` : `${m} min`;
}

function percent(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return (part / whole) * 100;
}

function formatPercent(value: number | null): string {
  return value == null ? "–" : `${value.toFixed(1)} %`;
}

function formatSignedPercent(value: number): string {
  return `${value > 0 ? "+" : ""}${value.toFixed(1)} pe`;
}

/** Summan av zontider över ett urval veckor. */
function sumWeeks(weeks: IntensityWeek[]): ZoneSeconds {
  const out = emptyZoneSeconds();
  for (const w of weeks) {
    for (const i of ZONE_INDEXES) out[i] += w.zoneSeconds[i];
  }
  return out;
}

export function IntensityChart({
  weeks,
  profile,
  emptyLabel = "Ingen zondata i perioden.",
}: {
  weeks: IntensityWeek[];
  profile: ThresholdProfile;
  emptyLabel?: string;
}) {
  const [hovered, setHovered] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const [modelId, setModelId] = useState(INTENSITY_MODELS[0].id);

  const totals = useMemo(() => weeks.map((w) => zoneTotal(w.zoneSeconds)), [weeks]);
  const periodZones = useMemo(() => sumWeeks(weeks), [weeks]);
  const periodTotal = zoneTotal(periodZones);
  const weeksWithData = useMemo(
    () => weeks.filter((w) => zoneTotal(w.zoneSeconds) > 0),
    [weeks],
  );

  /** Mittenzonens riktning: senaste fyra veckorna med data mot de fyra
   * dessförinnan. Fyra veckor är kort nog att fånga en glidning och långt nog
   * att en enskild tävlingsvecka inte styr utfallet. */
  const middleTrend = useMemo(() => {
    if (weeksWithData.length < 8) return null;
    const recent = sumWeeks(weeksWithData.slice(-4));
    const previous = sumWeeks(weeksWithData.slice(-8, -4));
    const recentShare = percent(recent[2], zoneTotal(recent));
    const previousShare = percent(previous[2], zoneTotal(previous));
    if (recentShare == null || previousShare == null) return null;
    return { recentShare, previousShare, delta: recentShare - previousShare };
  }, [weeksWithData]);

  const model = INTENSITY_MODELS.find((m) => m.id === modelId) ?? INTENSITY_MODELS[0];
  const actualBands = bandsFromZones(periodZones);
  const bandKeys: BandKey[] = ["easy", "middle", "threshold"];

  const personalZones = hasPersonalThresholds(profile);

  /* ------------------------------- geometri ------------------------------ */

  const plotWidth = WIDTH - PAD_LEFT - PAD_RIGHT;
  const step = weeks.length > 0 ? plotWidth / weeks.length : plotWidth;
  const barWidth = Math.min(MAX_BAR_WIDTH, Math.max(3, step - 6));
  const xCenter = (i: number) => PAD_LEFT + (i + 0.5) * step;
  const yFor = (share: number) => PAD_TOP + PLOT_H - (share / 100) * PLOT_H;
  const labelStep = Math.max(1, Math.ceil(weeks.length / 12));

  const hoveredWeek = hovered != null ? weeks[hovered] : null;
  const hoveredTotal = hovered != null ? totals[hovered] : 0;

  return (
    <div className="flex w-full max-w-full flex-col gap-4">
      {/* --- zongränserna redovisas före grafen, inte som fotnot efter ----- */}
      <div
        className={`rounded border p-3 text-sm ${
          personalZones
            ? "border-zinc-200 dark:border-zinc-800"
            : "border-amber-400/60 bg-amber-50/60 dark:border-amber-500/40 dark:bg-amber-950/20"
        }`}
      >
        <div className="font-medium text-zinc-900 dark:text-zinc-100">
          {personalZones ? "Zongränser: personligt kalibrerade" : "Zongränser: Garmins autogissning"}
        </div>
        {personalZones ? (
          <p className="mt-1 text-zinc-600 dark:text-zinc-400">
            Ditt tröskelband är satt till {profile.thresholdHrLow}–{profile.thresholdHrHigh}{" "}
            slag/min
            {profile.lt1Hr != null && ` (LT1 ${profile.lt1Hr})`}
            {profile.lt2Hr != null && ` (LT2 ${profile.lt2Hr})`}
            {profile.maxHr != null && `, maxpuls ${profile.maxHr}`}. Zontiderna nedan kommer
            ändå från Garmins egna zonindelning — klockan levererar bara sekunder per zon,
            aldrig pulsintervallen den räknat mot. Ditt band är alltså facit att jämföra mot,
            inte den indelning staplarna är byggda av.
          </p>
        ) : (
          <p className="mt-1 text-zinc-700 dark:text-zinc-300">
            Inget personligt tröskelband är ifyllt, så zonerna nedan kommer från Garmins
            automatiska gissning utifrån ålder och autodetekterad maxpuls.{" "}
            <strong className="font-medium">Siffrorna är därför osäkra</strong> — de mäter
            klockans modell av dig, inte din fysiologi. Almgren styr mot ett personligt band
            på {ALMGREN_THRESHOLD_BAND.low}–{ALMGREN_THRESHOLD_BAND.high} slag/min, inte mot
            &rdquo;zon 4&rdquo;. Fyll i tröskelpuls så blir den här sektionen meningsfull.
          </p>
        )}
      </div>

      {periodTotal === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">{emptyLabel}</p>
      ) : (
        <>
          {/* --------------------- stackade kolumner över tid ------------- */}
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            className="h-auto w-full"
            role="img"
            aria-label="Andel av veckans pulstid per zon"
            onPointerLeave={() => setHovered(null)}
          >
            {[0, 25, 50, 75, 100].map((share) => (
              <g key={`grid-${share}`}>
                <line
                  x1={PAD_LEFT}
                  x2={WIDTH - PAD_RIGHT}
                  y1={yFor(share)}
                  y2={yFor(share)}
                  className="stroke-zinc-200 dark:stroke-zinc-800"
                  strokeWidth={1}
                />
                <text
                  x={PAD_LEFT - 6}
                  y={yFor(share)}
                  textAnchor="end"
                  dominantBaseline="middle"
                  className="fill-zinc-500 tabular-nums dark:fill-zinc-400"
                  style={{ fontSize: 10 }}
                >
                  {share} %
                </text>
              </g>
            ))}

            {weeks.map((week, i) => {
              const total = totals[i];
              if (total <= 0) return null;
              const x = xCenter(i) - barWidth / 2;
              let cumulative = 0;
              const segments = ZONE_INDEXES.map((z) => ({
                zone: z,
                share: (week.zoneSeconds[z] / total) * 100,
              })).filter((s) => s.share > 0);

              return (
                <g key={`bar-${week.key}`}>
                  {segments.map((segment, segmentIndex) => {
                    const yTop = yFor(cumulative + segment.share);
                    const yBottom = yFor(cumulative);
                    cumulative += segment.share;
                    const isBottom = segmentIndex === 0;
                    const isTop = segmentIndex === segments.length - 1;
                    // Gapet tas ur segmentets underkant, utom längst ned där
                    // stapeln ska sitta på nollinjen.
                    const h = yBottom - yTop - (isBottom ? 0 : STACK_GAP);
                    if (h <= 0.4) return null;
                    return (
                      <path
                        key={segment.zone}
                        d={topRoundedRect(x, yTop, barWidth, h, isTop ? 4 : 0)}
                        style={{
                          fill: zoneColorVar(segment.zone),
                          opacity: hovered == null || hovered === i ? 1 : 0.5,
                          transition: "opacity 120ms",
                        }}
                      >
                        <title>{`${week.fullLabel} — ${ZONE_LABELS[segment.zone]}: ${segment.share.toFixed(0)} % (${formatHoursMinutesShort(week.zoneSeconds[segment.zone])})`}</title>
                      </path>
                    );
                  })}
                </g>
              );
            })}

            {hovered != null && (
              <line
                x1={xCenter(hovered)}
                x2={xCenter(hovered)}
                y1={PAD_TOP}
                y2={PAD_TOP + PLOT_H}
                className="stroke-zinc-400 dark:stroke-zinc-500"
                strokeWidth={1}
              />
            )}

            {weeks.map((week, i) =>
              i % labelStep === 0 ? (
                <text
                  key={`x-${week.key}`}
                  x={xCenter(i)}
                  y={HEIGHT - 5}
                  textAnchor="middle"
                  className="fill-zinc-500 dark:fill-zinc-400"
                  style={{ fontSize: 10 }}
                >
                  {week.label}
                </text>
              ) : null,
            )}

            {weeks.map((week, i) => (
              <rect
                key={`hit-${week.key}`}
                x={PAD_LEFT + i * step}
                y={PAD_TOP}
                width={step}
                height={PLOT_H}
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

          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            {ZONE_INDEXES.map((z) => (
              <span key={z} className="inline-flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 shrink-0 rounded-sm"
                  style={{ backgroundColor: zoneColorVar(z) }}
                />
                {ZONE_LABELS[z]}
                <span className="text-zinc-400 dark:text-zinc-500">
                  · {ZONE_DESCRIPTIONS[z]}
                </span>
              </span>
            ))}
          </div>

          {hoveredWeek && (
            <div className="flex flex-col gap-2 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {hoveredWeek.fullLabel}
              </div>
              {hoveredTotal > 0 ? (
                <>
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">
                    {formatHoursMinutesShort(hoveredTotal)} med pulsdata
                  </div>
                  <dl className="grid grid-cols-1 gap-x-6 gap-y-1 sm:grid-cols-2 lg:grid-cols-3">
                    {ZONE_INDEXES.map((z) => (
                      <div key={z} className="flex flex-wrap items-baseline gap-x-2">
                        <dt className="inline-flex items-center gap-1.5 text-zinc-500 dark:text-zinc-400">
                          <span
                            className="h-2 w-2 shrink-0 rounded-sm"
                            style={{ backgroundColor: zoneColorVar(z) }}
                          />
                          {ZONE_LABELS[z]}
                        </dt>
                        <dd className="font-medium tabular-nums text-zinc-900 dark:text-zinc-100">
                          {formatPercent(percent(hoveredWeek.zoneSeconds[z], hoveredTotal))}
                        </dd>
                        <dd className="text-xs tabular-nums text-zinc-500 dark:text-zinc-400">
                          {formatHoursMinutesShort(hoveredWeek.zoneSeconds[z])}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </>
              ) : (
                <p className="text-xs text-zinc-500 dark:text-zinc-400">
                  Ingen pulsdata den här veckan — antingen ingen träning, eller träning utan
                  pulsband.
                </p>
              )}
            </div>
          )}

          {/* ------------------- mittenzonen ------------------------------ */}
          <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              Mittenzonen (zon 3) — varken lugnt eller tröskel
            </div>
            <div className="mt-1 flex flex-wrap items-baseline gap-x-3">
              <span className="text-3xl font-semibold text-zinc-900 dark:text-zinc-50">
                {formatPercent(percent(periodZones[2], periodTotal))}
              </span>
              {middleTrend && (
                <span className="text-sm tabular-nums text-zinc-600 dark:text-zinc-400">
                  {formatSignedPercent(middleTrend.delta)} senaste 4 veckorna mot de 4
                  dessförinnan ({middleTrend.previousShare.toFixed(1)} %{" "}
                  {"→"} {middleTrend.recentShare.toFixed(1)} %)
                </span>
              )}
            </div>
            <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {middleTrend == null
                ? "Kräver minst 8 veckor med pulsdata för att kunna säga något om riktningen."
                : middleTrend.delta > 3
                  ? "Andelen i mittenzonen stiger. Det är ofta första tecknet på att de lugna passen blivit för snabba — inte att tröskelpassen blivit fler."
                  : middleTrend.delta < -3
                    ? "Andelen i mittenzonen sjunker. Fördelningen har blivit tydligare uppdelad mellan lugnt och hårt."
                    : "Andelen i mittenzonen ligger stilla."}
            </p>
          </div>

          {/* ------------------- fördelning mot målmodell ----------------- */}
          <div className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-zinc-500 dark:text-zinc-400">Jämför mot modell:</span>
              {INTENSITY_MODELS.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  aria-pressed={m.id === modelId}
                  onClick={() => setModelId(m.id)}
                  className={`rounded border px-2 py-1 text-xs transition-colors ${
                    m.id === modelId
                      ? "border-zinc-400 text-zinc-900 dark:border-zinc-500 dark:text-zinc-50"
                      : "border-zinc-200 text-zinc-500 hover:border-zinc-400 dark:border-zinc-800 dark:text-zinc-400 dark:hover:border-zinc-600"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>

            <div className="flex flex-col gap-2">
              {(
                [
                  { title: "Din fördelning i perioden", values: bandKeys.map((k) => percent(actualBands[k], periodTotal) ?? 0) },
                  { title: model.label, values: bandKeys.map((k) => model.target[k]) },
                ] as const
              ).map((row) => (
                <div key={row.title} className="flex flex-col gap-1">
                  <div className="text-xs text-zinc-500 dark:text-zinc-400">{row.title}</div>
                  <div className="flex h-5 w-full max-w-full gap-[2px] overflow-hidden">
                    {bandKeys.map((band, i) => (
                      <div
                        key={band}
                        style={{
                          width: `${row.values[i]}%`,
                          backgroundColor: BAND_COLOR_VARS[band],
                        }}
                        className="first:rounded-l-sm last:rounded-r-sm"
                        title={`${BAND_LABELS[band]}: ${row.values[i].toFixed(1)} %`}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                    <th scope="col" className="py-1 pr-4 font-normal">
                      Band
                    </th>
                    <th scope="col" className="py-1 pr-4 font-normal">
                      Din andel
                    </th>
                    <th scope="col" className="py-1 pr-4 font-normal">
                      {model.label}
                    </th>
                    <th scope="col" className="py-1 pr-4 font-normal">
                      Skillnad
                    </th>
                    <th scope="col" className="py-1 font-normal">
                      Tid
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {bandKeys.map((band) => {
                    const actual = percent(actualBands[band], periodTotal) ?? 0;
                    return (
                      <tr key={band} className="border-t border-zinc-100 dark:border-zinc-800">
                        <th scope="row" className="py-1 pr-4 font-normal">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="h-2.5 w-2.5 shrink-0 rounded-sm"
                              style={{ backgroundColor: BAND_COLOR_VARS[band] }}
                            />
                            {BAND_LABELS[band]}
                          </span>
                        </th>
                        <td className="py-1 pr-4 tabular-nums">{actual.toFixed(1)} %</td>
                        <td className="py-1 pr-4 tabular-nums">{model.target[band]} %</td>
                        <td className="py-1 pr-4 tabular-nums">
                          {formatSignedPercent(actual - model.target[band])}
                        </td>
                        <td className="py-1 tabular-nums">
                          {formatHoursMinutesShort(actualBands[band])}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {model.source} Modellen är en referenspunkt, inte ett facit — appen påstår inte
              att någon av dem är rätt för dig. Översättningen från klockans fem zoner till
              litteraturens tre band (zon 1–2 / zon 3 / zon 4–5) är dessutom en approximation
              som ärver samma osäkerhet som zongränserna.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            className="w-fit text-xs text-zinc-500 underline hover:text-zinc-950 dark:text-zinc-400 dark:hover:text-zinc-50"
          >
            {showTable ? "Dölj veckotabell" : "Visa veckotabell"}
          </button>

          {showTable && (
            <div className="w-full max-w-full overflow-x-auto">
              <table className="w-full min-w-max text-left text-sm">
                <thead>
                  <tr className="text-xs text-zinc-500 dark:text-zinc-400">
                    <th scope="col" className="py-1 pr-4 font-normal">
                      Vecka
                    </th>
                    {ZONE_INDEXES.map((z) => (
                      <th key={z} scope="col" className="py-1 pr-4 font-normal">
                        {ZONE_LABELS[z]}
                      </th>
                    ))}
                    <th scope="col" className="py-1 font-normal">
                      Total tid
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {weeks.map((week, i) => (
                    <tr key={week.key} className="border-t border-zinc-100 dark:border-zinc-800">
                      <th scope="row" className="py-1 pr-4 font-normal">
                        {week.fullLabel}
                      </th>
                      {ZONE_INDEXES.map((z) => (
                        <td key={z} className="py-1 pr-4 tabular-nums">
                          {formatPercent(percent(week.zoneSeconds[z], totals[i]))}
                        </td>
                      ))}
                      <td className="py-1 tabular-nums">
                        {totals[i] > 0 ? formatHoursMinutesShort(totals[i]) : "–"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
