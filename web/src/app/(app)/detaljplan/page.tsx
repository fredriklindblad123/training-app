import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  canEditPlanning,
  getScopedProfile,
  resolveScopedUserId,
  viewableAthletes,
  type AthleteOption,
  type ScopedProfile,
} from "@/lib/auth-scope";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
import {
  PERIOD_LABELS,
  PHASE_LABELS,
  PHASE_TYPES,
  QUALITY_WORKOUT_TYPES,
  SLOT_LABELS,
  toDateKey,
  WEEKDAY_LABELS,
  WORKOUT_LABELS,
  WORKOUT_TYPES,
  type PeriodType,
  type PhaseType,
  type WorkoutType,
} from "@/lib/planning";
import { plannedSignatureLabel, type PlannedRepGroup } from "@/lib/session-signature";
import { RepGroupEditor, type RepGroupRow } from "@/components/RepGroupEditor";
import { TrainingFactorSelect } from "@/components/TrainingFactorSelect";
import {
  addAthleteToPass,
  addManualPass,
  addTemplateItem,
  addTemplateRepGroup,
  deleteTemplateItem,
  deleteTemplateRepGroup,
  removeAthleteFromPass,
  updatePlannedPass,
  updateTemplateItem,
  updateTemplateRepGroup,
} from "./actions";
import {
  buildDetaljplanWeeks,
  type DetaljplanWeek,
  type PassGroup,
  type PlannedPassRow,
} from "@/lib/detaljplan-weeks";
import { Fragment } from "react";
import {
  TRAINING_FACTORS,
  TRAINING_FACTOR_GROUP_LABELS,
  TRAINING_FACTOR_SUBGROUP_LABELS,
} from "@/lib/training-factors";
import {
  detaljplanItemsFor,
  detaljplanRowCountByGroup,
  hasUngroupedDetaljplanItems,
  usedDetaljplanFactorRows,
} from "@/lib/detaljplan-grid";

/* Detaljplan: varje blocks eget dag-för-dag-veckomönster, en fas i taget —
 * speglar Excel-mallens Detaljplan-flik. Flyttad hit ur /sasongen
 * 2026-08-17 (var tidigare nästlad under varje block), och förenklad samma
 * dag: ett block äger sitt mönster direkt (week_template_items.block_id)
 * — ingen separat namngiven "mall" att skapa, ingen delning mellan block.
 * Uttrycklig begäran: en gammal, coach-ägd mall läckte in mellan löpare
 * bara för att den delade fas med ett block, och det extra namngivnings-
 * steget kändes redundant ovanpå att blocket redan skapats på /arsplan —
 * "man får skapa ett nytt varje gång istället, lättare att begripa". */

const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const ghostBtn =
  "w-fit rounded border border-zinc-300 px-3 py-1 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-zinc-600 dark:text-zinc-400">{label}</span>
      {children}
    </label>
  );
}

type TemplateItemRow = {
  id: string;
  weekday: number;
  slot: number;
  workout_type: string;
  title: string | null;
  description: string | null;
  training_factor: string | null;
  template_rep_groups?: RepGroupRow[] | null;
};

/** Ett enskilt pass-kort i rutnätet — delad mellan alla celler (dag ×
 * träningsfaktor-grupp) i PatternGrid nedan, så kortets innehåll bara
 * behöver underhållas på ett ställe.
 *
 * Kortet bär också steg 4 i tränarens process (2026-08-21): "ändra"-fliken
 * fyller på detaljer i efterhand, med en scope-väljare för om ändringen
 * gäller alla taggade löpare eller bara en. Se updateTemplateItem i
 * actions.ts för varför det måste skriva i planned_workouts direkt. */
