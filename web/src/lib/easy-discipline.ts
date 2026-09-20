// "Är lugnt verkligen lugnt?" — disciplinen på de lugna passen.
//
// ── Varför den här mätningen behövs ──────────────────────────────────────
// Intensitetsfördelningen (lib/intensity.ts) bygger på Garmins zonhinkar, och
// de går inte att lita på: klockan levererar sekunder per zon men aldrig
// pulsgränserna de räknades mot. Står klockan på standardzoner från 220 − ålder
// hamnar zon 4 kring 163 slag, och ett lugnt pass på 168 stämplas som
// tröskelarbete. För Alice ger det 68 % "tröskel och över" av träningstiden —
// en siffra som skulle betyda överträning inom en månad om den vore sann.
//
// Den här modulen kringgår hinkarna helt. Den använder bara två tal: passets
// tidsviktade snittpuls och en personlig tröskel ur `profiles`. Ingen
// zonindelning inblandad, alltså inte känslig för klockans kalibrering.
//
// ── Varför LT1 och inte procent av max ───────────────────────────────────
// Aerob tröskel (LT1) är den fysiologiskt riktiga taknivån för lugn löpning:
// över den börjar laktatet ackumuleras och passet slutar vara återhämtning.
// Finns `profiles.lt1_hr` används den rakt av. Saknas den skattas den till
// 82 % av maxpuls — en grov men vedertagen approximation som skrivs ut i UI:t
// så att ingen tror att den är uppmätt.
//
// Målbandet läggs *under* taket, inte omkring det. Ett lugnt pass som ligger
// precis på LT1 är inte lugnt, det är så hårt det får vara utan att bli fel.
// Marginalen 8–25 slag under LT1 är den vanliga rekommendationen för
// distanslöpning i förberedelseperiod.

import type { TrainingSession } from "@/lib/sessions";
import { median } from "@/lib/stats-utils";

/** Samma filter som formkurvan (lib/efficiency.ts): bara pass som *ska* vara
 * lugna, och bara de som är långa nog att snittpulsen betyder något. En
 * 10-minuters nerjogg säger inget om disciplinen på distanspassen. */
export const EASY_CATEGORIES = ["easy", "long_run"] as const;
export const EASY_MIN_SECONDS = 20 * 60;

/** Marginal under LT1 för målbandet, i slag. */
const BAND_LOWER_MARGIN = 25;
const BAND_UPPER_MARGIN = 8;

/** LT1 ≈ 82 % av maxpuls när uppmätt värde saknas. */
const LT1_FRACTION_OF_MAX = 0.82;

export type EasyBandSource = "lt1" | "max-hr";

export type EasyBand = {
  /** Aerob tröskel: taket för lugn löpning. */
  ceiling: number;
  /** Målbandets undre och övre gräns. */
  low: number;
  high: number;
  /** Om taket är uppmätt eller skattat — avgör hur UI:t formulerar sig. */
  source: EasyBandSource;
};

/** Var ett enskilt pass hamnade. `over-ceiling` är det som betyder något:
 * passet gick över aerob tröskel och var alltså inte ett lugnt pass. */
export type EasyZone = "below" | "in-band" | "upper-margin" | "over-ceiling";

export type EasyPoint = {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  label: string;
  avgHr: number;
  durationSeconds: number;
  distanceMeters: number;
  /** Sekunder per kilometer — diagrammets höjdled. */
  paceSecondsPerKm: number;
  zone: EasyZone;
};

/* Längdfiltret. Ett distanspass på 4 km och ett på 12 km är inte samma sak:
 * pulsen driver uppåt ju längre passet blir, så ett långpass som ligger över
 * taket kan vara drift snarare än för hög fart. Att kunna hålla längden
 * konstant är det som gör jämförelsen mellan passen ärlig. */
export type EasyLengthBucket = "alla" | "kort" | "medel" | "lang";

export const EASY_LENGTH_LABELS: Record<EasyLengthBucket, string> = {
  alla: "Alla",
  kort: "0–5 km",
  medel: "5–8 km",
  lang: "Över 8 km",
};

