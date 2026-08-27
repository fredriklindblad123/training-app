import { SV_MONTHS, dateKey } from "@/lib/calendar-utils";
import { addDays, mondayOf, toDateKey } from "@/lib/planning";
import { weekRangeLabel } from "@/lib/week-series";

/* Perioden som /uppfoljning räknar statistik över (uttrycklig begäran
 * 2026-08-27: "per block, månad, vecka, dag").
 *
 * Ren datamodul utan Supabase- eller JSX-beroenden, samma princip som
 * lib/arsplan-grid.ts, lib/detaljplan-weeks.ts och lib/range-stats.ts. Den
 * här filen översätter bara (granularitet + ankare) till ett datumspann och
 * en etikett; själva siffrorna räknas av computeRangeStats, som redan är
 * spannbaserad och inte bryr sig om var spannet kommer ifrån.
 *
 * Varför ett *ankare* och inte start+slut i URL:en: ett ankardatum är det
 * enda som överlever ett byte av granularitet. Klickar man "Vecka" när man
 * står på augusti ska man hamna i en vecka *i* augusti, inte i innevarande
 * vecka — och det går bara om URL:en bär en punkt i tiden i stället för ett
 * färdigt spann. Blocket är undantaget: block är namngivna rader i databasen
 * med egna datum, så där är ankaret blockets id. */

export type PeriodKind = "block" | "manad" | "vecka" | "dag";

export const PERIOD_KINDS: readonly PeriodKind[] = ["block", "manad", "vecka", "dag"];

export const PERIOD_LABELS: Record<PeriodKind, string> = {
  block: "Block",
  manad: "Månad",
  vecka: "Vecka",
  dag: "Dag",
};

export function isPeriodKind(value: string | undefined): value is PeriodKind {
  return value != null && (PERIOD_KINDS as readonly string[]).includes(value);
}

export type ResolvedPeriod = {
  kind: PeriodKind;
  /** YYYY-MM-DD, inklusive. */
  startDate: string;
  /** YYYY-MM-DD, inklusive. */
  endDate: string;
  /** "Vecka 35, 24–30 aug", "Augusti 2026", "Grundträning 1". */
  label: string;
  /** Ankaret för föregående/nästa period, eller null när det inte finns
   * någon (bara aktuellt för block — datumperioder är oändliga åt båda
   * håll). Ett datumankare för manad/vecka/dag, ett block-id för block. */
  prevAnchor: string | null;
  nextAnchor: string | null;
};

/** Blocket som det ser ut här — bara det `resolveBlockPeriod` behöver, så
 * modulen slipper känna till season_blocks hela radform. */
export type PeriodBlock = {
  id: string;
  name: string;
  start_date: string;
  end_date: string;
};

/** Sista dagen i `dateKeyStr`s månad. Går via dag 0 i NÄSTA månad, vilket
 * Date normaliserar till "sista dagen i den här" — samma knep som
 * daysInMonth i lib/calendar-utils, bara uttryckt som ett datum. */