function PatternItemCard({
  it,
  canEdit,
  blockAthletes,
}: {
  it: TemplateItemRow;
  canEdit: boolean;
  blockAthletes: AthleteOption[];
}) {
  const sigLabel = plannedSignatureLabel(
    (it.template_rep_groups ?? []).map(
      (g): PlannedRepGroup => ({
        reps: g.reps,
        distanceMeters: g.distance_meters,
        durationSeconds: g.duration_seconds,
        sortOrder: g.sort_order,
      }),
    ),
  );
  return (
    <div className="rounded bg-zinc-100 px-1.5 py-1 text-xs dark:bg-zinc-800">
      <div className="font-medium text-zinc-900 dark:text-zinc-100">
        {WORKOUT_LABELS[it.workout_type as keyof typeof WORKOUT_LABELS] ?? it.workout_type}
      </div>
      {it.title && <div className="text-zinc-600 dark:text-zinc-400">{it.title}</div>}
      {it.training_factor && (
        <div className="text-[10px] text-zinc-500 dark:text-zinc-500">
          {TRAINING_FACTORS.find((f) => f.key === it.training_factor)?.label ?? it.training_factor}
        </div>
      )}
      {sigLabel && <div className="text-zinc-600 dark:text-zinc-400">{sigLabel}</div>}
      {it.slot > 1 && (
        <div className="text-[10px] text-zinc-500 dark:text-zinc-500">{SLOT_LABELS[it.slot]}</div>
      )}
      {canEdit && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            ändra
          </summary>
          <form action={updateTemplateItem} className="mt-1 flex flex-col gap-1">
            <input type="hidden" name="id" value={it.id} />
            <select
              name="workout_type"
              defaultValue={it.workout_type}
              className={`${input} w-full`}
              aria-label="Typ"
            >
              {WORKOUT_TYPES.map((w) => (
                <option key={w} value={w}>
                  {WORKOUT_LABELS[w]}
                </option>
              ))}
            </select>
            <input
              name="title"
              defaultValue={it.title ?? ""}
              placeholder="10x400m"
              aria-label="Rubrik"
              className={`${input} w-full`}
            />
            <input
              name="target_duration_minutes"
              type="number"
              min="0"
              placeholder="minuter"
              aria-label="Minuter"
              className={`${input} w-full`}
            />
            <TrainingFactorSelect defaultValue={it.training_factor} label={null} />
            {/* Scope-väljaren: hela poängen med steg 4. Visas bara när
                blocket faktiskt har fler än en taggad löpare — för ett
                block med en enda löpare är "alla" och "hon" samma sak, och
                en väljare med ett meningslöst val gör det bara krångligare. */}
            {blockAthletes.length > 1 && (
              <select name="scope" defaultValue="alla" className={`${input} w-full`} aria-label="Gäller">
                <option value="alla">Alla på blocket</option>
                {blockAthletes.map((a) => (
                  <option key={a.id} value={a.id}>
                    Bara {a.fullName ?? "namnlös löpare"}
                  </option>
                ))}
              </select>
            )}
            <button type="submit" className="rounded bg-zinc-200 px-2 py-0.5 text-[11px] hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600">
              Spara
            </button>
          </form>
          <form action={deleteTemplateItem} className="mt-1">
            <input type="hidden" name="id" value={it.id} />
            <button type="submit" className="text-[10px] text-zinc-400 hover:text-red-600">
              ta bort
            </button>
          </form>
        </details>
      )}
    </div>
  );
}

/** Veckorutnätet: dag-kolumner × träningsfaktor-rader — speglar
 * Excel-mallens Detaljplan-flik (dag × faktor, inte bara dag som tidigare)
 * uttrycklig begäran 2026-08-18. Samma underliggande pass-data som innan
 * (typ/rubrik/mål-tid/repgrupper) — bara omorganiserad radvis. Bara de
 * faktor-grupper som faktiskt har minst ett pass visas som rad, plus en
 * sista "Ej kopplat"-rad om något pass saknar träningsfaktor — annars fem
 * mestadels tomma rader varje gång, samma "visa bara det som används"-
 * princip som redan styr vilka faser som visas ovanför.
 *
 * Bryter en grupp ut i sina undergrupper (Anaerob alaktisk & laktisk /
 * Aerob, i dag bara under Uthållighet) så snart mer än en undergrupp
 * faktiskt används — samma tre-nivåers hierarki som Årsplans faktortabell
 * fick 2026-08-18. Använder bara en rad (utan undergrupp-rubrik) när
 * gruppens pass råkar ligga i en enda undergrupp den veckan, annars blir
 * "Uthållighet" en tom rubrikrad ovanför en enda datarad.
 *
 * Radlogiken (vilka grupper/undergrupper som visas) sitter i
 * lib/detaljplan-grid.ts, delad med Excel-exporten — samma "en datamodul"-
 * princip som lib/arsplan-grid.ts redan använder för Årsplan-fliken. */
