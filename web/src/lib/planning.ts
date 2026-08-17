/* ---------------------------------------------------------------------------
 * Träningsplanering: säsongsblock, tävlingar och veckomallar.
 *
 * Modellen följer hur en medeldistanssäsong faktiskt ser ut i svensk
 * friidrott: ett läsår som löper över årsskiftet, med en inomhussäsong på
 * vintern och en utomhussäsong på sommaren, och en periodisering som skärps
 * ju närmare tävlingarna man kommer.
 * ------------------------------------------------------------------------ */

// Period + fas — samma tvånivå-vokabulär som rad 5-6 i Årsplan-fliken i
// Svensk Friidrotts mall ("Träningsplanering Friidrottstränare steg 3").
// Ersätter det tidigare egna block_type-ordförrådet (grund/uppbyggnad/...)
// helt, så att ett block i appen heter samma sak som i mallen tränaren
// faktiskt skickar in — se supabase/migrations/20260815100000_block_period_redesign.sql
// för värdemappningen från det gamla ordförrådet.

export const PERIOD_TYPES = ["forberedelse", "tavling", "atehamtning"] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];

export const PERIOD_LABELS: Record<PeriodType, string> = {
  forberedelse: "Förberedelseperiod",
  tavling: "Tävlingsperiod",
  atehamtning: "Återhämtning",
};

export const PHASE_TYPES = [
  "allman",
  "tavlingsforberedande",
  "tavling_form",
  "tavling_stabiliserande",
  "stabiliserande",
  "vila",
] as const;

export type PhaseType = (typeof PHASE_TYPES)[number];

export const PHASE_LABELS: Record<PhaseType, string> = {
  allman: "Allmän",
  tavlingsforberedande: "Tävlingsförberedande",
  tavling_form: "Tävling (form)",
  tavling_stabiliserande: "Tävling (stabiliserande)",
  stabiliserande: "Stabiliserande",
  vila: "Vila",
};

/** Vad blocket är till för — visas som hjälptext när man väljer fas. */
export const PHASE_INTENT: Record<PhaseType, string> = {
  allman: "Volym vid kontrollerad intensitet. Bygger uthålligheten som allt annat vilar på.",
  tavlingsforberedande: "Mer specifikt arbete, tröskel och längre intervaller. Volymen hålls uppe.",
  tavling_form: "Tävlingsfart och kortare repetitioner. Volymen sjunker, kvaliteten stiger.",
  tavling_stabiliserande: "Tävlingar varvat med underhåll. Inga stora belastningssprång.",
  stabiliserande: "Sänkt volym inför A-tävling, bibehållen intensitet.",
  vila: "Övergång mellan säsonger. Alternativ träning och återhämtning.",
};

// Slot-ordning ur den kategoriska paletten i lib/categories.ts. Faserna ska
// gå att skilja åt i en tidslinje, även i gråskala och för färgblinda — därför
// återanvänds den redan validerade paletten i stället för nya färger.
export const PHASE_COLOR_VARS: Record<PhaseType, string> = {
  allman: "var(--cat-easy)",
  tavlingsforberedande: "var(--cat-threshold)",
  tavling_form: "var(--cat-interval)",
  tavling_stabiliserande: "var(--cat-race)",
  stabiliserande: "var(--cat-strength)",
  vila: "var(--cat-cross_training)",
};

/** Blocket som täcker ett givet datum, om något. Kalendervyerna (vecka,
 * månad, år) använder den här för att färga in dagar/månader efter block i
 * stället för att visa blocken som ett separat band ovanför rutnätet. */
export function blockForDate<T extends { start_date: string; end_date: string }>(
  blocks: T[],
  dateKey: string,
): T | null {
  return blocks.find((b) => b.start_date <= dateKey && b.end_date >= dateKey) ?? null;
}

/** Alla block som helt eller delvis överlappar ett intervall — årsvyns
 * månadsrader är för smala för dagvisa markeringar, så där listas i stället
 * vilka block som förekommer under månaden. */
export function blocksInRange<T extends { start_date: string; end_date: string }>(
  blocks: T[],
  from: string,
  to: string,
): T[] {
  return blocks.filter((b) => b.start_date <= to && b.end_date >= from);
}

// --- Tillgänglighet: skola, läger, resor (K7) -------------------------------

export const AVAILABILITY_KINDS = ["skola", "lager", "resa", "ledighet", "annat"] as const;
export type AvailabilityKind = (typeof AVAILABILITY_KINDS)[number];

