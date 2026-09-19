import { GEAR_COLOR_VAR, GEAR_LABELS } from "@/lib/training-gears";

/* ------------------------------------------------------------------------ *
 * LactateCurve — den schematiska bilden bakom hela Form-vyn.
 *
 * ── Vad kurvan är ────────────────────────────────────────────────────────
 * INTE en mätning. Ingen i appen har mätt laktat. Det här är formen på
 * sambandet mellan intensitet och blodlaktat, ritad genom adeptens egna
 * tröskelvärden så att bandens lägen stämmer med resten av vyn. Att den är
 * schematisk står utskrivet, inte i en fotnot — en kurva som ser mätt ut och
 * inte är det är värre än ingen kurva alls.
 *
 * ── Modellen ─────────────────────────────────────────────────────────────
 * Laktatet ligger nära vilovärdet tills det börjar ackumuleras, och stiger
 * sedan allt brantare. Det beskrivs väl av en exponential över en baslinje:
 *
 *     laktat(puls) = 1,0 + a · e^(k · (puls − LT2))
 *
 * Konstanterna sätts av de två vedertagna referensvärdena — ungefär
 * 2 mmol/l vid LT1 och 4 vid LT2 — vilket ger a = 3 och
 * k = ln(3) / (LT2 − LT1). Kurvan går alltså exakt genom båda trösklarna,
 * och en löpare med tätt liggande trösklar får en brantare kurva än en med
 * glest liggande. Det är rätt beteende: smalt spann mellan trösklarna
 * betyder att laktatet stiger fort.
 *
 * Referensvärdena 2 och 4 mmol/l är konvention, inte naturlag, och individen
 * kan ligga flera mmol därifrån. Det står i förklaringen.
 *
 * ── Ritningen ────────────────────────────────────────────────────────────
 * Kurvan och fälten ritas i en svg som skalas fritt i x-led; text ligger i
 * HTML ovanpå. En <text> inne i svg:n hade dragits ut i sidled på breda
 * skärmar, precis som cirklarna gjorde i lugn-diagrammet.
 * ------------------------------------------------------------------------ */

const BASELINE_MMOL = 1;
const LT1_MMOL = 2;
const LT2_MMOL = 4;

const H = 150;
/** Taket på y-axeln. Över tio ligger man i lopp, inte i träning. */
const MAX_MMOL = 11;

