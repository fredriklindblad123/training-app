"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useFormStatus } from "react-dom";
import { createBlockFromWizard, type PatternItem, type WeekKind } from "./actions";

/* Skapa block i tre steg: ramen, veckomönstret, veckorna (2026-11-21).
 *
 * Ett enda formulär: stegen göms med `hidden`, så fälten finns kvar och
 * skickas tillsammans när man trycker på sista knappen. Inget sparas på
 * vägen. Summorna (tid, distans, kvalitetspass) räknas här ur mönstret —
 * tiden med samma regel som resten av appen: styrka räknas inte. */

export type PatternSource = { key: string; label: string; items: PatternItem[] };

const DAYS = ["Mån", "Tis", "Ons", "Tor", "Fre", "Lör", "Sön"];
const TYPE_LABEL: Record<string, string> = {
  easy: "Distans",
  long_run: "Långpass",
  threshold: "Tröskel",
  interval: "Intervaller",
  race: "Tävling",
  strength: "Styrka",
  cross_training: "Alternativ träning",
  test: "Tröskeltest",
  rest: "Vila",
  hurdles: "Häck",
};
const TYPE_COLOR: Record<string, string> = {
  easy: "var(--cat-easy)",
  long_run: "var(--cat-long_run)",
  threshold: "var(--cat-threshold)",
  interval: "var(--cat-interval)",
  race: "var(--cat-race)",
  strength: "var(--cat-strength)",
  cross_training: "var(--cat-cross_training)",
  test: "var(--cat-test)",
};
const QUALITY = new Set(["threshold", "interval", "test", "race"]);

function addDaysKey(key: string, n: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function mondayKey(key: string): string {
  const d = new Date(`${key}T12:00:00Z`);
  return addDaysKey(key, -((d.getUTCDay() + 6) % 7));
}
function short(key: string): string {
  const [, m, d] = key.split("-").map(Number);
  return `${d}/${m}`;
}
function isoWeek(key: string): number {
  const d = new Date(`${key}T12:00:00Z`);
  const day = (d.getUTCDay() + 6) % 7;
  d.setUTCDate(d.getUTCDate() - day + 3);
  const firstThursday = new Date(Date.UTC(d.getUTCFullYear(), 0, 4));
  return 1 + Math.round(((d.getTime() - firstThursday.getTime()) / 86_400_000 - 3 + ((firstThursday.getUTCDay() + 6) % 7)) / 7);
}

const field = "h-12 rounded-[10px] border border-[var(--line)] bg-[var(--surface)] px-3 text-base text-[var(--foreground)]";
const label = "flex flex-col gap-1.5 text-sm font-semibold text-[var(--foreground)]";

function Submit({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--foreground)] px-4 font-semibold text-[var(--background)] disabled:opacity-60"
    >
      {pending ? "Skapar blocket …" : `Skapa blocket och lägg in ${count} pass`}
    </button>
  );
}

function Segment<T extends string>({
  name,
  value,
  onChange,
  options,
}: {
  name: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <div
      role="radiogroup"
      className="grid gap-0.5 rounded-[10px] bg-[var(--surface-raised)] p-[3px]"
      style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}
    >
      {options.map((o) => (
        <label
          key={o.value}
          className={`flex min-h-10 cursor-pointer items-center justify-center rounded-lg px-2 text-center text-sm ${
            value === o.value ? "bg-[var(--foreground)] font-semibold text-[var(--background)]" : "text-[var(--ink-2)]"
          }`}
        >
          <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
          {o.label}
        </label>
      ))}
    </div>
  );
}

