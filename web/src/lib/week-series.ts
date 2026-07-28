// Datumfönster delade mellan /trends och /dashboard: måndagsserier,
// blockbundna varianter och veckoetiketter. Extraherat ur trends/page.tsx
// (P1.5) när /dashboard fick samma behov av "N veckor bakåt" och "veckorna
// inom ett givet intervall" — hellre en delad modul än två kopior som glider
// isär.

import { addDays as planAddDays, mondayOf } from "@/lib/planning";
import { weekLabel } from "@/lib/stats-utils";

const MONTHS_SHORT = [
  "jan", "feb", "mar", "apr", "maj", "jun",
  "jul", "aug", "sep", "okt", "nov", "dec",
];

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function toDateKey(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

/** Alla måndagsdatum (YYYY-MM-DD) från `weeks` veckor bakåt fram till
 * innevarande vecka, så diagrammen visar kontinuitet även för veckor helt
 * utan data. */
export function buildWeekSeries(weeks: number): string[] {
  const today = new Date();
  const currentMonday = new Date(today);
  const day = (currentMonday.getDay() + 6) % 7;
  currentMonday.setDate(currentMonday.getDate() - day);

  const series: string[] = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const monday = new Date(currentMonday);
    monday.setDate(monday.getDate() - i * 7);
    series.push(toDateKey(monday));
  }
  return series;
}

/** Måndagsdatum från och med startveckan till och med slutveckan för ett
 * givet intervall (P1.5) — samma form som `buildWeekSeries`, men bunden av
 * ett datumintervall i stället för antal veckor bakåt från idag. Delvisa
 * första/sista veckor är normalfallet: ett intervall börjar sällan på en
 * måndag. */
export function buildWeekSeriesForRange(fromDateKey: string, toDateKeyStr: string): string[] {
  const series: string[] = [];
  for (
    let monday = mondayOf(fromDateKey);
    monday <= mondayOf(toDateKeyStr);
    monday = planAddDays(monday, 7)
  ) {
    series.push(toDateKey(monday));
  }
  return series;
}

/** "V.31, 28 juli–3 aug" — kort etikett på axeln, lång i panelen. */
export function weekRangeLabel(monday: string): string {
  const from = new Date(`${monday}T00:00:00`);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  const fromPart = `${from.getDate()} ${MONTHS_SHORT[from.getMonth()]}`;
  const toPart = `${to.getDate()} ${MONTHS_SHORT[to.getMonth()]}`;
  return `${weekLabel(monday)}, ${fromPart}–${toPart}`;
}

/** "28 juli" — kort dagsetikett, för dagsgranulära diagram (dashboardens
 * 7-dagarsvy). */
export function shortDateLabel(dateKeyStr: string): string {
  const d = new Date(`${dateKeyStr}T00:00:00`);
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
