import { NextRequest, NextResponse } from "next/server";
import { dateKey, isValidYear, isValidMonth, isValidDay } from "@/lib/calendar-utils";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { athleteBlocks, blockContaining, currentOrNextBlock } from "@/lib/calendar-block";
import { getViewMode } from "@/lib/view-mode";

/* Löser "hoppa till datum"-formuläret (CalendarNav) till rätt konkreta URL
 * för den horisont man stod i — dag/vecka/månad/block/år har olika
 * rutt-format, men bara en gemensam <input type="date"> behövs för att hoppa
 * i alla fem, i stället för att bläddra pil för pil genom tjugo dagar.
 *
 * Block är det enda horisontvalet som kan sakna mål: datumet kan ligga i ett
 * glapp mellan två block, eller i ett år som ingen lagt upp. Då krävs en
 * databasfråga för att ens veta det, till skillnad från de andra fyra som
 * räknas fram ur datumet. Hittas inget block som innehåller datumet landar
 * hoppet på MÅNADEN i stället — den vyn finns alltid och visar samma dagar.
 * Att skicka tillbaka till /calendar hade slängt bort datumet användaren
 * just skrev in. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const horizon = searchParams.get("horizon");
  const date = searchParams.get("date");
  // Fas 0-uppföljning: en coachs valda löpare ska överleva "hoppa till
  // datum"-formuläret precis som den redan gör i navigeringen (BottomNav).
  const athlete = searchParams.get("athlete");
  const athleteQuery = athlete ? `?athlete=${athlete}` : "";

  const match = date ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(date) : null;
  if (!match) {
    return NextResponse.redirect(new URL(`/calendar${athleteQuery}`, request.url));
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!isValidYear(year) || !isValidMonth(month) || !isValidDay(year, month, day)) {
    return NextResponse.redirect(new URL(`/calendar${athleteQuery}`, request.url));
  }

  if (horizon === "block") {
    const supabase = await createClient();
    const scoped = await getScopedProfile(supabase);
    if (scoped) {
      const runnerMode = scoped.role === "coach" && (await getViewMode()) === "runner";
      const scopedUserId = resolveScopedUserId(scoped, athlete ?? undefined, runnerMode);
      const blocks = await athleteBlocks(supabase, scopedUserId);
      // Det normaliserade datumet, inte råsträngen: den är redan kontrollerad
      // ovan, och dateKey ger samma form som blockens start_date/end_date
      // jämförs som.
      const wanted = dateKey(year, month, day);
      // Blocket som innehåller datumet; ligger datumet i ett glapp tas det
      // block som är på väg, samma regel som fliken själv använder.
      const target = blockContaining(blocks, wanted) ?? currentOrNextBlock(blocks, wanted);
      if (target) {
        return NextResponse.redirect(
          new URL(`/calendar/block/${target.id}${athleteQuery}`, request.url),
        );
      }
    }
    return NextResponse.redirect(
      new URL(`/calendar/${year}/${month}${athleteQuery}`, request.url),
    );
  }

  const target =
    horizon === "day"
      ? `/calendar/${year}/${month}/${day}${athleteQuery}`
      : horizon === "week"
        ? `/calendar/vecka/${dateKey(year, month, day)}${athleteQuery}`
        : horizon === "year"
          ? `/calendar/${year}${athleteQuery}`
          : `/calendar/${year}/${month}${athleteQuery}`;

  return NextResponse.redirect(new URL(target, request.url));
}
