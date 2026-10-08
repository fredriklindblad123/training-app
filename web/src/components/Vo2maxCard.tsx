import { vo2maxVerdict, type Vo2maxTrend } from "@/lib/vo2max";

/* ------------------------------------------------------------------------ *
 * Vo2maxCard — det aeroba taket.
 *
 * ── Trappa, inte kurva ────────────────────────────────────────────────────
 * Garmin levererar heltal, och för en tränad löpare rör sig talet några
 * enheter om året. En mjuk linje mellan punkterna hade antytt en upplösning
 * som inte finns; en trappa säger sanningen: värdet står stilla i veckor och
 * hoppar sedan ett steg. Spannet skrivs ut bredvid, så ett hopp på ±1 läses
 * som det brus det är.
 *
 * ── Varför kortet finns ───────────────────────────────────────────────────
 * Syreupptaget är taket som tröskeln och loppfarten ligger under. Det
 * förklarar varför vyn placerar det bredvid formkurvan: båda svarar på "blir
 * motorn större", och båda är skattningar ur fart och puls med samma
 * svagheter. Att visa dem tillsammans gör att de kan läsas mot varandra i
 * stället för att motsäga varandra på var sitt håll i vyn.
 * ------------------------------------------------------------------------ */

const H = 90;

export function Vo2maxCard({ trend }: { trend: Vo2maxTrend }) {
  const verdict = vo2maxVerdict(trend);
  const { points, min, max } = trend;

  /* Skalan får alltid minst fyra enheters spann. Utan det blir ett år som
     rör sig mellan 58 och 59 en dramatisk berg-och-dalbana över hela
     kortets höjd, vilket är precis den överdrift talet inte tål. */
  const mid = (min + max) / 2;
  const half = Math.max((max - min) / 2, 2) + 0.5;
  const lo = mid - half;
  const hi = mid + half;

  const x = (i: number) => (points.length === 1 ? 50 : (i / (points.length - 1)) * 100);
  const y = (v: number) => ((hi - v) / (hi - lo)) * H;

  /* Trappa: vågrätt till nästa datum, sedan lodrätt till nya värdet. */
  const stepped = points
    .map((p, i) => (i === 0 ? `M${x(i)} ${y(p.value)}` : `H${x(i)} V${y(p.value)}`))
    .join(" ");

  return (
    <div className="flex flex-col gap-3">
      <div>
        <h3 className="display text-lg leading-tight font-semibold text-[var(--foreground)]">
          Syreupptag (VO2max)
        </h3>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Kroppens syretak. Garmins skattning ur fart och puls, inte en mätning.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <p className="text-base font-medium text-[var(--foreground)]">{verdict.headline}</p>
        {/* Tre tal på en rad, alltid tre kolumner. Rubriken ovanför säger
            redan riktningen; här står bara talen den vilar på. */}
        <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
          {[
            { label: "Nu", value: String(trend.current) },
            {
              label: "Förändring",
              value:
                trend.direction === "oförändrad"
                  ? "—"
                  : `${trend.change > 0 ? "+" : ""}${trend.change.toFixed(1)}`,
            },
            { label: `Spann, ${points.length} d`, value: `${min}–${max}` },
          ].map((st) => (
            <div key={st.label} className="rounded-md bg-[var(--surface-raised)] px-2 py-2">
              <dt className="text-[0.65rem] tracking-wider text-[var(--ink-3)] uppercase">{st.label}</dt>
              <dd className="display tabular text-xl font-semibold text-[var(--foreground)]">{st.value}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-4 flex gap-3">
          <div className="relative w-8 shrink-0" style={{ height: H }} aria-hidden>
            {[max, min].map((v) => (
              <span
                key={v}
                className="absolute right-0 -translate-y-1/2 text-[0.65rem] tabular-nums text-[var(--ink-3)]"
                style={{ top: y(v) }}
              >
                {v}
              </span>
            ))}
          </div>
          <svg
            viewBox={`0 0 100 ${H}`}
            preserveAspectRatio="none"
            className="h-[90px] w-full"
            role="img"
            aria-label={`Syreupptag över perioden, mellan ${min} och ${max}. Senaste värdet ${trend.current}.`}
          >
            <path
              d={stepped}
              fill="none"
              stroke="var(--zone-3)"
              strokeWidth="2"
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </svg>
        </div>

        <details className="mt-4 rounded-lg border border-[var(--line)] p-3 text-sm">
          <summary className="cursor-pointer text-[var(--ink-2)]">
            Vad som höjer det
          </summary>
          <ul className="mt-2 flex list-disc flex-col gap-1 pl-5 text-[var(--ink-2)]">
            <li>Intervaller på 3–5 minuter i ungefär 3000-meterfart, med vila så farten håller.</li>
            <li>En stadig distansbas — utan den planar intervallerna snabbt ut.</li>
            <li>
              Inte mer medelhård löpning: lugna pass som kryper upp mot tröskeln tränar varken
              taket eller basen.
            </li>
            <li>
              Talet rör sig av värme och kupering och avrundas till heltal. Följ riktningen över
              månader.
            </li>
          </ul>
        </details>
      </div>
    </div>
  );
}
