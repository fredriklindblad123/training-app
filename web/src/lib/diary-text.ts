/* ---------------------------------------------------------------------------
 * P2.2 i docs/insikter-roadmap.md: dagbokstext → strukturerad känsla.
 *
 * Varför detta finns: rpe/mood/soreness är null i samtliga befintliga
 * dagboksrader, och den dagliga incheckningen (P0.4) ger bara data framåt.
 * Men atleten har redan skrivit 214 dagar av egna ord om hur passen kändes.
 * Textanalys är den enda vägen till subjektiv historik *bakåt* — och den
 * enda vägen att få korrelationerna på /trends att räkna på något, nu när
 * sömndata täcker 241 av dagboksdagarna.
 *
 * ── Vilket fält som analyseras ────────────────────────────────────────────
 * ENDAST `notes`. PDF-importen skilde redan idrottarens egna ord (grönt/rosa)
 * från träningsloggen (`session_log`, svart faktatext) och tränarens
 * kommentarer (`coach_notes`, blått/rött). `session_log` innehåller tider och
 * distanser — ord som "tungt" där beskriver passet, inte känslan.
 * `coach_notes` är någon annans röst. Att blanda in dem skulle mäta fel sak.
 *
 * ── Varför regelbaserat och inte en språkmodell ───────────────────────────
 * Kostnadsfritt i drift, deterministiskt, och granskningsbart: när en dag får
 * fel poäng går det att se exakt vilket ord som orsakade det. En modell som
 * poängsätter 214 dagar självsäkert utan att gå att felsöka är sämre här.
 *
 * ── Vad som INTE görs ─────────────────────────────────────────────────────
 * Resultatet skrivs aldrig till `diary_entries.feeling`. Det fältet är
 * atletens egen incheckning; en maskinellt härledd siffra får inte gå att
 * förväxla med något hon själv svarat. Härledda värden beräknas vid behov och
 * hålls åtskilda hela vägen ut i UI:t.
 * ------------------------------------------------------------------------ */

/** Ord som beskriver att kroppen kändes bra. Vikt 1 = tydligt, 0.5 = svagt. */
const POSITIVE: Record<string, number> = {
  bra: 1,
  lätt: 1,
  lätta: 1,
  pigg: 1,
  pigga: 1,
  stark: 1,
  starkt: 1,
  skön: 1,
  sköna: 1,
  skönt: 1,
  kul: 1,
  grym: 1,
  grymt: 1,
  nice: 1,
  toppen: 1,
  rullade: 1,
  flöt: 1,
  // "okej" är ett medgivande snarare än beröm — hon skriver det när passet
  // gick men inte var bra. Halv vikt, annars drar 48 förekomster upp snittet.
  okej: 0.5,
  ok: 0.5,
  hyfsat: 0.5,
};

/** Ord som beskriver att kroppen kändes dålig. */
const NEGATIVE: Record<string, number> = {
  tungt: 1,
  tung: 1,
  tunga: 1,
  trött: 1,
  trötta: 1,
  trötthet: 1,
  seg: 1,
  segt: 1,
  sega: 1,
  stel: 1,
  stelt: 1,
  stela: 1,
  sliten: 1,
  slut: 1,
  död: 1,
  dött: 1,
  väggade: 1,
  orkeslös: 1,
  yr: 1,
  dålig: 1,
  dåligt: 1,
  värk: 1,
  ont: 1,
  hungrig: 0.5,
  // Ett intervallpass SKA kännas jobbigt — det säger inget om måendet.
  // Medvetet utelämnat: jobbig, hårt, ansträngande.
};

/** Hälsoflaggor. Separata från känslan: "sjuk" är ett tillstånd, inte en
 * gradering, och ska kunna visas som markör även när texten i övrigt är
 * positiv ("kändes bra trots förkylningen"). */
const HEALTH_PATTERNS: { flag: DiaryHealthFlag; re: RegExp }[] = [
  { flag: "sick", re: /\b(sjuk|förkyl\w*|feber|halsont|influensa|magsjuk\w*)/ },
  // OBS: inget bart "sena" här. Det matchar "senaste" (\b + prefix) och gav
  // falska skadeflaggor på pass där hon skrev "de senaste dagarna".
  { flag: "injured", re: /\b(skada\w*|skadad|stukade|inflammation|benhinn\w*|seninflammation)/ },
  { flag: "pain", re: /\b(ont i|värk i|smärta)/ },
];

/** Förstärkare och dämpare som skalar ordet efter dem. */
const INTENSIFIERS: Record<string, number> = {
  väldigt: 1.5,
  jätte: 1.5,
  riktigt: 1.4,
  supert: 1.5,
  super: 1.5,
  extremt: 1.6,
  otroligt: 1.5,
  ganska: 0.7,
  lite: 0.6,
  rätt: 0.8,
  någorlunda: 0.6,
};

const NEGATIONS = new Set(["inte", "ej", "aldrig", "knappt"]);

/** Hur många ord bakåt en negation eller förstärkare får påverka.
 * "inte så bra" = 2 ord bakåt ("så" räknas). Större fönster börjar fånga
 * negationer som hör till en annan sats. */
const MODIFIER_WINDOW = 3;

export type DiaryHealthFlag = "sick" | "injured" | "pain";

