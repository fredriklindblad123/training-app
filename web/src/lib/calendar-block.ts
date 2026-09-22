import type { createClient } from "@/lib/supabase/server";

type SupabaseServerClient = Awaited<ReturnType<typeof createClient>>;

/* Blockhorisonten i kalendern (begäran 2026-09-21).
 *
 * Kalenderns övriga horisonter är kalendrar: dag, vecka, månad, år finns
 * alltid och går att räkna fram ur ett datum. Ett block gör inte det — det
 * är en period NÅGON har lagt upp, den kan saknas, och året kan ha glapp
 * mellan två block. Den här modulen äger därför den enda fråga alla
 * kalendervyer behöver kunna svara på för att kunna rita fliken: "vilket
 * block ska Block-knappen peka på?"
 *
 * Regeln är lånad, inte uppfunnen: exakt samma som dashboardens
 * säsongskort använder (se SeasonContext-frågan i dashboard/page.tsx) —
 * det block som pågår, och ligger man i ett glapp det som börjar härnäst.
 * Ett glapp är inget kantfall i den här appen; säsongen 2026 har ett på
 * fyra veckor mellan 31 aug och 27 sep. Hade knappen krävt ett pågående
 * block vore den död just de veckorna, vilket är precis när en tränare vill
 * titta framåt på vad som kommer.
 *
 * Blocken hör till löparen via season_block_athletes, inte via user_id —
 * samma block kan gälla flera adepter (migration 20260816100000). */

export type CalendarBlock = {
  id: string;
  name: string;
  phase: string;
  start_date: string;
  end_date: string;
  focus: string | null;
};

/** Löparens alla block, i kronologisk ordning. */
export async function athleteBlocks(
  supabase: SupabaseServerClient,
  athleteId: string,
): Promise<CalendarBlock[]> {
  const { data } = await supabase
    .from("season_blocks")
    .select(
      "id, name, phase, start_date, end_date, focus, season_block_athletes!inner(athlete_id)",
    )
    .eq("season_block_athletes.athlete_id", athleteId)
    .order("start_date");
  return (data ?? []) as unknown as CalendarBlock[];
}

/** Det block Block-fliken ska peka på: det pågående, annars nästa som
 * börjar, annars — om löparen bara har avslutade block — det senaste. Null
 * först när det inte finns några block alls, och då ska fliken inte ritas. */
export function currentOrNextBlock(
  blocks: CalendarBlock[],
  todayKey: string,
): CalendarBlock | null {
  if (blocks.length === 0) return null;
  return blocks.find((b) => b.end_date >= todayKey) ?? blocks[blocks.length - 1];
}

/** Blocket som innehåller datumet, för "hoppa till datum" i blockläget. */
export function blockContaining(
  blocks: CalendarBlock[],
  dateKeyStr: string,
): CalendarBlock | null {
  return blocks.find((b) => dateKeyStr >= b.start_date && dateKeyStr <= b.end_date) ?? null;
}

/** Hela block-URL:en, eller null när löparen saknar block. Vyerna skickar
 * den rakt in i CalendarNav, som utelämnar fliken när den är null. */
export function blockHrefFor(
  blocks: CalendarBlock[],
  todayKey: string,
  athleteQuery: string,
): string | null {
  const block = currentOrNextBlock(blocks, todayKey);
  return block ? `/calendar/block/${block.id}${athleteQuery}` : null;
}
