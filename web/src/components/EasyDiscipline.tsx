import {
  easyVerdict,
  type EasyDiscipline as EasyDisciplineData,
  type EasyZone,
} from "@/lib/easy-discipline";

/* ------------------------------------------------------------------------ *
 * EasyDiscipline — "Pulsen på de lugna passen"
 *
 * ── Varför ett punktdiagram och inte staplar ──────────────────────────────
 * Frågan är inte "hur mycket tid låg i bandet" (det vore en stapel) utan
 * "hur många av passen missade bandet, och glider de uppåt över tid". Det är
 * en fråga om spridning och riktning, och då är ett märke per pass mot ett
 * inritat målband den enda formen som visar båda.
 *
 * ── Varför inte SVG ───────────────────────────────────────────────────────
 * Första versionen ritade punkterna i en <svg viewBox="0 0 100 190"> med
 * preserveAspectRatio="none". Det skalar x-axeln till containerns bredd men
 * lämnar y i pixlar — på en bred skärm blev skalfaktorn omkring 19:1 och
 * varje cirkel en utdragen oval. vector-effect hjälper inte, det påverkar
 * bara linjebredder. Punkterna ligger därför i absolut positionerade
 * element: x i procent, y i procent, och märket självt i px så att det
 * förblir runt oavsett bredd.
 *
 * ── Färg ─────────────────────────────────────────────────────────────────
 * Bara två tillstånd bär färg: under taket (status-good) och över taket
 * (status-concern). Mellanmarginalen ritas dämpad, inte gul — den är inte
 * ett fel, bara inte idealet. Tre färger hade gjort diagrammet till en
 * bedömningsskala när det bara behöver svara ja eller nej.
 * ------------------------------------------------------------------------ */

const ZONE_FILL: Record<EasyZone, string> = {
  below: "var(--status-good)",
  "in-band": "var(--status-good)",
  "upper-margin": "var(--ink-3)",
  "over-ceiling": "var(--status-concern)",
};

export function EasyDiscipline({ data }: { data: EasyDisciplineData }) {
  const { band, points, counts } = data;
  const verdict = easyVerdict(data);

  /* Skalan sätts av data och band tillsammans, aldrig av data ensamt: ligger
     alla pass över taket måste taket ändå synas, annars ser fördelningen
     normal ut. Marginal på 6 slag i varje ände så att märken aldrig klistrar
     i kanten. */
  const hrs = points.map((p) => p.avgHr);
  const lo = Math.min(band.low, ...hrs) - 6;
  const hi = Math.max(band.ceiling, ...hrs) + 6;
  const span = hi - lo || 1;

  /** Puls → andel av höjden uppifrån. Högre puls högre upp. */
  const top = (hr: number) => ((hi - hr) / span) * 100;
  /** Passindex → andel av bredden. Jämnt fördelade: avstånden i tid är
   *  ointressanta här, ordningen bär riktningen. Insatt 2 % i varje ände så
   *  att första och sista märket får plats. */
  const left = (i: number) =>
    points.length === 1 ? 50 : 2 + ((i / (points.length - 1)) * 96);

  const over = counts["over-ceiling"];
  const tone = over / points.length >= 0.25 ? "var(--status-concern)" : "var(--status-good)";

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Pulsen på de lugna passen
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Ett märke per lugnt pass och långpass på minst 20 minuter, placerat efter sin snittpuls.
          Det gröna fältet är målbandet, den streckade linjen{" "}
          {band.source === "lt1" ? "din aeroba tröskel" : "din skattade aeroba tröskel"} på{" "}
          {band.ceiling} slag — taket för vad ett lugnt pass får vara.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        {/* Domen före diagrammet: vyn ska säga vad man gör, inte kräva att
            man tolkar en punktsvärm för att komma fram till det själv. */}
        <p className="text-base font-medium" style={{ color: tone }}>
          {verdict.headline}
        </p>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-2)]">{verdict.detail}</p>

        <div className="mt-5 flex gap-3">
          {/* Axeletiketterna ligger utanför ritytan så de aldrig skalas med. */}
          <div className="relative h-52 w-8 shrink-0 sm:h-60" aria-hidden>
            <span
              className="absolute right-0 -translate-y-1/2 text-[0.65rem] tabular-nums text-[var(--ink-3)]"
              style={{ top: `${top(band.ceiling)}%` }}
            >
              {band.ceiling}
            </span>
            <span
              className="absolute right-0 -translate-y-1/2 text-[0.65rem] tabular-nums text-[var(--ink-3)]"
              style={{ top: `${top(band.low)}%` }}
            >
              {band.low}
            </span>
          </div>

          <div
            className="relative h-52 min-w-0 flex-1 sm:h-60"
            role="img"
            aria-label={`Snittpuls för ${points.length} lugna pass mot ett målband på ${band.low} till ${band.high} slag. ${over} pass ligger över taket ${band.ceiling}.`}
          >
            {/* Målbandet först, så märkena hamnar ovanpå. */}
            <div
              className="absolute inset-x-0 rounded-sm"
              style={{
                top: `${top(band.high)}%`,
                height: `${top(band.low) - top(band.high)}%`,
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
                title={`${p.date} · ${p.label} · ${p.avgHr} slag`}
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
            I eller under bandet ({counts.below + counts["in-band"]})
          </span>
          <span className="flex items-center gap-1.5">
            <i
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--ink-3)" }}
            />
            Mellan bandet och taket ({counts["upper-margin"]})
          </span>
          <span className="flex items-center gap-1.5">
            <i
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: "var(--status-concern)" }}
            />
            Över taket ({over})
          </span>
        </div>

        <details className="mt-4 rounded-lg border border-[var(--line)] p-3 text-sm">
          <summary className="cursor-pointer text-[var(--ink-2)]">Hur bandet räknas fram</summary>
          <p className="mt-2 text-[var(--ink-2)]">
            {band.source === "lt1" ? (
              <>
                Taket är <strong>aerob tröskel ur din profil</strong>: {band.ceiling} slag. Över
                den nivån ackumuleras laktat och passet slutar vara återhämtning.
              </>
            ) : (
              <>
                Taket är <strong>skattat till 82 % av din maxpuls</strong>: {band.ceiling} slag.
                Det är en grov approximation — fyll i aerob tröskel under Inställningar så räknas
                bandet på ett uppmätt värde i stället.
              </>
            )}{" "}
            Målbandet {band.low}–{band.high} ligger 8–25 slag under taket. Ett pass som ligger
            precis på tröskeln är inte lugnt, det är så hårt ett lugnt pass får vara utan att bli
            fel.
          </p>
          <p className="mt-2 text-[var(--ink-2)]">
            Måttet använder bara passets tidsviktade snittpuls och ett tal ur din profil — inga
            pulszoner. Det är avsiktligt: Garmin levererar sekunder per zon men aldrig gränserna
            de räknades mot, så zonandelarna i Intensitetsfördelningen ovan ärver klockans
            kalibrering. Den här rutan gör inte det.
          </p>
        </details>
      </div>
    </section>
  );
}
