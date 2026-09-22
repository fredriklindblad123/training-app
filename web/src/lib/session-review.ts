import { easyBandFrom } from "@/lib/easy-discipline";
import { PACE_MULTIPLIERS } from "@/lib/training-gears";
import { paceBasisFromGoal, formatRaceTime } from "@/lib/race-pace";
import type { PhaseType } from "@/lib/planning";

/* "Så gick passet" — en kort läsning av ETT genomfört pass.
 *
 * Begäran 2026-09-22. Förslaget var två mått: pulsslag per meter på
 * distanspassen mot senaste fyra veckorna, och intervaller mot måltiden.
 * Båda mättes mot Alices data först, och båda behövde skrivas om.
 *
 * SLAG PER METER PER PASS GÅR INTE. Mätt på 73 distanspass sedan maj 2026:
 * spridningen mellan enskilda pass är ±5 %, medan hela rörelsen i
 * fyraveckorsmedianen under fem månader är ±4 %. Bruset i ett pass är
 * alltså större än säsongens signal. Dessutom förklarar FARTEN 37 % av
 * variationen (r²=0,373): hennes puls på distanspass är nästan konstant
 * (std 6,6 slag, korrelation med fart −0,21, vilket är bra lugnlöpning),
 * och då blir slag/meter i praktiken en mätning av hur fort hon valde att
 * springa. De två "sämsta" veckorna i materialet var de två långsammaste —
 * återhämtningsjogg. Ett omdöme byggt på det hade sagt att hon tappat form
 * för att hon lunkat lugnt.
 *
 * Avdrift (puls första mot andra halvan) hade varit rätt mått, eftersom det
 * jämför passet med sig självt och annullerar värme, underlag och klockfel.
 * Det går inte att bygga: bara 7 % av distanspassen har varvdata. Hon
 * trycker inte varv på lunken. Intervall har 100 %, tröskel 69 %.
 *
 * Kvar för distanspass finns den fråga ett enskilt pass faktiskt kan svara
 * på: VAR DET LUGNT. Det är utförande, inte form. Formen bor kvar i
 * fyraveckorskurvan på /trender (lib/efficiency.ts), där den hör hemma.
 *
 * RIEGEL PÅ REPS GÅR INTE HELLER. Testat på hennes riktiga intervallpass:
 * omräkningen gav 5:25–6:12 på 1500 m när hon i verkligheten springer
 * 4:42,72. Fel med 40–90 sekunder. Riegel förutsätter ett sammanhängande
 * maxlopp, och ett rep med 90 sekunders vila är medvetet submaximalt —
 * formeln vet inget om vilan. Det som fungerar är att jämföra reppen mot
 * det FARTBAND målet implicerar (PACE_MULTIPLIERS, samma band som
 * Träningens tre växlar visar), inte mot en förutsagd tid.
 *
 * Och jämförelsen är FASBEROENDE. I ett allmänt förberedande block ska
 * reppen vara långsammare än tävlingsfart; Almgrens tävlingsfartsintervaller
 * hör hemma 6–12 veckor före tävlingsperioden. Mäter man ett septemberpass
 * mot ett mål i augusti nästa år underkänns varje pass.
 *
 * Tonen är observation, aldrig betyg (begäran 2026-09-19: vägledande, inte
 * tvärsäkert). "Snittpuls 158, under din LT1 på 169" — inte "under
 * förväntan". Läsaren är femton år och passet är redan gjort. */

export type ReviewTone = "neutral" | "good" | "note";

export type SessionReview = {
  /** Kort konstaterande, en mening. */
  headline: string;
  tone: ReviewTone;
  /** Noll till två stödjande rader. */
  lines: string[];
  /** Vad läsningen vilar på och var den kan ha fel. Alltid utskriven när
   * slutsatsen bygger på ett självskattat värde. */
  caveat: string | null;
};

export type ReviewRep = {
  distanceMeters: number;
  durationSeconds: number;
  avgHr: number | null;
};

