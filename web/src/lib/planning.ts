/* ---------------------------------------------------------------------------
 * Träningsplanering: säsongsblock, tävlingar och veckomallar.
 *
 * Modellen följer hur en medeldistanssäsong faktiskt ser ut i svensk
 * friidrott: ett läsår som löper över årsskiftet, med en inomhussäsong på
 * vintern och en utomhussäsong på sommaren, och en periodisering som skärps
 * ju närmare tävlingarna man kommer.
 * ------------------------------------------------------------------------ */

export const BLOCK_TYPES = [
  "grund",
  "uppbyggnad",
  "skarpning",
  "tavling",
  "nedtrappning",
  "vila",
] as const;

export type BlockType = (typeof BLOCK_TYPES)[number];

export const BLOCK_LABELS: Record<BlockType, string> = {
  grund: "Grundträning",
  uppbyggnad: "Uppbyggnad",
  skarpning: "Skärpning",
  tavling: "Tävlingsperiod",
  nedtrappning: "Nedtrappning",
  vila: "Vila/övergång",
};

/** Vad blocket är till för — visas som hjälptext när man väljer typ. */
export const BLOCK_INTENT: Record<BlockType, string> = {
  grund: "Volym vid kontrollerad intensitet. Bygger uthålligheten som allt annat vilar på.",
  uppbyggnad: "Mer specifikt arbete, tröskel och längre intervaller. Volymen hålls uppe.",
  skarpning: "Tävlingsfart och kortare repetitioner. Volymen sjunker, kvaliteten stiger.",
  tavling: "Tävlingar varvat med underhåll. Inga stora belastningssprång.",
  nedtrappning: "Sänkt volym inför A-tävling, bibehållen intensitet.",
  vila: "Övergång mellan säsonger. Alternativ träning och återhämtning.",
};

// Slot-ordning ur den kategoriska paletten i lib/categories.ts. Blocken ska
// gå att skilja åt i en tidslinje, även i gråskala och för färgblinda — därför
// återanvänds den redan validerade paletten i stället för nya färger.
export const BLOCK_COLOR_VARS: Record<BlockType, string> = {
  grund: "var(--cat-easy)",
  uppbyggnad: "var(--cat-threshold)",
  skarpning: "var(--cat-interval)",
  tavling: "var(--cat-race)",
  nedtrappning: "var(--cat-strength)",
  vila: "var(--cat-cross_training)",
};

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
  rest: "Vila",
};

/** Vilodagar har ingen motsvarighet bland genomförda pass — allt annat
 * matchar en `ActivityCategory` rakt av. */
export function workoutTypeColorVar(type: string): string | null {
  return type === "rest" || !(WORKOUT_TYPES as readonly string[]).includes(type)
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

// --- Utrullning av veckomall ----------------------------------------------

export type TemplateItem = {
  weekday: number;
  slot: number;
  workout_type: string;
  title: string | null;
  description: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
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
  block_id: string | null;
  template_id: string;
  status: "planned";
};

/**
 * Rullar ut en veckomall över ett datumintervall.
 *
 * Genererar ett pass per mallrad och vecka. `existingKeys` är nycklar
 * (`datum|slot`) som redan har ett planerat pass — de hoppas över, så att en
 * utrullning aldrig skriver över något man lagt in för hand. Det är också
 * det som gör att samma mall kan rullas ut igen efter att intervallet
 * förlängts, utan dubbletter.
 */
export function generateFromTemplate({
  userId,
  templateId,
  blockId,
  items,
  from,
  to,
  existingKeys,
}: {
  userId: string;
  templateId: string;
  blockId: string | null;
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
        block_id: blockId,
        template_id: templateId,
        status: "planned",
      });
    }
  }

  return out;
}

// --- Periodiseringsförslag -------------------------------------------------

export type SuggestedBlock = {
  name: string;
  block_type: BlockType;
  season: SeasonKind | null;
  start_date: string;
  end_date: string;
  focus: string;
};

