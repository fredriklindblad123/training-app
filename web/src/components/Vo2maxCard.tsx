import { Stat, StatRow, StatCell } from "@/components/ui/Stat";
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
          Hur mycket syre kroppen kan ta upp och använda per minut — det aeroba taket som
          tröskelfarten och loppfarten ligger under. Talet är Garmins skattning ur förhållandet
          mellan fart och puls, inte en mätning.
        </p>
      </div>

      <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <p className="text-base font-medium text-[var(--foreground)]">{verdict.headline}</p>
        <p className="mt-1 max-w-2xl text-sm text-[var(--ink-2)]">{verdict.detail}</p>

        <StatRow columns={3}>
          <StatCell>
            <Stat label="Nu" value={trend.current} sub="senaste mätningen" />
          </StatCell>
          <StatCell>
            <Stat label="Spann i perioden" value={`${min}–${max}`} sub={`${points.length} dagar`} />
          </StatCell>
          <StatCell>
            <Stat
              label="Förändring"
              value={
                trend.direction === "oförändrad"
                  ? "—"
                  : `${trend.change > 0 ? "+" : ""}${trend.change.toFixed(1)}`
              }
              sub="första mot sista tredjedelen"
            />
          </StatCell>
        </StatRow>

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
            Vad det betyder och hur du påverkar det
          </summary>
          <p className="mt-2 text-[var(--ink-2)]">
            Syreupptaget sätts av hur mycket blod hjärtat pumpar per slag och hur väl musklerna
            tar upp syret ur det. Det är taket för vad du kan prestera aerobt — men bara taket.
            Två löpare med samma syreupptag kan skilja en halvminut på 1500 m, eftersom
            löpekonomi och hur stor andel av taket du kan hålla avgör resten.
          </p>
          <p className="mt-2 text-[var(--ink-2)]">
            <strong className="text-[var(--foreground)]">Det som höjer det:</strong> arbete nära
            taket, alltså intervaller på tre till fem minuter i ungefär 3000-meterfart med
            tillräcklig vila för att kunna hålla farten hela vägen. Det är intervallväxelns
            uppgift. Men effekten kommer bara om basen bär den: distansvolymen bygger
            blodvolymen och kapillärnätet som avgör hur mycket syre som kan levereras, och utan
            den planar intervallerna ut snabbt.
          </p>
          <p className="mt-2 text-[var(--ink-2)]">
            <strong className="text-[var(--foreground)]">Det som inte höjer det:</strong> mer
            medelhård löpning. Ligger de lugna passen för nära tröskeln tränas varken taket eller
            basen — du blir tröttare utan att något av de två systemen får rätt stimulans.
          </p>
          <p className="mt-2 text-[var(--ink-2)]">
            <strong className="text-[var(--foreground)]">Läs det försiktigt.</strong> Skattningen
            bygger på fart vid given puls, så den rör sig av värme, kupering, uttorkning och
            pulsbandets dagsform. Klockan rapporterar dessutom heltal — ett steg upp eller ner
            mellan två pass är avrundning, inte kapacitet. Följ riktningen över månader, aldrig
            mellan två enskilda pass.
          </p>
        </details>
      </div>
    </div>
  );
}