export const AVAILABILITY_LABELS: Record<AvailabilityKind, string> = {
  skola: "Skola/prov",
  lager: "Läger",
  resa: "Resa",
  ledighet: "Ledighet",
  annat: "Annat",
};

/** En enda dämpad gråton för alla fem sorter, medvetet skild från både
 * passpaletten (--cat-*) och fasfärgerna (PHASE_COLOR_VARS ovan). En
 * tillgänglighetsperiod är en annan sorts information än en passkategori
 * eller ett periodiseringsblock — den säger inget om *vad* som tränades,
 * bara att omständigheterna var annorlunda. Att låna en av de andra
 * palettens hues hade gjort identiteten tvetydig (t.ex. skulle "läger" i
 * --cat-race-grön kunna misstas för en tävlingsperiod). Etiketten bär
 * identiteten; färgen bär bara "det här är kontext, inte ett pass". */
export const AVAILABILITY_COLOR_VAR = "var(--availability-band)";

export type AvailabilityPeriod = {
  start_date: string;
  end_date: string;
  kind: AvailabilityKind;
  label: string | null;
};

/** Alla tillgänglighetsperioder som helt eller delvis överlappar ett
 * intervall — samma form som blocksInRange ovan, återanvänd för både
 * kalenderbandet (vecka/månad) och blockjämförelsen på /trends. */
export function availabilityInRange<T extends { start_date: string; end_date: string }>(
  periods: T[],
  from: string,
  to: string,
): T[] {
  return periods.filter((p) => p.start_date <= to && p.end_date >= from);
}

export type SeasonKind = "indoor" | "outdoor";

export const SEASON_LABELS: Record<SeasonKind, string> = {
  indoor: "Inomhus",
  outdoor: "Utomhus",
};

export type Priority = "A" | "B" | "C";

export const PRIORITY_LABELS: Record<Priority, string> = {
  A: "A — säsongens huvudmål",
  B: "B — viktig tävling",
  C: "C — träningstävling",
};

export const PRIORITY_SHORT: Record<Priority, string> = { A: "A", B: "B", C: "C" };

/** Vanliga grenar för en svensk medeldistanslöpare. Fritext är tillåtet —
 * listan finns för att slippa skriva "1500m" varje gång, inte för att
 * begränsa. */
export const COMMON_EVENTS = [
  "800m",
  "1500m",
  "3000m",
  "5000m",
  "1000m",
  "2000m hinder",
  "3000m hinder",
  "Terräng",
  "Stafett",
] as const;

/**
 * Passtyper i en veckomall och i `planned_workouts.workout_type`.
 *
 * Medvetet identiska med `activities.category` (se lib/categories.ts), plus
 * `rest` som bara finns i planen. Tidigare använde planeringen ett eget
 * ordförråd (`tempo`, `long`) medan utfallet använde ett annat (`threshold`,
 * `long_run`). Det gjorde två saker fel samtidigt: färgvariablerna
 * `--cat-tempo` och `--cat-long` finns inte, så planerade pass ritades utan
 * färg — och viktigare, plan och utfall gick inte att jämföra alls. Hela
 * poängen med att visa dem sida vid sida är att kunna se om det som
 * planerades också blev det som gjordes.
 */
export const WORKOUT_TYPES = [
  "easy",
  "long_run",
  "threshold",
  "interval",
  "race",
  "strength",
  "cross_training",
  "test",
  "rest",
] as const;

export type WorkoutType = (typeof WORKOUT_TYPES)[number];

export const WORKOUT_LABELS: Record<WorkoutType, string> = {
  easy: "Lugn distans",
  long_run: "Långpass",
  threshold: "Tröskel",
  interval: "Intervaller",
  race: "Tävling",
  strength: "Styrka",
  cross_training: "Alternativ träning",
  test: "Tröskeltest",
  rest: "Vila",
};

/** Fältprotokollet för ett tröskeltest, ur docs/insikter-roadmap.md (P1.3,
 * "Kalibreringen är blockeraren"). Skrivs som färdig text i beskrivningen när
 * ett testpass läggs in, så tränare/atlet slipper formulera om det varje
 * gång — och så att lib/threshold-test.ts och UI-texten pratar om exakt
 * samma protokoll. */
export const THRESHOLD_TEST_PROTOCOL =
  "30 minuter maxinsats i jämn fart, helst på bana eller platt underlag. " +
  "Snittpulsen för de sista 20 minuterna motsvarar ungefär din anaeroba tröskel (LT2).";