function lastDayOfMonth(dateKeyStr: string): string {
  const d = new Date(`${dateKeyStr}T00:00:00`);
  return toDateKey(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}

function firstDayOfMonth(dateKeyStr: string): string {
  const d = new Date(`${dateKeyStr}T00:00:00`);
  return dateKey(d.getFullYear(), d.getMonth() + 1, 1);
}

/** Samma månad, N månader bort. Klampar dagen till månadens längd så att
 * 31 mars minus en månad blir 28/29 februari i stället för att spilla över
 * till 2 eller 3 mars — den överspillningen skulle få "föregående månad" att
 * hoppa över februari helt. */
function shiftMonths(dateKeyStr: string, months: number): string {
  const d = new Date(`${dateKeyStr}T00:00:00`);
  const targetYear = d.getFullYear();
  const targetMonth = d.getMonth() + months;
  const lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return toDateKey(new Date(targetYear, targetMonth, Math.min(d.getDate(), lastDay)));
}

function longDateLabel(dateKeyStr: string): string {
  const d = new Date(`${dateKeyStr}T00:00:00`);
  return `${d.getDate()} ${SV_MONTHS[d.getMonth()].toLowerCase()} ${d.getFullYear()}`;
}

function monthLabel(dateKeyStr: string): string {
  const d = new Date(`${dateKeyStr}T00:00:00`);
  return `${SV_MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * Löser en datumbunden period (månad/vecka/dag) kring `anchor`.
 *
 * Veckan är måndag–söndag, samma veckostart som resten av appen räknar med
 * (mondayOf i lib/planning) — inte söndagsstart, som JS Date har som default
 * och som skulle få veckonumren att avvika från Detaljplanens.
 */
export function resolveDatePeriod(
  kind: Exclude<PeriodKind, "block">,
  anchor: string,
): ResolvedPeriod {
  if (kind === "dag") {
    return {
      kind,
      startDate: anchor,
      endDate: anchor,
      label: longDateLabel(anchor),
      prevAnchor: toDateKey(addDays(new Date(`${anchor}T00:00:00`), -1)),
      nextAnchor: toDateKey(addDays(new Date(`${anchor}T00:00:00`), 1)),
    };
  }

  if (kind === "vecka") {
    const monday = mondayOf(anchor);
    const mondayKey = toDateKey(monday);
    return {
      kind,
      startDate: mondayKey,
      endDate: toDateKey(addDays(monday, 6)),
      label: weekRangeLabel(mondayKey),
      prevAnchor: toDateKey(addDays(monday, -7)),
      nextAnchor: toDateKey(addDays(monday, 7)),
    };
  }

  return {
    kind,
    startDate: firstDayOfMonth(anchor),
    endDate: lastDayOfMonth(anchor),
    label: monthLabel(anchor),
    prevAnchor: shiftMonths(firstDayOfMonth(anchor), -1),
    nextAnchor: shiftMonths(firstDayOfMonth(anchor), 1),
  };
}

/**
 * Löser blockperioden. `blocks` ska vara sorterad på start_date stigande.
 *
 * Returnerar null när det inte finns några block alls — anroparen ska då
 * säga "inga block upplagda än" i stället för att visa en tom tabell, av
 * samma skäl som /arsplan gör det: noll block är ett normalt startläge, inte
 * ett fel.
 *
 * Utan giltigt `anchorId` väljs blocket som täcker `today`, annars det
 * senaste som redan börjat, annars det första kommande. Det är samma
 * "visa det som är relevant nu"-ordning som "Nästa A-tävling" och
 * dashboardens aktiva block redan använder — en tränare som öppnar sidan mitt
 * i ett block ska inte behöva leta upp det.
 */
export function resolveBlockPeriod(
  blocks: PeriodBlock[],
  anchorId: string | undefined,
  today: string,
): ResolvedPeriod | null {
  if (blocks.length === 0) return null;

  let index = anchorId != null ? blocks.findIndex((b) => b.id === anchorId) : -1;
  if (index === -1) {
    index = blocks.findIndex((b) => today >= b.start_date && today <= b.end_date);
  }
  if (index === -1) {
    // Senaste block som redan börjat. findLastIndex finns i Node 20+, som
    // är den runtime appen byggs och körs på (se .nvmrc/Vercel), men uttryckt
    // med en bakåtloop här för att inte göra en lib-höjning i tsconfig till
    // ett krav för en enda rad.
    for (let i = blocks.length - 1; i >= 0; i--) {
      if (blocks[i].start_date <= today) {
        index = i;
        break;
      }
    }
  }
  if (index === -1) index = 0;

  const block = blocks[index];
  return {
    kind: "block",
    startDate: block.start_date,
    endDate: block.end_date,
    label: block.name,
    prevAnchor: index > 0 ? blocks[index - 1].id : null,
    nextAnchor: index < blocks.length - 1 ? blocks[index + 1].id : null,
  };
}