export type ReviewInput = {
  category: string | null;
  avgHr: number | null;
  distanceMeters: number;
  durationSeconds: number;
  /** Sammanslagna arbetsreps (merged_splits, is_rest=false). Tom lista när
   * passet saknar varvdata — då säger vi inget om repen i stället för att
   * gissa ur snittfarten, som blandar in uppvärmning och vila. */
  reps: ReviewRep[];
  lt1Hr: number | null;
  lt2Hr: number | null;
  maxHr: number | null;
  /** Självskattat LT2 gör slutsatsen mjukare, se caveat. */
  lt2Source: string | null;
  goalEvent: string | null;
  goalSeconds: number | null;
  /** Fasen för blocket dagen ligger i, null i ett glapp. */
  phase: PhaseType | null;
};

/** Reps kortare än så här säger inget om uthållig fart — de är för korta
 * för att pulsen eller farten ska hinna bli representativ. Samma gränser
 * som växlarna använder (GEAR_MIN_REP_*). */
const MIN_REP_METERS = 400;
const MIN_REP_SECONDS = 60;

/* Uppvärmning och nerjogg är INTE markerade som vila i merged_splits — de
 * är vanliga varv, bara långa. Ett filter på storlek släpper därför igenom
 * dem, och då mäts uppvärmningen som om den vore ett rep.
 *
 * Mätt på Alices tröskelpass 2026-08-06 ("7x3min/60sek vila"): uppvärmning
 * 3770 m och nerjogg 2772 m räknades in bland fem riktiga rep på ~740 m,
 * och passets fart blev 270 s/km i stället för 241. Fyra av nitton
 * kvalitetspass sedan juli hade samma fel, alla åt samma håll — de såg
 * långsammare ut än de var.
 *
 * Regeln som skiljer dem åt är fart, inte längd: ett arbetsrep ligger nära
 * passets snabbaste rep, en uppvärmning gör det aldrig. Fönstret är
 * avsiktligt generöst (15 %) så att ett ärligt sista rep som segnat inte
 * faller ur. Testat mot samtliga kvalitetspass sedan juli 2026: de fyra
 * trasiga rättas, de övriga fjorton rörs inte. */
const REP_PACE_WINDOW = 1.15;

/** Faser där tävlingsfart är själva poängen, och där en jämförelse mot
 * måltiden alltså är relevant. I allmänt förberedande block SKA reppen
 * ligga lugnare, så där vore jämförelsen missvisande. */
const RACE_PACE_PHASES: PhaseType[] = [
  "tavlingsforberedande",
  "tavling_form",
  "tavling_stabiliserande",
  "stabiliserande",
];

function perKm(meters: number, seconds: number): number {
  return seconds / (meters / 1000);
}

