/* Dagboken skickas in från appen (2026-11-24) — jämförelsen mellan det PDF:en
 * säger och det som redan finns i diary_entries.
 *
 * PDF:en tolkas i Python (web/api/_diary_pdf.py); här bestäms vad som händer
 * med varje dag. Ren funktion, ingen databas — samma uträkning visas i
 * förhandsvisningen och används när inskicket skrivs.
 *
 * VARFÖR DET SOM FINNS BEHÅLLS NÄR TEXTEN SKILJER SIG. Tanken var först att
 * det senast inskickade skulle gälla. Kontrollen mot produktionsdata
 * 2026-11-24 (skolårsfilen 26/27 mot databasen, 73 dagar) sänkte det: på 31
 * dagar skilde sig passtexten, och i nästan alla var databasens text den
 * bättre —
 *   - stavning rättad ("Uppvrämning", "Trökskelintervaller"),
 *   - sjukdagar märkta ("Vila, förkyld" där PDF:ens mall bara säger
 *     "Finnkamp" eller "Möte åk 1 08.00"),
 *   - en tränarkommentar skriven i SVART i måndagsrutan (12/10), som
 *     tolkningen inte kan skilja från passtext.
 * Därför: nya dagar och tomma fält fylls i, och dagar som skiljer sig visas
 * sida vid sida och ersätts bara om någon väljer det. Kommentarerna (grönt
 * och rosa) stämde på 72 av 73 dagar.
 *
 * TVÅ DELAR PER DAG, BEDÖMDA VAR FÖR SIG.
 *   Passet:       session_log (svart text).
 *   Anteckningen: notes + notes_good/bad_text + tecken (grönt och rosa).
 * En dag kan alltså få anteckningen ifylld men behålla sin passtext.
 *
 * ALDRIG RÖRT: day_type på en befintlig rad, coach_notes, känsla/motivation/
 * sömn (ifyllda i appen) och kopplingarna till pass och plan. */

export type ParsedDiaryDay = {
  entry_date: string;
  session_log: string | null;
  notes: string | null;
  notes_good_text: string | null;
  notes_bad_text: string | null;
  notes_good_chars: number;
  notes_bad_chars: number;
};

export type ExistingDiaryRow = {
  id: string;
  entry_date: string;
  session_log: string | null;
  notes: string | null;
  notes_good_text: string | null;
  notes_bad_text: string | null;
  notes_good_chars: number | null;
  notes_bad_chars: number | null;
  day_type: string | null;
};

type PartState = "fill" | "same" | "differs" | "none";

export type DayChange = {
  date: string;
  kind: "new" | "fill" | "same" | "differs";
  log: PartState;
  note: PartState;
  /** Bara för "differs": det som finns. */
  before?: { log: string | null; note: string | null };
  /** Det PDF:en säger. */
  after: { log: string | null; note: string | null };
};

/** Jämförbar text: bara bokstäver och siffror, gemener. Mellanslag,
 * skiljetecken och radbrytningar ("tempo." mot "tempo") räknas inte som en
 * skillnad. */
export function normText(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
}

/** Likhet 0–1 mellan två normerade texter (Dice på teckenpar). */
export function similarity(a: string, b: string): number {
  if (a === b) return 1;
  if (a.length < 2 || b.length < 2) return 0;
  const pairs = new Map<string, number>();
  for (let i = 0; i < a.length - 1; i++) pairs.set(a.slice(i, i + 2), (pairs.get(a.slice(i, i + 2)) ?? 0) + 1);
  let common = 0;
  for (let i = 0; i < b.length - 1; i++) {
    const k = b.slice(i, i + 2);
    const n = pairs.get(k) ?? 0;
    if (n > 0) {
      common++;
      pairs.set(k, n - 1);
    }
  }
  return (2 * common) / (a.length - 1 + b.length - 1);
}

