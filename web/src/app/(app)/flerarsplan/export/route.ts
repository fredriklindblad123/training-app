import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { TRAINING_FACTOR_GROUP_LABELS, TRAINING_FACTORS } from "@/lib/training-factors";
import { PERIOD_LABELS, PHASE_LABELS } from "@/lib/planning";
import {
  buildArsplanWeeks,
  computeMergeRuns,
  type ArsplanBlockInput,
  type ArsplanCompetitionInput,
  type ArsplanPlannedWorkoutInput,
} from "@/lib/arsplan-grid";

/* Excel-export: Flerårsplan + Årsplan, de två flikarna Daniel (coach)
 * faktiskt ska skicka in till Svensk Friidrott — se konversationen. Målgrupp,
 * Detaljplan och övningsbiblioteken skrivs medvetet inte hit (avgränsning
 * bekräftad med användaren). Radetiketterna speglar originalmallens rubriker
 * men det här är en ny arbetsbok, inte en ifylld kopia av källfilen.
 *
 * Årsplan-fliken byggs sedan 2026-08-17 ur lib/arsplan-grid.ts — samma
 * datamodul som /arsplan-sidans in-app-rutnät använder, så Excel-filen och
 * appvyn aldrig kan visa olika siffror för samma data. Antal pass/dagar/
 * timmar räknas live ur faktiskt utrullade planned_workouts när sådana
 * finns för veckan (annars block.sessions_count m.fl. som förval, se
 * `usedFallback` i arsplan-grid.ts) — tidigare upprepade den här filen bara
 * blockets statiska fält per vecka oavsett vad som faktiskt låg i kalendern.
 *
 * exceljs kräver Node-API:er (Buffer m.m.) — måste köra i Node-runtimen,
 * inte Edge. */
export const runtime = "nodejs";

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

function buildArsplanSheet(
  workbook: ExcelJS.Workbook,
  blocks: ArsplanBlockInput[],
  plannedWorkouts: ArsplanPlannedWorkoutInput[],
  competitions: ArsplanCompetitionInput[],
) {
  const sheet = workbook.addWorksheet("Årsplan");
  const weeks = buildArsplanWeeks(blocks, plannedWorkouts, competitions);

  if (weeks.length === 0) {
    sheet.addRow(["Vecka #"]).font = { bold: true };
    sheet.getColumn(1).width = 32;
    return;
  }

  sheet.addRow(["Vecka #", ...weeks.map((w) => w.isoWeekNumber)]).font = { bold: true };
  sheet.addRow(["Datum", ...weeks.map((w) => w.weekStart)]);
  sheet.addRow(["Månad", ...weeks.map((w) => w.monthLabel)]);

  const periodRow = sheet.addRow([
    "Period",
    ...weeks.map((w) => (w.block ? PERIOD_LABELS[w.block.period] : "")),
  ]);
  const phaseRow = sheet.addRow(["", ...weeks.map((w) => (w.block ? PHASE_LABELS[w.block.phase] : ""))]);
  // Sammanslagna celler över varje sammanhängande körd veckor som tillhör
  // samma block, precis som originalmallens Period-rad är en sammanslagen
  // cell per period, inte samma text upprepad i varje veckokolumn.
  for (const run of computeMergeRuns(weeks)) {
    if (run.length <= 1) continue;
    sheet.mergeCells(periodRow.number, run.startIndex + 2, periodRow.number, run.startIndex + run.length + 1);
    sheet.mergeCells(phaseRow.number, run.startIndex + 2, phaseRow.number, run.startIndex + run.length + 1);
  }

  sheet.addRow(["Antal pass", ...weeks.map((w) => w.sessionsCount)]);
  sheet.addRow(["Antal dagar", ...weeks.map((w) => w.daysCount)]);
  sheet.addRow(["Antal tävlingsstarter", ...weeks.map((w) => w.startsCount)]);
  sheet.addRow(["Antal timmar", ...weeks.map((w) => Math.round(w.hoursCount * 10) / 10)]);
  sheet.addRow(["Tester", ...weeks.map((w) => (w.block?.has_test ? "x" : ""))]);

  // Träningsfaktorerna (Snabbhet/Uthållighet/...) härleds ur faktiskt taggade
  // pass, inte ur ett fält på blocket — se training_factor på
  // week_template_items/planned_workouts.
  let lastGroup: string | null = null;
  for (const factor of TRAINING_FACTORS) {
    if (factor.group !== lastGroup) {
      sheet.addRow([TRAINING_FACTOR_GROUP_LABELS[factor.group]]).font = { italic: true };
      lastGroup = factor.group;
    }
    sheet.addRow([factor.label, ...weeks.map((w) => w.factorCounts[factor.key] ?? "")]);
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
      .select("id, start_date, end_date, period, phase, sessions_count, days_count, starts_count, hours_count, has_test")
      .eq("user_id", scopedUserId)
      .order("start_date"),
  ]);

  const blocks = (blockRows ?? []) as ArsplanBlockInput[];

  // planned_workouts/competitions behövs bara för blockens eget datumspann
  // (samma spann buildArsplanWeeks räknar fram) — frågas parallellt, tomt
  // om inga block finns alls.
  const minDate = blocks.reduce((m, b) => (b.start_date < m ? b.start_date : m), blocks[0]?.start_date ?? "");
  const maxDate = blocks.reduce((m, b) => (b.end_date > m ? b.end_date : m), blocks[0]?.end_date ?? "");

  const [{ data: workoutRows }, { data: competitionRows }] =
    blocks.length === 0
      ? [{ data: [] }, { data: [] }]
      : await Promise.all([
          supabase
            .from("planned_workouts")
            .select("scheduled_date, training_factor, target_duration_seconds")
            .eq("user_id", scopedUserId)
            .gte("scheduled_date", minDate)
            .lte("scheduled_date", maxDate),
          supabase
            .from("competitions")
            .select("competition_date, name, competition_events(event)")
            .eq("user_id", scopedUserId)
            .gte("competition_date", minDate)
            .lte("competition_date", maxDate),
        ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = "Träningsappen";
  workbook.created = new Date();

  buildFlerarsplanSheet(workbook, (yearRows ?? []) as MultiYearPlanRow[]);
  buildArsplanSheet(
    workbook,
    blocks,
    (workoutRows ?? []) as ArsplanPlannedWorkoutInput[],
    (competitionRows ?? []) as ArsplanCompetitionInput[],
  );

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="traningsplanering.xlsx"',
    },
  });
}