export function easyLengthBucket(distanceMeters: number): Exclude<EasyLengthBucket, "alla"> {
  if (distanceMeters < 5000) return "kort";
  if (distanceMeters <= 8000) return "medel";
  return "lang";
}

export function filterByLength(points: EasyPoint[], bucket: EasyLengthBucket): EasyPoint[] {
  return bucket === "alla"
    ? points
    : points.filter((p) => easyLengthBucket(p.distanceMeters) === bucket);
}

/* Fartfiltret. Farten förklarar bara en del av pulsen på lugna pass — för
 * Alice ligger sambandet på r = −0,37 över ett år, alltså ungefär 13 % av
 * variationen. Just därför är fart mer användbar som *filter* än som axel:
 * håller man farten konstant syns hur mycket puls som varierar av andra skäl
 * (trötthet, värme, kupering) i stället för att sambandet ska läsas ur en
 * punktsvärm där det knappt finns.
 *
 * Gränserna är löparens egna tredjedelar, inte fasta tempon. En app som
 * delar på 5:00 och 5:30 fungerar för en löpare och lägger allt i en hink
 * för nästa. Etiketterna visar de faktiska tiderna, så indelningen ändå är
 * konkret. */
export type PaceBucket = {
  key: "snabb" | "mitten" | "langsam";
  label: string;
  /** Sekunder per km. Inklusive undre, exklusive övre. */
  from: number;
  to: number;
};

export function paceBuckets(
  points: EasyPoint[],
  format: (secondsPerKm: number) => string,
): PaceBucket[] | null {
  // Under nio pass blir tredjedelarna tre pass styck — för tunt för att en
  // uppdelning ska säga något.
  if (points.length < 9) return null;
  const sorted = [...points].map((p) => p.paceSecondsPerKm).sort((a, b) => a - b);
  const cut1 = sorted[Math.floor(sorted.length / 3)];
  const cut2 = sorted[Math.floor((sorted.length * 2) / 3)];
  if (!(cut1 < cut2)) return null;
  return [
    { key: "snabb", label: `Under ${format(cut1)}`, from: -Infinity, to: cut1 },
    { key: "mitten", label: `${format(cut1)}–${format(cut2)}`, from: cut1, to: cut2 },
    { key: "langsam", label: `Över ${format(cut2)}`, from: cut2, to: Infinity },
  ];
}

export function filterByPace(points: EasyPoint[], bucket: PaceBucket | null): EasyPoint[] {
  if (!bucket) return points;
  return points.filter(
    (p) => p.paceSecondsPerKm >= bucket.from && p.paceSecondsPerKm < bucket.to,
  );
}

export function countZones(points: EasyPoint[]): Record<EasyZone, number> {
  const counts: Record<EasyZone, number> = {
    below: 0,
    "in-band": 0,
    "upper-margin": 0,
    "over-ceiling": 0,
  };
  for (const p of points) counts[p.zone] += 1;
  return counts;
}

export type EasyDiscipline = {
  band: EasyBand;
  points: EasyPoint[];
  /** Antal pass per utfall. Summerar till `points.length`. */
  counts: Record<EasyZone, number>;
  /** Median-snittpuls över de lugna passen. Median, inte medelvärde: ett
   * enstaka pass med tappat pulsband ska inte flytta siffran. */
  medianHr: number;
  /** Andel pass över aerob tröskel, 0–1. Vyns huvudtal. */
  shareOverCeiling: number;
};

/** Bygger målbandet ur profilens pulsvärden. `null` när underlaget saknas —
 * då ska UI:t be om värdet i stället för att gissa fram ett band. */
export function easyBandFrom(
  lt1Hr: number | null,
  maxHr: number | null,
): EasyBand | null {
  if (lt1Hr != null && lt1Hr > 0) {
    return {
      ceiling: lt1Hr,
      low: lt1Hr - BAND_LOWER_MARGIN,
      high: lt1Hr - BAND_UPPER_MARGIN,
      source: "lt1",
    };
  }
  if (maxHr != null && maxHr > 0) {
    const ceiling = Math.round(maxHr * LT1_FRACTION_OF_MAX);
    return {
      ceiling,
      low: ceiling - BAND_LOWER_MARGIN,
      high: ceiling - BAND_UPPER_MARGIN,
      source: "max-hr",
    };
  }
  return null;
}

