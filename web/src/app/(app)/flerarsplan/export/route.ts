import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { TRAINING_FACTORS, TRAINING_FACTOR_GROUP_LABELS, type TrainingFactorGroup } from "@/lib/training-factors";

/* Excel-export: Flerårsplan + Årsplan, de två flikarna Daniel (coach)
 * faktiskt ska skicka in till Svensk Friidrott — se konversationen. Målgrupp,
 * Detaljplan och övningsbiblioteken skrivs medvetet inte hit (avgränsning
 * bekräftad med användaren). Radetiketterna speglar originalmallens rubriker
 * men det här är en ny arbetsbok, inte en ifylld kopia av källfilen — exakt
 * visuell matchning (färger, sammanslagna celler) är inte målet i det här
 * steget, bara att data hamnar rätt.
 *
 * exceljs kräver Node-API:er (Buffer m.m.) — måste köra i Node-runtimen,
 * inte Edge. */
export const runtime = "nodejs";

const MONTHS_SHORT = [
  "jan", "feb", "mar", "apr", "maj", "jun",
  "jul", "aug", "sep", "okt", "nov", "dec",
];

type MultiYearPlanRow = {
  year_label: string;
  sort_order: number;
  overall_goal: string | null;
  general_training_goal: string | null;
  specific_training_goal: string | null;
  weekly_hours: number | null;
  weekly_days: number | null;
  weekly_sessions: number | null;
  target_competitions: string | null;
  camps: string | null;
  result_targets: { event: string; target: string }[];
  evaluations: string | null;
};

type SeasonWeekPlanRow = {
  week_start_date: string;
  period_type: string | null;
  sub_phase: string | null;
  note: string | null;
  sessions_count: number | null;
  days_count: number | null;
  starts_count: number | null;
  hours_count: number | null;
  has_test: boolean;
  training_factors: Record<string, string>;
};

function isoWeekNumber(dateKey: string): number {
  const d = new Date(`${dateKey}T00:00:00Z`);
  const dayNum = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - dayNum + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  const firstDayNum = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDayNum + 3);
  return 1 + Math.round((d.getTime() - firstThursday.getTime()) / (7 * 86_400_000));
}

function monthLabel(dateKey: string): string {
  return MONTHS_SHORT[Number(dateKey.slice(5, 7)) - 1];
}

function buildFlerarsplanSheet(workbook: ExcelJS.Workbook, years: MultiYearPlanRow[]) {
  const sheet = workbook.addWorksheet("Flerårsplan");
  const sorted = [...years].sort((a, b) => a.sort_order - b.sort_order);

  const header = ["", ...sorted.map((y) => y.year_label)];
  sheet.addRow(header).font = { bold: true };

  const simpleRows: [string, (y: MultiYearPlanRow) => string | number][] = [
    ["Övergripande mål", (y) => y.overall_goal ?? ""],
    ["Mål allmän träning", (y) => y.general_training_goal ?? ""],
    ["Mål specifik träning", (y) => y.specific_training_goal ?? ""],
    ["Träningstid, timmar", (y) => y.weekly_hours ?? ""],
    ["Dagar, antal", (y) => y.weekly_days ?? ""],
    ["Pass, antal", (y) => y.weekly_sessions ?? ""],
    ["Huvudtävlingar", (y) => y.target_competitions ?? ""],
    ["Läger", (y) => y.camps ?? ""],
  ];
  for (const [label, getValue] of simpleRows) {
    sheet.addRow([label, ...sorted.map(getValue)]);
  }

  // Resultatmål: en rad per gren som förekommer i något år, kolumnen visar
  // det årets måltid om grenen är satt då.
  const events: string[] = [];
  for (const y of sorted) {
    for (const t of y.result_targets ?? []) {
      if (!events.includes(t.event)) events.push(t.event);
    }
  }
  if (events.length > 0) {
    sheet.addRow(["Resultatmål:"]).font = { italic: true };
    for (const event of events) {
      sheet.addRow([
        event,
        ...sorted.map((y) => (y.result_targets ?? []).find((t) => t.event === event)?.target ?? ""),
      ]);
    }
  }

  sheet.addRow(["Utvärderingar", ...sorted.map((y) => y.evaluations ?? "")]);

  sheet.getColumn(1).width = 28;
  for (let i = 2; i <= header.length; i++) sheet.getColumn(i).width = 18;
}

function buildArsplanSheet(workbook: ExcelJS.Workbook, weeks: SeasonWeekPlanRow[]) {
  const sheet = workbook.addWorksheet("Årsplan");
  const sorted = [...weeks].sort((a, b) => (a.week_start_date < b.week_start_date ? -1 : 1));

  sheet.addRow(["Vecka #", ...sorted.map((w) => isoWeekNumber(w.week_start_date))]).font = {
    bold: true,
  };
  sheet.addRow(["Datum", ...sorted.map((w) => w.week_start_date)]);
  sheet.addRow(["Månad", ...sorted.map((w) => monthLabel(w.week_start_date))]);
  sheet.addRow(["Period", ...sorted.map((w) => w.period_type ?? "")]);
  sheet.addRow(["", ...sorted.map((w) => w.sub_phase ?? "")]);
  sheet.addRow(["Tävlingar / Läger / Skola", ...sorted.map((w) => w.note ?? "")]);
  sheet.addRow(["Antal pass", ...sorted.map((w) => w.sessions_count ?? "")]);
  sheet.addRow(["Antal dagar", ...sorted.map((w) => w.days_count ?? "")]);
  sheet.addRow(["Antal tävlingsstarter", ...sorted.map((w) => w.starts_count ?? "")]);
  sheet.addRow(["Antal timmar", ...sorted.map((w) => w.hours_count ?? "")]);
  sheet.addRow(["Tester", ...sorted.map((w) => (w.has_test ? "x" : ""))]);

  let lastGroup: TrainingFactorGroup | null = null;
  for (const factor of TRAINING_FACTORS) {
    if (factor.group !== lastGroup) {
      sheet.addRow([TRAINING_FACTOR_GROUP_LABELS[factor.group]]).font = { italic: true };
      lastGroup = factor.group;
    }
    sheet.addRow([factor.label, ...sorted.map((w) => w.training_factors?.[factor.key] ?? "")]);
  }

  sheet.getColumn(1).width = 32;
  for (let i = 2; i <= sorted.length + 1; i++) sheet.getColumn(i).width = 14;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scopedUserId = resolveScopedUserId(scoped, searchParams.get("athlete") ?? undefined);

  const [{ data: yearRows }, { data: weekRows }] = await Promise.all([
    supabase
      .from("multi_year_plans")
      .select("*")
      .eq("user_id", scopedUserId)
      .order("sort_order"),
    supabase
      .from("season_week_plans")
      .select("*")
      .eq("user_id", scopedUserId)
      .order("week_start_date"),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Träningsappen";
  workbook.created = new Date();

  buildFlerarsplanSheet(workbook, (yearRows ?? []) as MultiYearPlanRow[]);
  buildArsplanSheet(workbook, (weekRows ?? []) as SeasonWeekPlanRow[]);

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="traningsplanering.xlsx"',
    },
  });
}