export function formatPaceShort(secondsPerKm: number): string {
  const s = Math.round(secondsPerKm);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** Distans och långpass: var passet lugnt? */
function reviewEasy(input: ReviewInput): SessionReview | null {
  const band = easyBandFrom(input.lt1Hr, input.maxHr);
  if (!band || input.avgHr == null) return null;

  const hr = Math.round(input.avgHr);
  const selfReported = input.lt2Source === "manuell";
  const caveat = selfReported
    ? "Din LT1 är självskattad, så gränsen är ungefärlig."
    : null;

  // Marginalen finns för att snittpulsen drar med sig uppvärmning och
  // backar. Några slag över taket är inte ett hårt pass.
  if (hr <= band.ceiling) {
    return {
      headline: `Lugnt pass: snittpuls ${hr}, under din LT1 på ${band.ceiling}.`,
      tone: "good",
      lines: [
        "Distanspassets uppgift är att bygga grunden utan att kosta något. Den här låg rätt.",
      ],
      caveat,
    };
  }
  if (hr <= band.ceiling + 6) {
    return {
      headline: `Snittpuls ${hr}, precis över din LT1 på ${band.ceiling}.`,
      tone: "neutral",
      lines: [
        "Nära gränsen. Backar och en hård uppvärmning drar upp snittet, så det behöver inte betyda att passet var för hårt.",
      ],
      caveat,
    };
  }
  return {
    headline: `Snittpuls ${hr}, över din LT1 på ${band.ceiling}.`,
    tone: "note",
    lines: [
      "Det här låg hårdare än ett distanspass brukar. Ibland är det avsikten, ibland är det terrängen eller sällskapet.",
    ],
    caveat,
  };
}

/** Tröskel och intervall: låg reppen i det band målet implicerar? */
function reviewQuality(input: ReviewInput): SessionReview | null {
  const candidates = input.reps.filter(
    (r) =>
      r.distanceMeters >= MIN_REP_METERS &&
      r.durationSeconds >= MIN_REP_SECONDS &&
      r.distanceMeters > 0,
  );
  if (candidates.length < 2) return null;

  const fastest = Math.min(...candidates.map((r) => perKm(r.distanceMeters, r.durationSeconds)));
  const work = candidates.filter(
    (r) => perKm(r.distanceMeters, r.durationSeconds) <= fastest * REP_PACE_WINDOW,
  );
  // Under två rep går det inte att säga något om passets fart — ett ensamt
  // varv kan vara vad som helst.
  if (work.length < 2) return null;

  const totalM = work.reduce((n, r) => n + r.distanceMeters, 0);
  const totalS = work.reduce((n, r) => n + r.durationSeconds, 0);
  const pace = perKm(totalM, totalS);
  const avgM = Math.round(totalM / work.length);

  const repLine = `${work.length} reps på snitt ${avgM} m i ${formatPaceShort(pace)}/km.`;

  const basis = paceBasisFromGoal(input.goalEvent, input.goalSeconds);
  if (!basis) {
    return {
      headline: repLine,
      tone: "neutral",
      lines: [
        "Lägg in ett måltid under Inställningar, så kan passet också jämföras mot farten målet kräver.",
      ],
      caveat: null,
    };
  }

  const key = input.category === "threshold" ? "troskel" : "intervall";
  const [lo, hi] = PACE_MULTIPLIERS[key];
  const low = basis.perKm * lo;
  const high = basis.perKm * hi;
  const label = key === "troskel" ? "tröskelbandet" : "intervallbandet";
  const bandText = `${formatPaceShort(low)}–${formatPaceShort(high)}/km`;
  const goalText = `${formatRaceTime(basis.seconds)} på ${input.goalEvent}`;

  const racePhase = input.phase != null && RACE_PACE_PHASES.includes(input.phase);

  /* Utanför bandet åt det långsamma hållet är INTE ett underkänt pass i ett
     allmänt block — det är vad ett allmänt block går ut på. Därför avgör
     fasen vad avvikelsen betyder, inte avvikelsen själv. */
  if (pace >= low && pace <= high) {
    return {
      headline: repLine,
      tone: "good",
      lines: [`Det ligger i ${label} ditt mål ${goalText} innebär (${bandText}).`],
      caveat: null,
    };
  }
  if (pace < low) {
    return {
      headline: repLine,
      tone: "note",
      lines: [
        `Snabbare än ${label} för ${goalText} (${bandText}). Hårt arbete — frågan är om nästa pass blir lidande.`,
      ],
      caveat: null,
    };
  }
  return {
    headline: repLine,
    tone: racePhase ? "note" : "neutral",
    lines: [
      racePhase
        ? `Lugnare än ${label} för ${goalText} (${bandText}). Så här nära tävling brukar reppen ligga närmare målfarten.`
        : `Lugnare än ${label} för ${goalText} (${bandText}) — vilket är meningen så här långt från tävling. Tävlingsfarten kommer när blocket byter fas.`,
    ],
    caveat: null,
  };
}

/** Läsningen av ett pass, eller null när underlaget inte räcker. Null är ett
 * fullgott svar: ett pass utan pulsdata eller utan varv ska inte få ett
 * omdöme byggt på gissningar. */
export function reviewSession(input: ReviewInput): SessionReview | null {
  switch (input.category) {
    case "easy":
    case "long_run":
      return reviewEasy(input);
    case "threshold":
    case "interval":
      return reviewQuality(input);
    default:
      return null;
  }
}
