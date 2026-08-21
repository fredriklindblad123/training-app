import ExcelJS from "exceljs";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import {
  TRAINING_FACTOR_GROUP_LABELS,
  TRAINING_FACTOR_SUBGROUP_LABELS,
  TRAINING_FACTORS,
  type TrainingFactorSubgroup,
} from "@/lib/training-factors";
import {
  PERIOD_LABELS,
  PHASE_LABELS,
  PHASE_TYPES,
  WEEKDAY_LABELS,
  WORKOUT_LABELS,
  type PeriodType,
  type PhaseType,
  type WorkoutType,
} from "@/lib/planning";
import {
  buildArsplanWeeks,
  computeMergeRuns,
  type ArsplanBlockInput,
  type ArsplanCompetitionInput,
  type ArsplanPlannedWorkoutInput,
} from "@/lib/arsplan-grid";
import {
  detaljplanItemsFor,
  detaljplanRowCountByGroup,
  hasUngroupedDetaljplanItems,
  usedDetaljplanFactorRows,
  type DetaljplanItemInput,
} from "@/lib/detaljplan-grid";

/* Excel-export: Flerårsplan, Årsplan och (sedan 2026-08-21) Detaljplan — de
 * flikar som speglar appens planeringsdata. Målgrupp och övningsbiblioteken
 * skrivs medvetet inte hit (avgränsning bekräftad med användaren), och
 * Utfall (plan mot faktiskt genomfört) likaså — det förblir en ren app-vy på
 * /arsplan tills vidare, uttryckligt val 2026-08-21. Radetiketterna speglar
 * originalmallens rubriker men det här är en ny arbetsbok, inte en ifylld
 * kopia av källfilen.
 *
 * Årsplan-fliken byggs sedan 2026-08-17 ur lib/arsplan-grid.ts och
 * Detaljplan-fliken ur lib/detaljplan-grid.ts — samma datamoduler som
 * /arsplan och /detaljplan använder in-app, så Excel-filen och appvyerna
 * aldrig kan visa olika siffror eller rader för samma data. Antal pass/
 * dagar/timmar räknas alltid live ur faktiskt utrullade planned_workouts
 * (blockets egna manuella "standardvecka"-fält togs bort 2026-08-18 —
 * uttrycklig begäran, samma skäl som redan flyttade träningsfaktorer till
 * pass-nivå).
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

  // Träningsfaktorerna (Snabbhet/Uthållighet/...) härleds ur faktiskt taggade
  // pass, inte ur ett fält på blocket — se training_factor på
  // week_template_items/planned_workouts. Tre nivåer (grupp/undergrupp/rad),
  // som originalmallens fetstil/indragning — se motsvarande rendering i
  // arsplan/page.tsx, samma tre-nivå-princip.
  let lastGroup: string | null = null;
  let lastSubgroup: TrainingFactorSubgroup | null = null;
  for (const factor of TRAINING_FACTORS) {
    if (factor.group !== lastGroup) {
      sheet.addRow([TRAINING_FACTOR_GROUP_LABELS[factor.group]]).font = { italic: true };
      lastGroup = factor.group;
      lastSubgroup = null;
    }
    if (factor.subgroup && factor.subgroup !== lastSubgroup) {
      const subgroupRow = sheet.addRow([TRAINING_FACTOR_SUBGROUP_LABELS[factor.subgroup]]);
      subgroupRow.font = { italic: true };
      subgroupRow.getCell(1).alignment = { indent: 1 };
    }
    lastSubgroup = factor.subgroup ?? null;
    const factorRow = sheet.addRow([factor.label, ...weeks.map((w) => w.factorCounts[factor.key] ?? "")]);
    if (factor.subgroup) factorRow.getCell(1).alignment = { indent: 2 };
  }

  sheet.getColumn(1).width = 32;
  for (let i = 2; i <= weeks.length + 1; i++) sheet.getColumn(i).width = 14;
}

type DetaljplanBlockInput = {
  id: string;
  name: string;
  period: PeriodType;
  phase: PhaseType;
  start_date: string;
  end_date: string;
  week_template_items: (DetaljplanItemInput & { id: string })[] | null;
};

/** Cellinnehållet för ett pass i Detaljplan-fliken: samma tre uppgifter som
 * PatternItemCard visar i appen (typ, rubrik, pass-nummer), men som en
 * textrad eftersom en Excel-cell inte kan bära ett kort. Repgrupper utelämnas
 * medvetet — de gör cellerna oläsligt långa i Excel, och originalmallens
 * Detaljplan-flik har dem inte heller. */
function detaljplanCellText(items: (DetaljplanItemInput & { id: string })[]): string {
  return items
    .map((it) => {
      const type = WORKOUT_LABELS[it.workout_type as WorkoutType] ?? it.workout_type;
      const parts = [type];
      if (it.title) parts.push(it.title);
      if (it.slot > 1) parts.push(`pass ${it.slot}`);
      return parts.join(" · ");
    })
    .join("\n");
}