/**
 * Föreslår en periodisering bakåt från en A-tävling.
 *
 * Bygger på Almgrens observation att strukturen hålls fast i ungefär sex
 * veckor i taget (2.3 i insikter-roadmapen), och på den klassiska ordningen
 * grund → uppbyggnad → skärpning → nedtrappning. Förslaget är en
 * utgångspunkt att justera, inte ett facit: appen vet ingenting om skola,
 * läger eller hur kroppen svarat.
 */
export function suggestBlocks(
  competitionDate: string,
  season: SeasonKind | null,
  startFrom: string,
): SuggestedBlock[] {
  const target = new Date(`${competitionDate}T00:00:00`);
  const begin = new Date(`${startFrom}T00:00:00`);
  const totalWeeks = Math.max(0, Math.floor((target.getTime() - begin.getTime()) / (7 * 864e5)));

  // Under åtta veckor finns inte utrymme för en full periodisering — då är
  // det ärligare att föreslå en kort skärpning plus nedtrappning än att
  // dela upp tiden i block som blir någon vecka vardera.
  if (totalWeeks < 8) {
    const taperWeeks = Math.min(2, Math.max(1, Math.floor(totalWeeks / 4)));
    return [
      {
        name: "Skärpning",
        block_type: "skarpning",
        season,
        start_date: startFrom,
        end_date: toDateKey(addDays(target, -taperWeeks * 7 - 1)),
        focus: "Tävlingsfart, sjunkande volym.",
      },
      {
        name: "Nedtrappning",
        block_type: "nedtrappning",
        season,
        start_date: toDateKey(addDays(target, -taperWeeks * 7)),
        end_date: competitionDate,
        focus: "Sänkt volym, bibehållen intensitet.",
      },
    ];
  }

  // Nedtrappningen är kort och fast; skärpningen får ungefär en tredjedel av
  // det som återstår, resten delas mellan grund och uppbyggnad med tyngd på
  // grunden — det är den som bär resten av säsongen.
  const taper = 2;
  const remaining = totalWeeks - taper;
  const sharpen = Math.max(3, Math.round(remaining * 0.3));
  const build = Math.max(3, Math.round((remaining - sharpen) * 0.45));
  const base = Math.max(3, remaining - sharpen - build);

  const blocks: SuggestedBlock[] = [];
  let cursor = new Date(begin);

  const push = (
    name: string,
    block_type: BlockType,
    weeks: number,
    focus: string,
  ) => {
    const start = new Date(cursor);
    const end = addDays(start, weeks * 7 - 1);
    blocks.push({
      name,
      block_type,
      season,
      start_date: toDateKey(start),
      end_date: toDateKey(end),
      focus,
    });
    cursor = addDays(end, 1);
  };

  push("Grundträning", "grund", base, "Volym vid kontrollerad intensitet, 2 tröskelpass/vecka.");
  push("Uppbyggnad", "uppbyggnad", build, "Längre intervaller, volymen hålls uppe.");
  push("Skärpning", "skarpning", sharpen, "Tävlingsfart, kortare repetitioner, lägre volym.");

  // Nedtrappningen ankras mot tävlingsdatumet medan blocken före räknas
  // framåt från startdatumet. De två räkningarna möts sällan exakt, så
  // föregående block sträcks fram till dagen före nedtrappningen — annars
  // blir det några oplanerade dagar mitt i upptrappningen.
  const taperStart = toDateKey(addDays(target, -taper * 7));
  const previous = blocks[blocks.length - 1];
  if (previous && previous.end_date < taperStart) {
    previous.end_date = toDateKey(addDays(new Date(`${taperStart}T00:00:00`), -1));
  }

  blocks.push({
    name: "Nedtrappning",
    block_type: "nedtrappning",
    season,
    start_date: taperStart,
    end_date: competitionDate,
    focus: "Sänkt volym, bibehållen intensitet.",
  });

  return blocks;
}