export type DiaryTextAnalysis = {
  /** −1 (kändes uselt) till +1 (kändes toppen). null när texten saknar
   * känsloord alls — då ska ingenting gissas. */
  score: number | null;
  /** Samma sak på 1–5, jämförbar med den självrapporterade `feeling`. */
  feeling: number | null;
  /** Orden som faktiskt drev poängen, för granskning i UI och felsökning. */
  matches: { word: string; weight: number; negated: boolean }[];
  healthFlags: DiaryHealthFlag[];
};

/** Delar upp i ord, behåller svenska tecken, kastar skiljetecken. */
function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .split(/\s+/)
    .filter(Boolean);
}

/** Letar bakåt efter negation/förstärkare inom fönstret och returnerar den
 * sammanlagda multiplikatorn samt om ordet är negerat. */
function modifierFor(tokens: string[], index: number): { factor: number; negated: boolean } {
  let factor = 1;
  let negated = false;
  for (let i = Math.max(0, index - MODIFIER_WINDOW); i < index; i++) {
    const t = tokens[i];
    if (NEGATIONS.has(t)) negated = true;
    const intensifier = INTENSIFIERS[t];
    if (intensifier != null) factor *= intensifier;
  }
  return { factor, negated };
}

/**
 * Analyserar idrottarens egna dagboksord.
 *
 * Skicka ENDAST `diary_entries.notes` hit — se filhuvudet om varför
 * `session_log` och `coach_notes` inte får blandas in.
 */
export function analyzeDiaryNote(text: string | null | undefined): DiaryTextAnalysis {
  const empty: DiaryTextAnalysis = {
    score: null,
    feeling: null,
    matches: [],
    healthFlags: [],
  };
  if (!text || !text.trim()) return empty;

  const lower = text.toLowerCase();
  const healthFlags = HEALTH_PATTERNS.filter((p) => p.re.test(lower)).map((p) => p.flag);

  const tokens = tokenize(text);
  const matches: DiaryTextAnalysis["matches"] = [];
  let sum = 0;

  tokens.forEach((token, i) => {
    const positive = POSITIVE[token];
    const negative = NEGATIVE[token];
    if (positive == null && negative == null) return;

    const base = positive != null ? positive : -(negative as number);
    if (base === 0) return; // t.ex. "helt", som bara finns för att bära förstärkning

    const { factor, negated } = modifierFor(tokens, i);
    // Negation vänder tecknet men dämpas: "inte bra" är sämre än neutralt,
    // men inte lika illa som "uselt".
    const value = base * factor * (negated ? -0.8 : 1);

    sum += value;
    matches.push({ word: token, weight: Number(value.toFixed(2)), negated });
  });

  if (matches.length === 0) return { ...empty, healthFlags };

  // Mättande kurva i stället för medelvärde. Att dela summan med sin egen
  // vikt (första försöket) gav alltid exakt ±1 så snart precis ett ord
  // matchade — "kändes lite tungt" blev lika illa som "väggade totalt, helt
  // död". tanh låter i stället styrkan spela roll och planar ut mot ±1:
  //   ett milt ord (−0,6) → −0,29   ett "bra" (+1) → +0,46
  //   tre starka negativa (−3) → −0,90
  // Divisorn 2 sätter var kurvan börjar plana ut; den är vald så att ett
  // enstaka ord hamnar nära men inte på skalans kant.
  const score = Math.tanh(sum / 2);

  return {
    score: Number(score.toFixed(3)),
    feeling: scoreToFeeling(score),
    matches,
    healthFlags,
  };
}

/** −1..1 → 1..5, samma skala som den självrapporterade `feeling` (P0.4),
 * så de går att jämföra i samma diagram. */
export function scoreToFeeling(score: number): number {
  return Math.min(5, Math.max(1, Math.round(3 + score * 2)));
}

/* ---------------------------------------------------------------------------
 * Styrketräning som bara finns i texten.
 *
 * 94 av 259 dagboksdagar nämner styrka eller gym i träningsloggen, men noll
 * styrkepass finns i activities — hon startar inte klockan för dem. Kategorin
 * "Styrka" fanns därför men syntes aldrig.
 *
 * Ingen aktivitet skapas av detta. Texten skiljer inte tillförlitligt på ett
 * eget gympass ("Morgonträning: Stabiliseringsstyrka i gymmet") och ett
 * tillägg efter ett löppass ("Distans 45 min 9 km + bålstyrka"), och ~40 fall
 * är genuint tvetydiga. Att skapa pass av dem hade blåst upp passräkning och
 * kategorifördelning med gissningar. Det här är en *indikation* på att styrka
 * förekom, inte ett pass med volym — och ska visas som det.
 * ------------------------------------------------------------------------ */

const STRENGTH_PATTERN =
  /(styrka|styrketräning|marklyft|knäböj|\bgym\b|cirkelträning|stabiliserings)/i;

/** Sant när träningsloggen nämner styrketräning. Kör på `session_log`, inte
 * på `notes`: loggen beskriver vad som gjordes, anteckningarna hur det
 * kändes ("kändes starkt" är ingen styrketräning). */
export function mentionsStrength(sessionLog: string | null | undefined): boolean {
  if (!sessionLog) return false;
  // "rehab" räknas inte som styrka — det är återhämtningsarbete och skulle
  // annars märka upp varje skadedag som styrkepass.
  return STRENGTH_PATTERN.test(sessionLog);
}
