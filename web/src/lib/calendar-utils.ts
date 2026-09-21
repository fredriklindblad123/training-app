export const SV_MONTHS = [
  "Januari",
  "Februari",
  "Mars",
  "April",
  "Maj",
  "Juni",
  "Juli",
  "Augusti",
  "September",
  "Oktober",
  "November",
  "December",
];

export const SV_WEEKDAYS_SHORT = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];

export type DayStatus = "training" | "rest" | "sick" | "injured";

export const STATUS_COLOR: Record<DayStatus, string> = {
  training: "bg-emerald-500",
  rest: "bg-sky-400",
  sick: "bg-amber-500",
  injured: "bg-red-600",
};

/** Samma färger som STATUS_COLOR, men som CSS-variabler.
 *
 * Kalendern ritar med Tailwind-klasserna ovan; diagram, svg-markörer och
 * inline-stilar kan inte göra det och valde tidigare egna färger — därför
 * blev sjuk gult i månadsvyn och rött i formkurvan. Variablerna är
 * definierade i globals.css och speglar klassernas hex-värden exakt. */
export const STATUS_COLOR_VAR: Record<DayStatus, string> = {
  training: "var(--day-trained)",
  rest: "var(--day-rest)",
  sick: "var(--day-sick)",
  injured: "var(--day-injured)",
};

export const STATUS_LABEL: Record<DayStatus, string> = {
  training: "Tränade",
  rest: "Ledig",
  sick: "Sjuk",
  injured: "Skadad",
};

export function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad2(month)}-${pad2(day)}`;
}

/** Antal dagar i månaden. month är 1-12. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

/** Veckodagsindex (0=mån .. 6=sön) för den första dagen i månaden. */
export function firstWeekdayOfMonth(year: number, month: number): number {
  const jsDay = new Date(year, month - 1, 1).getDay(); // 0=sön..6=lör
  return (jsDay + 6) % 7;
}

export function isValidYear(year: number): boolean {
  return Number.isInteger(year) && year >= 2000 && year <= 2100;
}

export function isValidMonth(month: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

export function isValidDay(year: number, month: number, day: number): boolean {
  return Number.isInteger(day) && day >= 1 && day <= daysInMonth(year, month);
}

/** Datumnyckel för dagen efter (year, month, day), med korrekt månads-/årsskifte. */
export function nextDateKey(year: number, month: number, day: number): string {
  const d = new Date(year, month - 1, day + 1);
  return dateKey(d.getFullYear(), d.getMonth() + 1, d.getDate());
}
