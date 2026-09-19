"use client";

import { useMemo, useState } from "react";
import {
  countZones,
  EASY_LENGTH_LABELS,
  easyVerdict,
  filterByLength,
  type EasyDiscipline as EasyDisciplineData,
  type EasyLengthBucket,
  type EasyZone,
} from "@/lib/easy-discipline";
import { formatPacePerKm } from "@/lib/training-gears";

/* ------------------------------------------------------------------------ *
 * EasyDiscipline — "Pulsen på de lugna passen"
 *
 * ── Två variabler, inte en ────────────────────────────────────────────────
 * Första versionen hade snittpuls i höjdled *och* färg efter samma puls —
 * samma tal kodat två gånger, vilket bara gjorde diagrammet redundant. Nu
 * bär höjdled **farten** och färgen **pulsutfallet**. Det gör det till en
 * riktig tvåvariabeldiagram, och frågan den svarar på blir den som faktiskt
 * går att agera på: *vid vilken fart hamnar jag i rätt pulszon?*
 *
 * Läsningen blir en gradient — snabba pass högst upp och röda, långsamma
 * längst ner och gröna — och gränsen mellan färgerna pekar ut den fart där
 * pulsen slutar vara lugn.
 *
 * ── Längdfiltret ─────────────────────────────────────────────────────────
 * Pulsen driver uppåt ju längre passet blir, så ett långpass över taket kan
 * vara drift snarare än för hög fart. Utan möjlighet att hålla längden
 * konstant är jämförelsen mellan ett 4 km-pass och ett 12 km-pass inte
 * ärlig. Domen räknas därför om på det filtrerade urvalet.
 *
 * ── Y-axelns riktning ────────────────────────────────────────────────────
 * Snabbare fart uppåt, som i alla löpappar. Följden är att målbandet hamnar
 * i nederkant — det är avsiktligt och läses som "du ska ner hit".
 *
 * ── Färg ─────────────────────────────────────────────────────────────────
 * Bara två tillstånd bär färg: under taket (status-good) och över taket
 * (status-concern). Mellanmarginalen ritas dämpad, inte gul — den är inte
 * ett fel, bara inte idealet.
 * ------------------------------------------------------------------------ */

const ZONE_FILL: Record<EasyZone, string> = {
  below: "var(--status-good)",
  "in-band": "var(--status-good)",
  "upper-margin": "var(--ink-3)",
  "over-ceiling": "var(--status-concern)",
};

const BUCKETS: EasyLengthBucket[] = ["alla", "kort", "medel", "lang"];

