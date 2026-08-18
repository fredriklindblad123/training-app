import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  canEditPlanning,
  getScopedProfile,
  resolveScopedUserId,
  viewableAthletes,
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
import {
  addManualPass,
  addTemplateItem,
  addTemplateRepGroup,
  deleteTemplateItem,
  deleteTemplateRepGroup,
  updateTemplateRepGroup,
} from "./actions";
import {
  TRAINING_FACTORS,
  TRAINING_FACTOR_GROUP_LABELS,
  type TrainingFactorGroup,
} from "@/lib/training-factors";

/** Vilken träningsfaktor-GRUPP ett pass tillhör, för att kunna gruppera
 * rutnätet radvis (Excel-mallens Detaljplan-flik har en rad per faktor,
 * grupperad likadant) — `null` för pass utan satt träningsfaktor, samlas i
 * en egen sista rad ("Ej kopplat") i stället för att falla bort tyst. */
function factorGroupOf(key: string | null): TrainingFactorGroup | null {
  if (!key) return null;
  return TRAINING_FACTORS.find((f) => f.key === key)?.group ?? null;
}

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

/** Träningsfaktor-väljare för ett enskilt pass (Årsplan-raden passet räknas
 * mot, t.ex. "Tröskel" eller "Maximal" snabbhet) — grupperad precis som
 * Årsplan-fliken. Fritt att lämna tom; inte alla pass (vila, ett obestämt
 * lugnt pass) hör till en specifik faktor. */