function PatternGrid({
  items,
  canEdit,
  blockAthletes = [],
}: {
  items: TemplateItemRow[];
  canEdit: boolean;
  /** Vilka löpare blocket är taggat för — driver scope-väljaren i varje
   * pass-kort ("alla på blocket" vs "bara hon"). Tom i Alla-vyn, som är
   * read-only. */
  blockAthletes?: AthleteOption[];
}) {
  const usedRows = usedDetaljplanFactorRows(items);
  const hasUngrouped = hasUngroupedDetaljplanItems(items);

  if (usedRows.length === 0 && !hasUngrouped) {
    return <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">Inga pass i mönstret ännu.</p>;
  }

  const rowCountByGroup = detaljplanRowCountByGroup(usedRows);
  const colSpan = WEEKDAY_LABELS.length + 1;

  function cellsFor(row: (typeof usedRows)[number] | { group: null }) {
    return WEEKDAY_LABELS.map((label, wi) => {
      const cellItems = detaljplanItemsFor(items, wi + 1, row);
      return (
        <td key={label} className="border-b border-zinc-100 px-1 py-2 dark:border-zinc-900">
          <div className="flex flex-col gap-1">
            {cellItems.map((it) => (
              <PatternItemCard key={it.id} it={it} canEdit={canEdit} blockAthletes={blockAthletes} />
            ))}
          </div>
        </td>
      );
    });
  }

  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[640px] border-collapse text-xs">
        <thead>
          <tr>
            <th className="w-28 border-b border-zinc-200 px-1 pb-1 text-left font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Träningsfaktor
            </th>
            {WEEKDAY_LABELS.map((label) => (
              <th
                key={label}
                className="border-b border-zinc-200 px-1 pb-1 text-left font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
              >
                {label.slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {usedRows.map((row, i) => {
            const splitBySubgroup = (rowCountByGroup[row.group] ?? 0) > 1;
            const isFirstOfGroup = i === 0 || usedRows[i - 1].group !== row.group;
            const label =
              splitBySubgroup && row.subgroup
                ? TRAINING_FACTOR_SUBGROUP_LABELS[row.subgroup]
                : TRAINING_FACTOR_GROUP_LABELS[row.group];
            return (
              <Fragment key={`${row.group}-${row.subgroup ?? "_"}`}>
                {splitBySubgroup && isFirstOfGroup && (
                  <tr>
                    <th
                      scope="row"
                      colSpan={colSpan}
                      className="border-b border-zinc-100 px-1 py-1 text-left font-medium italic text-zinc-500 dark:border-zinc-900 dark:text-zinc-400"
                    >
                      {TRAINING_FACTOR_GROUP_LABELS[row.group]}
                    </th>
                  </tr>
                )}
                <tr className="align-top">
                  <td
                    className={`border-b border-zinc-100 px-1 py-2 font-medium text-zinc-700 dark:border-zinc-900 dark:text-zinc-300 ${
                      splitBySubgroup ? "pl-4" : ""
                    }`}
                  >
                    {label}
                  </td>
                  {cellsFor(row)}
                </tr>
              </Fragment>
            );
          })}
          {hasUngrouped && (
            <tr className="align-top">
              <td className="border-b border-zinc-100 px-1 py-2 font-medium text-zinc-700 dark:border-zinc-900 dark:text-zinc-300">
                Ej kopplat
              </td>
              {cellsFor({ group: null })}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

type BlockRow = {
  id: string;
  name: string;
  period: PeriodType;
  phase: PhaseType;
  start_date: string;
  end_date: string;
  week_template_items?: TemplateItemRow[] | null;
  season_block_athletes?: { athlete_id: string }[] | null;
};

/** Ett pass i veckovyn: sammanfattning + löparchips + "öppna" för
 * detaljer. Chips visas bara när blocket har fler än en taggad löpare —
 * med en enda löpare är "vilka är taggade" ingen fråga. */
function WeekPassCard({
  pass,
  blockId,
  canEdit,
  blockAthletes,
}: {
  pass: PassGroup;
  blockId: string;
  canEdit: boolean;
  blockAthletes: AthleteOption[];
}) {
  const tagged = new Set(pass.athleteIds);
  const untagged = blockAthletes.filter((a) => !tagged.has(a.id));
  const showChips = blockAthletes.length > 1;
  const minutes =
    pass.targetDurationSeconds != null ? Math.round(pass.targetDurationSeconds / 60) : null;

  return (
    <div className="rounded bg-zinc-100 px-1.5 py-1 text-xs dark:bg-zinc-800">
      <div className="font-medium text-zinc-900 dark:text-zinc-100">
        {WORKOUT_LABELS[pass.workoutType as keyof typeof WORKOUT_LABELS] ?? pass.workoutType}
      </div>
      {pass.title && <div className="text-zinc-600 dark:text-zinc-400">{pass.title}</div>}
      {pass.trainingFactor && (
        <div className="text-[10px] text-zinc-500 dark:text-zinc-500">
          {TRAINING_FACTORS.find((f) => f.key === pass.trainingFactor)?.label ?? pass.trainingFactor}
        </div>
      )}
      {minutes != null && <div className="text-[10px] text-zinc-500 dark:text-zinc-500">{minutes} min</div>}
      {pass.slot > 1 && (
        <div className="text-[10px] text-zinc-500 dark:text-zinc-500">{SLOT_LABELS[pass.slot]}</div>
      )}
      {/* Skiljer sig innehållet åt mellan löparna (efter en ändring med
          scope "bara en") får kortet inte se ut att gälla alla. */}
      {pass.diverges && (
        <div className="text-[10px] italic text-amber-700 dark:text-amber-500">olika per löpare</div>
      )}

      {showChips && (
        <div className="mt-1 flex flex-wrap gap-0.5">
          {blockAthletes
            .filter((a) => tagged.has(a.id))
            .map((a) => (
              <span
                key={a.id}
                className="inline-flex items-center gap-0.5 rounded-full bg-zinc-200 px-1.5 py-0.5 text-[10px] text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
              >
                {a.fullName ?? "namnlös"}
                {canEdit && (
                  <form action={removeAthleteFromPass} className="inline">
                    <input type="hidden" name="block_id" value={blockId} />
                    <input type="hidden" name="scheduled_date" value={pass.scheduledDate} />
                    <input type="hidden" name="slot" value={pass.slot} />
                    <input type="hidden" name="athlete_id" value={a.id} />
                    <button
                      type="submit"
                      title={`Ta bort ${a.fullName ?? "löparen"} från passet`}
                      className="text-zinc-400 hover:text-red-600"
                    >
                      ×
                    </button>
                  </form>
                )}
              </span>
            ))}
        </div>
      )}

      {canEdit && (
        <details className="mt-1">
          <summary className="cursor-pointer text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
            öppna
          </summary>

          {showChips && untagged.length > 0 && (
            <form action={addAthleteToPass} className="mt-1 flex items-center gap-1">
              <input type="hidden" name="block_id" value={blockId} />
              <input type="hidden" name="scheduled_date" value={pass.scheduledDate} />
              <input type="hidden" name="slot" value={pass.slot} />
              <select name="athlete_id" className={`${input} w-full`} aria-label="Lägg till löpare">
                {untagged.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.fullName ?? "namnlös löpare"}
                  </option>
                ))}
              </select>
              <button type="submit" className="rounded bg-zinc-200 px-1.5 py-0.5 text-[11px] hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600">
                +
              </button>
            </form>
          )}

          <form action={updatePlannedPass} className="mt-1 flex flex-col gap-1">
            <input type="hidden" name="block_id" value={blockId} />
            <input type="hidden" name="scheduled_date" value={pass.scheduledDate} />
            <input type="hidden" name="slot" value={pass.slot} />
            <select
              name="workout_type"
              defaultValue={pass.workoutType}
              className={`${input} w-full`}
              aria-label="Typ"
            >
              {WORKOUT_TYPES.map((w) => (
                <option key={w} value={w}>
                  {WORKOUT_LABELS[w]}
                </option>
              ))}
            </select>
            <input
              name="title"
              defaultValue={pass.title ?? ""}
              placeholder="10x400m"
              aria-label="Rubrik"
              className={`${input} w-full`}
            />
            <input
              name="target_duration_minutes"
              type="number"
              min="0"
              defaultValue={minutes ?? ""}
              placeholder="minuter"
              aria-label="Minuter"
              className={`${input} w-full`}
            />
            <TrainingFactorSelect defaultValue={pass.trainingFactor} label={null} />
            {pass.athleteIds.length > 1 && (
              <select name="scope" defaultValue="alla" className={`${input} w-full`} aria-label="Gäller">
                <option value="alla">Alla på passet</option>
                {blockAthletes
                  .filter((a) => tagged.has(a.id))
                  .map((a) => (
                    <option key={a.id} value={a.id}>
                      Bara {a.fullName ?? "namnlös löpare"}
                    </option>
                  ))}
              </select>
            )}
            <button type="submit" className="rounded bg-zinc-200 px-2 py-0.5 text-[11px] hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600">
              Spara
            </button>
          </form>
          {pass.hasCompleted && (
            <p className="mt-1 text-[10px] text-zinc-500 dark:text-zinc-500">
              Något av passen är redan genomfört — det lämnas orört.
            </p>
          )}
        </details>
      )}
    </div>
  );
}

/** Veckovyn: en rad per kalendervecka i blocket, tidigaste veckan överst,
 * dagarna som kolumner (uttrycklig begäran 2026-08-21). Ersätter den
 * abstrakta standardvecka-vyn i den enskilda löparens Detaljplan —
 * standardveckan sätts numera vid blockskapandet på /arsplan, så det här
 * är platsen där tränaren arbetar med de pass som faktiskt ligger i
 * kalendern. */
function WeekGrid({
  weeks,
  blockId,
  canEdit,
  blockAthletes,
}: {
  weeks: DetaljplanWeek[];
  blockId: string;
  canEdit: boolean;
  blockAthletes: AthleteOption[];
}) {
  if (weeks.length === 0) {
    return <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">Inga veckor i blocket.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[720px] border-collapse text-xs">
        <thead>
          <tr>
            <th className="w-24 border-b border-zinc-200 px-1 pb-1 text-left font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
              Vecka
            </th>
            {WEEKDAY_LABELS.map((label) => (
              <th
                key={label}
                className="border-b border-zinc-200 px-1 pb-1 text-left font-medium text-zinc-500 dark:border-zinc-800 dark:text-zinc-400"
              >
                {label.slice(0, 3)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeks.map((week) => (
            <tr key={week.weekStart} className="align-top">
              <td className="border-b border-zinc-100 px-1 py-2 dark:border-zinc-900">
                <div className="font-medium text-zinc-700 dark:text-zinc-300">v{week.isoWeekNumber}</div>
                <div className="text-[10px] text-zinc-500 dark:text-zinc-500">{week.weekStart}</div>
              </td>
              {week.days.map((day, di) => (
                <td
                  key={day.date}
                  className={`border-b border-zinc-100 px-1 py-2 dark:border-zinc-900 ${
                    week.outside[di] ? "bg-zinc-50 dark:bg-zinc-900/40" : ""
                  }`}
                >
                  <div className="flex flex-col gap-1">
                    {day.passes.map((p) => (
                      <WeekPassCard
                        key={p.key}
                        pass={p}
                        blockId={blockId}
                        canEdit={canEdit}
                        blockAthletes={blockAthletes}
                      />
                    ))}
                  </div>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Alla"-läget (samma dedup-princip som ArsplanOverview i /arsplan, se
 * lib/auth-scope.ts): en coach ser blockens riktiga dag×faktor-rutnät direkt
 * i stället för bara en räkning — uttrycklig begäran 2026-08-20, eftersom ett
 * blocks veckomönster ändå är identiskt för alla löpare kopplade till det
 * (samma week_template_items delas). Ett delat block visas EN gång, inte en
 * gång per löpare, med namnchips (länkar vidare till respektive löpares
 * fulla vy) för vilka löpare det gäller. Repgrupps-redigerare och
 * "lägg till pass"-formulär hör bara hemma i den enskilda löparvyn
 * (canEdit=false här) — annars blir det oklart vems mönster man just
 * redigerade. */
async function DetaljplanOverview({
  supabase,
  scoped,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  scoped: ScopedProfile;
}) {
  const athletes = viewableAthletes(scoped);
  const athleteIds = athletes.map((a) => a.id);
  const athletesById = new Map(athletes.map((a) => [a.id, a]));
  // Samma innevarande-år-avgränsning som ArsplanOverview — uttrycklig
  // begäran att de två sidornas "Alla"-vyer visar samma tidsperiod för alla
  // löpare, så de faktiskt går att jämföra sida vid sida.
  const currentYear = toDateKey(new Date()).slice(0, 4);

  const { data: blockAthleteRows } =
    athleteIds.length > 0
      ? await supabase
          .from("season_block_athletes")
          .select("block_id, athlete_id")
          .in("athlete_id", athleteIds)
      : { data: [] as { block_id: string; athlete_id: string }[] };

  const athleteIdsByBlockId = new Map<string, string[]>();
  for (const row of blockAthleteRows ?? []) {
    const list = athleteIdsByBlockId.get(row.block_id) ?? [];
    list.push(row.athlete_id);
    athleteIdsByBlockId.set(row.block_id, list);
  }
  const blockIds = [...athleteIdsByBlockId.keys()];

  const { data: blocks } =
    blockIds.length > 0
      ? await supabase
          .from("season_blocks")
          .select(
            "id, name, period, phase, start_date, end_date, week_template_items(*, template_rep_groups(*))",
          )
          .in("id", blockIds)
          .order("start_date")
      : { data: [] as BlockRow[] };

  const blockList = ((blocks ?? []) as BlockRow[]).filter(
    (b) => b.start_date.slice(0, 4) <= currentYear && b.end_date.slice(0, 4) >= currentYear,
  );
  const relevantPhases = PHASE_TYPES.filter((phase) => blockList.some((b) => b.phase === phase));

  if (relevantPhases.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Inga block i år ännu.</p>;
  }

  return (
    <div className="flex flex-col gap-3">
      {relevantPhases.map((phase) => {
        const phaseBlocks = blockList.filter((b) => b.phase === phase);
        return (
          <details
            key={phase}
            className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
            open
          >
            <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {PHASE_LABELS[phase]}
              </span>
              <span className="text-sm text-zinc-500 dark:text-zinc-400">
                {phaseBlocks.length} block
              </span>
            </summary>

            <div className="mt-4 flex flex-col gap-4">
              {phaseBlocks.map((b) => {
                const items = b.week_template_items ?? [];
                const chipAthletes = (athleteIdsByBlockId.get(b.id) ?? [])
                  .map((id) => athletesById.get(id))
                  .filter((a): a is NonNullable<typeof a> => a != null);

                return (
                  <div key={b.id} className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                    <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                      <span className="font-medium text-zinc-900 dark:text-zinc-100">{b.name}</span>
                      <span className="text-sm text-zinc-500 dark:text-zinc-400">
                        {PERIOD_LABELS[b.period]} · {b.start_date} – {b.end_date} · {items.length}{" "}
                        pass/vecka
                      </span>
                    </div>
                    {chipAthletes.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1">
                        {chipAthletes.map((a) => (
                          <Link
                            key={a.id}
                            href={`/detaljplan?athlete=${a.id}`}
                            className="rounded-full bg-zinc-100 px-2 py-0.5 text-xs text-zinc-600 hover:bg-zinc-200 dark:bg-zinc-800 dark:text-zinc-400 dark:hover:bg-zinc-700"
                          >
                            {a.fullName ?? "Namnlös löpare"}
                          </Link>
                        ))}
                      </div>
                    )}
                    <PatternGrid items={items} canEdit={false} />
                  </div>
                );
              })}
            </div>
          </details>
        );
      })}
    </div>
  );
}

export default async function DetaljplanPage({
  searchParams,
}: {
  searchParams: Promise<{
    /** Fas 0-uppföljning: vilken löpare en coach tittar på just nu — samma
     * mönster som /arsplan, se lib/auth-scope.ts. */
    athlete?: string;
  }>;
}) {
  const supabase = await createClient();
  const { athlete: athleteParam } = await searchParams;

  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;

  // "Alla"-läget ersätter hela sidans innehåll med ett kort per löpare — se
  // motiveringen vid DetaljplanOverview.
  if (athleteParam === "alla" && scoped.role === "coach") {
    return (
      <div className="flex flex-1 flex-col gap-10 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Detaljplan</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
            Alla blocks veckomönster samlade, oavsett vilka löpare de gäller. Klicka på en löpares
            namn för att fylla i eller justera dag för dag.
          </p>
        </div>
        <AthleteSwitcher
          athletes={viewableAthletes(scoped)}
          activeId="alla"
          viewerUserId={scoped.userId}
          buildHref={(id) => `/detaljplan?athlete=${id}`}
          overviewHref="/detaljplan?athlete=alla"
        />
        <DetaljplanOverview supabase={supabase} scoped={scoped} />
      </div>
    );
  }

  const scopedUserId = resolveScopedUserId(scoped, athleteParam);
  const canEdit = canEditPlanning(scoped);

  const { data: blockAthleteRows } = await supabase
    .from("season_block_athletes")
    .select("block_id")
    .eq("athlete_id", scopedUserId);
  const blockIds = [...new Set((blockAthleteRows ?? []).map((r) => r.block_id as string))];

  // Blockets eget mönster hämtas nästlat direkt — inget separat mall-objekt
  // att slå upp längre. template_rep_groups(*) hämtas två led ner (K1); en
  // saknad tabell (migrationen inte körd) ger bara undefined, aldrig ett
  // kastat fel.
  const { data: blocks } =
    blockIds.length > 0
      ? await supabase
          .from("season_blocks")
          .select(
            "id, name, period, phase, start_date, end_date, week_template_items(*, template_rep_groups(*)), season_block_athletes(athlete_id)",
          )
          .in("id", blockIds)
          .order("start_date")
      : { data: [] as BlockRow[] };

  const blockList = (blocks ?? []) as BlockRow[];
  // Namn för löparchips och väljare — bara coacher har fler än sig själv,
  // se athletesById-uppslaget nedan.
  const athletesById = new Map(viewableAthletes(scoped).map((a) => [a.id, a]));

  // Veckovyn visar passen för ALLA löpare som är taggade på blocket, inte
  // bara den löpare vyn är scopad till — hela poängen är att se vilka
  // löpare som ligger på vilket pass. Hämtas i en fråga för samtliga block.
  const allBlockAthleteIds = [
    ...new Set(blockList.flatMap((b) => (b.season_block_athletes ?? []).map((r) => r.athlete_id))),
  ];
  const { data: plannedRows } =
    blockList.length > 0 && allBlockAthleteIds.length > 0
      ? await supabase
          .from("planned_workouts")
          .select(
            "id, user_id, scheduled_date, slot, workout_type, title, description, target_duration_seconds, training_factor, status, block_id",
          )
          .in(
            "block_id",
            blockList.map((b) => b.id),
          )
          .in("user_id", allBlockAthleteIds)
      : { data: [] as (PlannedPassRow & { block_id: string })[] };

  const passesByBlock = new Map<string, PlannedPassRow[]>();
  for (const row of (plannedRows ?? []) as (PlannedPassRow & { block_id: string })[]) {
    passesByBlock.set(row.block_id, [...(passesByBlock.get(row.block_id) ?? []), row]);
  }

  // Visa bara faser som faktiskt har ett block — en lista med alla sex
  // faser, mest tomma, gjorde det svårt att se vad man faktiskt skulle
  // göra. Arbetsflödet är Flerårsplan → Årsplan (skapar block) → Detaljplan
  // (fyller i just den fasens block), så Detaljplan speglar vad som redan
  // finns i Årsplan i stället för att lista hela taxonomin i förväg.
  const relevantPhases = PHASE_TYPES.filter((phase) => blockList.some((b) => b.phase === phase));

  function athleteHref(id: string): string {
    const params = new URLSearchParams();
    params.set("athlete", id);
    return `/detaljplan?${params.toString()}`;
  }

  return (
    <div className="flex flex-1 flex-col gap-10 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Detaljplan</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Varje blocks eget dag-för-dag-veckomönster — precis som Excel-mallens Detaljplan-flik.
          Ett pass läggs till direkt på blocket och syns i kalendern omedelbart, utan ett
          separat &quot;rulla ut&quot;-steg. Block och standardvecka skapas på{" "}
          <Link href="/arsplan" className="underline">
            Årsplan
          </Link>{" "}
          — nya block dyker upp här automatiskt.
        </p>
      </div>

      {scoped.role === "coach" && (
        <AthleteSwitcher
          athletes={viewableAthletes(scoped)}
          activeId={scopedUserId}
          viewerUserId={scoped.userId}
          buildHref={athleteHref}
          overviewHref="/detaljplan?athlete=alla"
        />
      )}

      {relevantPhases.length === 0 && (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Inga block skapade ännu. Lägg upp ett block för säsongens första fas på{" "}
          <Link href="/arsplan" className="underline">
            Årsplan
          </Link>{" "}
          — det dyker upp här automatiskt så fort det finns.
        </p>
      )}

      {/* Block i datumordning, tidigaste överst (uttrycklig begäran
          2026-08-21). Fas-grupperingen som låg här tidigare är borta: den
          lade ett lager mellan tränaren och veckorna utan att svara på
          någon fråga han faktiskt ställer i den här vyn — fasen står kvar
          på varje blockrubrik. */}
      <div className="flex flex-col gap-4">
        {blockList.map((b) => {
                  const items = b.week_template_items ?? [];
                  // K1: repgrupps-redigeraren visas bara för kvalitetstyper
                  // som standard (fallgrop 1), men aldrig hårt blockerad —
                  // redan inlagda grupper (t.ex. efter ett typbyte) visas
                  // oavsett.
                  const repEditableItems = items.filter(
                    (it) =>
                      QUALITY_WORKOUT_TYPES.includes(it.workout_type as WorkoutType) ||
                      (it.template_rep_groups ?? []).length > 0,
                  );
                  // Vilka löpare blocket gäller för — driver löparchipsen
                  // per pass, scope-väljarna och "extra pass"-formuläret.
                  const blockAthletes = (b.season_block_athletes ?? [])
                    .map((r) => athletesById.get(r.athlete_id))
                    .filter((a): a is NonNullable<typeof a> => a != null);
                  const weeks = buildDetaljplanWeeks(
                    b.start_date,
                    b.end_date,
                    passesByBlock.get(b.id) ?? [],
                  );

                  return (
                    <details
                      key={b.id}
                      className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
                      open
                    >
                      <summary className="cursor-pointer">
                        <span className="font-medium text-zinc-900 dark:text-zinc-100">
                          {b.name}
                        </span>
                        <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
                          {PERIOD_LABELS[b.period]} · {PHASE_LABELS[b.phase]} · {b.start_date} –{" "}
                          {b.end_date} · {items.length} pass/vecka
                        </span>
                      </summary>

                      <WeekGrid
                        weeks={weeks}
                        blockId={b.id}
                        canEdit={canEdit}
                        blockAthletes={blockAthletes}
                      />

                      {canEdit && repEditableItems.length > 0 && (
                        <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                          <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                            Repgrupper — samma struktur som ett enskilt planerat pass (K1), så
                            mönstret bär med sig &ldquo;5×1000 m&rdquo; i stället för bara en
                            rubrik.
                          </div>
                          {repEditableItems.map((it) => (
                            <div key={it.id}>
                              <div className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
                                {WEEKDAY_LABELS[it.weekday - 1]} ·{" "}
                                {WORKOUT_LABELS[it.workout_type as keyof typeof WORKOUT_LABELS] ??
                                  it.workout_type}
                                {it.title ? ` · ${it.title}` : ""}
                              </div>
                              <RepGroupEditor
                                groups={it.template_rep_groups ?? []}
                                parentIdField="template_item_id"
                                parentId={it.id}
                                addAction={addTemplateRepGroup}
                                updateAction={updateTemplateRepGroup}
                                deleteAction={deleteTemplateRepGroup}
                              />
                            </div>
                          ))}
                        </div>
                      )}

                      {canEdit && (
                        <form
                          action={addTemplateItem}
                          className="mt-4 flex flex-wrap items-end gap-2"
                        >
                          <input type="hidden" name="block_id" value={b.id} />
                          <Field label="Dag">
                            <select name="weekday" className={input} defaultValue="1">
                              {WEEKDAY_LABELS.map((d, wi) => (
                                <option key={d} value={wi + 1}>
                                  {d}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Pass">
                            <select name="slot" className={input} defaultValue="1">
                              {[1, 2, 3].map((s) => (
                                <option key={s} value={s}>
                                  {SLOT_LABELS[s]}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Typ">
                            <select name="workout_type" className={input} defaultValue="easy">
                              {WORKOUT_TYPES.map((w) => (
                                <option key={w} value={w}>
                                  {WORKOUT_LABELS[w]}
                                </option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Rubrik">
                            <input name="title" placeholder="10x400m" className={input} />
                          </Field>
                          <Field label="Minuter">
                            <input
                              name="target_duration_minutes"
                              type="number"
                              min="0"
                              className={`${input} w-24`}
                            />
                          </Field>
                          <TrainingFactorSelect />
                          <button type="submit" className={ghostBtn}>
                            Lägg till pass
                          </button>
                        </form>
                      )}

                      {(() => {
                        // Extra pass för en enskild löpare på blocket — utanför
                        // det delade mönstret ovan, se addManualPass i
                        // actions.ts. Bara en coach har fler än sig själv att
                        // välja bland, så formuläret är meningslöst för en
                        // självcoachad löpare (hon skulle bara kunna välja sig
                        // själv, vilket "Lägg till pass" redan gör via mönstret).
                        if (!canEdit || scoped.role !== "coach" || blockAthletes.length === 0) {
                          return null;
                        }
                        return (
                          <div className="mt-4 flex flex-col gap-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              Extra pass för en enskild löpare — utanför det delade mönstret, syns bara
                              hos henne.
                            </div>
                            <form action={addManualPass} className="flex flex-wrap items-end gap-2">
                              <input type="hidden" name="block_id" value={b.id} />
                              <Field label="Löpare">
                                <select name="athlete_id" className={input} defaultValue={blockAthletes[0].id}>
                                  {blockAthletes.map((a) => (
                                    <option key={a.id} value={a.id}>
                                      {a.fullName ?? "Namnlös löpare"}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Datum">
                                <input
                                  type="date"
                                  name="scheduled_date"
                                  min={b.start_date}
                                  max={b.end_date}
                                  required
                                  className={input}
                                />
                              </Field>
                              <Field label="Pass">
                                <select name="slot" className={input} defaultValue="1">
                                  {[1, 2, 3].map((s) => (
                                    <option key={s} value={s}>
                                      {SLOT_LABELS[s]}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Typ">
                                <select name="workout_type" className={input} defaultValue="easy">
                                  {WORKOUT_TYPES.map((w) => (
                                    <option key={w} value={w}>
                                      {WORKOUT_LABELS[w]}
                                    </option>
                                  ))}
                                </select>
                              </Field>
                              <Field label="Rubrik">
                                <input name="title" placeholder="Extra pass" className={input} />
                              </Field>
                              <Field label="Minuter">
                                <input
                                  name="target_duration_minutes"
                                  type="number"
                                  min="0"
                                  className={`${input} w-24`}
                                />
                              </Field>
                              <TrainingFactorSelect />
                              <button type="submit" className={ghostBtn}>
                                Lägg till extra pass
                              </button>
                            </form>
                          </div>
                        );
                      })()}
                    </details>
                  );
        })}
      </div>
    </div>
  );
}