export function LactateCurve({ lt1, lt2 }: { lt1: number; lt2: number }) {
  const a = LT2_MMOL - BASELINE_MMOL;
  const k = Math.log((LT2_MMOL - BASELINE_MMOL) / (LT1_MMOL - BASELINE_MMOL)) / (lt2 - lt1);
  const lactate = (hr: number) => BASELINE_MMOL + a * Math.exp(k * (hr - lt2));

  /* Axeln börjar en bit under distansbandet och slutar där kurvan passerat
     tio — bortom det är skalan bara brant och säger inget mer. Taket på 25
     slag över LT2 finns för att axeln inte ska sträcka sig till pulsvärden
     ingen har: med glest liggande trösklar (150/180) hamnar kurvans tiogräns
     först vid 213 slag, och en axel som går dit antyder att den nivån är
     nåbar. */
  const from = lt1 - 32;
  const to = Math.min(
    lt2 + Math.ceil(Math.log((MAX_MMOL - BASELINE_MMOL) / a) / k),
    lt2 + 25,
  );
  const span = to - from;

  const x = (hr: number) => ((hr - from) / span) * 100;
  const y = (mmol: number) => H - (Math.min(mmol, MAX_MMOL) / MAX_MMOL) * H;

  const path = Array.from({ length: 81 }, (_, i) => {
    const hr = from + (span * i) / 80;
    return `${i === 0 ? "M" : "L"}${x(hr).toFixed(2)} ${y(lactate(hr)).toFixed(2)}`;
  }).join(" ");

  /* Banden är desamma som växeldiagrammets mål: distans under LT1 med
     marginal, tröskel mellan trösklarna, intervall över LT2. */
  const bands = [
    { key: "distans" as const, low: lt1 - 25, high: lt1 - 8 },
    { key: "troskel" as const, low: lt1, high: lt2 },
    { key: "intervall" as const, low: lt2, high: to },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="display text-lg leading-tight font-semibold text-[var(--foreground)]">
          Så beter sig laktatet
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Mjölksyra bildas hela tiden, även i vila. Så länge kroppen hinner omsätta lika mycket som
          den bildar ligger nivån stilla — det är där de lugna passen hör hemma. Vid aeroba
          tröskeln ({lt1}) börjar den stiga, vid anaeroba ({lt2}) stiger den snabbare än kroppen
          hinner städa undan, och därefter går klockan.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex gap-3">
          <div className="relative w-10 shrink-0 text-right" style={{ height: H }} aria-hidden>
            {[2, 4, 8].map((m) => (
              <span
                key={m}
                className="absolute right-0 -translate-y-1/2 text-[0.65rem] tabular-nums text-[var(--ink-3)]"
                style={{ top: y(m) }}
              >
                {m}
              </span>
            ))}
          </div>

          <div className="relative min-w-0 flex-1">
            <svg
              viewBox={`0 0 100 ${H}`}
              preserveAspectRatio="none"
              className="w-full"
              style={{ height: H }}
              role="img"
              aria-label={`Schematisk laktatkurva. Nivån ligger stilla upp till aerob tröskel ${lt1}, stiger till anaerob tröskel ${lt2} och accelererar därefter.`}
            >
              {bands.map((b) => (
                <rect
                  key={b.key}
                  x={x(b.low)}
                  y={0}
                  width={Math.max(x(b.high) - x(b.low), 0)}
                  height={H}
                  fill={`color-mix(in oklab, ${GEAR_COLOR_VAR[b.key]} 16%, transparent)`}
                />
              ))}
              {[lt1, lt2].map((hr) => (
                <line
                  key={hr}
                  x1={x(hr)}
                  x2={x(hr)}
                  y1={0}
                  y2={H}
                  stroke="var(--ink-3)"
                  strokeWidth="1"
                  strokeDasharray="3 3"
                  vectorEffect="non-scaling-stroke"
                />
              ))}
              <path
                d={path}
                fill="none"
                stroke="var(--foreground)"
                strokeWidth="2"
                vectorEffect="non-scaling-stroke"
                strokeLinejoin="round"
              />
            </svg>

            {/* Etiketterna ligger i HTML, inte i svg:n — en <text> hade dragits
                ut i sidled av preserveAspectRatio="none". */}
            <div className="relative mt-1 h-8">
              {[
                { hr: lt1, label: "LT1" },
                { hr: lt2, label: "LT2" },
              ].map((m) => (
                <span
                  key={m.label}
                  className="absolute -translate-x-1/2 text-center text-[0.65rem] leading-tight text-[var(--ink-2)]"
                  style={{ left: `${x(m.hr)}%` }}
                >
                  <span className="block font-semibold">{m.label}</span>
                  <span className="tabular text-[var(--ink-3)]">{m.hr}</span>
                </span>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-2 text-xs text-[var(--ink-3)]">
          Y-axeln är millimol laktat per liter blod. Kurvan är <strong>schematisk</strong> — ingen
          har mätt ditt laktat. Den är ritad genom dina egna trösklar med de vedertagna
          referensvärdena 2 mmol vid LT1 och 4 vid LT2.
        </p>

        <div className="mt-4 flex flex-col gap-2">
          {[
            {
              key: "distans" as const,
              where: `under ${lt1}`,
              what: "Laktatet ligger kvar på vilovärdet. Här byggs motorn: blodvolym, kapillärer, mitokondrier. Det är den enda zonen du kan tillbringa många timmar i varje vecka.",
              section: "Sektionen Distans mäter om de lugna passen faktiskt hamnar här.",
            },
            {
              key: "troskel" as const,
              where: `${lt1}–${lt2}`,
              what: "Laktatet stiger men kroppen hinner med. Det här är farten du kan hålla länge, och att flytta LT2 uppåt är det som gör tävlingsfarten uthållig.",
              section: "Sektionen Tröskel mäter om tröskelpassen ligger i bandet — eller över det.",
            },
            {
              key: "intervall" as const,
              where: `över ${lt2}`,
              what: "Laktatet ackumuleras snabbare än det städas undan, och kurvan vänder uppåt. Här höjs taket, men bara i korta doser med vila emellan.",
              section: "Sektionen Intervall mäter om intervallerna når hit, och Syreupptag visar taket de arbetar mot.",
            },
          ].map((row) => (
            <div key={row.key} className="flex gap-2.5">
              <span
                className="mt-[7px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: GEAR_COLOR_VAR[row.key] }}
                aria-hidden
              />
              <p className="max-w-3xl text-sm text-[var(--ink-2)]">
                <strong className="font-medium text-[var(--foreground)]">
                  {GEAR_LABELS[row.key]}
                </strong>{" "}
                <span className="tabular text-[var(--ink-3)]">({row.where} slag)</span> —{" "}
                {row.what}{" "}
                <span className="text-[var(--ink-3)]">{row.section}</span>
              </p>
            </div>
          ))}
        </div>

        <details className="mt-4 rounded-lg border border-[var(--line)] p-3 text-sm">
          <summary className="cursor-pointer text-[var(--ink-2)]">
            Varför kurvans form spelar roll
          </summary>
          <p className="mt-2 text-[var(--ink-2)]">
            Avståndet mellan trösklarna avgör hur brant kurvan är. Ligger de tätt stiger laktatet
            fort så fort du passerar LT1, och marginalen mellan lugnt och hårt blir smal — då är
            det extra viktigt att de lugna passen verkligen ligger under. Ligger de glest har du
            ett brett arbetsområde att träna i.
          </p>
          <p className="mt-2 text-[var(--ink-2)]">
            Det är också därför ett pass mitt emellan trösklarna ger så lite: det är hårt nog att
            kosta återhämtning, men inte hårt nog att flytta taket, och för hårt för att bygga
            basen. Den zonen är inte förbjuden — tröskelpassen bor där — men den ska vara ett val,
            inte något man hamnar i för att de lugna passen kröp uppåt.
          </p>
          <p className="mt-2 text-[var(--ink-2)]">
            Referensvärdena 2 och 4 mmol/l är konvention. En enskild löpare kan ha sin verkliga
            tröskel flera millimol därifrån, och bara ett laktattest visar var. Kurvan här säger
            formen, inte talen.
          </p>
        </details>
      </div>
    </div>
  );
}
