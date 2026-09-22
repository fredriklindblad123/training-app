// Träningens tre växlar: distans, tröskel, intervall — var och en mätt mot
// adeptens egna trösklar.
//
// ── Varför den här indelningen ───────────────────────────────────────────
// Medeldistansträning består av tre olika jobb: bygga motorn (distans), höja
// farten som går att hålla (tröskel), och höja taket plus lära kroppen
// loppfarten (intervall). De ska ligga på tydligt åtskilda intensiteter —
// distans under LT1, tröskel mellan LT1 och LT2, intervall över LT2.
//
// När de glider ihop tränar man i praktiken bara en sak, oavsett vad passen
// heter. För Alice ligger tröskel- och intervallpassens medianpuls två slag
// isär (182 mot 184), och deras mittersta hälfter överlappar på 181–186.
// Det går inte att se i Intensitetsfördelningen, eftersom den bygger på
// Garmins zonhinkar och klockan aldrig skickar gränserna den räknade mot.
// Den här modulen använder bara puls och profilens trösklar.
//
// ── Varför aerob/anaerob inte duger ──────────────────────────────────────
// På 1500 m kommer ungefär fyra femtedelar av energin aerobt. En sådan
// indelning lägger nästan all träning i en låda, och — värre — slår ihop
// tröskel och VO2max-arbete, som är just det par som behöver hållas isär.

import type { TrainingSession } from "@/lib/sessions";
import { percentile } from "@/lib/stats-utils";
import { formatRaceTime, type PaceBasis } from "@/lib/race-pace";

export type GearKey = "distans" | "troskel" | "intervall";

export const GEAR_LABELS: Record<GearKey, string> = {
  distans: "Distans",
  troskel: "Tröskel",
  intervall: "Intervall",
};

export const GEAR_PURPOSE: Record<GearKey, string> = {
  distans: "Bygga motorn. Utdelningen kommer av tid på foten vid låg intensitet.",
  troskel: "Höja farten du kan hålla. Arbete mellan trösklarna, aldrig över.",
  intervall: "Höja taket och lära kroppen loppfarten. Ska ligga tydligt över LT2.",
};

/** Färgvariabel per växel — samma ordning som intensiteten stiger. */
export const GEAR_COLOR_VAR: Record<GearKey, string> = {
  distans: "var(--zone-2)",
  troskel: "var(--status-watch)",
  intervall: "var(--status-concern)",
};

export type GearBand = { low: number; high: number };
export type GearStats = { p25: number; median: number; p75: number; n: number };

export type Gear = {
  key: GearKey;
  target: GearBand;
  /** null när perioden saknar underlag för växeln. */
  actual: GearStats | null;
  /** Andel av underlaget som hamnade över växelns tak, 0–1. null för
   * intervall, som inte har något meningsfullt tak, och i fartvyn. */
  shareOverCeiling: number | null;
};

/** En vy av samma tre växlar: puls eller fart. Axeln är alltid orienterad så
 * att hårdare arbete ligger till höger — i fartvyn betyder det att skalan
 * går från långsamt till snabbt, alltså fallande sekunder per kilometer. */
export type GearView = {
  gears: Gear[];
  axisMin: number;
  axisMax: number;
  /** Referenslinjer: LT1/LT2 i pulsvyn, tävlingsfart i fartvyn. */
  markers: { value: number; label: string }[];
  /** Var målbanden kommer ifrån — skrivs ut i UI:t. */
  source: string;
};

export type TrainingGears = {
  /** null när profilen saknar trösklar — fartvyn fungerar ändå. */
  hr: GearView | null;
  /** null när tävlingsfart saknas — då går fartmålen inte att härleda. */
  pace: GearView | null;
  lt1: number | null;
  lt2: number | null;
};

/** En repetition ur ett kvalitetspass, redan filtrerad på `split_type`. */
export type GearRep = {
  category: string;
  distanceMeters: number;
  durationSeconds: number;
  avgHr: number;
};

/* Distans mäts per *pass* (ett distanspass har en intensitet), tröskel och
 * intervall per *varv* (ett intervallpass har en per repetition). Olika
 * enheter i samma diagram är avsiktligt, men måste skrivas ut i UI:t.
 *
 * Varvgolvet på 400 m finns för att snittpulsen ska hinna bli meningsfull:
 * på ett 200-metersryck ligger pulsen efter hela vägen och underskattar
 * ansträngningen. Följden är att jämförelsen mellan tröskel och intervall
 * snarast *underskattar* hur lika passen är. */
