/* ---------------------------------------------------------------------------
 * Teman i träningsdagboken per passtyp (2026-11-14).
 *
 * Tränaren bad om en stämningsanalys av anteckningarna. Den mättes först
 * (dataverifiering 2026-11-14) och bar inte:
 *   - Inget facit: klockans känsla/RPE är nästan alltid 3/1, r = 0,16 mot
 *     texten.
 *   - Ett ordlistebetyg träffade 74 % blint och hittade bara hälften av de
 *     negativa anteckningarna.
 *   - Skillnaden mellan passtyper försvann när textlängden hölls lika —
 *     intervallanteckningar är dubbelt så långa och fulla av "jobbigt", som
 *     i ett hårt pass inte är negativt.
 *   - Ett betyg per anteckning vore ett betyg på en 16-årings dagbok.
 *
 * Det som håller är VAD hon skriver om: teman, räknade som "nämns i X av N
 * anteckningar", och citaten bakom. Ingen värdering — systemet filtrerar,
 * tränaren läser.
 *
 * Avgränsningar, alla från mätningen:
 *   - Bara 2026 och framåt. Anteckningarna (notes) 2025 är förskjutna en
 *     dag vid importen och delvis ihopklistrade — eftermiddagspassets känsla
 *     ligger på dagen före, utan markör att dela på. Passloggen
 *     (session_log) rättades 2026-11-14, anteckningarna inte.
 *   - Rader utan day_type (importskräp) och dagar utan pass räknas inte.
 *     Skaddagar då hon tränade räknas: höften 20/10–12/11 skulle annars
 *     försvinna ur just de anteckningar som handlar om den.
 *   - En passtyp visas bara med minst MIN_NOTES anteckningar.
 * ------------------------------------------------------------------------ */

export const THEMES_FROM = "2026-01-01";
export const MIN_NOTES = 20;

export type Theme = { key: string; label: string; re: RegExp };

export const THEMES: Theme[] = [
  { key: "kontroll", label: "Kontroll", re: /kontroll/i },
  { key: "fart", label: "Fart och tempo", re: /\b(tempo|farten|fart|snabb\w*|långsam\w*)\b/i },
  { key: "puls", label: "Puls", re: /puls/i },
  { key: "andning", label: "Andning", re: /\b(andas|andning\w*|astma\w*|inhalator\w*|pip\w*)\b/i },
  { key: "benen", label: "Benen", re: /\b(ben|benen|lår\w*|vaden|vader)\b/i },
  { key: "hoft", label: "Höften", re: /höft/i },
  { key: "fot", label: "Foten", re: /\b(fot|foten|fötter\w*|tå|tån|tårna|häl\w*)\b/i },
  { key: "vader", label: "Väder och underlag", re: /\b(vind\w*|blåst\w*|blås\w*|regn\w*|kallt|kyla|varmt|värme\w*|halt|storm\w*|snö\w*|motvind|medvind|gräs\w*|is)\b/i },
];

export type ThemeNote = { date: string; category: string; text: string; tone: Tone | null };

/* ------------------------------ känslan ---------------------------------- *
 * Alice färgar sina kommentarer enligt FIG:s mall: grönt = bra, rosa = mindre
 * bra. Färgen läses ur källdokumentet (scripts/import_diary_tone.py) och
 * sparas som antal tecken per färg. Det är HENNES markering — appen tolkar
 * ingenting, den räknar bara hur hon själv färgat.
 *
 * Per anteckning: minst två tredjedelar grönt = "bra", minst två tredjedelar
 * rosa = "mindre bra", annars "blandat". Tredjedelsgränsen är vald så att en
 * anteckning med en kort rosa bisats ("men lite seg i början") fortfarande
 * räknas som bra. Under TONE_MIN_CHARS färgade tecken räknas den inte. */
export type Tone = "bra" | "blandat" | "mindre_bra";
export const TONE_LABELS: Record<Tone, string> = {
  bra: "Bra",
  blandat: "Blandat",
  mindre_bra: "Mindre bra",
};
/* Hennes egna färger (grönt och rosa), lite dämpade för att läsas på båda
 * bakgrunderna. Blandat är neutralt grått. */
export const TONE_COLORS: Record<Tone, string> = {
  bra: "#22b55a",
  blandat: "var(--ink-3)",
  mindre_bra: "#d63fd0",
};
const TONE_MIN_CHARS = 10;

export function toneOf(good: number | null, bad: number | null): Tone | null {
  if (good == null || bad == null || good + bad < TONE_MIN_CHARS) return null;
  const share = good / (good + bad);
  return share >= 2 / 3 ? "bra" : share <= 1 / 3 ? "mindre_bra" : "blandat";
}

export type ToneCount = Record<Tone, number>;
export function toneCounts(notes: ThemeNote[]): ToneCount {
  const out: ToneCount = { bra: 0, blandat: 0, mindre_bra: 0 };
  for (const n of notes) if (n.tone) out[n.tone]++;
  return out;
}

export type ThemeCell = { count: number; notes: number };

/** Antal anteckningar per passtyp och hur många av dem som nämner varje tema. */
export function themeTable(
  notes: ThemeNote[],
  minNotes = MIN_NOTES,
): {
  categories: { category: string; notes: number }[];
  cells: Map<string, ThemeCell>; // nyckel `${theme}|${category}`
} {
  const byCat = new Map<string, ThemeNote[]>();
  for (const n of notes) byCat.set(n.category, [...(byCat.get(n.category) ?? []), n]);
  const categories = [...byCat.entries()]
    .filter(([, ns]) => ns.length >= minNotes)
    .map(([category, ns]) => ({ category, notes: ns.length }))
    .sort((a, b) => b.notes - a.notes);
  const cells = new Map<string, ThemeCell>();
  for (const { category, notes: n } of categories) {
    const ns = byCat.get(category) ?? [];
    for (const t of THEMES) {
      cells.set(`${t.key}|${category}`, { count: ns.filter((x) => t.re.test(x.text)).length, notes: n });
    }
  }
  return { categories, cells };
}

/** Meningen där temat nämns, kortad runt träffen. */
export function quoteFor(text: string, re: RegExp, max = 160): string {
  const sentences = text.split(/(?<=[.!?])\s+/);
  const hit = sentences.find((s) => re.test(s)) ?? text;
  if (hit.length <= max) return hit.trim();
  const m = hit.match(re);
  const at = m?.index ?? 0;
  const start = Math.max(0, at - Math.floor(max / 2));
  return `${start > 0 ? "…" : ""}${hit.slice(start, start + max).trim()}…`;
}

/** Passtypen en dags anteckning knyts till: dagens mest krävande pass. */
const PRIORITY = ["race", "test", "interval", "threshold", "long_run", "easy", "cross_training", "strength"];
export function mainCategory(categories: string[]): string | null {
  for (const c of PRIORITY) if (categories.includes(c)) return c;
  return categories[0] ?? null;
}
