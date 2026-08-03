import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import {
  SeasonTimeline,
  type TimelineBlock,
  type TimelineCompetition,
} from "@/components/SeasonTimeline";
import {
  AVAILABILITY_KINDS,
  AVAILABILITY_LABELS,
  BLOCK_INTENT,
  BLOCK_LABELS,
  BLOCK_TYPES,
  COMMON_EVENTS,
  competitionYearCounts,
  defaultCompetitionYear,
  PRIORITY_LABELS,
  QUALITY_WORKOUT_TYPES,
  SEASON_LABELS,
  SLOT_LABELS,
  WEEKDAY_LABELS,
  WORKOUT_LABELS,
  WORKOUT_TYPES,
  toDateKey,
  weeksBetween,
  type AvailabilityKind,
  type WorkoutType,
} from "@/lib/planning";
import { plannedSignatureLabel, type PlannedRepGroup } from "@/lib/session-signature";
import { RepGroupEditor, type RepGroupRow } from "@/components/RepGroupEditor";
import {
  addTemplateItem,
  addTemplateRepGroup,
  createAvailabilityPeriod,
  createBlock,
  createCompetition,
  createTemplate,
  deleteAvailabilityPeriod,
  deleteBlock,
  deleteCompetition,
  deleteTemplate,
  deleteTemplateItem,
  deleteTemplateRepGroup,
  saveEventResult,
  suggestPeriodisation,
  updateBlock,
  updateTemplateRepGroup,
} from "./actions";

const input =
  "rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900";
const primaryBtn =
  "w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200";
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

