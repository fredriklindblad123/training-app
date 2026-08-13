// Pass som analysenhet, inte aktivitet (P0.5 i docs/insikter-roadmap.md).
//
// Alice loggar uppvärmning, huvudpass och nerjogg som *separata*
// Garmin-aktiviteter: av 277 träningsdagar har 97 exakt tre aktiviteter.
// Det gör att per-aktivitet-analys mäter fragment i stället för träning, och
// att autokategoriseringen blir systematiskt fel — 53 % av alla aktiviteter
// är märkta `threshold` och `long_run` har noll träffar.
//
// Den här modulen grupperar fragmenten till pass och sätter kategorin på
// passnivå. Allt sker i TypeScript, medvetet: `activities` har en
// `BEFORE INSERT OR UPDATE`-trigger (`activities_set_category`) som räknar om
// `category` vid varje UPDATE där `category_source = 'auto'`, så ett vanligt
// `update ... set category = ...` blir tyst verkningslöst. Genom att gruppera
// och kategorisera i läsvägen rörs databasen inte alls, fragmentkategorin
// behåller sitt värde i dagvyn, och ändringen är trivialt reversibel.

import type { ActivityCategory } from "@/lib/categories";
import { isActivityCategory } from "@/lib/categories";

/** Aktivitetsraden som grupperingen behöver. Namnen matchar kolumnerna i
 * `activities` rakt av, så en `select(SESSION_ACTIVITY_COLUMNS)` kan skickas
 * in utan mellansteg. Allt utom id/user_id/start_time är nullbart i schemat. */
export type SessionActivity = {
  id: string;
  user_id: string;
  name: string | null;
  activity_type: string | null;
  start_time: string;
  duration_seconds: number | null;
  distance_meters: number | null;
  avg_hr: number | null;
  max_hr: number | null;
  training_load: number | null;
  category: string | null;
  hr_zone_1_seconds: number | null;
  hr_zone_2_seconds: number | null;
  hr_zone_3_seconds: number | null;
  hr_zone_4_seconds: number | null;
  hr_zone_5_seconds: number | null;
  /** Alices egen "Känsla"/"Upplevd ansträngning"-skattning i Garmin Connect-
   * appen, se migration 20260812100000_garmin_feel_rpe.sql. Ersätter den
   * borttagna dagliga incheckningen som källa till subjektiv känsla. */
  garmin_feel: number | null;
  garmin_rpe: number | null;
  /** Garmins egen skattning (vO2MaxValue), satt sällan — bara när klockan
   * räknar om den, inte på varje pass. */
  vo2max: number | null;
};

/** Kolumnlistan för `.select()` — håll i synk med `SessionActivity`. */
export const SESSION_ACTIVITY_COLUMNS =
  "id, user_id, name, activity_type, start_time, duration_seconds, distance_meters, " +
  "avg_hr, max_hr, training_load, category, " +
  "hr_zone_1_seconds, hr_zone_2_seconds, hr_zone_3_seconds, hr_zone_4_seconds, hr_zone_5_seconds, " +
  "garmin_feel, garmin_rpe, vo2max";

/** Ett träningspass: aggregatet av de fragment som hör ihop. */
export type TrainingSession = {
  /** Stabilt id = användare + starttid för första fragmentet. */
  id: string;
  userId: string;
  /** YYYY-MM-DD. Sliceat ur `start_time` precis som resten av appen gör
   * (kalender, /dashboard, /trends), så passdatum och dagvy alltid stämmer. */
  date: string;
  /** ISO-tid för första fragmentets start. */
  startTime: string;
  /** ISO-tid för sista fragmentets slut (start + duration). */
  endTime: string;
  /** Fragmenten, tidssorterade. Alltid minst ett. */
  activities: SessionActivity[];
  durationSeconds: number;
  distanceMeters: number;
  trainingLoad: number;
  /** Summerade zontider. Summering över dagens fragment är korrekt (1.3) —
   * till skillnad från allt som grupperar per kategori. 0 betyder antingen
   * "ingen tid i zonen" eller "inget fragment hade zondata"; kolla
   * `hrZoneTotalSeconds` innan andelar räknas. */
  hrZone1Seconds: number;
  hrZone2Seconds: number;
  hrZone3Seconds: number;
  hrZone4Seconds: number;
  hrZone5Seconds: number;
  hrZoneTotalSeconds: number;
  /** Tidsviktad snittpuls. Ett rakt medelvärde över fragmenten skulle ge en
   * 10-minuters nerjogg samma vikt som ett 40-minuters huvudpass. */
  avgHr: number | null;
  /** Max av fragmentens maxpuls. */
  maxHr: number | null;
  /** Passets kategori, se `categorizeSession`. */
  category: ActivityCategory;
  /** Fragmentet som avgjorde kategorin — bra att kunna visa i UI ("kategorin
   * kommer från *det här* passet"). */
  dominantActivity: SessionActivity;
};