/* Från 0,85 är skillnaden stavning och skiljetecken, inte innehåll.
 * Uppmätt 2026-11-24 på skolårsfilen 26/27: 14 av 31 avvikande passtexter
 * låg på 0,88–0,99 ("Uppvrämning", "Trökskelintervaller", "ängårdsbergen");
 * under 0,85 låg de där innehållet faktiskt skilde sig (mallens "Finnkamp"
 * mot "Vila, förkyld", 0,00; en tränarkommentar mot passet, 0,46). Det som
 * finns behålls i båda fallen — gränsen avgör bara om dagen visas som en
 * skillnad att ta ställning till. */
const SAME_ENOUGH = 0.85;

function part(existing: string | null, parsed: string | null): PartState {
  const p = normText(parsed);
  const e = normText(existing);
  if (!p) return "none";
  if (!e) return "fill";
  return similarity(e, p) >= SAME_ENOUGH ? "same" : "differs";
}

export function diffDiary(parsed: ParsedDiaryDay[], existing: ExistingDiaryRow[]): DayChange[] {
  const byDate = new Map(existing.map((r) => [r.entry_date, r]));
  return parsed.map((p) => {
    const row = byDate.get(p.entry_date);
    if (!row || (!normText(row.session_log) && !normText(row.notes))) {
      return {
        date: p.entry_date,
        kind: "new",
        log: p.session_log ? "fill" : "none",
        note: p.notes ? "fill" : "none",
        after: { log: p.session_log, note: p.notes },
      };
    }
    const log = part(row.session_log, p.session_log);
    /* Anteckningen jämförs på de gröna och rosa fälten, som läses ur PDF:en
       oförändrade. `notes` kan vara rättad för hand (29 dagar hösten 2026
       skilde sig bara på "med"/"men" och liknande). Saknar raden färgfälten
       (importerad före 15/11) jämförs `notes` i stället, och färgfälten
       fylls i om texten är densamma. */
    const hasTone = row.notes_good_text != null || row.notes_bad_text != null;
    let note = hasTone
      ? part(`${row.notes_good_text ?? ""} ${row.notes_bad_text ?? ""}`, `${p.notes_good_text ?? ""} ${p.notes_bad_text ?? ""}`)
      : part(row.notes, p.notes);
    if (note === "same" && !hasTone && (p.notes_good_text || p.notes_bad_text)) note = "fill";
    const kind = log === "differs" || note === "differs" ? "differs" : log === "fill" || note === "fill" ? "fill" : "same";
    return {
      date: p.entry_date,
      kind,
      log,
      note,
      after: { log: p.session_log, note: p.notes },
      ...(kind === "differs" ? { before: { log: row.session_log, note: row.notes } } : {}),
    };
  });
}

/* Dagtyp för en NY rad, samma regel som scripts/fix_diary_day_types.py i
 * förenklad form: loggen börjar med "Vila" eller "Sjuk". Sjukdom bara när
 * texten säger det och inte i dåtid ("varit sjuk"). Befintliga rader behåller
 * sin dagtyp — den kan vara satt för hand. */
const SICK_WORD = /\b(sjuk|förkyl\w*|feber|halsont|influensa|magsjuk\w*|ont i halsen)/i;
const PAST_TENSE = /\b(varit sjuk|var sjuk|efter sjukdom|blivit frisk)/i;
const NO_TRAINING_LOG = /^\s*(sjuk|vila)\b/i;

export function dayTypeFor(log: string | null, notes: string | null): "training" | "rest" | "sick" {
  const l = (log ?? "").trim();
  const blob = `${l} ${notes ?? ""}`;
  if (!NO_TRAINING_LOG.test(l)) return "training";
  return SICK_WORD.test(blob) && !PAST_TENSE.test(blob) ? "sick" : "rest";
}

/** Fälten som skrivs för en del. */
export function fieldsFor(p: ParsedDiaryDay, which: { log: boolean; note: boolean }): Record<string, unknown> {
  return {
    ...(which.log ? { session_log: p.session_log } : {}),
    ...(which.note
      ? {
          notes: p.notes,
          notes_good_text: p.notes_good_text,
          notes_bad_text: p.notes_bad_text,
          notes_good_chars: p.notes_good_chars,
          notes_bad_chars: p.notes_bad_chars,
        }
      : {}),
  };
}
