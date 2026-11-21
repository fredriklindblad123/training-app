import Link from "next/link";
import { TONE_COLORS, TONE_LABELS, type Tone } from "@/lib/diary-themes";

/* En prick per anteckning (2026-11-21, ersätter de liggande staplarna).
 *
 * Staplarna fyllde alltid hela bredden — en enda rosa anteckning blev en
 * lika lång rosa stapel som tolv, och "1 av 1" såg ut som ett mönster.
 * Prickar visar hur MÅNGA anteckningar det rör sig om, så att få anteckningar
 * läses som få. I datumordning, och varje prick leder till dagen.
 *
 * Ingen bedömning: färgen är löparens egen markering i dagboken (grönt = bra,
 * rosa = mindre bra, grått = båda i samma anteckning). */

export type ToneDot = { date: string; tone: Tone | null };

export function ToneDots({
  dots,
  hrefFor,
  size = 10,
  empty = "–",
}: {
  dots: ToneDot[];
  hrefFor?: (date: string) => string;
  size?: number;
  empty?: string;
}) {
  if (dots.length === 0) return <span className="text-xs text-[var(--ink-3)]">{empty}</span>;
  return (
    <span className="flex flex-wrap gap-1" role="img" aria-label={summary(dots)}>
      {dots.map((d, i) => {
        const style = {
          width: size,
          height: size,
          backgroundColor: d.tone ? TONE_COLORS[d.tone] : "transparent",
          border: d.tone ? undefined : "1.5px solid var(--ink-3)",
        };
        const title = `${d.date.slice(8, 10).replace(/^0/, "")}/${Number(d.date.slice(5, 7))}${d.tone ? ` · ${TONE_LABELS[d.tone]}` : " · ingen färg"}`;
        return hrefFor ? (
          <Link key={`${d.date}-${i}`} href={hrefFor(d.date)} title={title} className="inline-block rounded-full" style={style} />
        ) : (
          <span key={`${d.date}-${i}`} title={title} className="inline-block rounded-full" style={style} />
        );
      })}
    </span>
  );
}

function summary(dots: ToneDot[]): string {
  const n = (t: Tone) => dots.filter((d) => d.tone === t).length;
  return `${dots.length} anteckningar: ${n("bra")} bra, ${n("blandat")} blandat, ${n("mindre_bra")} mindre bra`;
}
