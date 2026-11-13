/* ---------------------------------------------------------------------------
 * Styrkepass ur träningsdagboken (2026-11-13).
 *
 * Styrka loggas sällan med klockan. Alice skriver den i dagbokens passlogg
 * (diary_entries.session_log): "Gym: marklyft, utfall, knäböj…", "Morgon-
 * träning: cirkel med medicinboll", "Styrka, blandat bl.a. bål…". I blocket
 * Allmän förberedelse ht 2026 fanns ett enda styrkepass från Garmin — och det
 * var ett crosstrainerpass — mot åtta loggade i dagboken.
 *
 * Bara EGNA styrkepass räknas (Fredriks val): det som motsvarar det planerade
 * fredagspasset "Styrka – blandat". Styrka som tillägg efter ett löppass
 * ("Distans … Bålstyrka", "… Styrka med gummiband") räknas inte. Uppmätt på
 * Alices dagbok: 8 dagar ht 2026 och 13 ht 2025 fram till samma dag, mot 24
 * respektive 17 om allt som nämner styrka räknades.
 *
 * Rättat samma dag: "morgonträning" ensamt räknades som styrka, och träffade
 * då även "Morgonträning: distans 41min" (skolans morgonpass är inte alltid
 * styrka) — 13 dagar ht 2025 blev 9. Samtidigt missades "stabiliserings-
 * styrka i gymmet", eftersom \bgym\b inte matchar "gymmet". Nu räknas
 * morgonträning bara när styrka står direkt efter ("Morgonträning: styrka
 * med pilatesboll").
 *
 * Underlaget är självskattat — det är vad löparen skrivit, inte en mätning.
 * ------------------------------------------------------------------------ */

export const STRENGTH_SESSION_PATTERN =
  /(\bgym|cirkel|medicinboll|stabiliserings? ?styrka|morgonträning:? *styrka|styrka,? blandat|styrka med blandade|överkroppsstyrka|marklyft|knäböj)/i;

export type DiaryLogRow = { entry_date: string; session_log: string | null };

/** Datum (YYYY-MM-DD) där dagboken beskriver ett eget styrkepass. */
export function strengthDatesFromDiary(rows: DiaryLogRow[]): string[] {
  return [
    ...new Set(
      rows
        .filter((r) => r.session_log != null && STRENGTH_SESSION_PATTERN.test(r.session_log))
        .map((r) => r.entry_date),
    ),
  ];
}