export function EasyDiscipline({
  data,
  paceTarget,
}: {
  data: EasyDisciplineData;
  /** Målfart för distans, sekunder per km. Kommer från växeldiagrammets
   *  fartvy — saknas den ritas inget band, men färgerna fungerar ändå. */
  paceTarget?: { low: number; high: number } | null;
}) {
  const [bucket, setBucket] = useState<EasyLengthBucket>("alla");
  const { band } = data;

  const points = useMemo(() => filterByLength(data.points, bucket), [data.points, bucket]);
  const counts = useMemo(() => countZones(points), [points]);
  const verdict = useMemo(() => easyVerdict(points, band), [points, band]);

  /* Skalan sätts av data och målband tillsammans, aldrig av data ensamt:
     ligger alla pass snabbare än målet måste målet ändå synas i bilden. */
  const paces = points.map((p) => p.paceSecondsPerKm);
  const lo = Math.min(...paces, paceTarget?.low ?? Infinity) - 10;
  const hi = Math.max(...paces, paceTarget?.high ?? -Infinity) + 10;
  const span = hi - lo || 1;

  /** Fart → andel av höjden uppifrån. Snabbare (lägre s/km) hamnar högre. */
  const top = (pace: number) => ((pace - lo) / span) * 100;
  const left = (i: number) => (points.length === 1 ? 50 : 2 + (i / (points.length - 1)) * 96);

  const over = counts["over-ceiling"];
  const tone = points.length > 0 && over / points.length >= 0.25 ? "var(--status-concern)" : "var(--status-good)";

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Pulsen på de lugna passen
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Ett märke per lugnt pass och långpass på minst 20 minuter. Höjdled är farten, färgen är
          pulsen: röd betyder att passet gick över{" "}
          {band.source === "lt1" ? "din aeroba tröskel" : "din skattade aeroba tröskel"} på{" "}
          {band.ceiling} slag. Gränsen mellan färgerna visar vid vilken fart pulsen slutar vara
          lugn.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <p className="text-base font-medium" style={{ color: tone }}>
              {verdict.headline}
            </p>
            <p className="mt-1 max-w-2xl text-sm text-[var(--ink-2)]">{verdict.detail}</p>
          </div>

          <div
            className="flex shrink-0 flex-wrap overflow-hidden rounded border border-[var(--line)] text-sm"
            role="group"
            aria-label="Passlängd"
          >
            {BUCKETS.map((b) => (
              <button
                key={b}
                type="button"
                onClick={() => setBucket(b)}
                aria-pressed={bucket === b}
                className={`px-3 py-1 ${
                  bucket === b
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "text-[var(--ink-2)]"
                }`}
              >
                {EASY_LENGTH_LABELS[b]}
              </button>
            ))}
          </div>
        </div>

        {points.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--ink-3)]">
            Inga pass i det här längdintervallet.
          </p>
        ) : (
          <>
            <div className="mt-5 flex gap-3">
              {/* Axeletiketterna ligger utanför ritytan så de aldrig skalas med. */}
              <div className="relative h-52 w-12 shrink-0 sm:h-60" aria-hidden>
                {[lo + span * 0.1, lo + span * 0.5, lo + span * 0.9].map((v) => (
                  <span
                    key={v}
                    className="absolute right-0 -translate-y-1/2 text-[0.65rem] tabular-nums text-[var(--ink-3)]"
                    style={{ top: `${top(v)}%` }}
                  >
                    {formatPacePerKm(v)}
                  </span>
                ))}
              </div>

              <div
                className="relative h-52 min-w-0 flex-1 sm:h-60"
                role="img"
                aria-label={`Fart och puls för ${points.length} lugna pass. ${over} pass ligger över taket ${band.ceiling} slag.`}
              >
                {paceTarget && (
                  <div
                    className="absolute inset-x-0 rounded-sm"
                    style={{
                      top: `${top(paceTarget.low)}%`,
                      height: `${Math.max(top(paceTarget.high) - top(paceTarget.low), 1)}%`,
                      background: "color-mix(in oklab, var(--status-good) 14%, transparent)",
                    }}
                  />
                )}
                {points.map((p, i) => (
                  <span
                    key={p.id}
                    title={`${p.date} · ${p.label} · ${formatPacePerKm(p.paceSecondsPerKm)}/km · ${p.avgHr} slag · ${(p.distanceMeters / 1000).toFixed(1)} km`}
                    className="absolute block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface)]"
                    style={{
                      left: `${left(i)}%`,
                      top: `${top(p.paceSecondsPerKm)}%`,
                      background: ZONE_FILL[p.zone],
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 pl-15 text-xs text-[var(--ink-3)]">
              <span className="flex items-center gap-1.5">
                <i
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: "var(--status-good)" }}
                />
                Under taket ({counts.below + counts["in-band"]})
              </span>
              <span className="flex items-center gap-1.5">
                <i
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: "var(--ink-3)" }}
                />
                Nära taket ({counts["upper-margin"]})
              </span>
              <span className="flex items-center gap-1.5">
                <i
                  className="inline-block h-2 w-2 rounded-full"
                  style={{ background: "var(--status-concern)" }}
                />
                Över taket ({over})
              </span>
              {paceTarget && (
                <span className="flex items-center gap-1.5">
                  <i
                    className="inline-block h-2 w-3 rounded-sm"
                    style={{
                      background: "color-mix(in oklab, var(--status-good) 30%, transparent)",
                    }}
                  />
                  Målfart {formatPacePerKm(paceTarget.low)}–{formatPacePerKm(paceTarget.high)}/km
                </span>
              )}
            </div>
          </>
        )}

        <details className="mt-4 rounded-lg border border-[var(--line)] p-3 text-sm">
          <summary className="cursor-pointer text-[var(--ink-2)]">Hur taket räknas fram</summary>
          <p className="mt-2 text-[var(--ink-2)]">
            {band.source === "lt1" ? (
              <>
                Taket är <strong>aerob tröskel ur din profil</strong>: {band.ceiling} slag. Över
                den nivån ackumuleras laktat och passet slutar vara återhämtning.
              </>
            ) : (
              <>
                Taket är <strong>skattat till 82 % av din maxpuls</strong>: {band.ceiling} slag.
                Fyll i aerob tröskel under Inställningar så räknas det på ett angivet värde i
                stället.
              </>
            )}{" "}
            Grått märke betyder att passet låg under taket men inom {band.high}–{band.ceiling},
            alltså på gränsen. Ett pass som ligger precis på tröskeln är inte lugnt, det är så
            hårt ett lugnt pass får vara utan att bli fel.
          </p>
          <p className="mt-2 text-[var(--ink-2)]">
            Pulsen driver uppåt ju längre passet blir, så ett långpass över taket kan vara drift
            snarare än för hög fart. Längdfiltret finns för att kunna hålla längden konstant —
            domen räknas om på det urval du valt.
          </p>
          <p className="mt-2 text-[var(--ink-2)]">
            Måttet använder bara passets tidsviktade snittpuls och ett tal ur din profil — inga
            pulszoner. Det är avsiktligt: Garmin levererar sekunder per zon men aldrig gränserna
            de räknades mot, så zonandelarna i Intensitetsfördelningen ärver klockans
            kalibrering. Den här rutan gör inte det.
          </p>
        </details>
      </div>
    </section>
  );
}
