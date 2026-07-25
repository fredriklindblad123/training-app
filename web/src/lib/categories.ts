// Medeldistans-taxonomi för träningspass. Måste hållas i synk med check-
// constrainten på activities.category, se
// supabase/migrations/20260725120000_activity_category.sql.

export const CATEGORY_VALUES = [
  "easy",
  "long_run",
  "threshold",
  "interval",
  "repetition",
  "race",
  "strength",
  "other",
] as const;

export type ActivityCategory = (typeof CATEGORY_VALUES)[number];

export const CATEGORY_LABELS: Record<ActivityCategory, string> = {
  easy: "Lugn distans",
  long_run: "Långpass",
  threshold: "Tröskel",
  interval: "Intervaller",
  repetition: "Räckor",
  race: "Tävling",
  strength: "Styrka",
  other: "Övrigt",
};

// Fast slot-ordning ur den kategoriska 8-färgspaletten. Ordningen är CVD-
// säkerhetsmekanismen (validerad, se dataviz-riktlinjer) och ska inte ändras
// utan att paletten valideras om.
export const CATEGORY_COLORS: Record<
  ActivityCategory,
  { light: string; dark: string }
> = {
  easy: { light: "#2a78d6", dark: "#3987e5" },
  long_run: { light: "#eb6834", dark: "#d95926" },
  threshold: { light: "#1baf7a", dark: "#199e70" },
  interval: { light: "#eda100", dark: "#c98500" },
  repetition: { light: "#e87ba4", dark: "#d55181" },
  race: { light: "#008300", dark: "#008300" },
  strength: { light: "#4a3aa7", dark: "#9085e9" },
  other: { light: "#e34948", dark: "#e66767" },
};

export function isActivityCategory(value: string): value is ActivityCategory {
  return (CATEGORY_VALUES as readonly string[]).includes(value);
}

// CSS custom property (ljust/mörkt tema hanteras i globals.css) för given kategori.
export function categoryColorVar(category: ActivityCategory): string {
  return `var(--cat-${category})`;
}
