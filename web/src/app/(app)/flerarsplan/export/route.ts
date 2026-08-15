import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { TRAINING_FACTORS, TRAINING_FACTOR_GROUP_LABELS, type TrainingFactorGroup } from "@/lib/training-factors";
import { blockForDate, PERIOD_LABELS, PHASE_LABELS, type PeriodType, type PhaseType } from "@/lib/planning";
import { buildWeekSeriesForRange } from "@/lib/week-series";

/* Excel-export: Flerårsplan + Årsplan, de två flikarna Daniel (coach)
 * faktiskt ska skicka in till Svensk Friidrott — se konversationen. Målgrupp,
 * Detaljplan och övningsbiblioteken skrivs medvetet inte hit (avgränsning
 * bekräftad med användaren). Radetiketterna speglar originalmallens rubriker
 * men det här är en ny arbetsbok, inte en ifylld kopia av källfilen.
 *
 * Årsplan-fliken byggs numera ur season_blocks (period/fas/standardvecka per
 * block, se supabase/migrations/20260815100000_block_period_redesign.sql)
 * i stället för en rad per vecka — samma standardvecka projiceras över varje
 * kalendervecka i blockets datumintervall. Period- och fasraderna slås ihop
 * med sammanslagna celler över de veckor blocket täcker, precis som
 * originalmallens Period-rad faktiskt är uppbyggd (en sammanslagen cell per
 * period, inte upprepad text) — övriga rader (pass/dagar/timmar/faktorer)
 * skrivs som upprepat värde per vecka, också det likt originalet.
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

type SeasonBlockRow = {
  id: string;
  start_date: string;
  end_date: string;
  period: PeriodType;
  phase: PhaseType;
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

/** Slår ihop cellerna i en rad över varje sammanhängande körd veckor som
 * tillhör samma block (jämfört på block-id) — precis som originalmallens
 * Period-rad är en sammanslagen cell per period, inte samma text upprepad i
 * varje veckokolumn. `weekIndex` är 0-baserat; kolumn 1 är radetiketten, så
 * vecka 0 hamnar i kolumn 2. */
function mergeConsecutiveBlockRuns(
  sheet: ExcelJS.Worksheet,
  rowNumber: number,
  blockPerWeek: (SeasonBlockRow | null)[],
) {
  let runStart = 0;
  for (let i = 1; i <= blockPerWeek.length; i++) {
    const continuesRun = i < blockPerWeek.length && blockPerWeek[i]?.id === blockPerWeek[runStart]?.id;
    if (!continuesRun) {
      if (blockPerWeek[runStart] && i - runStart > 1) {
        sheet.mergeCells(rowNumber, runStart + 2, rowNumber, i + 1);
      }
      runStart = i;
    }
  }
}

function buildArsplanSheet(workbook: ExcelJS.Workbook, blocks: SeasonBlockRow[]) {
  const sheet = workbook.addWorksheet("Årsplan");
  const sortedBlocks = [...blocks].sort((a, b) => (a.start_date < b.start_date ? -1 : 1));

  if (sortedBlocks.length === 0) {
    sheet.addRow(["Vecka #"]).font = { bold: true };
    sheet.getColumn(1).width = 32;
    return;
  }

  // Veckorna som faktiskt har blockdata — spannet från det tidigaste
  // blockets start till det senaste blockets slut, inte ett kalenderår.
  const minDate = sortedBlocks.reduce((m, b) => (b.start_date < m ? b.start_date : m), sortedBlocks[0].start_date);
  const maxDate = sortedBlocks.reduce((m, b) => (b.end_date > m ? b.end_date : m), sortedBlocks[0].end_date);
  const weeks = buildWeekSeriesForRange(minDate, maxDate);
  const blockPerWeek = weeks.map((w) => blockForDate(sortedBlocks, w));

  sheet.addRow(["Vecka #", ...weeks.map((w) => isoWeekNumber(w))]).font = { bold: true };
  sheet.addRow(["Datum", ...weeks]);
  sheet.addRow(["Månad", ...weeks.map((w) => monthLabel(w))]);

  const periodRow = sheet.addRow([
    "Period",
    ...blockPerWeek.map((b) => (b ? PERIOD_LABELS[b.period] : "")),
  ]);
  const phaseRow = sheet.addRow(["", ...blockPerWeek.map((b) => (b ? PHASE_LABELS[b.phase] : ""))]);
  mergeConsecutiveBlockRuns(sheet, periodRow.number, blockPerWeek);
  mergeConsecutiveBlockRuns(sheet, phaseRow.number, blockPerWeek);

  sheet.addRow(["Antal pass", ...blockPerWeek.map((b) => b?.sessions_count ?? "")]);
  sheet.addRow(["Antal dagar", ...blockPerWeek.map((b) => b?.days_count ?? "")]);
  sheet.addRow(["Antal tävlingsstarter", ...blockPerWeek.map((b) => b?.starts_count ?? "")]);
  sheet.addRow(["Antal timmar", ...blockPerWeek.map((b) => b?.hours_count ?? "")]);
  sheet.addRow(["Tester", ...blockPerWeek.map((b) => (b?.has_test ? "x" : ""))]);

  let lastGroup: TrainingFactorGroup | null = null;
  for (const factor of TRAINING_FACTORS) {
    if (factor.group !== lastGroup) {
      sheet.addRow([TRAINING_FACTOR_GROUP_LABELS[factor.group]]).font = { italic: true };
      lastGroup = factor.group;
    }
    sheet.addRow([
      factor.label,
      ...blockPerWeek.map((b) => b?.training_factors?.[factor.key] ?? ""),
    ]);
  }

  sheet.getColumn(1).width = 32;
  for (let i = 2; i <= weeks.length + 1; i++) sheet.getColumn(i).width = 14;
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scopedUserId = resolveScopedUserId(scoped, searchParams.get("athlete") ?? undefined);

  const [{ data: yearRows }, { data: blockRows }] = await Promise.all([
    supabase
      .from("multi_year_plans")
      .select("*")
      .eq("user_id", scopedUserId)
      .order("sort_order"),
    supabase
      .from("season_blocks")
      .select("id, start_date, end_date, period, phase, sessions_count, days_count, starts_count, hours_count, has_test, training_factors")
      .eq("user_id", scopedUserId)
      .order("start_date"),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Träningsappen";
  workbook.created = new Date();

  buildFlerarsplanSheet(workbook, (yearRows ?? []) as MultiYearPlanRow[]);
  buildArsplanSheet(workbook, (blockRows ?? []) as SeasonBlockRow[]);

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="traningsplanering.xlsx"',
    },
  });
}
