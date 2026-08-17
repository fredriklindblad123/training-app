import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  canEditPlanning,
  getScopedProfile,
  planningOwnerId,
  resolveScopedUserId,
  viewableAthletes,
} from "@/lib/auth-scope";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
import {
  PHASE_LABELS,
  PHASE_TYPES,
  QUALITY_WORKOUT_TYPES,
  SLOT_LABELS,
  WEEKDAY_LABELS,
  WORKOUT_LABELS,
  WORKOUT_TYPES,
  type PhaseType,
  type WorkoutType,
} from "@/lib/planning";
import { plannedSignatureLabel, type PlannedRepGroup } from "@/lib/session-signature";
import { RepGroupEditor, type RepGroupRow } from "@/components/RepGroupEditor";
import {
  addTemplateItem,
  addTemplateRepGroup,
  createTemplate,
  deleteTemplate,
  deleteTemplateItem,
  deleteTemplateRepGroup,
  updateTemplateRepGroup,
} from "./actions";
import {
  TRAINING_FACTORS,
  TRAINING_FACTOR_GROUP_LABELS,
  type TrainingFactorGroup,
} from "@/lib/training-factors";

/* Detaljplan: veckomallarnas dag-för-dag-innehåll, en fas i taget — speglar
 * Excel-mallens Detaljplan-flik. Flyttad hit ur /sasongen 2026-08-17 (var
 * tidigare nästlad under varje enskilt block, vilket visade samma mall
 * flera gånger så fort två block delade fas). En mall gäller hela fasen,
 * precis som innan — se motiveringen i lib/template-sync.ts. Block/
 * standardvecka/tävlingar hör till /arsplan. */

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

type TemplateRow = {
  id: string;
  name: string;
  phase: PhaseType | null;
  week_template_items?: TemplateItemRow[] | null;
};

