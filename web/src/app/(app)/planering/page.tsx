import { createClient } from "@/lib/supabase/server";
import {
  SeasonTimeline,
  type TimelineBlock,
  type TimelineCompetition,
} from "@/components/SeasonTimeline";
import {
  BLOCK_INTENT,
  BLOCK_LABELS,
  BLOCK_TYPES,
  COMMON_EVENTS,
  PRIORITY_LABELS,
  SEASON_LABELS,
  SLOT_LABELS,
  WEEKDAY_LABELS,
  WORKOUT_LABELS,
  WORKOUT_TYPES,
  toDateKey,
  weeksBetween,
  type BlockType,
} from "@/lib/planning";
import {
  addTemplateItem,
  applyTemplate,
  clearTemplateWorkouts,
  createBlock,
  createCompetition,
  createTemplate,
  deleteBlock,
  deleteCompetition,
  deleteTemplate,
  deleteTemplateItem,
  saveEventResult,
  suggestPeriodisation,
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

export default async function PlaneringPage() {
  const supabase = await createClient();
  const today = toDateKey(new Date());

  const [{ data: blocks }, { data: competitions }, { data: templates }, { data: plannedCounts }] =
    await Promise.all([
      supabase.from("season_blocks").select("*").order("start_date"),
      supabase
        .from("competitions")
        .select("*, competition_events(*)")
        .order("competition_date"),
      supabase
        .from("week_templates")
        .select("*, week_template_items(*)")
        .order("created_at"),
      supabase
        .from("planned_workouts")
        .select("scheduled_date")
        .gte("scheduled_date", today),
    ]);

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

  const nextA = competitionList.find((c) => c.priority === "A" && c.competition_date >= today);
  const activeBlock = blockList.find((b) => b.start_date <= today && b.end_date >= today);

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

        {blockList.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[42rem] text-sm">
              <thead>
                <tr className="text-left text-xs text-zinc-500 dark:text-zinc-400">
                  <th className="pb-1 font-normal">Namn</th>
                  <th className="pb-1 font-normal">Typ</th>
                  <th className="pb-1 font-normal">Säsong</th>
                  <th className="pb-1 font-normal">Period</th>
                  <th className="pb-1 font-normal">Veckor</th>
                  <th className="pb-1 font-normal">Fokus</th>
                  <th className="pb-1" />
                </tr>
              </thead>
              <tbody>
                {blockList.map((b) => (
                  <tr key={b.id} className="border-t border-zinc-100 dark:border-zinc-800">
                    <td className="py-1.5 pr-3 font-medium text-zinc-900 dark:text-zinc-100">
                      {b.name}
                    </td>
                    <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-400">
                      {BLOCK_LABELS[b.block_type]}
                    </td>
                    <td className="py-1.5 pr-3 text-zinc-600 dark:text-zinc-400">
                      {b.season ? SEASON_LABELS[b.season] : "—"}
                    </td>
                    <td className="py-1.5 pr-3 whitespace-nowrap text-zinc-600 dark:text-zinc-400">
                      {b.start_date} – {b.end_date}
                    </td>
                    <td className="py-1.5 pr-3 tabular-nums text-zinc-600 dark:text-zinc-400">
                      {weeksBetween(b.start_date, b.end_date)}
                    </td>
                    <td className="py-1.5 pr-3 text-zinc-500 dark:text-zinc-400">
                      {b.focus ?? "—"}
                    </td>
                    <td className="py-1.5 text-right">
                      <form action={deleteBlock}>
                        <input type="hidden" name="id" value={b.id} />
                        <button
                          type="submit"
                          className="text-xs text-zinc-400 hover:text-red-600 dark:hover:text-red-400"
                        >
                          Ta bort
                        </button>
                      </form>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
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
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Tävlingar</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          Prioriteten styr hur planeringen toppar. A är säsongens huvudmål och får en
          nedtrappning före sig; C är träningstävling och planeras rakt igenom.
        </p>

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

      {/* ---------------- Veckomallar ---------------- */}
      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">Veckomallar</h2>
        <p className="max-w-3xl text-sm text-zinc-500 dark:text-zinc-400">
          En mall beskriver en typisk vecka. Rulla ut den över ett block så skapas passen för
          varje vecka i intervallet. Dagar som redan har ett planerat pass lämnas orörda, så
          en utrullning aldrig skriver över något du lagt in för hand.
        </p>

        {(templates ?? []).map((t) => {
          const items = (t.week_template_items ?? []) as {
            id: string;
            weekday: number;
            slot: number;
            workout_type: string;
            title: string | null;
            description: string | null;
          }[];
          return (
            <details key={t.id} className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
              <summary className="cursor-pointer">
                <span className="font-medium text-zinc-900 dark:text-zinc-100">{t.name}</span>
                <span className="ml-2 text-sm text-zinc-500 dark:text-zinc-400">
                  {items.length} pass/vecka
                  {t.block_type ? ` · ${BLOCK_LABELS[t.block_type as BlockType]}` : ""}
                </span>
              </summary>

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-7">
                {WEEKDAY_LABELS.map((label, i) => {
                  const day = items
                    .filter((it) => it.weekday === i + 1)
                    .sort((a, b) => a.slot - b.slot);
                  return (
                    <div key={label} className="flex flex-col gap-1">
                      <div className="text-xs font-medium text-zinc-500 dark:text-zinc-400">
                        {label.slice(0, 3)}
                      </div>
                      {day.length === 0 && (
                        <div className="text-xs text-zinc-300 dark:text-zinc-700">—</div>
                      )}
                      {day.map((it) => (
                        <div
                          key={it.id}
                          className="rounded bg-zinc-100 px-1.5 py-1 text-xs dark:bg-zinc-800"
                        >
                          <div className="font-medium text-zinc-900 dark:text-zinc-100">
                            {WORKOUT_LABELS[it.workout_type as keyof typeof WORKOUT_LABELS] ??
                              it.workout_type}
                          </div>
                          {it.title && (
                            <div className="text-zinc-600 dark:text-zinc-400">{it.title}</div>
                          )}
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

              <form action={addTemplateItem} className="mt-4 flex flex-wrap items-end gap-2">
                <input type="hidden" name="template_id" value={t.id} />
                <Field label="Dag">
                  <select name="weekday" className={input} defaultValue="1">
                    {WEEKDAY_LABELS.map((d, i) => (
                      <option key={d} value={i + 1}>
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

              <div className="mt-4 border-t border-zinc-100 pt-3 dark:border-zinc-800">
                <form action={applyTemplate} className="flex flex-wrap items-end gap-2">
                  <input type="hidden" name="template_id" value={t.id} />
                  <Field label="Rulla ut i block">
                    <select name="block_id" className={input} defaultValue="">
                      <option value="">Inget block</option>
                      {blockList.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name} ({b.start_date} – {b.end_date})
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Från">
                    <input type="date" name="from" required className={input} />
                  </Field>
                  <Field label="Till">
                    <input type="date" name="to" required className={input} />
                  </Field>
                  <button type="submit" className={primaryBtn}>
                    Rulla ut
                  </button>
                </form>
                <form action={clearTemplateWorkouts} className="mt-2 flex flex-wrap items-end gap-2">
                  <input type="hidden" name="template_id" value={t.id} />
                  <Field label="Ångra från">
                    <input type="date" name="from" required className={input} />
                  </Field>
                  <Field label="Till">
                    <input type="date" name="to" required className={input} />
                  </Field>
                  <button type="submit" className={ghostBtn}>
                    Ta bort mallens pass i intervallet
                  </button>
                </form>
                <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
                  Ångra tar bara bort pass som den här mallen skapat och som fortfarande är
                  planerade — aldrig pass du lagt in själv eller redan genomfört.
                </p>
              </div>

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

        <form
          action={createTemplate}
          className="flex flex-wrap items-end gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <Field label="Ny mall">
            <input name="name" required placeholder="Grundvecka med dubbeltröskel" className={input} />
          </Field>
          <Field label="Hör till blocktyp">
            <select name="block_type" className={input} defaultValue="">
              <option value="">—</option>
              {BLOCK_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BLOCK_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <button type="submit" className={primaryBtn}>
            Skapa mall
          </button>
        </form>
      </section>
    </div>
  );
}
