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
  workoutTypeColorVar,
  type PeriodType,
  type PhaseType,
  type WorkoutType,
} from "@/lib/planning";
import { RepGroupEditor, type RepGroupRow } from "@/components/RepGroupEditor";
import {
  addAthleteToPass,
  addPassOnDate,
  addTemplateRepGroup,
  deletePlannedPass,
  deleteTemplateRepGroup,
  removeAthleteFromPass,
  updateTemplateRepGroup,
} from "./actions";
import {
  buildDetaljplanWeeks,
  outcomeKey,
  type CompetitionGroup,
  type CompetitionRow,
  type DetaljplanWeek,
  type PassGroup,
  type PlannedPassRow,
} from "@/lib/detaljplan-weeks";
import { matchPlanToSessions, type PlanOutcome, type PlannedWorkout } from "@/lib/plan-matching";
import {
  groupActivitiesIntoSessions,
  SESSION_ACTIVITY_COLUMNS,
  type SessionActivity,
} from "@/lib/sessions";
import { TRAINING_FACTORS } from "@/lib/training-factors";

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

/** Ett block med sin veckovy. Delad mellan
 * Alla-vyn och den enskilda löparens vy så de aldrig kan glida isär —
 * samma resonemang som BlockCard på /arsplan. */
function BlockWeekSection({
  block,
  weeks,
  canEdit,
  blockAthletes,
  athletesById,
}: {
  block: BlockRow;
  weeks: DetaljplanWeek[];
  canEdit: boolean;
  blockAthletes: AthleteOption[];
  athletesById: Map<string, AthleteOption>;
}) {
  const items = block.week_template_items ?? [];
  return (
    <details className="rounded border border-zinc-200 p-3 dark:border-zinc-800" open>
      <summary className="cursor-pointer">
        <span className="font-medium text-zinc-900 dark:text-zinc-100">{block.name}</span>
        <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
          {PERIOD_LABELS[block.period]} · {PHASE_LABELS[block.phase]} · {block.start_date} –{" "}
          {block.end_date} · {items.length} pass/vecka
        </span>
        {blockAthletes.length > 0 && (
          <span className="ml-2 text-sm text-zinc-400 dark:text-zinc-500">
            · {blockAthletes.map((a) => a.fullName ?? "namnlös").join(", ")}
          </span>
        )}
      </summary>

      <WeekGrid
        weeks={weeks}
        blockId={block.id}
        canEdit={canEdit}
        blockAthletes={blockAthletes}
        athletesById={athletesById}
      />
    </details>
  );
}

/** Länk till kalenderns dagvy för en löpare — samma URL-form som månads-
 * och veckovyn bygger (månad/dag utan inledande nolla). */
function dayHref(dateKey: string, athleteId: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return `/calendar/${y}/${m}/${d}?athlete=${athleteId}`;
}

