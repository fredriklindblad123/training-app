import { NextRequest, NextResponse } from "next/server";
import { dateKey, isValidYear, isValidMonth, isValidDay } from "@/lib/calendar-utils";

/* Löser "hoppa till datum"-formuläret (CalendarNav) till rätt konkreta URL
 * för den horisont man stod i — dag/vecka/månad/år har olika rutt-format,
 * men bara en gemensam <input type="date"> behövs för att hoppa i alla
 * fyra, i stället för att bläddra pil för pil genom tjugo dagar. */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const horizon = searchParams.get("horizon");
  const date = searchParams.get("date");
  // Fas 0-uppföljning: en coachs valda löpare ska överleva "hoppa till
  // datum"-formuläret precis som den redan gör i huvudmenyn (NavLinks).
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