export const GEAR_MIN_REP_METERS = 400;
/* Tidsgolv utöver distansgolvet. Pulsen ligger efter i början av varje
 * repetition, och på ett snabbt 400-metersvarv hinner den aldrig ikapp — ett
 * inledande varv drar då ner snittet utan att säga något om intensiteten.
 * 60 sekunder är den punkt där avg_hr börjar beskriva arbetet i stället för
 * uppladdningen till det. */
export const GEAR_MIN_REP_SECONDS = 60;
export const GEAR_MIN_SESSION_SECONDS = 20 * 60;

/** Marginal under LT1 för distansmålet, samma som lib/easy-discipline.ts. */
const EASY_LOWER_MARGIN = 25;
const EASY_UPPER_MARGIN = 8;

/* ------------------------- fartmålen ------------------------------------ *
 * Fartbanden härleds ur tävlingsfarten (lib/race-pace.ts), inte ur pulsen.
 * Två skäl:
 *
 *  1. Att härleda dem ur hennes eget utfall går inte. Farten på tröskel- och
 *     intervallvarv är i praktiken densamma oavsett om pulsen låg i bandet
 *     eller inte (3:41–4:00 mot 3:43–3:57 per km), och för distans finns bara
 *     en handfull pass med puls i målbandet. Utfallet bär alltså ingen
 *     information om vilken fart som hör till vilken växel.
 *  2. Tävlingsfarten är *oberoende av trösklarna*. När LT1 och LT2 är
 *     skattade värden ger fartvyn en andra, fristående bild av samma fråga.
 *
 * Multiplarna är konvention, inte naturlag, och skrivs ut i UI:t. De är
 * kalibrerade mot 1500 m som referensgren; för en 800-löpare blir de för
 * snabba och bör då läsas som en grov riktning.                            */
export const PACE_MULTIPLIERS: Record<GearKey, [number, number]> = {
  // Lugn distans: klart långsammare än tröskel. Undre gränsen 1,70 ligger
  // där Alices egen puls faktiskt hamnar i målbandet (under 5:30/km).
  distans: [1.7, 1.95],
  // Tröskelfart, strax långsammare än 3000-fart.
  troskel: [1.15, 1.27],
  // Från 1500-fart till VO2max-fart. Bandet är brett med flit: växeln
  // rymmer både 400:or i loppfart och 1000:or i 3000-fart, och ett smalt
  // band hade underkänt de längre repetitionerna för att de är långsammare
  // än 1500-farten — vilket de ska vara. Den repspecifika jämförelsen görs
  // i stället per passtyp under Passkvalitet, som känner varvlängden.
  intervall: [0.95, 1.18],
};

/** Intervallmålets tak när maxpuls saknas: LT2 + 17 slag. */
const INTERVAL_SPAN_WITHOUT_MAX = 17;
/** Andel av maxpuls som övre gräns när den finns — över det är det lopp. */
const INTERVAL_CEILING_FRACTION = 0.97;

function statsFrom(values: number[]): GearStats | null {
  if (values.length < 4) return null;
  const p25 = percentile(values, 0.25);
  const median = percentile(values, 0.5);
  const p75 = percentile(values, 0.75);
  if (p25 == null || median == null || p75 == null) return null;
  return {
    p25: Math.round(p25),
    median: Math.round(median),
    p75: Math.round(p75),
    n: values.length,
  };
}

function buildView(
  values: Record<GearKey, number[]>,
  targets: Record<GearKey, GearBand>,
  ceilings: Record<GearKey, number | null>,
  markers: { value: number; label: string }[],
  source: string,
  /** Fartaxeln går från långsamt till snabbt, alltså fallande värden. */
  descending = false,
): GearView | null {
  const gears: Gear[] = (["distans", "troskel", "intervall"] as GearKey[]).map((key) => {
    const vals = values[key];
    const ceiling = ceilings[key];
    return {
      key,
      target: targets[key],
      actual: statsFrom(vals),
      shareOverCeiling:
        ceiling != null && vals.length > 0
          ? vals.filter((v) => (descending ? v < ceiling : v > ceiling)).length / vals.length
          : null,
    };
  });
  if (gears.every((g) => g.actual == null)) return null;

  const all = [
    ...gears.flatMap((g) => [g.target.low, g.target.high]),
    ...gears.flatMap((g) => (g.actual ? [g.actual.p25, g.actual.p75] : [])),
    ...markers.map((m) => m.value),
  ];
  const pad = (Math.max(...all) - Math.min(...all)) * 0.08;
  return {
    gears,
    axisMin: Math.min(...all) - pad,
    axisMax: Math.max(...all) + pad,
    markers,
    source,
  };
}

