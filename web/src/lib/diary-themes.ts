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
 *   - Anteckningarna 2025 var förskjutna en dag vid den första importen
 *     (rubrikerna i PDF:en är centrerade, så text i kolumnens början lästes
 *     till dagen före). De är omimporterade ur PDF:en med kolumnerna från
 *     tabellens linjer, se THEMES_FROM.
 *   - Rader utan day_type (importskräp) och dagar utan pass räknas inte.
 *     Skaddagar då hon tränade räknas: höften 20/10–12/11 skulle annars
 *     försvinna ur just de anteckningar som handlar om den.
 *   - En passtyp visas bara med minst MIN_NOTES anteckningar.
 * ------------------------------------------------------------------------ */

/** Första datum med anteckningstext på rätt dag. Texten 2025 importerades om
 * ur PDF:en 2026-11-15 (scripts/import_diary_tone.py) sedan den visat sig vara
 * förskjuten en dag; före augusti 2025 finns ingen dagbok. */
export const THEMES_FROM = "2025-08-18";
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

export type ThemeNote = {
  date: string;
  category: string;
  text: string;
  tone: Tone | null;
  /** Den gröna respektive rosa texten ur källdokumentet, när den finns. */
  good?: string | null;
  bad?: string | null;
};

/** I vilken färg ett tema togs upp i en anteckning: grön text = bra, rosa =
 * mindre bra, båda = blandat. Står temat bara i ofärgad text (eller saknas
 * färgad text) gäller anteckningens helhetsfärg. */
export function mentionTone(n: ThemeNote, re: RegExp): Tone | null {
  const inGood = !!n.good && re.test(n.good);
  const inBad = !!n.bad && re.test(n.bad);
  if (inGood && inBad) return "blandat";
  if (inGood) return "bra";
  if (inBad) return "mindre_bra";
  return n.tone;
}

/** Omnämnanden av ett tema fördelade på färg. */
export function mentionCounts(notes: ThemeNote[], re: RegExp): ToneCount & { total: number } {
  const out = { bra: 0, blandat: 0, mindre_bra: 0, total: 0 };
  for (const n of notes) {
    if (!re.test(n.text) && !(n.good && re.test(n.good)) && !(n.bad && re.test(n.bad))) continue;
    out.total++;
    const t = mentionTone(n, re);
    if (t) out[t]++;
  }
  return out;
}

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

/* ------------------------- vanligaste orden ------------------------------ *
 * Ord i ett urval anteckningar, räknade som i hur många anteckningar de
 * förekommer (inte hur många gånger) — ett långt referat ska inte väga mer än
 * en kort rad. Böjningsformer slås ihop grovt genom att vanliga svenska
 * ändelser kapas ("intervallerna", "intervaller" -> "intervall"); ordet visas
 * i den form som var vanligast. Småord och siffror räknas inte. */
const STOPWORDS = new Set(
  (
    "och att det som en ett är var de den på i för med men inte så jag har hade av till om sen sedan " +
    "då när vi man mig min mitt mina kan kunde ska skulle blev bli blir få fick gick går " +
    "lite mycket väldigt ganska typ ju väl nog bara också ändå även efter innan igen idag igår imorgon " +
    "här där hur vad vilket vilken eller utan under över från upp ner ut in alla allt något några " +
    "kändes känns kände känna kännas känsla känslan var hela helt kanske liksom sista första andra tredje " +
    "dem dom deras sig sin sitt sina hon han hennes detta dessa denna mer mest än som eftersom tills " +
    "jätte rätt fast ingen inget inga både heller kör körde köra varit vara är " +
    "tog ta tar annars istället tror trodde alls trots lika samma riktigt verkligen faktiskt nästan " +
    "kom kommer gjorde göra gör fått haft har hela sig dag dagen gång gången"
  ).split(/\s+/),
);
const SUFFIXES = ["arna", "erna", "orna", "ande", "ende", "ade", "are", "ast", "na", "en", "et", "ar", "er", "or", "a", "e", "t"];

function stem(w: string): string {
  for (const s of SUFFIXES) if (w.length - s.length >= 4 && w.endsWith(s)) return w.slice(0, -s.length);
  return w;
}

export type WordCount = { word: string; notes: number };

export function topWords(notes: ThemeNote[], limit = 14): WordCount[] {
  const byStem = new Map<string, { notes: number; forms: Map<string, number> }>();
  for (const n of notes) {
    const seen = new Set<string>();
    for (const raw of n.text.toLowerCase().match(/[a-zåäöé]+/g) ?? []) {
      if (raw.length < 3 || STOPWORDS.has(raw)) continue;
      const st = stem(raw);
      const e = byStem.get(st) ?? { notes: 0, forms: new Map() };
      e.forms.set(raw, (e.forms.get(raw) ?? 0) + 1);
      if (!seen.has(st)) {
        e.notes++;
        seen.add(st);
      }
      byStem.set(st, e);
    }
  }
  return [...byStem.values()]
    .filter((e) => e.notes >= 2)
    .map((e) => ({ word: [...e.forms.entries()].sort((a, b) => b[1] - a[1])[0][0], notes: e.notes }))
    .sort((a, b) => b.notes - a.notes || a.word.localeCompare(b.word, "sv"))
    .slice(0, limit);
}
