/* Tolkning av ett tävlingsresultat till jämförbara sekunder.
 *
 * `competition_events.actual_result` är och förblir fritext — så resultat
 * faktiskt skrivs ("2:21,99", "4.18", "7.31 sb", "DNF"), och
 * tävlingsjämförelsen visar dem oförändrade. Men progressionsgrafen behöver
 * tal att sortera och plotta, och den filtrerar på `result_seconds`. Se
 * migration 20260803100000 för hela resonemanget.
 *
 * Fram till 2026-08-27 fanns tolkningen bara i scripts/import_results.py, som
 * kördes en gång vid import. Resultat som lades in i appen (saveEventResult)
 * fick `actual_result` men aldrig `result_seconds` — och blev därmed osynliga
 * i grafen samtidigt som de syntes i listan. Rapporterat med ett 1500m-lopp
 * från 2026-08-24 som aldrig dök upp i kurvan.
 *
 * ---------------------------------------------------------------------------
 * Hur vi vet om ett resultat är en tid eller en längd
 *
 * Importskriptet avgör det med en handskriven lista över löpgrenar
 * (RUNNING_EVENTS). Den listan går inte att lita på i appen: här får man
 * skriva in vilket grennamn som helst, och databasen innehåller redan
 * "2000m hinder", "Halvmaraton" och "Maraton" som listan saknar.
 *
 * I stället avgör FORMATET, vilket är entydigt i det faktiska materialet
 * (mätt 2026-08-27): alla 147 rader med result_seconds innehåller kolon, och
 * noll gör det inte. Alla fältresultat (Höjd 1.12, Längd 4.27, Kula 6.13,
 * Spjut 16.3, Stav 1.89) saknar kolon. Kolon betyder alltså tid, punkt.
 *
 * Undantaget är en kort löpgren skriven utan minutdel — "8.12" på 60m. Den
 * formen finns inte i materialet i dag, men är fullt rimlig att skriva, så
 * den tolkas som rena sekunder NÄR grennamnet innehåller en distans
 * ("60m", "1500m", "2000m hinder"). "Höjd", "Kula" och "Kast m boll" gör inte
 * det, och skyddas därför av samma regel.
 */

/** Grennamn som innehåller en distans i meter: "60m", "1500m",
 * "2000m hinder", "Stafett 200mx4". Medvetet en siffra FÖRE m — "Kast m
 * boll" har ett fristående m och ska inte träffas. */
const DISTANCE_IN_NAME = /\d\s*m/i;

/**
 * Tolkar ett resultat till sekunder, eller null när det inte är en tid.
 *
 * Null är ett fullgott svar och det vanliga för hopp/kast, DNF/DNS och tomma
 * fält. Anroparen ska skriva null till `result_seconds`, inte hoppa över
 * kolumnen — annars ligger ett gammalt värde kvar när ett resultat rättas
 * från en tid till "DNF".
 */
export function parseResultSeconds(
  actualResult: string | null | undefined,
  event: string | null | undefined,
): number | null {
  const raw = (actualResult ?? "").trim();
  if (raw === "") return null;

  // Efterhängda noteringar ("7.31 sb", "2:21,99 pb") kapas. Komma är svensk
  // decimalavgränsare och samma tecken som importskriptet normaliserar bort.
  const cleaned = raw.replace(",", ".").split(/\s+/)[0];

  const parts = cleaned.split(":");

  if (parts.length === 3) {
    // H:MM:SS — maraton och längre.
    const [h, m, s] = parts;
    const seconds = Number(h) * 3600 + Number(m) * 60 + Number(s);
    return Number.isFinite(seconds) ? seconds : null;
  }

  if (parts.length === 2) {
    // M:SS(.hh) — den överlägset vanligaste formen i materialet.
    const [m, s] = parts;
    const seconds = Number(m) * 60 + Number(s);
    return Number.isFinite(seconds) ? seconds : null;
  }

  if (parts.length === 1) {
    // Utan kolon är siffran tvetydig: 4.27 är meter i längdhopp och sekunder
    // på ingenting. Bara ett grennamn med en distans i sig gör den till en
    // tid. Se filens huvudkommentar.
    if (!DISTANCE_IN_NAME.test(event ?? "")) return null;
    const seconds = Number(cleaned);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
  }

  return null;
}
