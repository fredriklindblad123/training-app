"use client";

import { useMemo, useState } from "react";
import {
  countZones,
  EASY_LENGTH_LABELS,
  easyVerdict,
  filterByLength,
  filterByPace,
  paceBuckets,
  type EasyDiscipline as EasyDisciplineData,
  type EasyLengthBucket,
  type EasyZone,
} from "@/lib/easy-discipline";
import { formatPacePerKm } from "@/lib/training-gears";

/* ------------------------------------------------------------------------ *
 * EasyDiscipline — "Pulsen på de lugna passen"
 *
 * ── Puls i höjdled, fart och längd som filter ─────────────────────────────
 * Ett mellansteg hade farten i höjdled och pulsen som färg. Det lät
 * förnuftigt — två variabler i stället för en — men gav ett sämre diagram:
 * sambandet mellan fart och puls är svagt på lugna pass (r ≈ −0,37 över ett
 * år, alltså omkring 13 % av variationen), så punktsvärmen visade ingen
 * gradient att läsa. Pulsen är tillbaka i höjdled, där den går att ställa
 * mot ett tak och ett målband.
 *
 * Fart och längd är i stället *filter*. Det är den starkare formen för svaga
 * samband: i stället för att leta efter en lutning håller man den ena
 * variabeln konstant och ser hur mycket puls som varierar ändå. Filtrerar
 * man på ett smalt fartspann och pulsen fortfarande spretar, kommer
 * spridningen från något annat — trötthet, värme, kupering.
 *
 * Båda filtren räknar om domen, så den alltid beskriver det man tittar på.
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

export function EasyDiscipline({ data }: { data: EasyDisciplineData }) {
  const [bucket, setBucket] = useState<EasyLengthBucket>("alla");
  const [paceKey, setPaceKey] = useState<string>("alla");
  const { band } = data;

  /* Fartgränserna räknas på hela underlaget, inte på det längdfiltrerade —
     annars hade knapparnas etiketter hoppat varje gång man bytte längd. */
  const buckets = useMemo(
    () => paceBuckets(data.points, formatPacePerKm),
    [data.points],
  );
  const activePace = buckets?.find((b) => b.key === paceKey) ?? null;

  const points = useMemo(
    () => filterByPace(filterByLength(data.points, bucket), activePace),
    [data.points, bucket, activePace],
  );
  const counts = useMemo(() => countZones(points), [points]);
  const verdict = useMemo(() => easyVerdict(points, band), [points, band]);

  /* Skalan sätts av data och band tillsammans, aldrig av data ensamt: ligger
     alla pass över taket måste taket ändå synas, annars ser fördelningen
     normal ut. Hela underlaget styr skalan, inte det filtrerade — annars
     hoppar axeln när man byter filter och passen går inte att jämföra
     mellan urvalen. */
  const allHrs = data.points.map((p) => p.avgHr);
  const lo = Math.min(band.low, ...allHrs) - 6;
  const hi = Math.max(band.ceiling, ...allHrs) + 6;
  const span = hi - lo || 1;

  /** Puls → andel av höjden uppifrån. Högre puls högre upp. */
  const top = (hr: number) => ((hi - hr) / span) * 100;
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
          Ett märke per lugnt pass och långpass på minst 20 minuter, placerat efter sin
          snittpuls. Det gröna fältet är målbandet, den streckade linjen{" "}
          {band.source === "lt1" ? "din aeroba tröskel" : "din skattade aeroba tröskel"} på{" "}
          {band.ceiling} slag — taket för vad ett lugnt pass får vara. Filtrera på längd och fart
          för att hålla den ena konstant och se hur mycket pulsen ändå varierar.
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

          <div className="flex shrink-0 flex-col gap-2">
            <FilterRow label="Längd">
              {BUCKETS.map((b) => (
                <FilterButton
                  key={b}
                  active={bucket === b}
                  onClick={() => setBucket(b)}
                  label={EASY_LENGTH_LABELS[b]}
                />
              ))}
            </FilterRow>
            {buckets && (
              <FilterRow label="Fart">
                <FilterButton
                  active={paceKey === "alla"}
                  onClick={() => setPaceKey("alla")}
                  label="Alla"
                />
                {buckets.map((b) => (
                  <FilterButton
                    key={b.key}
                    active={paceKey === b.key}
                    onClick={() => setPaceKey(b.key)}
                    label={b.label}
                  />
                ))}
              </FilterRow>
            )}
          </div>
        </div>

        {points.length === 0 ? (
          <p className="mt-6 text-sm text-[var(--ink-3)]">
            Inga pass matchar filtren.
          </p>
        ) : (
          <>
            <div className="mt-5 flex gap-3">
              {/* Axeletiketterna ligger utanför ritytan så de aldrig skalas med. */}
              <div className="relative h-52 w-8 shrink-0 sm:h-60" aria-hidden>
                {[band.ceiling, band.low].map((v) => (
                  <span
                    key={v}
                    className="absolute right-0 -translate-y-1/2 text-[0.65rem] tabular-nums text-[var(--ink-3)]"
                    style={{ top: `${top(v)}%` }}
                  >
                    {v}
                  </span>
                ))}
              </div>

              <div
                className="relative h-52 min-w-0 flex-1 sm:h-60"
                role="img"
                aria-label={`Snittpuls för ${points.length} lugna pass mot ett målband på ${band.low} till ${band.high} slag. ${over} pass ligger över taket ${band.ceiling}.`}
              >
                <div
                  className="absolute inset-x-0 rounded-sm"
                  style={{
                    top: `${top(band.high)}%`,
                    height: `${Math.max(top(band.low) - top(band.high), 1)}%`,
                    background: "color-mix(in oklab, var(--status-good) 14%, transparent)",
                  }}
                />
                <div
                  className="absolute inset-x-0 border-t border-dashed"
                  style={{
                    top: `${top(band.ceiling)}%`,
                    borderColor: "var(--status-concern)",
                  }}
                />
                {points.map((p, i) => (
                  <span
                    key={p.id}
                    title={`${p.date} · ${p.label} · ${formatPacePerKm(p.paceSecondsPerKm)}/km · ${p.avgHr} slag · ${(p.distanceMeters / 1000).toFixed(1)} km`}
                    className="absolute block h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-[var(--surface)]"
                    style={{
                      left: `${left(i)}%`,
                      top: `${top(p.avgHr)}%`,
                      background: ZONE_FILL[p.zone],
                    }}
                  />
                ))}
              </div>
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 pl-11 text-xs text-[var(--ink-3)]">
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
            snarare än för hög fart. Längd- och fartfiltren finns för att kunna hålla den ena
            konstant — domen räknas om på det urval du valt.
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

/** En filterrad med sin etikett. Två rader staplade ovanpå varandra behöver
 * varsin etikett — utan dem är det inte uppenbart att den övre raden gäller
 * längd och den undre fart. */
function FilterRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-10 shrink-0 text-right text-xs text-[var(--ink-3)]">{label}</span>
      <div
        className="flex flex-wrap overflow-hidden rounded border border-[var(--line)] text-sm"
        role="group"
        aria-label={label}
      >
        {children}
      </div>
    </div>
  );
}

function FilterButton({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`px-3 py-1 whitespace-nowrap ${
        active ? "bg-[var(--foreground)] text-[var(--background)]" : "text-[var(--ink-2)]"
      }`}
    >
      {label}
    </button>
  );
}