/** Max glapp mellan slutet på ett fragment och starten på nästa innan det
 * räknas som ett nytt pass. 2,5 h: Almgrens dubbeltröskel innebär två
 * *riktiga* pass samma dag och de får inte slås ihop, medan glappet mellan
 * uppvärmning och huvudpass ligger på minuter. */
export const SESSION_MAX_GAP_SECONDS = 2.5 * 3600;

/** Fragment vars namn matchar det här är uppvärmning/nerjogg: de räknas med i
 * passets volym och zontid men får inte bestämma passets kategori. Det är
 * just nerjoggen som ärver huvudpassets puls och därför felaktigt klassas
 * som tröskel (1.3). */
const WARMUP_COOLDOWN_PATTERN = /uppvärmning|nerjogg|jogg|warm|cool/i;

/** Namnmönster som visar att fragmentet faktiskt *är* kvalitetsarbete.
 * Speglar namnreglerna i `categorize_activity()` (se
 * supabase/migrations/20260725160000_cross_training_category.sql) plus
 * intervallnotationen Alice skriver för hand: "5x2min", "10x400m", "5×1km".
 *
 * `stegring`/`stride`/`fart` är medvetet *inte* med, till skillnad från i
 * SQL-funktionen: "Distans + stegringar" är en distanslöpning med några
 * stegringar på slutet, inte ett kvalitetspass. */
const QUALITY_NAME_PATTERN =
  /tröskel|threshold|tempo|intervall|interval|vo2|räck|repetition|\brep\b|sprint|backe|\d+\s*[x×]\s*\d+/i;

/** Kategorier som bara får sättas om det finns belägg för kvalitetsarbete.
 *
 * Bara `threshold`, inte `interval` (rättat 2026-08-13). Skillnaden ligger i
 * varifrån kategorin kommer när namnet inte säger något: `threshold` kan
 * komma från Garmins TEMPO/LACTATE_THRESHOLD-etikett, som dokumenterat
 * opålitlig för Alice — hennes lugna distanspass ligger på 81 % av maxpuls
 * och triggar den etiketten (se
 * supabase/migrations/20260727160000_fix_distance_run_categorisation.sql).
 * `interval` kommer i stället från VO2MAX/ANAEROBIC_CAPACITY/SPRINT —
 * Firstbeats etiketter för genuint hårt arbete, som `categorize_activity()`
 * medvetet litar på rakt av även för automatnamngivna pass ("Göteborg
 * Löpning") enligt sin egen kommentar. Ett enfragmentspass utan
 * uppvärmning/nerjogg-uppdelning (isStructured=false) och utan
 * intervallnotation i namnet (nameCategory=null) klarar aldrig
 * hasQualityEvidence — innan den här ändringen nedgraderades då ett riktigt
 * intervallpass till "easy" och, om det var långt nog, vidare till
 * "long_run". */
const QUALITY_CATEGORIES: ReadonlySet<string> = new Set(["threshold"]);

/** Kvalitetskategori ur passnamnet, i fallande specificitet. Behövs åt båda
 * håll: Garmins `training_effect_label` säger ibland TEMPO om en lugn timme
 * (för hög kategori) och ibland BASE om ett kort ryckpass (för låg). När
 * namnet säger vad passet var ska namnet vinna. */
function qualityCategoryFromName(name: string): ActivityCategory | null {
  if (/tröskel|threshold|tempo/i.test(name)) return "threshold";
  if (/intervall|interval|vo2/i.test(name)) return "interval";
  if (QUALITY_NAME_PATTERN.test(name)) return "interval";
  return null;
}

// Långpassgräns på *passnivå*. `categorize_activity()` använder 15 km / 75 min
// per fragment, vilket är en maratonlöpares mått — därför har `long_run` noll
// träffar i dag. För en medeldistanslöpare är långpasset "drygt en timme,
// omkring 12 km", inte 2–3 timmar.
//
// Gränsen är satt strax under det: histogrammet över Alices lugna pass är
// tydligt tudelat — normaldistansen ligger på 35–45 min / 7–8 km, långpasset
// på 60–64 min / 12 km, och bandet 46–59 min innehåller nästan ingenting. Att
// lägga gränsen mitt i det tomma bandet gör klassningen okänslig för om en
// planerad timme klockas på 59:40 eller 60:20.
export const LONG_RUN_MIN_SECONDS = 55 * 60;
export const LONG_RUN_MIN_METERS = 11000;

