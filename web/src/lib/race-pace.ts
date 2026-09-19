// Måltempo: farten adepten faktiskt tävlar i, som jämförelsepunkt för
// intervallträningen.
//
// ── Varför den här jämförelsen behövs ────────────────────────────────────
// Passkvalitetsvyn visade tidigare bara utvecklingen mot adeptens eget bästa
// genomförande av samma pass ("+4,2 s mot bäst"). Det svarar på om passet går
// bättre än förra gången, men inte på om farten räcker till det lopp träningen
// syftar mot. Alices 400-intervaller ligger i snitt på 84,4 s per 400 m medan
// hennes 1500-fart är 75,0 — en skillnad på nio sekunder per varv som inte
// syntes någonstans i appen förrän den ställdes mot tävlingsfarten.
//
// ── Varför en enda referensgren ──────────────────────────────────────────
// Ett medeldistanslopp per gren har sin egen fart, och att visa fyra
// referenser samtidigt gör tabellen oläsbar. Referensen väljs därför som den
// gren adepten faktiskt tävlar mest i, och grenen skrivs alltid ut i UI:t så
// att antagandet går att se och ifrågasätta — aldrig som en osynlig default.

/** Grenar som räknas som medeldistans på bana. Landsväg, terräng och häck
 * hålls utanför: underlag och hinder gör farten ojämförbar med intervaller
 * på bana. Häckgrenar filtreras bort av regexen — "1500m H" matchar inte. */
const TRACK_EVENTS: { pattern: RegExp; meters: number }[] = [
  { pattern: /^\s*800\s*m\s*$/i, meters: 800 },
  { pattern: /^\s*1000\s*m\s*$/i, meters: 1000 },
  { pattern: /^\s*1500\s*m\s*$/i, meters: 1500 },
  { pattern: /^\s*3000\s*m\s*$/i, meters: 3000 },
  { pattern: /^\s*5000\s*m\s*$/i, meters: 5000 },
];

/** Hur långt bakåt resultat räknas. 24 månader: kort nog att farten fortfarande
 * beskriver adepten, långt nog att fånga både inne- och utesäsong. */
export const RACE_PACE_MONTHS = 24;

/** Grenar som går att välja som mål. Samma uppsättning som TRACK_EVENTS,
 * i den ordning en medeldistanslöpare möter dem. */
export const GOAL_EVENTS = ["800m", "1000m", "1500m", "3000m", "5000m"] as const;

export type RaceResultRow = {
  event: string;
  result_seconds: number | null;
  competition_date: string;
};

export type RacePace = {
  /** Referensgrenen, t.ex. 1500. */
  distanceMeters: number;
  /** Bästa tiden i grenen, sekunder. */
  seconds: number;
  /** Datum för den tiden. */
  date: string;
  /** Sekunder per 400 m — enheten all intervalljämförelse sker i. */
  per400: number;
  /** Antal lopp i grenen inom fönstret. Visas så att en referens byggd på
   * ett enda lopp går att väga lägre. */
  races: number;
};

/* ---------------------- 1500-ekvivalent tid ------------------------------ *
 * Fartbanden i växeldiagrammet är kalibrerade mot 1500 m. Ett mål på 800 m
 * har en helt annan loppfart, så samma multiplar hade gett orimligt snabba
 * band — därför räknas varje måltid först om till den 1500-tid den motsvarar.
 *
 * Omräkningen använder Riegels formel, T2 = T1 × (D2/D1)^k. Standardexponenten
 * 1,06 är kalibrerad för långdistans och gör 800→1500 för snabb; 1,12 ligger
 * närmare hur medeldistanslöpare faktiskt förhåller sig mellan grenarna.
 * Kontrollerat mot en löpare med både 800 och 1500 i samma säsong: 2:15,47
 * på 800 m ger 4:33,9, mot uppmätta 4:41,1 på 1500 m — knappt tre procents
 * fel, vilket duger för att härleda träningsband men inte för att förutsäga
 * ett lopp.
 *
 * Det här är en konvention, inte en naturlag, och den skrivs ut i UI:t.
 * Ju längre från 1500 m målgrenen ligger, desto grövre blir omräkningen.    */
const RIEGEL_EXPONENT = 1.12;
const REFERENCE_METERS = 1500;

export function equivalent1500Seconds(seconds: number, meters: number): number {
  if (meters === REFERENCE_METERS) return seconds;
  return seconds * Math.pow(REFERENCE_METERS / meters, RIEGEL_EXPONENT);
}

