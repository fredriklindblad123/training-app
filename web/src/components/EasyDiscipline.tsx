import {
  easyVerdict,
  type EasyDiscipline as EasyDisciplineData,
  type EasyZone,
} from "@/lib/easy-discipline";

/* ------------------------------------------------------------------------ *
 * EasyDiscipline — "Är lugnt verkligen lugnt?"
 *
 * ── Varför ett punktdiagram och inte staplar ──────────────────────────────
 * Frågan är inte "hur mycket tid låg i bandet" (det vore en stapel) utan
 * "hur många av passen missade bandet, och glider de uppåt över tid". Det är
 * en fråga om spridning och riktning, och då är ett märke per pass mot ett
 * inritat målband den enda formen som visar båda. Man ser direkt om
 * överträdelserna är enstaka utflykter eller ett stadigt band över taket.
 *
 * ── Färg ─────────────────────────────────────────────────────────────────
 * Bara två tillstånd bär färg: under taket (status-good) och över taket
 * (status-concern). Mellanmarginalen — mellan målbandets övre kant och
 * tröskeln — ritas dämpad, inte gul: den är inte ett fel, bara inte idealet.
 * Tre färger hade gjort diagrammet till en bedömningsskala när det bara
 * behöver svara ja eller nej.
 *
 * ── Y-axeln ──────────────────────────────────────────────────────────────
 * Skalan sätts av data och band tillsammans, aldrig av data ensamt: ligger
 * alla pass över taket måste taket ändå synas i bilden, annars ser
 * fördelningen normal ut. Marginal på 6 slag i varje ände så att punkter
 * aldrig klistrar i kanten.
 * ------------------------------------------------------------------------ */

const ZONE_FILL: Record<EasyZone, string> = {
  below: "var(--status-good)",
  "in-band": "var(--status-good)",
  "upper-margin": "var(--ink-3)",
  "over-ceiling": "var(--status-concern)",
};

const H = 190;
const PAD_TOP = 12;
const PAD_BOTTOM = 22;

export function EasyDiscipline({ data }: { data: EasyDisciplineData }) {
  const { band, points, counts } = data;
  const verdict = easyVerdict(data);

  const hrs = points.map((p) => p.avgHr);
  const lo = Math.min(band.low, ...hrs) - 6;
  const hi = Math.max(band.ceiling, ...hrs) + 6;
  const span = hi - lo || 1;

  /** Puls → y i px. Högre puls högre upp, som man läser en pulskurva. */
  const y = (hr: number) => PAD_TOP + (1 - (hr - lo) / span) * (H - PAD_TOP - PAD_BOTTOM);
  /** Pass-index → x i procent. Jämnt fördelade: avstånden i tid är
   *  ointressanta här, ordningen är det som bär riktningen. */
  const x = (i: number) => ((i + 0.5) / points.length) * 100;

  const bandTop = y(band.high);
  const bandBottom = y(band.low);
  const ceilingY = y(band.ceiling);

  const over = counts["over-ceiling"];
  const tone = over / points.length >= 0.25 ? "var(--status-concern)" : "var(--status-good)";

  return (
    <section className="flex flex-col gap-3">
      <div>
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Är lugnt verkligen lugnt?
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Ett märke per lugnt pass och långpass på minst 20 minuter, placerat efter sin
          snittpuls. Det gröna fältet är målbandet, den röda linjen är{" "}
          {band.source === "lt1" ? "din aeroba tröskel" : "din skattade aeroba tröskel"} på{" "}
          {band.ceiling} slag — taket för vad ett lugnt pass får vara.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        {/* Domen före diagrammet: sidan ska säga vad man gör, inte kräva att
            man tolkar en punktsvärm för att komma fram till det själv. */}
        <p className="text-base font-medium" style={{ color: tone }}>
          {verdict.headline}
        </p>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-2)]">{verdict.detail}</p>

        <div className="mt-4 flex gap-3">
          {/* Y-axelns etiketter står utanför svg:n så de aldrig skalas med. */}
          <div
            className="relative w-8 shrink-0 text-right text-[0.65rem] tabular-nums text-[var(--ink-3)]"
            style={{ height: H }}
            aria-hidden
          >
            <span className="absolute right-0 -translate-y-1/2" style={{ top: ceilingY }}>
              {band.ceiling}
            </span>
            <span className="absolute right-0 -translate-y-1/2" style={{ top: bandBottom }}>
              {band.low}
            </span>
          </div>

          <svg
            viewBox={`0 0 100 ${H}`}
            preserveAspectRatio="none"
            className="h-[190px] w-full overflow-visible"
            role="img"
            aria-label={`Snittpuls för ${points.length} lugna pass mot ett målband på ${band.low} till ${band.high} slag. ${over} pass ligger över taket ${band.ceiling}.`}
          >
            {/* Målbandet först, så punkterna hamnar ovanpå. */}
            <rect
              x="0"
              y={bandTop}
              width="100"
              height={Math.max(bandBottom - bandTop, 1)}
              fill="var(--status-good)"
              opacity="0.13"
            />
            <line
              x1="0"
              x2="100"
              y1={ceilingY}
              y2={ceilingY}
              stroke="var(--status-concern)"
              strokeWidth="1"
              vectorEffect="non-scaling-stroke"
              strokeDasharray="4 3"
            />
            {points.map((p, i) => (
              <circle
                key={p.id}
                cx={x(i)}
                cy={y(p.avgHr)}
                r="4"
                fill={ZONE_FILL[p.zone]}
                stroke="var(--surface)"
                strokeWidth="1.5"
                vectorEffect="non-scaling-stroke"
              >
                {/* Native title: samma hovermönster som RecordCard använder,
                    och fungerar utan att komponenten behöver bli klient. */}
                <title>{`${p.date} · ${p.label} · ${p.avgHr} slag`}</title>
              </circle>
            ))}
          </svg>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 pl-11 text-xs text-[var(--ink-3)]">
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
            de räknades mot, så zonandelarna i Intensitetsfördelningen nedan ärver klockans
            kalibrering. Den här rutan gör inte det.
          </p>
        </details>
      </div>
    </section>
  );
}