export default async function DetaljplanPage({
  searchParams,
}: {
  searchParams: Promise<{
    /** Fas 0: vilken löpare en coach tittar på just nu — bara för
     * fas-kontextens blocklista, mallarna själva är delade mellan alla
     * löpare ägaren coachar (samma fas rullas ut till alla). */
    athlete?: string;
  }>;
}) {
  const supabase = await createClient();
  const { athlete: athleteParam } = await searchParams;

  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const scopedUserId = resolveScopedUserId(scoped, athleteParam);
  const owner = planningOwnerId(scoped);
  const canEdit = canEditPlanning(scoped);

  const { data: blockAthleteRows } = await supabase
    .from("season_block_athletes")
    .select("block_id")
    .eq("athlete_id", scopedUserId);
  const blockIds = [...new Set((blockAthleteRows ?? []).map((r) => r.block_id as string))];

  const [{ data: blocks }, { data: templates }, { data: blockTemplateLinks }] = await Promise.all([
    blockIds.length > 0
      ? supabase.from("season_blocks").select("id, name, phase, start_date, end_date").in("id", blockIds)
      : Promise.resolve({ data: [] as { id: string; name: string; phase: PhaseType; start_date: string; end_date: string }[] }),
    // template_rep_groups(*) hämtas nästlat två led ner (K1) — en saknad
    // tabell (migrationen inte körd) ger bara undefined per mallrad, aldrig
    // ett kastat fel. Mallar ägs av samma person som blocken (owner), inte
    // nödvändigtvis den löpare som råkar vara vald i växlaren.
    supabase
      .from("week_templates")
      .select("*, week_template_items(*, template_rep_groups(*))")
      .eq("user_id", owner)
      .order("created_at"),
    supabase
      .from("planned_workouts")
      .select("block_id, template_id")
      .eq("user_id", scopedUserId)
      .not("block_id", "is", null)
      .not("template_id", "is", null),
  ]);

  const blockList = (blocks ?? []) as { id: string; name: string; phase: PhaseType; start_date: string; end_date: string }[];
  const templateList = (templates ?? []) as TemplateRow[];

  const linkedTemplateIds = new Set((blockTemplateLinks ?? []).map((r) => r.template_id as string));

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
          Veckomallarnas dag-för-dag-innehåll, en fas i taget — precis som Excel-mallens
          Detaljplan-flik. En mall gäller hela fasen: lägger du till eller ändrar ett pass
          slår det igenom i varje block av den fasen direkt, utan ett separat
          &quot;rulla ut&quot;-steg. Block, standardvecka och tävlingar hanteras på{" "}
          <Link href="/arsplan" className="underline">
            Årsplan
          </Link>
          .
        </p>
      </div>

      {scoped.role === "coach" && (
        <AthleteSwitcher
          athletes={viewableAthletes(scoped)}
          activeId={scopedUserId}
          viewerUserId={scoped.userId}
          buildHref={athleteHref}
        />
      )}

      <div className="flex flex-col gap-3">
        {PHASE_TYPES.map((phase) => {
          const phaseBlocks = blockList.filter((b) => b.phase === phase);
          const phaseTemplates = templateList.filter((t) => t.phase === phase);

          return (
            <details
              key={phase}
              className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
              open={phaseTemplates.length > 0}
            >
              <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">
                  {PHASE_LABELS[phase]}
                </span>
                <span className="text-sm text-zinc-500 dark:text-zinc-400">
                  {phaseTemplates.length} {phaseTemplates.length === 1 ? "mall" : "mallar"}
                  {phaseBlocks.length > 0
                    ? ` · block: ${phaseBlocks.map((b) => b.name).join(", ")}`
                    : ""}
                </span>
              </summary>

              <div className="mt-4 flex flex-col gap-4">
                {phaseTemplates.length === 0 && (
                  <p className="text-sm text-zinc-400 dark:text-zinc-600">
                    Ingen mall för {PHASE_LABELS[phase]} än.
                  </p>
                )}

                <div className="flex flex-col gap-2">
                  {phaseTemplates.map((t) => {
                    const items = t.week_template_items ?? [];
                    const isLinked = linkedTemplateIds.has(t.id);
                    // K1: repgrupps-redigeraren visas bara för
                    // kvalitetstyper som standard (fallgrop 1), men aldrig
                    // hårt blockerad — redan inlagda grupper (t.ex. efter
                    // ett typbyte) visas oavsett.
                    const repEditableItems = items.filter(
                      (it) =>
                        QUALITY_WORKOUT_TYPES.includes(it.workout_type as WorkoutType) ||
                        (it.template_rep_groups ?? []).length > 0,
                    );

                    return (
                      <details
                        key={t.id}
                        className="rounded border border-zinc-200 p-3 dark:border-zinc-800"
                      >
                        <summary className="cursor-pointer">
                          <span className="font-medium text-zinc-900 dark:text-zinc-100">
                            {t.name}
                          </span>
                          <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
                            {items.length} pass/vecka
                            {isLinked ? " · utrullad i minst ett block" : ""}
                          </span>
                        </summary>

                        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-7">
                          {WEEKDAY_LABELS.map((label, wi) => {
                            const day = items
                              .filter((it) => it.weekday === wi + 1)
                              .sort((a, b2) => a.slot - b2.slot);
                            return (
                              <div key={label} className="flex flex-col gap-1">
                                <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                  {label.slice(0, 3)}
                                </div>
                                {day.length === 0 && (
                                  <div className="text-xs text-zinc-300 dark:text-zinc-700">
                                    —
                                  </div>
                                )}
                                {day.map((it) => (
                                  <div
                                    key={it.id}
                                    className="rounded bg-zinc-100 px-1.5 py-1 text-xs dark:bg-zinc-800"
                                  >
                                    <div className="font-medium text-zinc-900 dark:text-zinc-100">
                                      {WORKOUT_LABELS[
                                        it.workout_type as keyof typeof WORKOUT_LABELS
                                      ] ?? it.workout_type}
                                    </div>
                                    {it.title && (
                                      <div className="text-zinc-600 dark:text-zinc-400">
                                        {it.title}
                                      </div>
                                    )}
                                    {it.training_factor && (
                                      <div className="text-[10px] text-zinc-500 dark:text-zinc-500">
                                        {TRAINING_FACTORS.find((f) => f.key === it.training_factor)
                                          ?.label ?? it.training_factor}
                                      </div>
                                    )}
                                    {(() => {
                                      // Samma nyckelformat som utfallets
                                      // buildSessionSignature — se
                                      // lib/session-signature.ts.
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
                                        sigLabel && (
                                          <div className="text-zinc-600 dark:text-zinc-400">
                                            {sigLabel}
                                          </div>
                                        )
                                      );
                                    })()}
                                    {it.slot > 1 && (
                                      <div className="text-[10px] text-zinc-500 dark:text-zinc-500">
                                        {SLOT_LABELS[it.slot]}
                                      </div>
                                    )}
                                    {canEdit && (
                                      <form action={deleteTemplateItem}>
                                        <input type="hidden" name="id" value={it.id} />
                                        <button
                                          type="submit"
                                          className="mt-0.5 text-[10px] text-zinc-400 hover:text-red-600"
                                        >
                                          ta bort
                                        </button>
                                      </form>
                                    )}
                                  </div>
                                ))}
                              </div>
                            );
                          })}
                        </div>

                        {canEdit && repEditableItems.length > 0 && (
                          <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                            <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                              Repgrupper — samma struktur som ett enskilt planerat pass (K1),
                              så mallen bär med sig &ldquo;5×1000 m&rdquo; i stället för bara
                              en rubrik.
                            </div>
                            {repEditableItems.map((it) => (
                              <div key={it.id}>
                                <div className="mb-1 text-xs text-zinc-500 dark:text-zinc-400">
                                  {WEEKDAY_LABELS[it.weekday - 1]} ·{" "}
                                  {WORKOUT_LABELS[
                                    it.workout_type as keyof typeof WORKOUT_LABELS
                                  ] ?? it.workout_type}
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
                          <>
                            <form
                              action={addTemplateItem}
                              className="mt-4 flex flex-wrap items-end gap-2"
                            >
                              <input type="hidden" name="template_id" value={t.id} />
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

                            <form action={deleteTemplate} className="mt-3">
                              <input type="hidden" name="id" value={t.id} />
                              <button
                                type="submit"
                                className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                              >
                                Ta bort hela mallen
                              </button>
                            </form>
                          </>
                        )}
                      </details>
                    );
                  })}
                </div>

                {canEdit && (
                  <form action={createTemplate} className="flex flex-wrap items-end gap-3">
                    <input type="hidden" name="phase" value={phase} />
                    <Field label={`Ny mall för ${PHASE_LABELS[phase]}`}>
                      <input
                        name="name"
                        required
                        placeholder="Grundvecka med dubbeltröskel"
                        className={input}
                      />
                    </Field>
                    <button type="submit" className={ghostBtn}>
                      Skapa mall
                    </button>
                  </form>
                )}
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