/** Vad fartbanden vilar på. Målet går före personbästa: träningsfarter ska
 * utgå från vad löparen siktar mot, inte från vad hen redan sprungit. */
export type PaceBasis = {
  kind: "mal" | "personbasta";
  /** Grenen basen uttrycks i, t.ex. 1500. */
  distanceMeters: number;
  /** Tiden i den grenen, sekunder. */
  seconds: number;
  /** Omräknad till 1500 m, sekunder — det multiplarna utgår från. */
  equivalent1500: number;
  /** Referensfarten i sekunder per kilometer. */
  perKm: number;
};

export function paceBasisFromGoal(
  goalEvent: string | null,
  goalSeconds: number | null,
): PaceBasis | null {
  if (!goalEvent || goalSeconds == null || goalSeconds <= 0) return null;
  const meters = eventDistanceMeters(goalEvent);
  if (meters == null) return null;
  const equivalent1500 = equivalent1500Seconds(goalSeconds, meters);
  return {
    kind: "mal",
    distanceMeters: meters,
    seconds: goalSeconds,
    equivalent1500,
    perKm: equivalent1500 / (REFERENCE_METERS / 1000),
  };
}

export function paceBasisFromRace(race: RacePace | null): PaceBasis | null {
  if (!race) return null;
  const equivalent1500 = equivalent1500Seconds(race.seconds, race.distanceMeters);
  return {
    kind: "personbasta",
    distanceMeters: race.distanceMeters,
    seconds: race.seconds,
    equivalent1500,
    perKm: equivalent1500 / (REFERENCE_METERS / 1000),
  };
}

/* Måltid skrivs som "4:32", "4:32.5" eller bara sekunder. Punkt och komma
 * accepteras båda som decimaltecken — svenska tangentbord ger komma, och att
 * avvisa det hade varit en onödig fälla. */
export function parseGoalSeconds(raw: string): number | null {
  const value = raw.trim().replace(",", ".");
  if (!value) return null;
  const parts = value.split(":");
  if (parts.length > 2) return null;
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const seconds = parts.length === 2 ? nums[0] * 60 + nums[1] : nums[0];
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function eventDistanceMeters(event: string): number | null {
  for (const { pattern, meters } of TRACK_EVENTS) {
    if (pattern.test(event)) return meters;
  }
  return null;
}

export function formatPace(secondsPer400: number): string {
  return `${secondsPer400.toFixed(1)} s`;
}

/**
 * Väljer referensgren och måltempo.
 *
 * Grenen är den adepten sprungit flest lopp i inom fönstret — det är den
 * träningen faktiskt syftar mot. Vid lika antal vinner den längre grenen:
 * intervallträning för medeldistans utgår oftare från 1500 än från 800, och
 * en referens som är för snabb får alla pass att se misslyckade ut.
 *
 * Tiden är personbästa inom fönstret, inte snittet. Ett snitt över en säsong
 * blandar formtoppar med inledande lopp och beskriver ingen fart alls.
 */
export function pickRacePace(rows: RaceResultRow[]): RacePace | null {
  const byDistance = new Map<number, RaceResultRow[]>();
  for (const row of rows) {
    if (row.result_seconds == null || row.result_seconds <= 0) continue;
    const meters = eventDistanceMeters(row.event);
    if (meters == null) continue;
    byDistance.set(meters, [...(byDistance.get(meters) ?? []), row]);
  }
  if (byDistance.size === 0) return null;

  const [meters, list] = [...byDistance.entries()].sort(
    (a, b) => b[1].length - a[1].length || b[0] - a[0],
  )[0];

  const best = list.reduce((a, b) =>
    (a.result_seconds as number) <= (b.result_seconds as number) ? a : b,
  );
  const seconds = best.result_seconds as number;

  return {
    distanceMeters: meters,
    seconds,
    date: best.competition_date,
    per400: seconds / (meters / 400),
    races: list.length,
  };
}

/** Sekunder per 400 m för en repetition. */
export function per400(repSeconds: number, repMeters: number): number | null {
  if (repMeters <= 0) return null;
  return repSeconds / (repMeters / 400);
}

/** "4:42,72" ur sekunder — svensk decimalkomma, som resultatlistorna. */
export function formatRaceTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m > 0
    ? `${m}:${s.toFixed(2).padStart(5, "0").replace(".", ",")}`
    : s.toFixed(2).replace(".", ",");
}