export function computeTrainingGears(
  sessions: TrainingSession[],
  reps: GearRep[],
  lt1Hr: number | null,
  lt2Hr: number | null,
  maxHr: number | null,
  paceBasis: PaceBasis | null,
): TrainingGears | null {
  /* Vyerna byggs oberoende av varandra. Pulsvyn kräver båda trösklarna — att
   * skatta den ena ur den andra hade gett band byggda på en gissning, och
   * hela poängen är att de är personliga. Fartvyn kräver i stället en
   * måltid eller ett resultat. En löpare som har det ena men inte det andra
   * ska få den vy som går att räkna fram, inte ingen vy alls. */
  const hasThresholds = lt1Hr != null && lt2Hr != null && lt1Hr > 0 && lt2Hr > lt1Hr;

  const easySessions = sessions.filter(
    (s) =>
      (s.category === "easy" || s.category === "long_run") &&
      s.durationSeconds >= GEAR_MIN_SESSION_SECONDS &&
      s.distanceMeters > 2000,
  );

  const keepRep = (r: GearRep, category: string) =>
    r.category === category &&
    r.distanceMeters >= GEAR_MIN_REP_METERS &&
    r.durationSeconds >= GEAR_MIN_REP_SECONDS;

  /* ---------------------------- pulsvyn ---------------------------------- */
  const hrValues: Record<GearKey, number[]> = {
    distans: easySessions.filter((s) => s.avgHr && s.avgHr > 0).map((s) => s.avgHr as number),
    troskel: reps.filter((r) => keepRep(r, "threshold")).map((r) => r.avgHr),
    intervall: reps.filter((r) => keepRep(r, "interval")).map((r) => r.avgHr),
  };

  const intervalCeiling = maxHr
    ? Math.round(maxHr * INTERVAL_CEILING_FRACTION)
    : (lt2Hr ?? 0) + INTERVAL_SPAN_WITHOUT_MAX;

  const hr = hasThresholds
    ? buildView(
        hrValues,
        {
          distans: { low: (lt1Hr as number) - EASY_LOWER_MARGIN, high: (lt1Hr as number) - EASY_UPPER_MARGIN },
          troskel: { low: lt1Hr as number, high: lt2Hr as number },
          intervall: { low: lt2Hr as number, high: Math.max(intervalCeiling, (lt2Hr as number) + 6) },
        },
        // Taket per växel. Intervall har inget: ett varv över LT2 gör precis
        // vad det ska.
        { distans: lt1Hr as number, troskel: lt2Hr as number, intervall: null },
        [
          { value: lt1Hr, label: "LT1" },
          { value: lt2Hr, label: "LT2" },
        ],
        "Banden kommer ur aerob och anaerob tröskel i din profil.",
      )
    : null;

  /* ---------------------------- fartvyn ---------------------------------- */
  const paceOf = (r: GearRep) => r.durationSeconds / (r.distanceMeters / 1000);
  const racePacePerKm = paceBasis?.perKm ?? null;
  const pace = racePacePerKm && paceBasis
    ? buildView(
        {
          distans: easySessions.map((s) => s.durationSeconds / (s.distanceMeters / 1000)),
          troskel: reps.filter((r) => keepRep(r, "threshold")).map(paceOf),
          intervall: reps.filter((r) => keepRep(r, "interval")).map(paceOf),
        },
        {
          distans: {
            low: racePacePerKm * PACE_MULTIPLIERS.distans[0],
            high: racePacePerKm * PACE_MULTIPLIERS.distans[1],
          },
          troskel: {
            low: racePacePerKm * PACE_MULTIPLIERS.troskel[0],
            high: racePacePerKm * PACE_MULTIPLIERS.troskel[1],
          },
          intervall: {
            low: racePacePerKm * PACE_MULTIPLIERS.intervall[0],
            high: racePacePerKm * PACE_MULTIPLIERS.intervall[1],
          },
        },
        // I fartvyn är felet att springa för *fort* på distans och tröskel:
        // taket är bandets snabba kant, och `descending` vänder jämförelsen.
        {
          distans: racePacePerKm * PACE_MULTIPLIERS.distans[0],
          troskel: racePacePerKm * PACE_MULTIPLIERS.troskel[0],
          intervall: null,
        },
        [{ value: racePacePerKm, label: paceBasis.kind === "mal" ? "Målfart" : "Tävlingsfart" }],
        paceSource(paceBasis),
        true,
      )
    : null;

  if (hr == null && pace == null) return null;
  return { hr, pace, lt1: lt1Hr, lt2: lt2Hr };
}

