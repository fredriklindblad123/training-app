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
 * Underlaget är självskattat — det är vad löparen skrivit, inte en mätning.
 * ------------------------------------------------------------------------ */

export const STRENGTH_SESSION_PATTERN =
  /(\bgym\b|cirkel|medicinboll|styrka,? blandat|morgonträning|överkroppsstyrka|marklyft|knäböj)/i;

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