function zoneFor(avgHr: number, band: EasyBand): EasyZone {
  if (avgHr > band.ceiling) return "over-ceiling";
  if (avgHr > band.high) return "upper-margin";
  if (avgHr >= band.low) return "in-band";
  return "below";
}

export function computeEasyDiscipline(
  sessions: TrainingSession[],
  band: EasyBand | null,
): EasyDiscipline | null {
  if (band == null) return null;

  const points: EasyPoint[] = sessions
    .filter(
      (s) =>
        (EASY_CATEGORIES as readonly string[]).includes(s.category) &&
        s.durationSeconds >= EASY_MIN_SECONDS &&
        s.avgHr != null &&
        s.avgHr > 0 &&
        s.distanceMeters > 0,
    )
    .map((s) => ({
      id: s.id,
      date: s.date,
      label: s.dominantActivity.name ?? "Pass",
      avgHr: s.avgHr as number,
      durationSeconds: s.durationSeconds,
      distanceMeters: s.distanceMeters,
      paceSecondsPerKm: s.durationSeconds / (s.distanceMeters / 1000),
      zone: zoneFor(s.avgHr as number, band),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  if (points.length === 0) return null;

  const counts: Record<EasyZone, number> = {
    below: 0,
    "in-band": 0,
    "upper-margin": 0,
    "over-ceiling": 0,
  };
  for (const p of points) counts[p.zone] += 1;

  return {
    band,
    points,
    counts,
    medianHr: Math.round(median(points.map((p) => p.avgHr)) ?? 0),
    shareOverCeiling: counts["over-ceiling"] / points.length,
  };
}

/** Domen, som en mening. Skrivs föreskrivande — vyn ska säga vad man gör åt
 * det, inte bara vad som hänt (docs/tranarloopen.md avsnitt 6).
 *
 * Tar punkterna och inte hela mätningen, så att den går att räkna om på en
 * filtrerad delmängd: läsaren som filtrerar på långpass ska få en dom om
 * långpassen, inte om allt. */
export function easyVerdict(
  points: EasyPoint[],
  band: EasyBand,
): { headline: string; detail: string } {
  const n = points.length;
  if (n === 0) {
    return { headline: "Inga pass i urvalet.", detail: "Prova ett annat längdintervall." };
  }
  const counts = countZones(points);
  const over = counts["over-ceiling"];
  const medianHr = Math.round(median(points.map((p) => p.avgHr)) ?? 0);
  const ceilingWord =
    band.source === "lt1" ? "din aeroba tröskel" : "din skattade aeroba tröskel";

  if (over / n >= 0.5) {
    return {
      headline: `${over} av ${n} lugna pass låg över ${ceilingWord}.`,
      detail:
        `Medianen ligger på ${medianHr} slag, ${medianHr - band.ceiling} över taket på ` +
        `${band.ceiling}. Stämmer tröskeln liknar passen mer distansfart än återhämtning — och ` +
        `då bygger de mindre uthållighet per kilometer än riktigt lugn löpning, samtidigt som de ` +
        `kostar mer inför kvalitetspassen. Värt att pröva några pass tydligt långsammare och se ` +
        `om pulsen följer med ner.`,
    };
  }
  if (over / n >= 0.25) {
    return {
      headline: `${over} av ${n} lugna pass låg strax över ${ceilingWord}.`,
      detail:
        `Medianen ${medianHr} slag ligger inom taket, men var fjärde lugnt pass gör det inte. ` +
        `Det är oftast de längsta passen som glider uppåt — prova längdfiltret.`,
    };
  }
  return {
    headline: `${counts["in-band"] + counts["upper-margin"] + counts.below} av ${n} lugna pass låg rätt.`,
    detail:
      `Medianen ${medianHr} slag ligger under taket på ${band.ceiling}. Det ser ut att ligga ` +
      `rätt — och det är den disciplinen som gör att kvalitetspassen går att köra hårt.`,
  };
}