/* Detaljplan-fliken: ett dag × träningsfaktor-rutnät per block, grupperat per
 * fas precis som /detaljplan-sidan. Raduppsättningen kommer ur
 * lib/detaljplan-grid.ts, delad med sidan — samma "en datamodul, aldrig olika
 * rader för samma data"-princip som Årsplan-fliken redan följer. */
function buildDetaljplanSheet(workbook: ExcelJS.Workbook, blocks: DetaljplanBlockInput[]) {
  const sheet = workbook.addWorksheet("Detaljplan");
  sheet.getColumn(1).width = 34;
  for (let i = 2; i <= WEEKDAY_LABELS.length + 1; i++) sheet.getColumn(i).width = 22;

  const relevantPhases = PHASE_TYPES.filter((phase) => blocks.some((b) => b.phase === phase));
  if (relevantPhases.length === 0) {
    sheet.addRow(["Inga block med veckomönster ännu."]);
    return;
  }

  for (const phase of relevantPhases) {
    sheet.addRow([PHASE_LABELS[phase]]).font = { bold: true, size: 13 };

    for (const block of blocks.filter((b) => b.phase === phase)) {
      const items = block.week_template_items ?? [];
      sheet.addRow([
        `${block.name} — ${PERIOD_LABELS[block.period]} · ${block.start_date} – ${block.end_date} · ${items.length} pass/vecka`,
      ]).font = { bold: true };

      if (items.length === 0) {
        sheet.addRow(["Inga pass i mönstret ännu."]).getCell(1).font = { italic: true };
        sheet.addRow([]);
        continue;
      }

      sheet.addRow(["Träningsfaktor", ...WEEKDAY_LABELS]).font = { bold: true };

      const usedRows = usedDetaljplanFactorRows(items);
      const rowCountByGroup = detaljplanRowCountByGroup(usedRows);

      usedRows.forEach((row, i) => {
        const splitBySubgroup = (rowCountByGroup[row.group] ?? 0) > 1;
        const isFirstOfGroup = i === 0 || usedRows[i - 1].group !== row.group;
        // Samma tre-nivå-hierarki som appvyn: gruppnamnet blir en egen
        // rubrikrad bara när gruppen faktiskt delas upp i undergrupper,
        // annars bär dataraden gruppnamnet själv.
        if (splitBySubgroup && isFirstOfGroup) {
          const groupRow = sheet.addRow([TRAINING_FACTOR_GROUP_LABELS[row.group]]);
          groupRow.font = { italic: true };
        }
        const label =
          splitBySubgroup && row.subgroup
            ? TRAINING_FACTOR_SUBGROUP_LABELS[row.subgroup]
            : TRAINING_FACTOR_GROUP_LABELS[row.group];
        const dataRow = sheet.addRow([
          label,
          ...WEEKDAY_LABELS.map((_, wi) => detaljplanCellText(detaljplanItemsFor(items, wi + 1, row))),
        ]);
        if (splitBySubgroup) dataRow.getCell(1).alignment = { indent: 1 };
        dataRow.alignment = { vertical: "top", wrapText: true };
      });

      if (hasUngroupedDetaljplanItems(items)) {
        const dataRow = sheet.addRow([
          "Ej kopplat",
          ...WEEKDAY_LABELS.map((_, wi) =>
            detaljplanCellText(detaljplanItemsFor(items, wi + 1, { group: null })),
          ),
        ]);
        dataRow.alignment = { vertical: "top", wrapText: true };
      }

      sheet.addRow([]);
    }
  }
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) {
    return NextResponse.json({ error: "Inte inloggad" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const scopedUserId = resolveScopedUserId(scoped, searchParams.get("athlete") ?? undefined);

  // Block hänger på löpare via season_block_athletes, INTE via
  // season_blocks.user_id — den kolumnen betyder "vem äger/redigerar
  // blocket" (coachen för ett delat block) sedan multi-löpar-omdesignen
  // (migration 20260816100000), inte "vem det gäller". Att filtrera på
  // user_id här gjorde att exporten tyst returnerade noll block för varje
  // löpare vars block skapats av en coach; /arsplan-sidan gjorde redan rätt.
  const { data: blockAthleteRows } = await supabase
    .from("season_block_athletes")
    .select("block_id")
    .eq("athlete_id", scopedUserId);
  const blockIds = [...new Set((blockAthleteRows ?? []).map((r) => r.block_id as string))];

  const [{ data: yearRows }, { data: blockRows }] = await Promise.all([
    supabase
      .from("multi_year_plans")
      .select("*")
      .eq("user_id", scopedUserId)
      .order("sort_order"),
    blockIds.length > 0
      ? supabase
          .from("season_blocks")
          .select(
            "id, name, start_date, end_date, period, phase, week_template_items(id, weekday, slot, workout_type, title, training_factor)",
          )
          .in("id", blockIds)
          .order("start_date")
      : Promise.resolve({ data: [] as DetaljplanBlockInput[] }),
  ]);

  const detaljplanBlocks = (blockRows ?? []) as DetaljplanBlockInput[];
  const blocks = detaljplanBlocks as ArsplanBlockInput[];

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
  buildDetaljplanSheet(workbook, detaljplanBlocks);

  const buffer = await workbook.xlsx.writeBuffer();

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="traningsplanering.xlsx"',
    },
  });
}