/** Passtyper där repgrupper (K1, docs/tranarperspektiv.md) faktiskt beskriver
 * något. Ett lugnt distanspass eller ett långpass har ingen reps-struktur —
 * "lägg till repgrupp" ska inte skrika efter uppmärksamhet där (fallgrop 1 i
 * K1). Listan styr bara vilka typer som visar tillägg-kontrollen som
 * standard i UI:t; den blockerar aldrig hårt — redan inlagda grupper (t.ex.
 * efter ett typbyte) visas oavsett workout_type. */
export const QUALITY_WORKOUT_TYPES: readonly WorkoutType[] = [
  "threshold",
  "interval",
  "race",
  "test",
];

/** Vilodagar och tröskeltest har ingen motsvarighet bland genomförda pass —
 * `rest` är ingen träning alls, och `test` är ett testtillfälle, inte en
 * träningskategori. Allt annat matchar en `ActivityCategory` rakt av. */
export function workoutTypeColorVar(type: string): string | null {
  return type === "rest" ||
    type === "test" ||
    !(WORKOUT_TYPES as readonly string[]).includes(type)
    ? null
    : `var(--cat-${type})`;
}

export const WEEKDAY_LABELS = [
  "Måndag",
  "Tisdag",
  "Onsdag",
  "Torsdag",
  "Fredag",
  "Lördag",
  "Söndag",
] as const;

export const SLOT_LABELS: Record<number, string> = {
  1: "Förmiddag",
  2: "Eftermiddag",
  3: "Kväll",
};

// --- Datumhjälpare ---------------------------------------------------------