export function Wizard({
  athletes,
  defaultAthletes,
  start: defaultStart,
  context,
  periods,
  phases,
  sources,
}: {
  athletes: { id: string; name: string }[];
  defaultAthletes: string[];
  start: string;
  context: {
    before: { name: string; end: string } | null;
    after: { name: string; start: string } | null;
    blocks: { name: string; start: string; end: string }[];
    races: { name: string; date: string; priority: string }[];
  };
  periods: { value: string; label: string }[];
  phases: { value: string; label: string; intent: string }[];
  sources: PatternSource[];
}) {
  const [step, setStep] = useState(1);
  const [chosen, setChosen] = useState<Set<string>>(new Set(defaultAthletes.length ? defaultAthletes : athletes.slice(0, 1).map((a) => a.id)));
  const [name, setName] = useState("");
  const [period, setPeriod] = useState(periods[0]?.value ?? "forberedelse");
  const [phase, setPhase] = useState(phases[0]?.value ?? "allman");
  const [season, setSeason] = useState<"indoor" | "outdoor" | "">("");
  const [start, setStart] = useState(defaultStart);
  const [end, setEnd] = useState(addDaysKey(defaultStart, 27));
  const [sourceKey, setSourceKey] = useState(sources[0]?.key ?? "tom");
  const [kinds, setKinds] = useState<Record<string, WeekKind>>({});

  const items = useMemo(
    () => [...(sources.find((s) => s.key === sourceKey)?.items ?? [])].sort((a, b) => a.weekday - b.weekday || a.slot - b.slot),
    [sources, sourceKey],
  );
  const weekMinutes = items
    .filter((i) => i.workout_type !== "strength")
    .reduce((s, i) => s + (i.target_duration_seconds ?? 0) / 60, 0);
  const weekKm = items
    .filter((i) => i.workout_type !== "cross_training")
    .reduce((s, i) => s + (i.target_distance_meters ?? 0) / 1000, 0);
  const weekQuality = items.filter((i) => QUALITY.has(i.workout_type)).length;

  const weeks = useMemo(() => {
    if (!start || !end || end < start) return [];
    const out: { monday: string; from: string; to: string }[] = [];
    for (let m = mondayKey(start); m <= end; m = addDaysKey(m, 7)) {
      out.push({ monday: m, from: m < start ? start : m, to: addDaysKey(m, 6) > end ? end : addDaysKey(m, 6) });
    }
    return out;
  }, [start, end]);
  const kindOf = (m: string): WeekKind => kinds[m] ?? "normal";
  const minutesFor = (m: string) => Math.round(weekMinutes * (kindOf(m) === "lattare" ? 0.8 : 1));
  const totalMinutes = weeks.reduce((s, w) => s + minutesFor(w.monday), 0);
  const passCount = weeks.reduce((s, w) => {
    const days = new Set<number>();
    for (let d = w.from; d <= w.to; d = addDaysKey(d, 1)) days.add(((new Date(`${d}T12:00:00Z`).getUTCDay() + 6) % 7) + 1);
    return s + items.filter((i) => days.has(i.weekday) && i.workout_type !== "rest").length;
  }, 0) * chosen.size;
  const phaseInfo = phases.find((p) => p.value === phase);
  const overlaps = context.blocks.filter((b) => b.start <= end && b.end >= start);
  const canNext1 = name.trim() !== "" && chosen.size > 0 && start !== "" && end >= start;

  const progress = (n: number) => (
    <div className="grid grid-cols-3 gap-1" aria-hidden>
      {[1, 2, 3].map((i) => (
        <span key={i} className={`h-1 rounded-full ${i <= n ? "bg-[var(--foreground)]" : "bg-[var(--line)]"}`} />
      ))}
    </div>
  );

  return (
    <form action={createBlockFromWizard} className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex items-center justify-between text-sm">
        {step === 1 ? (
          <Link href="/blockplan" className="flex min-h-9 items-center underline underline-offset-2">
            Avbryt
          </Link>
        ) : (
          <button type="button" onClick={() => setStep(step - 1)} className="flex min-h-9 items-center underline underline-offset-2">
            ‹ Tillbaka
          </button>
        )}
        <span className="text-[var(--ink-2)]">Steg {step} av 3</span>
      </div>

      {/* ---------- Steg 1: ramen ---------- */}
      <section hidden={step !== 1} className="flex flex-col gap-5">
        {progress(1)}
        <div>
          <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Nytt block</h1>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Ramen först: vem, när och vad blocket ska ge. Veckomönstret och veckorna kommer i nästa steg.
          </p>
        </div>

        <div className="flex flex-col gap-1.5 rounded-[14px] px-4 py-3.5 text-sm" style={{ backgroundColor: "var(--surface-insight)" }}>
          <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-2)] uppercase">Säsongen runt blocket</span>
          {context.before && (
            <span>
              Före: <strong>{context.before.name}</strong>, slutar {short(context.before.end)}.
            </span>
          )}
          {context.after && (
            <span>
              Efter: <strong>{context.after.name}</strong>, börjar {short(context.after.start)}.
            </span>
          )}
          {context.races.length > 0 && (
            <span>
              Kommande lopp: {context.races.map((r) => `${r.name} ${short(r.date)} (${r.priority})`).join(" · ")}
            </span>
          )}
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-2 text-sm font-semibold">Löpare</legend>
          <div className="flex flex-wrap gap-2">
            {athletes.map((a) => {
              const on = chosen.has(a.id);
              return (
                <label
                  key={a.id}
                  className={`flex min-h-10 cursor-pointer items-center gap-2 rounded-full px-4 text-[0.9375rem] ${
                    on ? "bg-[var(--foreground)] text-[var(--background)]" : "border border-[var(--line)]"
                  }`}
                >
                  <input
                    type="checkbox"
                    name="athletes"
                    value={a.id}
                    checked={on}
                    onChange={() => {
                      const next = new Set(chosen);
                      if (on) next.delete(a.id);
                      else next.add(a.id);
                      setChosen(next);
                    }}
                    className="sr-only"
                  />
                  {a.name}
                </label>
              );
            })}
          </div>
        </fieldset>

        <label className={label}>
          Namn
          <input name="name" value={name} onChange={(e) => setName(e.target.value)} required placeholder="t.ex. Tävlingsförberedande inne 2027" className={field} />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Period</span>
          <Segment name="period" value={period} onChange={setPeriod} options={periods.map((p) => ({ value: p.value, label: p.label.replace("period", "") }))} />
        </div>

        <label className={label}>
          Fas
          <select name="phase" value={phase} onChange={(e) => setPhase(e.target.value)} className={field}>
            {phases.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </select>
          {phaseInfo && <span className="text-sm font-normal text-[var(--ink-2)]">{phaseInfo.intent}</span>}
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className={label}>
            Start
            <input type="date" name="start_date" value={start} onChange={(e) => setStart(e.target.value)} required className={field} />
          </label>
          <label className={label}>
            Slut
            <input type="date" name="end_date" value={end} onChange={(e) => setEnd(e.target.value)} required className={field} />
          </label>
        </div>
        {weeks.length > 0 && <p className="-mt-3 text-sm text-[var(--ink-2)]">{weeks.length} veckor.</p>}
        {overlaps.length > 0 && (
          <div className="flex flex-col gap-1 rounded-[14px] border border-[var(--status-watch)] px-4 py-3 text-sm">
            <span className="font-semibold text-[var(--foreground)]">
              Datumen överlappar {overlaps.map((b) => `${b.name} (${short(b.start)}–${short(b.end)})`).join(" och ")}.
            </span>
            <span className="text-[var(--ink-2)]">
              Pass som redan ligger där får vara kvar, och nya pass läggs bara på tomma dagar. Vill du ändra ett
              befintligt block gör du det i Blockplan.
            </span>
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-semibold">Inne eller ute</span>
          <Segment
            name="season"
            value={season}
            onChange={setSeason}
            options={[
              { value: "indoor", label: "Inne" },
              { value: "outdoor", label: "Ute" },
              { value: "", label: "Ingen" },
            ]}
          />
        </div>

        <label className={label}>
          Fokus
          <input name="focus" placeholder="t.ex. tröskelvolym, 2 kvalitetspass i veckan" className={field} />
        </label>

        <button
          type="button"
          disabled={!canNext1}
          onClick={() => setStep(2)}
          className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--foreground)] px-4 font-semibold text-[var(--background)] disabled:opacity-40"
        >
          Nästa: veckomönster →
        </button>
      </section>

      {/* ---------- Steg 2: veckomönster ---------- */}
      <section hidden={step !== 2} className="flex flex-col gap-5">
        {progress(2)}
        <div>
          <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Veckomönster</h1>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            En vanlig vecka i blocket. Den läggs ut på alla veckor i nästa steg. Enskilda pass ändras efteråt i Blockplan.
          </p>
        </div>

        <label className={label}>
          Utgå från
          <select value={sourceKey} onChange={(e) => setSourceKey(e.target.value)} className={field}>
            {sources.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        <input type="hidden" name="pattern" value={JSON.stringify(items)} />

        {items.length === 0 ? (
          <div className="rounded-[14px] border border-dashed border-[var(--line)] px-4 py-3.5 text-sm text-[var(--ink-2)]">
            Tom vecka — blocket skapas utan pass, och mönstret läggs in i Blockplan.
          </div>
        ) : (
          <div className="overflow-hidden rounded-[14px] border border-[var(--line)]">
            {DAYS.map((d, i) => {
              const dayItems = items.filter((it) => it.weekday === i + 1);
              return (
                <div key={d} className={`grid grid-cols-[40px_minmax(0,1fr)] gap-2 px-3.5 py-2.5 ${i > 0 ? "border-t border-[var(--line)]" : ""}`}>
                  <span className="text-sm text-[var(--ink-2)]">{d}</span>
                  <span className="flex min-w-0 flex-col gap-1.5">
                    {dayItems.length === 0 ? (
                      <span className="text-sm text-[var(--ink-3)]">Vila</span>
                    ) : (
                      dayItems.map((it, j) => (
                        <span key={j} className="flex flex-col">
                          <span className="flex items-center gap-1.5 text-[0.9375rem] font-semibold text-[var(--foreground)]">
                            <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: TYPE_COLOR[it.workout_type] ?? "var(--ink-3)" }} />
                            {it.title ?? TYPE_LABEL[it.workout_type] ?? it.workout_type}
                          </span>
                          <span className="pl-3.5 text-xs text-[var(--ink-2)]">
                            {[
                              TYPE_LABEL[it.workout_type],
                              it.target_distance_meters ? `${(it.target_distance_meters / 1000).toLocaleString("sv-SE", { maximumFractionDigits: 1 })} km` : null,
                              it.target_duration_seconds ? `ca ${Math.round(it.target_duration_seconds / 60)} min` : null,
                            ]
                              .filter(Boolean)
                              .join(" · ")}
                          </span>
                        </span>
                      ))
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        <div className="grid grid-cols-3 gap-2.5">
          {[
            { l: "Träningstid", v: `${Math.round(weekMinutes)}`, u: "min", s: "utan styrka" },
            { l: "Löpning", v: `${Math.round(weekKm)}`, u: "km", s: "planerad distans" },
            { l: "Kvalitet", v: `${weekQuality}`, u: "pass", s: "tröskel, intervall, test" },
          ].map((t) => (
            <div key={t.l} className="rounded-[14px] border border-[var(--line)] p-3">
              <div className="text-xs text-[var(--ink-3)]">{t.l}</div>
              <div className="display tabular text-[1.375rem] font-bold text-[var(--foreground)]">
                {t.v} <span className="text-xs font-medium text-[var(--ink-2)]">{t.u}</span>
              </div>
              <div className="text-xs text-[var(--ink-3)]">{t.s}</div>
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={() => setStep(3)}
          className="flex min-h-12 items-center justify-center rounded-xl bg-[var(--foreground)] px-4 font-semibold text-[var(--background)]"
        >
          Nästa: lägg ut på veckorna →
        </button>
      </section>

      {/* ---------- Steg 3: veckorna ---------- */}
      <section hidden={step !== 3} className="flex flex-col gap-5">
        {progress(3)}
        <div>
          <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">Veckorna</h1>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Mönstret ligger på alla {weeks.length} veckorna. Välj typ per vecka. Lättare: passen ca 20 % kortare. Test: veckans
            första tröskelpass blir ett tröskeltest.
          </p>
        </div>
        <input type="hidden" name="week_kinds" value={JSON.stringify(kinds)} />

        {weeks.map((w) => (
          <article key={w.monday} className="flex flex-col gap-2.5 rounded-[14px] border border-[var(--line)] p-3.5">
            <div className="flex items-baseline justify-between gap-2">
              <span className="flex flex-col">
                <span className="font-semibold text-[var(--foreground)]">v{isoWeek(w.monday)}</span>
                <span className="text-xs text-[var(--ink-3)]">
                  {short(w.from)}–{short(w.to)}
                </span>
              </span>
              {weekMinutes > 0 && (
                <span className="display tabular text-xl font-bold text-[var(--foreground)]">
                  {minutesFor(w.monday)} <span className="text-xs font-medium text-[var(--ink-2)]">min</span>
                </span>
              )}
            </div>
            <Segment
              name={`kind-${w.monday}`}
              value={kindOf(w.monday)}
              onChange={(v) => setKinds({ ...kinds, [w.monday]: v })}
              options={[
                { value: "normal", label: "Normal" },
                { value: "lattare", label: "Lättare" },
                { value: "test", label: "Test" },
              ]}
            />
          </article>
        ))}

        {weekMinutes > 0 && (
          <div className="flex flex-col gap-1 rounded-[14px] px-4 py-3.5 text-[0.9375rem]" style={{ backgroundColor: "var(--surface-insight)" }}>
            <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-2)] uppercase">Blocket i siffror</span>
            <span>
              {passCount} pass för {chosen.size === 1 ? "en löpare" : `${chosen.size} löpare`}. {totalMinutes.toLocaleString("sv-SE")} min per löpare, i snitt{" "}
              {weeks.length ? Math.round(totalMinutes / weeks.length) : 0} min i veckan.
            </span>
          </div>
        )}

        <Submit count={passCount} />
        <p className="-mt-3 text-center text-xs text-[var(--ink-3)]">
          Passen hamnar i kalendern som planerade. Pass som redan ligger på ett datum skrivs inte över.
        </p>
      </section>
    </form>
  );
}