/** Ett pass i veckovyn: sammanfattning + löparchips + "öppna" för
 * detaljer. Chips visas bara när blocket har fler än en taggad löpare —
 * med en enda löpare är "vilka är taggade" ingen fråga.
 */
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
  // Samma färgkälla som kalendern, dashboarden och graferna: --cat-*-
  // variablerna via workoutTypeColorVar. Ingen egen palett här, så
  // Detaljplan aldrig kan visa en annan färg för "Tröskel" än resten av
  // appen. `rest`/`test` saknar färg med flit (vila är ingen träning, ett
  // test är ett testtillfälle, inte en kategori) och får appens etablerade
  // "ingen färg"-behandling: streckat i stället för heldraget.
  const typeColor = workoutTypeColorVar(pass.workoutType);

  return (
    // `break-words`: kolumnen har fast bredd sedan table-fixed, så en lång
    // passrubrik ska radbrytas i rutan i stället för att spilla ut över
    // nästa dag.
    <div
      className="rounded border-l-4 bg-zinc-100 px-1.5 py-1 text-xs break-words dark:bg-zinc-800"
      style={
        typeColor
          ? { borderLeftColor: typeColor }
          : { borderLeftStyle: "dashed", borderLeftColor: "currentColor" }
      }
    >
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
            .map((a) => {
              const outcome = pass.outcomeByAthlete[a.id];
              const done = outcome === "genomfört" || outcome === "avvikande typ";
              return (
              <span
                key={a.id}
                className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px] ${
                  done
                    ? "bg-emerald-100 text-emerald-900 dark:bg-emerald-900/50 dark:text-emerald-100"
                    : "bg-zinc-200 text-zinc-700 dark:bg-zinc-700 dark:text-zinc-200"
                }`}
              >
                {/* Namnet är en länk till löparens dagvy i kalendern, som
                    redan visar plan och utfall sida vid sida — den vyn
                    behöver inte byggas en gång till här. */}
                <Link
                  href={dayHref(pass.scheduledDate, a.id)}
                  title={`${a.fullName ?? "Löparen"} ${pass.scheduledDate}: plan och utfall${
                    outcome ? ` — ${outcome}` : ""
                  }`}
                  className="underline-offset-2 hover:underline"
                >
                  {a.fullName ?? "namnlös"}
                  {done ? " ✓" : outcome === "ej genomfört" ? " ·" : ""}
                </Link>
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
              );
            })}
        </div>
      )}

      {canEdit && (
        <div className="mt-1 flex flex-wrap items-start gap-x-2 gap-y-0.5">
          {/* "öppna" är borttaget: detaljerad planering och utfall görs i
              kalenderns dagvy, som chipsens namn länkar till. Kvar här är
              bara det som handlar om PASSET som helhet — vilka löpare som
              är med, och att ta bort det. */}
          {showChips && untagged.length > 0 && (
            <details className="min-w-0">
              <summary className="cursor-pointer whitespace-nowrap text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
                + löpare
              </summary>
              <form action={addAthleteToPass} className="mt-1 flex w-28 items-center gap-1">
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
            </details>
          )}
          {/* Tar bort passet för alla löpare på det. Att ta bort det för EN
              löpare görs med × på hennes chip ovan. */}
          <form action={deletePlannedPass}>
            <input type="hidden" name="block_id" value={blockId} />
            <input type="hidden" name="scheduled_date" value={pass.scheduledDate} />
            <input type="hidden" name="slot" value={pass.slot} />
            <button
              type="submit"
              title={
                pass.athleteIds.length > 1
                  ? "Ta bort passet för alla löpare på det"
                  : "Ta bort passet"
              }
              className="whitespace-nowrap text-[10px] text-zinc-400 hover:text-red-600"
            >
              ta bort{pass.athleteIds.length > 1 ? " (alla)" : ""}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

/** "+ nytt pass" i en dagruta. Datumet ligger i rutan och sloten väljs
 * automatiskt av addPassOnDate (första lediga förmiddag/eftermiddag/kväll),
 * så det som återstår att fråga om är typ och vilka löpare — resten fylls i
 * efteråt via passets "öppna", precis som tränarens process ser ut:
 * skelett först, detaljer när det passar. Ersatte ett stort formulär mellan
 * blocken där datumet fick skrivas in för hand (uttrycklig begäran
 * 2026-08-21). */
function DayAddPass({
  blockId,
  date,
  blockAthletes,
}: {
  blockId: string;
  date: string;
  blockAthletes: AthleteOption[];
}) {
  return (
    <details className="shrink-0 text-xs">
      <summary className="cursor-pointer whitespace-nowrap text-[10px] text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300">
        + nytt pass
      </summary>
      {/* Utfällt läge får egen bredd i stället för att pressas ihop av
          raden det ligger på — det är ett övergående läge, medan den
          hopfällda raden är den man ser hela tiden. */}
      <form action={addPassOnDate} className="mt-1 flex w-28 flex-col gap-1">
        <input type="hidden" name="block_id" value={blockId} />
        <input type="hidden" name="scheduled_date" value={date} />
        <select name="workout_type" defaultValue="easy" className={`${input} w-full`} aria-label="Typ">
          {WORKOUT_TYPES.map((w) => (
            <option key={w} value={w}>
              {WORKOUT_LABELS[w]}
            </option>
          ))}
        </select>
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
        <button
          type="submit"
          className="rounded bg-zinc-200 px-2 py-0.5 text-[11px] hover:bg-zinc-300 dark:bg-zinc-700 dark:hover:bg-zinc-600"
        >
          Lägg till
        </button>
      </form>
    </details>
  );
}

/** En planerad tävling i veckoraden. Visuellt skild från passen (ram +
 * accentfärg) — en tävling är inte ett pass tränaren ordinerar, den är en
 * fixpunkt han planerar runt. A-lopp markeras eftersom det är det som styr
 * periodiseringen. */
function CompetitionCard({
  competition,
  athletesById,
}: {
  competition: CompetitionGroup;
  athletesById: Map<string, AthleteOption>;
}) {
  const participants = competition.athleteIds
    .map((id) => athletesById.get(id))
    .filter((a): a is AthleteOption => a != null);

  return (
    <div className="rounded border border-amber-300 bg-amber-50 px-1.5 py-1 text-xs break-words dark:border-amber-700/60 dark:bg-amber-950/40">
      <div className="flex items-baseline gap-1">
        <span className="font-medium text-amber-900 dark:text-amber-200">{competition.name}</span>
        {competition.priority === "A" && (
          <span className="rounded bg-amber-200 px-1 text-[9px] font-medium text-amber-900 dark:bg-amber-800 dark:text-amber-100">
            A
          </span>
        )}
      </div>
      <div className="text-[10px] text-amber-800/80 dark:text-amber-300/80">tävling</div>
      {participants.length > 0 && (
        <div className="mt-0.5 flex flex-wrap gap-0.5">
          {participants.map((a) => (
            <span
              key={a.id}
              className="rounded-full bg-amber-200 px-1.5 py-0.5 text-[10px] text-amber-900 dark:bg-amber-800 dark:text-amber-100"
            >
              {a.fullName ?? "namnlös"}
            </span>
          ))}
        </div>
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
  athletesById,
}: {
  weeks: DetaljplanWeek[];
  blockId: string;
  canEdit: boolean;
  blockAthletes: AthleteOption[];
  athletesById: Map<string, AthleteOption>;
}) {
  if (weeks.length === 0) {
    return <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">Inga veckor i blocket.</p>;
  }
  return (
    <div className="mt-3 overflow-x-auto">
      {/* `table-fixed` + fast veckokolumn gör att alla sju dagkolumner blir
          exakt lika breda, och — eftersom varje block renderar samma tabell
          med samma mått — att måndagen i ett block hamnar rakt under
          måndagen i nästa. Utan det auto-anpassar varje tabell sig efter
          sitt EGET innehåll, så två block med olika många löpare eller
          längre passrubriker fick olika kolumnbredder och dagarna
          hamnade i sicksack mellan blocken (uttrycklig begäran 2026-08-21). */}
      <table className="w-full min-w-[960px] table-fixed border-collapse text-xs">
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
              {week.days.map((day, di) => {
                const canEditableDay = canEdit && !week.outside[di];
                return (
                <td
                  key={day.date}
                  className={`border-b border-zinc-100 px-1 py-2 dark:border-zinc-900 ${
                    week.outside[di] ? "bg-zinc-50 dark:bg-zinc-900/40" : ""
                  }`}
                >
                  <div className="flex flex-col gap-1">
                    {day.competitions.map((c) => (
                      <CompetitionCard key={c.key} competition={c} athletesById={athletesById} />
                    ))}
                    {day.passes.map((p) => (
                      <WeekPassCard
                        key={p.key}
                        pass={p}
                        blockId={blockId}
                        canEdit={canEdit}
                        blockAthletes={blockAthletes}
                      />
                    ))}
                    {/* "+ nytt pass" hör till DAGEN, inte till något av
                        passen, och ligger därför utanför passkorten
                        (uttrycklig begäran 2026-08-21). Dagar utanför
                        blockets datumspann får den inte — de finns bara för
                        att veckoraden ska behålla sin form. */}
                    {canEditableDay && (
                      <DayAddPass blockId={blockId} date={day.date} blockAthletes={blockAthletes} />
                    )}
                  </div>
                </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** "Alla"-läget — och en coachs STARTVY på /detaljplan (uttrycklig begäran
 * 2026-08-21: veckovyn ska synas direkt, utan att först gå in på en löpare).
 * Visar samma redigerbara veckovy som den enskilda löparvyn, men med alla
 * löpare som är taggade på varje block, så tränaren kan justera, lägga till
 * pass och tagga på/av löpare på ett ställe. Ett delat block visas EN gång,
 * inte en gång per löpare. */
async function DetaljplanOverview({
  supabase,
  scoped,
  canEdit,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  scoped: ScopedProfile;
  canEdit: boolean;
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
            "id, name, period, phase, start_date, end_date, week_template_items(id), season_block_athletes(athlete_id)",
          )
          .in("id", blockIds)
          .order("start_date")
      : { data: [] as BlockRow[] };

  const blockList = ((blocks ?? []) as BlockRow[]).filter(
    (b) => b.start_date.slice(0, 4) <= currentYear && b.end_date.slice(0, 4) >= currentYear,
  );

  if (blockList.length === 0) {
    return <p className="text-sm text-zinc-500 dark:text-zinc-400">Inga block i år ännu.</p>;
  }

  const { passesByBlock, competitionsByBlock, outcomes } = await loadWeekData(supabase, blockList);

  return (
    <div className="flex flex-col gap-4">
      {blockList.map((b) => {
        const blockAthletes = (athleteIdsByBlockId.get(b.id) ?? [])
          .map((id) => athletesById.get(id))
          .filter((a): a is AthleteOption => a != null);
        return (
          <BlockWeekSection
            key={b.id}
            block={b}
            weeks={buildDetaljplanWeeks(
              b.start_date,
              b.end_date,
              passesByBlock.get(b.id) ?? [],
              competitionsByBlock.get(b.id) ?? [],
              outcomes,
            )}
            canEdit={canEdit}
            blockAthletes={blockAthletes}
            athletesById={athletesById}
          />
        );
      })}
    </div>
  );
}

/** Passen och tävlingarna som veckovyn behöver, för en uppsättning block.
 * Delad mellan Alla-vyn och den enskilda löparvyn så båda hämtar exakt
 * samma sak. Tävlingar hämtas per blockets datumspann utvidgat till hela
 * veckoraderna (±7 dagar räcker: veckoserien kan aldrig sträcka sig längre
 * utanför spannet än en ofullständig vecka i vardera änden). */
async function loadWeekData(
  supabase: Awaited<ReturnType<typeof createClient>>,
  blockList: BlockRow[],
): Promise<{
  passesByBlock: Map<string, PlannedPassRow[]>;
  competitionsByBlock: Map<string, CompetitionRow[]>;
  outcomes: Map<string, PlanOutcome>;
}> {
  const passesByBlock = new Map<string, PlannedPassRow[]>();
  const competitionsByBlock = new Map<string, CompetitionRow[]>();
  const outcomes = new Map<string, PlanOutcome>();
  if (blockList.length === 0) return { passesByBlock, competitionsByBlock, outcomes };

  const allAthleteIds = [
    ...new Set(blockList.flatMap((b) => (b.season_block_athletes ?? []).map((r) => r.athlete_id))),
  ];
  if (allAthleteIds.length === 0) return { passesByBlock, competitionsByBlock, outcomes };

  const blockIds = blockList.map((b) => b.id);
  const minDate = blockList.reduce((m, b) => (b.start_date < m ? b.start_date : m), blockList[0].start_date);
  const maxDate = blockList.reduce((m, b) => (b.end_date > m ? b.end_date : m), blockList[0].end_date);
  const pad = (dateKey: string, days: number) => {
    const d = new Date(`${dateKey}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const [{ data: plannedRows }, { data: competitionRows }, { data: activityRows }] =
    await Promise.all([
      supabase
        .from("planned_workouts")
        .select(
          "id, user_id, scheduled_date, slot, workout_type, title, description, target_distance_meters, target_duration_seconds, training_factor, status, block_id",
        )
        .in("block_id", blockIds)
        .in("user_id", allAthleteIds),
      supabase
        .from("competitions")
        .select("id, user_id, competition_date, name, priority")
        .in("user_id", allAthleteIds)
        .gte("competition_date", pad(minDate, -7))
        .lte("competition_date", pad(maxDate, 7)),
      // Utfallet: `planned_workouts.status` skrivs aldrig (verifierat
      // 2026-08-22 — alla rader är `planned`, ingen har
      // linked_activity_id), så "genomfört" måste räknas fram ur de
      // faktiska aktiviteterna i läsvägen. Samma väg som /arsplan och
      // kalendern: activities → groupActivitiesIntoSessions →
      // matchPlanToSessions.
      supabase
        .from("activities")
        .select(SESSION_ACTIVITY_COLUMNS)
        .in("user_id", allAthleteIds)
        .gte("start_time", minDate)
        .lte("start_time", pad(maxDate, 1))
        .order("start_time"),
    ]);

  for (const row of (plannedRows ?? []) as (PlannedPassRow & { block_id: string })[]) {
    passesByBlock.set(row.block_id, [...(passesByBlock.get(row.block_id) ?? []), row]);
  }

  // En tävling hör inte till ett block i databasen — den hamnar i varje
  // block vars veckorader täcker datumet, och bara för löpare som faktiskt
  // är taggade på det blocket (annars skulle en av coachens löpare visas
  // som deltagare i ett block hon inte ens tränar).
  for (const b of blockList) {
    const athletes = new Set((b.season_block_athletes ?? []).map((r) => r.athlete_id));
    competitionsByBlock.set(
      b.id,
      ((competitionRows ?? []) as CompetitionRow[]).filter(
        (c) =>
          athletes.has(c.user_id) &&
          c.competition_date >= pad(b.start_date, -7) &&
          c.competition_date <= pad(b.end_date, 7),
      ),
    );
  }

  // Matchningen körs PER LÖPARE: matchPlanToSessions parar ihop planerade
  // pass med genomförda inom en dag, och att blanda två löpares dagar i
  // samma anrop skulle para Alices pass med Nikes aktivitet.
  const plannedByAthlete = new Map<string, (PlannedWorkout & { user_id: string })[]>();
  for (const row of (plannedRows ?? []) as (PlannedPassRow & { block_id: string })[]) {
    plannedByAthlete.set(row.user_id, [...(plannedByAthlete.get(row.user_id) ?? []), row]);
  }
  const activitiesByAthlete = new Map<string, SessionActivity[]>();
  for (const a of (activityRows ?? []) as unknown as (SessionActivity & { user_id: string })[]) {
    activitiesByAthlete.set(a.user_id, [...(activitiesByAthlete.get(a.user_id) ?? []), a]);
  }
  for (const [athleteId, planned] of plannedByAthlete) {
    const sessions = groupActivitiesIntoSessions(activitiesByAthlete.get(athleteId) ?? []);
    for (const m of matchPlanToSessions(planned, sessions)) {
      if (!m.planned) continue; // oplanerade pass hör inte till någon plan-ruta
      outcomes.set(
        outcomeKey(athleteId, m.planned.scheduled_date, m.planned.slot ?? 1),
        m.outcome,
      );
    }
  }

  return { passesByBlock, competitionsByBlock, outcomes };
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

  // En coach landar i veckovyn för ALLA sina löpare som standard — hen ska
  // inte behöva gå in på en löpare först för att se veckorna (uttrycklig
  // begäran 2026-08-21). `?athlete=<id>` går fortfarande till en enskild
  // löpares vy; det är bara startläget som ändrats.
  if ((athleteParam == null || athleteParam === "alla") && scoped.role === "coach") {
    return (
      <div className="flex flex-1 flex-col gap-10 px-6 py-8">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Detaljplan</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
            Alla blockens veckor, tidigaste först. Öppna ett pass för att fylla på detaljer, eller
            tagga på och av löpare direkt i rutan. Tävlingar läggs in på{" "}
            <Link href="/tavlingsresultat#lagg-till-tavling" className="underline">
              Tävlingar
            </Link>{" "}
            — flera löpare kan taggas på samma tävling — och dyker upp här automatiskt.
          </p>
        </div>
        <AthleteSwitcher
          athletes={viewableAthletes(scoped)}
          activeId="alla"
          viewerUserId={scoped.userId}
          buildHref={(id) => `/detaljplan?athlete=${id}`}
          overviewHref="/detaljplan?athlete=alla"
        />
        <DetaljplanOverview supabase={supabase} scoped={scoped} canEdit={canEditPlanning(scoped)} />
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
  // löpare som ligger på vilket pass.
  const { passesByBlock, competitionsByBlock, outcomes } = await loadWeekData(supabase, blockList);

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
          // K1: repgrupps-redigeraren visas bara för kvalitetstyper som
          // standard (fallgrop 1), men aldrig hårt blockerad — redan
          // inlagda grupper (t.ex. efter ett typbyte) visas oavsett.
          const repEditableItems = items.filter(
            (it) =>
              QUALITY_WORKOUT_TYPES.includes(it.workout_type as WorkoutType) ||
              (it.template_rep_groups ?? []).length > 0,
          );
          // Den här vyn är filtrerad på EN löpare, så bara hennes pass,
          // hennes chip och hennes tävlingar ska synas — inte hela blockets
          // (uttrycklig begäran 2026-08-22). Filtreringen görs på datan i
          // stället för i rutnätet: ett pass som bara andra löpare har
          // försvinner då helt ur hennes vecka, i stället för att ligga kvar
          // som ett tomt kort.
          const blockAthletes = (b.season_block_athletes ?? [])
            .map((r) => athletesById.get(r.athlete_id))
            .filter((a): a is AthleteOption => a != null)
            .filter((a) => a.id === scopedUserId);

          return (
            <div key={b.id} className="flex flex-col gap-2">
              <BlockWeekSection
                block={b}
                weeks={buildDetaljplanWeeks(
                  b.start_date,
                  b.end_date,
                  (passesByBlock.get(b.id) ?? []).filter((r) => r.user_id === scopedUserId),
                  (competitionsByBlock.get(b.id) ?? []).filter((c) => c.user_id === scopedUserId),
                  outcomes,
                )}
                canEdit={canEdit}
                blockAthletes={blockAthletes}
                athletesById={athletesById}
              />

              {canEdit && repEditableItems.length > 0 && (
                <details className="rounded border border-zinc-200 p-3 dark:border-zinc-800">
                  <summary className="cursor-pointer text-xs font-medium text-zinc-500 dark:text-zinc-400">
                    Repgrupper i standardveckan — {repEditableItems.length} pass
                  </summary>
                  <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                    Gäller blockets veckomönster, alltså framtida utrullningar. Ett pass som redan
                    ligger i kalendern ändras i veckovyn ovan.
                  </p>
                  <div className="mt-3 flex flex-col gap-3">
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
                </details>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