export function toDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Måndagen i veckan som datumet tillhör. */
export function mondayOf(dateKey: string): Date {
  const d = new Date(`${dateKey}T00:00:00`);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export function addDays(d: Date, days: number): Date {
  const next = new Date(d);
  next.setDate(next.getDate() + days);
  return next;
}

/** Antal hela veckor mellan två datum, inklusive båda ändarna. */
export function weeksBetween(from: string, to: string): number {
  const a = mondayOf(from).getTime();
  const b = mondayOf(to).getTime();
  return Math.floor((b - a) / (7 * 24 * 3600 * 1000)) + 1;
}

// --- Tävlingsårsväljare -----------------------------------------------------
// Historiken (t.ex. flera säsongers importerade tävlingar) gör
// tävlingslistan på /planering oöverskådlig utan ett årsfilter. Val och
// default byggs här, ur datan, i stället för planering/page.tsx — samma
// princip som blockForDate/blocksInRange ovan: en ren funktion är lätt att
// resonera om och att återanvända om fler vyer behöver samma årsfilter.

/** Grupperar en lista tävlingsdatum (YYYY-MM-DD) per år. `years` är sorterad
 * nyast-först, så årsväljaren kan renderas rakt av utan egen sortering. */
export function competitionYearCounts(dates: string[]): {
  years: string[];
  countsByYear: Map<string, number>;
} {
  const countsByYear = new Map<string, number>();
  for (const date of dates) {
    const year = date.slice(0, 4);
    countsByYear.set(year, (countsByYear.get(year) ?? 0) + 1);
  }
  const years = [...countsByYear.keys()].sort((a, b) => b.localeCompare(a));
  return { years, countsByYear };
}

/** Vilket år årsväljaren ska förvälja. Innevarande år är nästan alltid det
 * man vill se — men har det inga tävlingar ännu (vanligt tidigt på säsongen,
 * eller för en atlet vars historik bara sträcker sig bakåt i tiden) är en
 * tom sida ett sämre förval än det senaste året som faktiskt har några. */
export function defaultCompetitionYear(
  currentYear: string,
  years: string[],
  countsByYear: Map<string, number>,
): string {
  if (countsByYear.has(currentYear)) return currentYear;
  // `years` är redan nyast-först (se competitionYearCounts).
  return years[0] ?? currentYear;
}

// --- Utrullning av veckomall ----------------------------------------------

/**
 * En repgrupp med fältnamn som i databasraden (planned_rep_groups /
 * template_rep_groups — de två tabellerna har identisk form, se
 * supabase/migrations/20260801100000_planned_rep_groups.sql). snake_case
 * medvetet, till skillnad från PlannedRepGroup i lib/session-signature.ts:
 * den här typen speglar en databasrad rakt av (insert-payload), medan
 * session-signature.ts type är den minimala formen
 * plannedSignatureKey/-Label faktiskt behöver.
 */
export type RepGroupInput = {
  sort_order: number;
  reps: number;
  distance_meters: number | null;
  duration_seconds: number | null;
  target_pace_seconds_per_km: number | null;
  target_hr_low: number | null;
  target_hr_high: number | null;
  recovery_seconds: number | null;
  recovery_kind: string | null;
  note: string | null;
};

export type TemplateItem = {
  weekday: number;
  slot: number;
  workout_type: string;
  title: string | null;
  description: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  /** Vilken Årsplan-rad (lib/training-factors.ts) det här passet räknas mot
   * — t.ex. "Tröskel" eller "Maximal" snabbhet. Planeringen sker per pass,
   * inte som en klumpsumma för blocket (rättat 2026-08-16) — Excel-exportens
   * Årsplan-flik härleds numera ur vilka pass som faktiskt är taggade med
   * vilken faktor, inte ur ett separat block-fält. Nullable — inte alla pass
   * (vila, ett obestämt lugnt pass) hör till en specifik faktor. */
  training_factor?: string | null;
  /** Repgrupperna på mallraden (template_rep_groups). Saknas fältet helt
   * (äldre anrop, eller en frågad som inte hämtat dem) tolkas som "inga" —
   * se generateFromTemplate. */
  rep_groups?: RepGroupInput[];
};

export type GeneratedWorkout = {
  user_id: string;
  scheduled_date: string;
  slot: number;
  workout_type: string;
  title: string | null;
  description: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  training_factor: string | null;
  block_id: string;
  status: "planned";
  /** Repgrupperna som ska kopieras in på det nya planerade passet. Kan inte
   * skickas med i samma insert som passet självt — planned_rep_groups pekar
   * på passets id, som inte finns förrän insert-raden kommit tillbaka. Se
   * syncItemsIntoBlock i lib/template-sync.ts för hur det löses. */
  rep_groups: RepGroupInput[];
};

/**
 * Rullar ut ett blocks veckomönster över dess datumintervall.
 *
 * Genererar ett pass per mönsterrad och vecka. `existingKeys` är nycklar
 * (`datum|slot`) som redan har ett planerat pass — de hoppas över, så att en
 * utrullning aldrig skriver över något man lagt in för hand. Det är också
 * det som gör att mönstret kan rullas ut igen efter att intervallet
 * förlängts, utan dubbletter.
 */
export function generateFromTemplate({
  userId,
  blockId,
  items,
  from,
  to,
  existingKeys,
}: {
  userId: string;
  blockId: string;
  items: TemplateItem[];
  from: string;
  to: string;
  existingKeys: Set<string>;
}): GeneratedWorkout[] {
  const out: GeneratedWorkout[] = [];
  const end = new Date(`${to}T00:00:00`);
  const start = new Date(`${from}T00:00:00`);

  for (let monday = mondayOf(from); monday <= end; monday = addDays(monday, 7)) {
    for (const item of items) {
      const date = addDays(monday, item.weekday - 1);
      // Mallen rullas ut veckovis, men får inte spilla utanför intervallet i
      // vare sig ändan — första och sista veckan är oftast delvisa.
      if (date < start || date > end) continue;

      const key = `${toDateKey(date)}|${item.slot}`;
      if (existingKeys.has(key)) continue;

      out.push({
        user_id: userId,
        scheduled_date: toDateKey(date),
        slot: item.slot,
        workout_type: item.workout_type,
        title: item.title,
        description: item.description,
        target_distance_meters: item.target_distance_meters,
        target_duration_seconds: item.target_duration_seconds,
        training_factor: item.training_factor ?? null,
        block_id: blockId,
        status: "planned",
        // Fallgrop 3 i K1: missas den här kopian blir mallarna tomma skal
        // och tränaren skriver om kvalitetspassen varje vecka. Nytt
        // array-objekt per genererat pass — flera pass i samma vecka delar
        // annars samma mallrad och skulle annars dela referens.
        rep_groups: [...(item.rep_groups ?? [])],
      });
    }
  }

  return out;
}

/** Alla datum (YYYY-MM-DD) i ett intervall som faller på en given veckodag
 * (1=måndag..7=söndag, samma räkning som `TemplateItem.weekday`). Används för
 * att ta bort exakt de kalenderrader ett borttaget mallpass skapat, utan att
 * röra passen på andra dagar. */
export function datesForWeekday(from: string, to: string, weekday: number): string[] {
  const dates: string[] = [];
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(`${from}T00:00:00`); d <= end; d = addDays(d, 1)) {
    const dow = ((d.getDay() + 6) % 7) + 1;
    if (dow === weekday) dates.push(toDateKey(d));
  }
  return dates;
}