function num(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Slutet på ett fragment i millisekunder: start + duration. */
function endMs(activity: SessionActivity): number {
  return Date.parse(activity.start_time) + num(activity.duration_seconds) * 1000;
}

/** Uppvärmning/nerjogg — men bara om namnet *inte* också beskriver
 * kvalitetsarbete. Utan den andra halvan fastnar riktiga huvudpass i filtret:
 * "8x2min 60sek joggvila + 6x30sek backe" innehåller "jogg" och skulle
 * annars uteslutas ur kategoribeslutet, varpå uppvärmningen tog över och
 * passet blev lugn distans. */
function isWarmupOrCooldown(activity: SessionActivity): boolean {
  const name = activity.name ?? "";
  return WARMUP_COOLDOWN_PATTERN.test(name) && !QUALITY_NAME_PATTERN.test(name);
}

/** Grupperar aktiviteter till pass: per användare, per dag, och uppdelat på
 * glapp > `maxGapSeconds`. Indata sorteras här — lita inte på anroparen. */
export function groupActivitiesIntoSessions(
  activities: SessionActivity[],
  options: { maxGapSeconds?: number } = {},
): TrainingSession[] {
  const maxGapSeconds = options.maxGapSeconds ?? SESSION_MAX_GAP_SECONDS;

  const sorted = [...activities].sort((a, b) => {
    if (a.user_id !== b.user_id) return a.user_id < b.user_id ? -1 : 1;
    const diff = Date.parse(a.start_time) - Date.parse(b.start_time);
    // Stabil ordning även för fragment med identisk starttid.
    return diff !== 0 ? diff : a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const groups: SessionActivity[][] = [];
  let current: SessionActivity[] = [];

  for (const activity of sorted) {
    const previous = current[current.length - 1];
    if (previous) {
      const sameUser = previous.user_id === activity.user_id;
      const sameDay = previous.start_time.slice(0, 10) === activity.start_time.slice(0, 10);
      const gapSeconds = (Date.parse(activity.start_time) - endMs(previous)) / 1000;
      if (!sameUser || !sameDay || gapSeconds > maxGapSeconds) {
        groups.push(current);
        current = [];
      }
    }
    current.push(activity);
  }
  if (current.length > 0) groups.push(current);

  return groups.map(buildSession);
}

function buildSession(fragments: SessionActivity[]): TrainingSession {
  const first = fragments[0];

  const durationSeconds = fragments.reduce((sum, f) => sum + num(f.duration_seconds), 0);
  const distanceMeters = fragments.reduce((sum, f) => sum + num(f.distance_meters), 0);
  const trainingLoad = fragments.reduce((sum, f) => sum + num(f.training_load), 0);

  const zone = (key: keyof SessionActivity) =>
    fragments.reduce((sum, f) => sum + num(f[key] as number | null), 0);
  const hrZone1Seconds = zone("hr_zone_1_seconds");
  const hrZone2Seconds = zone("hr_zone_2_seconds");
  const hrZone3Seconds = zone("hr_zone_3_seconds");
  const hrZone4Seconds = zone("hr_zone_4_seconds");
  const hrZone5Seconds = zone("hr_zone_5_seconds");

  // Tidsviktad snittpuls: bara fragment som har både puls och varaktighet
  // bidrar, annars skulle ett fragment utan pulsband dra ner snittet.
  let hrWeight = 0;
  let hrSum = 0;
  for (const f of fragments) {
    const seconds = num(f.duration_seconds);
    if (f.avg_hr != null && seconds > 0) {
      hrSum += f.avg_hr * seconds;
      hrWeight += seconds;
    }
  }

  const maxHrValues = fragments
    .map((f) => f.max_hr)
    .filter((v): v is number => v != null);

  const { category, dominantActivity } = categorizeSession(fragments, {
    durationSeconds,
    distanceMeters,
  });

  const lastEnd = fragments.reduce((latest, f) => Math.max(latest, endMs(f)), endMs(first));

  return {
    id: `${first.user_id}:${first.start_time}`,
    userId: first.user_id,
    date: first.start_time.slice(0, 10),
    startTime: first.start_time,
    endTime: new Date(lastEnd).toISOString(),
    activities: fragments,
    durationSeconds,
    distanceMeters,
    trainingLoad,
    hrZone1Seconds,
    hrZone2Seconds,
    hrZone3Seconds,
    hrZone4Seconds,
    hrZone5Seconds,
    hrZoneTotalSeconds:
      hrZone1Seconds + hrZone2Seconds + hrZone3Seconds + hrZone4Seconds + hrZone5Seconds,
    avgHr: hrWeight > 0 ? Math.round(hrSum / hrWeight) : null,
    maxHr: maxHrValues.length > 0 ? Math.max(...maxHrValues) : null,
    category,
    dominantActivity,
  };
}

/** Kategoriserar ett pass utifrån dess hårdaste *meningsfulla* del.
 *
 * 1. Uppvärmning/nerjogg plockas bort ur kategoribeslutet (men inte ur
 *    volymen). Kvar blir "kärnan".
 * 2. Passets kategori = kategorin för det kärnfragment som har högst
 *    `training_load`. Saknas kärnfragment (bara "Nerjogg" den dagen) används
 *    det längsta fragmentet.
 * 3. `threshold` kräver *belägg* (se QUALITY_CATEGORIES). `categorize_activity()`
 *    faller tillbaka på Garmins `training_effect_label`, och den etiketten
 *    säger TEMPO/LACTATE_THRESHOLD även om en rak timmes distansjogg — det
 *    är varför 89 vanliga "Distans"-pass en gång låg som tröskel. Belägg =
 *    antingen ett namn som beskriver kvalitetsarbete, eller att Alice själv
 *    delat passet i uppvärmning + huvudpass + nerjogg (hon gör det bara på
 *    kvalitetspass). Utan belägg blir passet lugn distans. `interval`
 *    kräver inget belägg — se kommentaren vid QUALITY_CATEGORIES för varför.
 * 4. `long_run` sätts sist, på passets *totala* tid/distans, och bara på pass
 *    utan kvalitetsbelägg — ett långpass är sammanhängande lugn löpning, inte
 *    en backsession som råkar bli lång med uppvärmning inräknad. */
export function categorizeSession(
  fragments: SessionActivity[],
  totals: { durationSeconds: number; distanceMeters: number },
): { category: ActivityCategory; dominantActivity: SessionActivity } {
  const core = fragments.filter((f) => !isWarmupOrCooldown(f));

  const dominantActivity =
    core.length > 0
      ? core.reduce((best, f) =>
          num(f.training_load) > num(best.training_load) ? f : best,
        )
      : fragments.reduce((best, f) =>
          num(f.duration_seconds) > num(best.duration_seconds) ? f : best,
        );

  const raw = dominantActivity.category;
  let category: ActivityCategory =
    raw != null && isActivityCategory(raw) ? raw : "easy";

  // Att Alice delar passet i uppvärmning + huvudpass + nerjogg är i sig ett
  // belägg — hon gör det bara på kvalitetspass. Tre fragment räcker som
  // signal även när fragmenten fått Garmins automatiska namn ("Göteborg
  // Löpning" tre gånger på rad).
  const isStructured =
    fragments.length >= 3 || (fragments.length >= 2 && fragments.some(isWarmupOrCooldown));
  const nameCategory = qualityCategoryFromName(dominantActivity.name ?? "");
  const hasQualityEvidence = nameCategory !== null || isStructured;

  if (QUALITY_CATEGORIES.has(category)) {
    // Kategorin kommer ofta från `training_effect_label`, och den etiketten
    // säger TEMPO/LACTATE_THRESHOLD även om en rak timmes distansjogg — det
    // är därför 89 vanliga "Distans"-pass ligger som tröskel. Utan belägg är
    // passet lugn distans.
    if (!hasQualityEvidence) category = "easy";
  } else if (category === "easy" && nameCategory !== null) {
    // Omvänt fall: ett kort ryckpass ("6x150m", "Backe 5x30sek + 10x15sek")
    // ger låg träningseffekt och etiketten BASE, men namnet säger vad det var.
    category = nameCategory;
  }

  if (
    category === "easy" &&
    !hasQualityEvidence &&
    (totals.durationSeconds >= LONG_RUN_MIN_SECONDS ||
      totals.distanceMeters >= LONG_RUN_MIN_METERS)
  ) {
    category = "long_run";
  }

  return { category, dominantActivity };
}