/** Var fartbanden kommer ifrån, som en mening. Basen ska alltid vara synlig:
 * ett målbanden-system som tyst byter referens mellan mål och personbästa är
 * omöjligt att lita på. */
function paceSource(basis: PaceBasis): string {
  const time = formatRaceTime(basis.seconds);
  const event = `${basis.distanceMeters} m`;
  const converted =
    basis.distanceMeters === 1500
      ? ""
      : ` (motsvarar ${formatRaceTime(basis.equivalent1500)} på 1500 m)`;
  return basis.kind === "mal"
    ? `Banden härleds ur ditt mål ${time} på ${event}${converted} — alltså oberoende av trösklarna.`
    : `Banden härleds ur ditt bästa resultat ${time} på ${event}${converted}. Sätt en måltid under Inställningar så utgår de från den i stället.`;
}

/* ------------------------------- domar ----------------------------------- */

/** Formaterar sekunder per kilometer som m:ss. */
export function formatPacePerKm(secondsPerKm: number): string {
  const m = Math.floor(secondsPerKm / 60);
  const sec = Math.round(secondsPerKm - m * 60);
  return sec === 60 ? `${m + 1}:00` : `${m}:${String(sec).padStart(2, "0")}`;
}

/** Hur nära varandra tröskel och intervall ligger, i vyns egen enhet.
 * `null` när någon av dem saknar underlag. Det är växeldiagrammets
 * huvudtal: är skillnaden liten tränas samma sak två gånger i veckan under
 * olika namn. Beloppet, inte tecknet — fartvyn räknar åt andra hållet. */
export function gearSeparation(view: GearView): number | null {
  const t = view.gears.find((x) => x.key === "troskel")?.actual;
  const i = view.gears.find((x) => x.key === "intervall")?.actual;
  if (!t || !i) return null;
  return Math.abs(i.median - t.median);
}

/* Domarna beskriver, de dömer inte.
 *
 * Varje tal här vilar på trösklarna i profilen, och de kan vara satta några
 * slag fel. "Det är intervallarbete, inte tröskel" lät som ett konstaterande
 * när det i själva verket var en slutsats med ett villkor. Texterna namnger
 * därför villkoret, och där det finns två rimliga förklaringar nämns båda —
 * att träningen ligger fel ELLER att tröskeln gör det. */
export function gearVerdict(gear: Gear, lt1: number, lt2: number): string {
  const a = gear.actual;
  if (!a) return "För lite underlag i perioden för att säga något.";
  const pct = gear.shareOverCeiling != null ? Math.round(gear.shareOverCeiling * 100) : null;

  switch (gear.key) {
    case "distans":
      return a.median > lt1
        ? `Medianpuls ${a.median} mot aerob tröskel ${lt1} — ${pct} % av passen ligger över. Värt att titta närmare på.`
        : `Medianpuls ${a.median}, under aerob tröskel ${lt1}. Ser ut att ligga rätt.`;
    case "troskel":
      return pct != null && pct >= 25
        ? `${pct} % av varven ligger över ${lt2}. Stämmer tröskeln liknar passen mer intervall än tröskel.`
        : `Medianpuls ${a.median}, inom bandet ${lt1}–${lt2}.`;
    case "intervall":
      return a.median >= lt2
        ? `Medianpuls ${a.median}, över anaerob tröskel ${lt2}.`
        : `Medianpuls ${a.median}, under ${lt2} — antingen går intervallerna inte hårt nog, eller så ligger tröskeln högre än angivet.`;
  }
}