export default async function PlaneringPage({
  searchParams,
}: {
  searchParams: Promise<{ tavlingsAr?: string; tavlingsBana?: string }>;
}) {
  const supabase = await createClient();
  const today = toDateKey(new Date());
  const { tavlingsAr: tavlingsArParam, tavlingsBana: tavlingsBanaParam } = await searchParams;

  const [
    { data: blocks },
    { data: templates },
    { data: plannedCounts },
    { data: blockTemplateLinks },
    { data: availabilityPeriods },
    { data: competitionDateRows },
    { data: nextACompetition },
  ] = await Promise.all([
    supabase.from("season_blocks").select("*").order("start_date"),
    // template_rep_groups(*) hämtas nästlat två led ner (K1) — en saknad
    // tabell (migrationen inte körd) ger bara undefined per mallrad, aldrig
    // ett kastat fel. Alla ställen nedan som läser det gör det via `?? []`.
    supabase
      .from("week_templates")
      .select("*, week_template_items(*, template_rep_groups(*))")
      .order("created_at"),
    supabase
      .from("planned_workouts")
      .select("scheduled_date")
      .gte("scheduled_date", today),
    // Vilka mallar som redan rullats ut i vilket block — härlett ur de
    // planerade passens egna block_id/template_id, eftersom det inte finns
    // någon separat koppling lagrad någon annanstans (se applyTemplate).
    supabase
      .from("planned_workouts")
      .select("block_id, template_id")
      .not("block_id", "is", null)
      .not("template_id", "is", null),
    // K7: migrationen är inte körd (se AGENTS/uppdraget) — en saknad tabell
    // ger bara { data: null, error }, aldrig ett kastat fel, och `?? []`
    // nedan faller tillbaka till "inga perioder" precis som övriga frågor
    // på den här sidan gör för sina egna eventuellt okörda tabeller.
    supabase.from("availability_periods").select("*").order("start_date"),
    // Smal fråga för årsväljaren: bara datumet, inte hela raden med
    // competition_events(*) nästlat — historiken (flera säsongers
    // tävlingar) ska kunna byggas till en väljare utan att dra in allt.
    supabase.from("competitions").select("competition_date").order("competition_date"),
    // "Nästa A-tävling" i läget-just-nu-korten ska visa sanningen oavsett
    // vilket år/bana som råkar vara valt i tävlingslistan längre ner —
    // därför en egen liten fråga i stället för att söka i competitionList
    // (som är filtrerad). Träffar aldrig fler än en rad.
    supabase
      .from("competitions")
      .select("name, competition_date")
      .eq("priority", "A")
      .gte("competition_date", today)
      .order("competition_date")
      .limit(1)
      .maybeSingle(),
  ]);

  const { years: competitionYears, countsByYear: competitionCountsByYear } =
    competitionYearCounts((competitionDateRows ?? []).map((r) => r.competition_date as string));
  const currentYear = today.slice(0, 4);
  const defaultYear = defaultCompetitionYear(currentYear, competitionYears, competitionCountsByYear);
  // "Alla år" är ett explicit val (query-param), annars gäller förvalet ovan.
  const tavlingsAr = tavlingsArParam ?? defaultYear;
  const tavlingsBana: "alla" | "inne" | "ute" =
    tavlingsBanaParam === "inne" || tavlingsBanaParam === "ute" ? tavlingsBanaParam : "alla";
  const venueFilter = tavlingsBana === "inne" ? "indoor" : tavlingsBana === "ute" ? "outdoor" : null;

  // Huvudfrågan (med competition_events nästlat) hämtar bara det valda
  // årets tävlingar — sidan växer med ett år per år i takt med säsongerna,
  // och /planering har redan flera tunga frågor ovan.
  let competitionsQuery = supabase
    .from("competitions")
    .select("*, competition_events(*)")
    .order("competition_date");
  if (tavlingsAr !== "alla") {
    competitionsQuery = competitionsQuery
      .gte("competition_date", `${tavlingsAr}-01-01`)
      .lt("competition_date", `${Number(tavlingsAr) + 1}-01-01`);
  }
  if (venueFilter) {
    competitionsQuery = competitionsQuery.eq("venue", venueFilter);
  }
  const { data: competitions } = await competitionsQuery;

  /** Bygger en /planering-länk som behåller både årsfiltret och bana-filtret
   * — bara den del som skickas in i `overrides` byts ut. Samma mönster som
   * volumeHref i trends/page.tsx (läst för formen, inte kopierad rakt av):
   * utan den skulle t.ex. bana-växlaren nollställa årsvalet varje gång man
   * klickade. */
  function competitionHref(overrides: { tavlingsAr?: string; tavlingsBana?: string }): string {
    const params = new URLSearchParams();
    params.set("tavlingsAr", overrides.tavlingsAr ?? tavlingsAr);
    params.set("tavlingsBana", overrides.tavlingsBana ?? tavlingsBana);
    return `/sasongen?${params.toString()}#tavlingar`;
  }

  // TimelineBlock beskriver bara det tidslinjen behöver; sidan visar även
  // fokustexten, därav den utökade typen här.
  const blockList = (blocks ?? []) as (TimelineBlock & { focus: string | null })[];
  const competitionList = (competitions ?? []) as (TimelineCompetition & {
    location: string | null;
    notes: string | null;
    competition_events: {
      id: string;
      event: string;
      target_result: string | null;
      actual_result: string | null;
      placement: number | null;
    }[];
  })[];

  const availabilityList = (availabilityPeriods ?? []) as {
    id: string;
    start_date: string;
    end_date: string;
    kind: AvailabilityKind;
    label: string | null;
  }[];

  const nextA = nextACompetition;
  const activeBlock = blockList.find((b) => b.start_date <= today && b.end_date >= today);

  const templateNameById = new Map((templates ?? []).map((t) => [t.id as string, t.name as string]));
  const templateIdsByBlock = new Map<string, Set<string>>();
  for (const row of blockTemplateLinks ?? []) {
    const blockId = row.block_id as string;
    const set = templateIdsByBlock.get(blockId) ?? new Set<string>();
    set.add(row.template_id as string);
    templateIdsByBlock.set(blockId, set);
  }

  return (
    <div className="flex flex-1 flex-col gap-10 px-6 py-8">
      <div>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">Planering</h1>
        <p className="mt-1 max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Lägg upp säsongen i block och låt planeringen skärpas ju närmare tävlingarna du
          kommer. En veckomall skapas en gång och rullas sedan ut över hela blocket — du
          fyller aldrig i samma vecka två gånger.
        </p>
      </div>

      {/* ---------------- Läget just nu ---------------- */}
      <section className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Aktuellt block</div>
          <div className="mt-1 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {activeBlock ? activeBlock.name : "Inget block"}
          </div>
          {activeBlock && (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {BLOCK_LABELS[activeBlock.block_type]} · slutar {activeBlock.end_date}
            </div>
          )}
        </div>
        <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Nästa A-tävling</div>
          <div className="mt-1 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {nextA ? nextA.name : "Ingen inlagd"}
          </div>
          {nextA && (
            <div className="text-sm text-zinc-500 dark:text-zinc-400">
              {nextA.competition_date} · {weeksBetween(today, nextA.competition_date) - 1} veckor kvar
            </div>
          )}
        </div>
        <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <div className="text-xs text-zinc-500 dark:text-zinc-400">Planerade pass framåt</div>
          <div className="mt-1 text-lg font-medium text-zinc-900 dark:text-zinc-100">
            {(plannedCounts ?? []).length}
          </div>
        </div>
      </section>

      {/* ---------------- Säsongsöversikt ---------------- */}
      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Säsongsöversikt</h2>
        {/* Tar samma årsfilter som tävlingslistan (competitionList är redan
         * begränsad till tavlingsAr/tavlingsBana ovan) — med hela historiken
         * (2019–2024 importerad) ritad i ett band blir markörerna för många
         * för att gå att läsa, precis som listan. Blocken (blockList) filtreras
         * inte: banden är redan få och kortlivade (en säsong i taget), så de
         * blir aldrig oöverskådliga på samma sätt. Väljer man "Alla år" är
         * det ett medvetet val att se allt, inklusive en tätare tidslinje. */}
        <SeasonTimeline blocks={blockList} competitions={competitionList} />
      </section>

      {/* ---------------- Periodiseringsförslag ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Föreslå periodisering
        </h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Räknar bakåt från en tävling och delar tiden i grund, uppbyggnad, skärpning och
          nedtrappning. Blocklängderna följer principen att strukturen hålls fast i ungefär
          sex veckor i taget — Almgren beskriver det som att man kan justera, men bör vara
          konsekvent inom perioden. Förslaget är en utgångspunkt att flytta på, inte ett facit.
        </p>
        <form
          action={suggestPeriodisation}
          className="flex flex-wrap items-end gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <Field label="Tävlingsdatum">
            <input type="date" name="competition_date" required className={input} />
          </Field>
          <Field label="Börja planera från">
            <input type="date" name="start_from" defaultValue={today} className={input} />
          </Field>
          <Field label="Säsong">
            <select name="season" className={input} defaultValue="">
              <option value="">Ingen</option>
              <option value="indoor">{SEASON_LABELS.indoor}</option>
              <option value="outdoor">{SEASON_LABELS.outdoor}</option>
            </select>
          </Field>
          <button type="submit" className={primaryBtn}>
            Skapa block
          </button>
        </form>
      </section>

      {/* ---------------- Block ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Block</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Klicka på ett block för att redigera det eller hantera dess veckomallar. Ett pass som
          läggs till i en mall dyker automatiskt upp i kalendern för varje block av den typen.
        </p>

        {blockList.length > 0 && (
          <div className="flex flex-col gap-2">
            {blockList.map((b) => {
              const linkedNames = [...(templateIdsByBlock.get(b.id) ?? [])]
                .map((id) => templateNameById.get(id))
                .filter((n): n is string => n != null);
              // Mallar hör till en blocktyp (t ex "grund"), inte till ett
              // specifikt block — samma mall kan alltså återanvändas av flera
              // block av samma typ över säsonger. Det är därför den visas
              // här i stället för i en egen lista: den hör hemma där den
              // faktiskt används.
              const matchingTemplates = (templates ?? []).filter(
                (t) => t.block_type === b.block_type,
              );

              return (
                <details
                  key={b.id}
                  className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
                >
                  <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1">
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{b.name}</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {BLOCK_LABELS[b.block_type]}
                      {b.season ? ` · ${SEASON_LABELS[b.season]}` : ""} · {b.start_date} –{" "}
                      {b.end_date} · {weeksBetween(b.start_date, b.end_date)} veckor
                      {linkedNames.length > 0 ? ` · ${linkedNames.join(", ")}` : ""}
                    </span>
                  </summary>

                  <div className="mt-4 flex flex-col gap-4">
                    <form
                      action={updateBlock}
                      className="flex flex-wrap items-end gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800"
                    >
                      <input type="hidden" name="id" value={b.id} />
                      <Field label="Namn">
                        <input name="name" defaultValue={b.name} required className={input} />
                      </Field>
                      <Field label="Typ">
                        <select name="block_type" defaultValue={b.block_type} className={input}>
                          {BLOCK_TYPES.map((t) => (
                            <option key={t} value={t}>
                              {BLOCK_LABELS[t]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Säsong">
                        <select name="season" defaultValue={b.season ?? ""} className={input}>
                          <option value="">Ingen</option>
                          <option value="indoor">{SEASON_LABELS.indoor}</option>
                          <option value="outdoor">{SEASON_LABELS.outdoor}</option>
                        </select>
                      </Field>
                      <Field label="Från">
                        <input
                          type="date"
                          name="start_date"
                          defaultValue={b.start_date}
                          required
                          className={input}
                        />
                      </Field>
                      <Field label="Till">
                        <input
                          type="date"
                          name="end_date"
                          defaultValue={b.end_date}
                          required
                          className={input}
                        />
                      </Field>
                      <Field label="Fokus">
                        <input name="focus" defaultValue={b.focus ?? ""} className={input} />
                      </Field>
                      <button type="submit" className={primaryBtn}>
                        Spara ändringar
                      </button>
                    </form>

                    <div className="border-t border-zinc-100 pt-3 dark:border-zinc-800">
                      <div className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        Veckomallar för {BLOCK_LABELS[b.block_type]}
                      </div>

                      {matchingTemplates.length === 0 && (
                        <p className="text-sm text-zinc-400 dark:text-zinc-600">
                          Ingen mall för den här blocktypen än.
                        </p>
                      )}

                      <div className="flex flex-col gap-2">
                        {matchingTemplates.map((t) => {
                          const items = (t.week_template_items ?? []) as {
                            id: string;
                            weekday: number;
                            slot: number;
                            workout_type: string;
                            title: string | null;
                            description: string | null;
                            template_rep_groups?: RepGroupRow[] | null;
                          }[];
                          const isLinked = linkedNames.includes(t.name as string);
                          // K1: repgrupps-redigeraren visas bara för
                          // kvalitetstyper som standard (fallgrop 1), men
                          // aldrig hårt blockerad — redan inlagda grupper
                          // (t.ex. efter ett typbyte) visas oavsett.
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
                                  {isLinked ? " · utrullad i det här blocket" : ""}
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
                                          <form action={deleteTemplateItem}>
                                            <input type="hidden" name="id" value={it.id} />
                                            <button
                                              type="submit"
                                              className="mt-0.5 text-[10px] text-zinc-400 hover:text-red-600"
                                            >
                                              ta bort
                                            </button>
                                          </form>
                                        </div>
                                      ))}
                                    </div>
                                  );
                                })}
                              </div>

                              {repEditableItems.length > 0 && (
                                <div className="mt-4 flex flex-col gap-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                                  <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                                    Repgrupper — samma struktur som ett enskilt planerat pass
                                    (K1), så mallen bär med sig &ldquo;5×1000 m&rdquo; i stället
                                    för bara en rubrik.
                                  </div>
                                  {/* Ligger utanför veckorutnätet ovan med flit: rutnätets
                                   * kolumner är för smala för repgrupps-radens många fält, och
                                   * en tränare redigerar ett pass i taget här ändå. */}
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
                            </details>
                          );
                        })}
                      </div>

                      <form
                        action={createTemplate}
                        className="mt-3 flex flex-wrap items-end gap-3"
                      >
                        <input type="hidden" name="block_type" value={b.block_type} />
                        <Field label="Ny mall för den här blocktypen">
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
                    </div>

                    <form action={deleteBlock}>
                      <input type="hidden" name="id" value={b.id} />
                      <button
                        type="submit"
                        className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                      >
                        Ta bort block
                      </button>
                    </form>
                  </div>
                </details>
              );
            })}
          </div>
        )}

        <details className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Lägg till block för hand
          </summary>
          <form action={createBlock} className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Namn">
              <input name="name" required placeholder="Grundträning 1" className={input} />
            </Field>
            <Field label="Typ">
              <select name="block_type" className={input} defaultValue="grund">
                {BLOCK_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {BLOCK_LABELS[t]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Säsong">
              <select name="season" className={input} defaultValue="">
                <option value="">Ingen</option>
                <option value="indoor">{SEASON_LABELS.indoor}</option>
                <option value="outdoor">{SEASON_LABELS.outdoor}</option>
              </select>
            </Field>
            <Field label="Från">
              <input type="date" name="start_date" required className={input} />
            </Field>
            <Field label="Till">
              <input type="date" name="end_date" required className={input} />
            </Field>
            <Field label="Fokus">
              <input name="focus" placeholder="Tröskelvolym, 2 pass/vecka" className={input} />
            </Field>
            <button type="submit" className={primaryBtn}>
              Lägg till
            </button>
          </form>
          <dl className="mt-4 grid grid-cols-1 gap-1 text-xs text-zinc-500 sm:grid-cols-2 dark:text-zinc-400">
            {BLOCK_TYPES.map((t) => (
              <div key={t}>
                <dt className="inline font-medium text-zinc-700 dark:text-zinc-300">
                  {BLOCK_LABELS[t]}:{" "}
                </dt>
                <dd className="inline">{BLOCK_INTENT[t]}</dd>
              </div>
            ))}
          </dl>
        </details>
      </section>

      {/* ---------------- Tävlingar ---------------- */}
      <section id="tavlingar" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Tävlingar</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Prioriteten styr hur planeringen toppar. A är säsongens huvudmål och får en
          nedtrappning före sig; C är träningstävling och planeras rakt igenom.
        </p>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* Årsväljare. Byggd ur datan (competitionYears), inte en hårdkodad
           * lista — annars slutar den fungera så fort ett nytt år börjar
           * tävlas i. "Alla år" ligger sist så historiken alltid går att nå,
           * men aldrig är förvalet. */}
          <div className="flex flex-wrap gap-1 text-sm" role="group" aria-label="Tävlingsår">
            {competitionYears.map((year) => (
              <Link
                key={year}
                href={competitionHref({ tavlingsAr: year })}
                aria-current={tavlingsAr === year ? "page" : undefined}
                className={`rounded px-3 py-1 ${
                  tavlingsAr === year
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {year} ({competitionCountsByYear.get(year)})
              </Link>
            ))}
            <Link
              href={competitionHref({ tavlingsAr: "alla" })}
              aria-current={tavlingsAr === "alla" ? "page" : undefined}
              className={`rounded px-3 py-1 ${
                tavlingsAr === "alla"
                  ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                  : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
              }`}
            >
              Alla år ({competitionDateRows?.length ?? 0})
            </Link>
          </div>

          <div className="flex gap-1 text-sm" role="group" aria-label="Inne eller ute">
            {(
              [
                { key: "alla", label: "Alla banor" },
                { key: "inne", label: SEASON_LABELS.indoor },
                { key: "ute", label: SEASON_LABELS.outdoor },
              ] as const
            ).map((opt) => (
              <Link
                key={opt.key}
                href={competitionHref({ tavlingsBana: opt.key })}
                aria-current={tavlingsBana === opt.key ? "page" : undefined}
                className={`rounded px-3 py-1 ${
                  tavlingsBana === opt.key
                    ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                    : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                }`}
              >
                {opt.label}
              </Link>
            ))}
          </div>
        </div>

        {competitionList.length === 0 && (
          <p className="text-sm text-zinc-400 dark:text-zinc-600">
            Inga tävlingar {tavlingsAr === "alla" ? "" : `${tavlingsAr} `}
            {tavlingsBana !== "alla" ? `(${tavlingsBana === "inne" ? "inomhus" : "utomhus"}) ` : ""}
            än.
          </p>
        )}

        {competitionList.length > 0 && (
          <div className="flex flex-col gap-2">
            {competitionList.map((c) => (
              <div
                key={c.id}
                className="rounded border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex items-baseline gap-2">
                    <span
                      className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                        c.priority === "A"
                          ? "bg-red-100 text-red-800 dark:bg-red-950/40 dark:text-red-300"
                          : c.priority === "B"
                            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-300"
                            : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                      }`}
                    >
                      {c.priority}
                    </span>
                    <span className="font-medium text-zinc-900 dark:text-zinc-100">{c.name}</span>
                    <span className="text-sm text-zinc-500 dark:text-zinc-400">
                      {c.competition_date}
                      {c.venue ? ` · ${SEASON_LABELS[c.venue]}` : ""}
                      {c.location ? ` · ${c.location}` : ""}
                    </span>
                  </div>
                  <form action={deleteCompetition}>
                    <input type="hidden" name="id" value={c.id} />
                    <button
                      type="submit"
                      className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                    >
                      Ta bort
                    </button>
                  </form>
                </div>

                {c.competition_events.length > 0 && (
                  <div className="mt-3 flex flex-col gap-2">
                    {c.competition_events
                      .slice()
                      .sort((a, b) => a.event.localeCompare(b.event))
                      .map((e) => (
                        <form
                          key={e.id}
                          action={saveEventResult}
                          className="flex flex-wrap items-end gap-2 text-sm"
                        >
                          <input type="hidden" name="event_id" value={e.id} />
                          <span className="w-28 font-medium text-zinc-900 dark:text-zinc-100">
                            {e.event}
                          </span>
                          <span className="text-zinc-500 dark:text-zinc-400">
                            mål {e.target_result ?? "—"}
                          </span>
                          <input
                            name="actual_result"
                            defaultValue={e.actual_result ?? ""}
                            placeholder="resultat"
                            className={`${input} w-28`}
                          />
                          <input
                            name="placement"
                            type="number"
                            min="1"
                            defaultValue={e.placement ?? ""}
                            placeholder="plats"
                            className={`${input} w-20`}
                          />
                          <button type="submit" className={ghostBtn}>
                            Spara
                          </button>
                        </form>
                      ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <details className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Lägg till tävling
          </summary>
          <form action={createCompetition} className="mt-3 flex flex-wrap items-end gap-3">
            {/* Så att createCompetition kan avgöra om det aktiva filtret
             * skulle dölja den nyskapade tävlingen och navigera om till rätt
             * år/bana i så fall — se motiveringen i actions.ts. */}
            <input type="hidden" name="current_tavlingsAr" value={tavlingsAr} />
            <input type="hidden" name="current_tavlingsBana" value={tavlingsBana} />
            <Field label="Namn">
              <input name="name" required placeholder="Inomhus-SM" className={input} />
            </Field>
            <Field label="Datum">
              <input type="date" name="competition_date" required className={input} />
            </Field>
            <Field label="Plats">
              <input name="location" placeholder="Göteborg" className={input} />
            </Field>
            <Field label="Inne/ute">
              <select name="venue" className={input} defaultValue="">
                <option value="">—</option>
                <option value="indoor">{SEASON_LABELS.indoor}</option>
                <option value="outdoor">{SEASON_LABELS.outdoor}</option>
              </select>
            </Field>
            <Field label="Prioritet">
              <select name="priority" className={input} defaultValue="C">
                {(["A", "B", "C"] as const).map((p) => (
                  <option key={p} value={p}>
                    {PRIORITY_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Grenar (komma mellan)">
              <input
                name="events"
                list="common-events"
                placeholder="1500m, 800m"
                className={input}
              />
              <datalist id="common-events">
                {COMMON_EVENTS.map((e) => (
                  <option key={e} value={e} />
                ))}
              </datalist>
            </Field>
            <Field label="Måltid (första grenen)">
              <input name="target_result" placeholder="4:35.00" className={input} />
            </Field>
            <button type="submit" className={primaryBtn}>
              Lägg till
            </button>
          </form>
        </details>
      </section>

      {/* ---------------- Tillgänglighet (K7) ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Tillgänglighet</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Tentaveckor, lov, läger och resor styr träningen minst lika mycket som
          periodiseringen, men syns ingen annanstans i appen. Det här är bara kontext som gör
          en avvikande vecka förklarlig i efterhand — ingen logik, inga justerade riktvärden,
          ingen påverkan på beräkningarna någon annanstans i appen.
        </p>

        {availabilityList.length > 0 && (
          <div className="flex flex-col gap-2">
            {availabilityList.map((p) => (
              <div
                key={p.id}
                className="flex flex-wrap items-baseline justify-between gap-2 rounded border border-zinc-200 p-4 dark:border-zinc-800"
              >
                <div className="flex items-baseline gap-2">
                  <span
                    className="rounded px-1.5 py-0.5 text-xs font-medium"
                    style={{ border: "1px solid var(--availability-band)", color: "var(--availability-band)" }}
                  >
                    {AVAILABILITY_LABELS[p.kind]}
                  </span>
                  <span className="font-medium text-zinc-900 dark:text-zinc-100">
                    {p.label ?? AVAILABILITY_LABELS[p.kind]}
                  </span>
                  <span className="text-sm text-zinc-500 dark:text-zinc-400">
                    {p.start_date} – {p.end_date}
                  </span>
                </div>
                <form action={deleteAvailabilityPeriod}>
                  <input type="hidden" name="id" value={p.id} />
                  <button
                    type="submit"
                    className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                  >
                    Ta bort
                  </button>
                </form>
              </div>
            ))}
          </div>
        )}

        <details className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <summary className="cursor-pointer text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Lägg till period
          </summary>
          <form action={createAvailabilityPeriod} className="mt-3 flex flex-wrap items-end gap-3">
            <Field label="Från">
              <input type="date" name="start_date" required className={input} />
            </Field>
            <Field label="Till">
              <input type="date" name="end_date" required className={input} />
            </Field>
            <Field label="Typ">
              <select name="kind" className={input} defaultValue="skola">
                {AVAILABILITY_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {AVAILABILITY_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Etikett">
              <input name="label" placeholder="Tentavecka" className={input} />
            </Field>
            <button type="submit" className={primaryBtn}>
              Lägg till
            </button>
          </form>
        </details>
      </section>
    </div>
  );
}