function TrainingFactorSelect({ defaultValue }: { defaultValue?: string | null }) {
  return (
    <Field label="Träningsfaktor">
      <select name="training_factor" defaultValue={defaultValue ?? ""} className={input}>
        <option value="">— Ingen —</option>
        {(Object.keys(TRAINING_FACTOR_GROUP_LABELS) as TrainingFactorGroup[]).map((group) => (
          <optgroup key={group} label={TRAINING_FACTOR_GROUP_LABELS[group]}>
            {TRAINING_FACTORS.filter((f) => f.group === group).map((f) => (
              <option key={f.key} value={f.key}>
                {f.label}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </Field>
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
 * behöver underhållas på ett ställe. */
function PatternItemCard({ it, canEdit }: { it: TemplateItemRow; canEdit: boolean }) {
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
        <form action={deleteTemplateItem}>
          <input type="hidden" name="id" value={it.id} />
          <button type="submit" className="mt-0.5 text-[10px] text-zinc-400 hover:text-red-600">
            ta bort
          </button>
        </form>
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
 * princip som redan styr vilka faser som visas ovanför. */
function PatternGrid({ items, canEdit }: { items: TemplateItemRow[]; canEdit: boolean }) {
  const groupOrder = Object.keys(TRAINING_FACTOR_GROUP_LABELS) as TrainingFactorGroup[];
  const usedGroups = groupOrder.filter((g) => items.some((it) => factorGroupOf(it.training_factor) === g));
  const hasUngrouped = items.some((it) => factorGroupOf(it.training_factor) === null);
  const rows: (TrainingFactorGroup | null)[] = [...usedGroups, ...(hasUngrouped ? [null] : [])];

  if (rows.length === 0) {
    return <p className="mt-3 text-xs text-zinc-400 dark:text-zinc-600">Inga pass i mönstret ännu.</p>;
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
          {rows.map((group) => (
            <tr key={group ?? "_none"} className="align-top">
              <td className="border-b border-zinc-100 px-1 py-2 font-medium text-zinc-700 dark:border-zinc-900 dark:text-zinc-300">
                {group ? TRAINING_FACTOR_GROUP_LABELS[group] : "Ej kopplat"}
              </td>
              {WEEKDAY_LABELS.map((label, wi) => {
                const cellItems = items
                  .filter((it) => it.weekday === wi + 1 && factorGroupOf(it.training_factor) === group)
                  .sort((a, b2) => a.slot - b2.slot);
                return (
                  <td key={label} className="border-b border-zinc-100 px-1 py-2 dark:border-zinc-900">
                    <div className="flex flex-col gap-1">
                      {cellItems.map((it) => (
                        <PatternItemCard key={it.id} it={it} canEdit={canEdit} />
                      ))}
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

/** "Alla"-läget (uttrycklig begäran 2026-08-18, samma mönster som
 * ArsplanOverview i /arsplan): en coach ser hur långt varje löpares
 * veckomönster kommit — fas, block och antal ifyllda pass/vecka — utan att
 * klicka igenom en löpare i taget. Den fulla dag-för-dag-rutnätet för alla
 * samtidigt vore för brett, så kortet är medvetet bara en räkning; klick
 * går vidare till löparens fulla Detaljplan-vy för att faktiskt redigera. */
async function DetaljplanOverview({
  supabase,
  scoped,
}: {
  supabase: Awaited<ReturnType<typeof createClient>>;
  scoped: ScopedProfile;
}) {
  const athletes = viewableAthletes(scoped);
  // Samma innevarande-år-avgränsning som ArsplanOverview — uttrycklig
  // begäran att de två sidornas "Alla"-vyer visar samma tidsperiod för alla
  // löpare, så de faktiskt går att jämföra sida vid sida.
  const currentYear = toDateKey(new Date()).slice(0, 4);

  const cards = await Promise.all(
    athletes.map(async (athlete) => {
      const { data: blockAthleteRows } = await supabase
        .from("season_block_athletes")
        .select("block_id")
        .eq("athlete_id", athlete.id);
      const blockIds = [...new Set((blockAthleteRows ?? []).map((r) => r.block_id as string))];

      const { data: blocks } =
        blockIds.length > 0
          ? await supabase
              .from("season_blocks")
              .select("id, name, phase, start_date, end_date, week_template_items(id)")
              .in("id", blockIds)
              .order("start_date")
          : { data: [] as never[] };

      const allBlocks = (blocks ?? []) as {
        id: string;
        name: string;
        phase: PhaseType;
        start_date: string;
        end_date: string;
        week_template_items: { id: string }[] | null;
      }[];
      const blockList = allBlocks.filter(
        (b) => b.start_date.slice(0, 4) <= currentYear && b.end_date.slice(0, 4) >= currentYear,
      );

      return { athlete, blockList };
    }),
  );

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
      {cards.map(({ athlete, blockList }) => (
        <Link
          key={athlete.id}
          href={`/detaljplan?athlete=${athlete.id}`}
          className="flex flex-col gap-2 rounded border border-zinc-200 p-4 hover:bg-zinc-50 dark:border-zinc-800 dark:hover:bg-zinc-900"
        >
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {athlete.fullName ?? "Namnlös löpare"}
          </div>
          {blockList.length === 0 ? (
            <p className="text-sm text-zinc-500 dark:text-zinc-400">Inga block i år ännu.</p>
          ) : (
            <ul className="flex flex-col gap-1 text-sm text-zinc-600 dark:text-zinc-400">
              {blockList.map((b) => (
                <li key={b.id}>
                  {PHASE_LABELS[b.phase]} — {b.name} ({b.start_date} – {b.end_date}):{" "}
                  {(b.week_template_items ?? []).length} pass/vecka
                </li>
              ))}
            </ul>
          )}
        </Link>
      ))}
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
            Hur långt varje löpares veckomönster har kommit. Klicka på ett kort för att fylla i
            eller justera dag för dag.
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
  // Namn för "extra pass"-formulärets löparväljare — bara coacher har fler
  // än sig själv att välja mellan, se athletesById-uppslaget nedan.
  const athletesById = new Map(viewableAthletes(scoped).map((a) => [a.id, a]));

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
                  // K1: repgrupps-redigeraren visas bara för kvalitetstyper
                  // som standard (fallgrop 1), men aldrig hårt blockerad —
                  // redan inlagda grupper (t.ex. efter ett typbyte) visas
                  // oavsett.
                  const repEditableItems = items.filter(
                    (it) =>
                      QUALITY_WORKOUT_TYPES.includes(it.workout_type as WorkoutType) ||
                      (it.template_rep_groups ?? []).length > 0,
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
                          {PERIOD_LABELS[b.period]} · {b.start_date} – {b.end_date} ·{" "}
                          {items.length} pass/vecka
                        </span>
                      </summary>

                      <PatternGrid items={items} canEdit={canEdit} />

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
                        const blockAthletes = (b.season_block_athletes ?? [])
                          .map((r) => athletesById.get(r.athlete_id))
                          .filter((a): a is NonNullable<typeof a> => a != null);
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
            </details>
          );
        })}
      </div>
    </div>
  );
}
