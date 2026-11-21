import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, viewableAthletes } from "@/lib/auth-scope";
import { getViewMode } from "@/lib/view-mode";
import {
  SESSION_ACTIVITY_COLUMNS,
  groupActivitiesIntoSessions,
  trainingSeconds,
  type SessionActivity,
} from "@/lib/sessions";
import { strengthDatesFromDiary } from "@/lib/diary-strength";
import { addDays, mondayOf, toDateKey, WORKOUT_LABELS, type WorkoutType } from "@/lib/planning";
import { formatDateShort, formatMinutes } from "@/lib/format";
import { Page, PageHeader } from "@/components/ui/Page";
import { EmptyState, Eyebrow } from "@/components/ui/Explain";

/* Gruppen — coachens startsida (A3, 2026-11-21).
 *
 * Svarar på "vad har hänt sedan sist, och vad väntar på mig?". Det fanns
 * ingen sådan yta: coachen landade på Idag, som är en löpares sida, och fick
 * välja löpare innan något syntes. Här står alla löpare på en skärm.
 *
 * Tonen följer CLAUDE.md: observationer, aldrig betyg. Ingen färg för hur
 * mycket någon tränat. En löpare utan kopplad klocka visas som just det, inte
 * som noll pass — skillnaden mellan "tränade inte" och "vi vet inte" är hela
 * poängen (Emma, Nike och Signe hade 0 aktiviteter när sidan byggdes). */

type DiaryRow = { user_id: string; entry_date: string; day_type: string | null; session_log: string | null };
type PlanRow = { user_id: string; scheduled_date: string; slot: number; workout_type: string; title: string | null };

/** Senaste sammanhängande sjuk- eller skadeperiod (dagboksdagar i följd). */
function lastInterruption(rows: DiaryRow[]): { kind: "sick" | "injured"; from: string; to: string; days: number } | null {
  const marked = rows
    .filter((r) => r.day_type === "sick" || r.day_type === "injured")
    .sort((a, b) => a.entry_date.localeCompare(b.entry_date));
  if (marked.length === 0) return null;
  const last = marked[marked.length - 1];
  let from = last.entry_date;
  let days = 1;
  for (let i = marked.length - 2; i >= 0; i--) {
    const r = marked[i];
    if (r.day_type !== last.day_type || toDateKey(addDays(new Date(`${r.entry_date}T12:00:00`), 1)) !== from) break;
    from = r.entry_date;
    days++;
  }
  return { kind: last.day_type as "sick" | "injured", from, to: last.entry_date, days };
}

export default async function GruppenPage() {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  if (scoped.role !== "coach" || (await getViewMode()) === "runner") redirect("/dashboard");

  const athletes = viewableAthletes(scoped);
  const ids = athletes.map((a) => a.id);
  const today = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });
  const weekStart = toDateKey(mondayOf(today));
  const weekEnd = toDateKey(addDays(mondayOf(today), 6));
  const since = toDateKey(addDays(new Date(`${today}T12:00:00`), -60));

  const [{ data: actRows }, { data: planRows }, { data: diaryRows }] =
    ids.length === 0
      ? [{ data: [] }, { data: [] }, { data: [] }]
      : await Promise.all([
          supabase
            .from("activities")
            .select(SESSION_ACTIVITY_COLUMNS)
            .in("user_id", ids)
            .gte("start_time", since)
            .order("start_time"),
          supabase
            .from("planned_workouts")
            .select("user_id, scheduled_date, slot, workout_type, title")
            .in("user_id", ids)
            .gte("scheduled_date", weekStart)
            .lte("scheduled_date", weekEnd),
          supabase
            .from("diary_entries")
            .select("user_id, entry_date, day_type, session_log")
            .in("user_id", ids)
            .gte("entry_date", since),
        ]);

  const acts = (actRows ?? []) as unknown as SessionActivity[];
  const plans = (planRows ?? []) as PlanRow[];
  const diary = (diaryRows ?? []) as DiaryRow[];

  const cards = athletes.map((a) => {
    const mine = acts.filter((x) => x.user_id === a.id);
    const sessions = groupActivitiesIntoSessions(mine);
    const weekSessions = sessions.filter((s) => s.date >= weekStart && s.date <= weekEnd);
    const myPlans = plans.filter((p) => p.user_id === a.id && p.workout_type !== "rest");
    const myDiary = diary.filter((d) => d.user_id === a.id);
    const strength = new Set(strengthDatesFromDiary(myDiary));
    const trainedDates = new Set([...weekSessions.map((s) => s.date), ...strength]);
    const dueDates = [...new Set(myPlans.map((p) => p.scheduled_date))].filter((d) => d < today);
    const todayPlans = myPlans.filter((p) => p.scheduled_date === today).sort((x, y) => x.slot - y.slot);
    const lastDiary = myDiary.map((d) => d.entry_date).sort().at(-1) ?? null;
    return {
      athlete: a,
      hasWatch: mine.length > 0,
      plannedCount: myPlans.length,
      due: dueDates.length,
      doneOfDue: dueDates.filter((d) => trainedDates.has(d)).length,
      weekMinutes: weekSessions.reduce((sum, s) => sum + trainingSeconds(s), 0) / 60,
      todayLabel:
        todayPlans.length === 0
          ? "Vila"
          : todayPlans
              .map((p) => WORKOUT_LABELS[p.workout_type as WorkoutType] ?? p.title ?? "Pass")
              .join(" + "),
      interruption: lastInterruption(myDiary),
      lastDiary,
    };
  });


  return (
    <Page>
      <PageHeader
        title="Gruppen"
        lead={`${formatDateShort(today, true)} · veckan hittills, löpare för löpare.`}
      />


      <section className="flex flex-col gap-2.5">
        <Eyebrow>Löparna</Eyebrow>
        {cards.map((c) =>
          c.hasWatch ? (
            <article key={c.athlete.id} className="flex flex-col gap-3 rounded-[14px] border border-[var(--line)] p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-lg font-semibold text-[var(--foreground)]">{(c.athlete.fullName ?? "Löpare")}</span>

              </div>
              <div className="grid grid-cols-3 gap-2">
                <div>
                  <div className="text-xs text-[var(--ink-3)]">Veckan</div>
                  <div className="font-semibold text-[var(--foreground)]">
                    {c.due === 0 ? "–" : `${c.doneOfDue} av ${c.due} dagar`}
                  </div>
                </div>
                <div>
                  <div className="text-xs text-[var(--ink-3)]">Tid hittills</div>
                  <div className="tabular font-semibold text-[var(--foreground)]">{formatMinutes(c.weekMinutes)}</div>
                </div>
                <div>
                  <div className="text-xs text-[var(--ink-3)]">Idag</div>
                  <div className="font-semibold text-[var(--foreground)]">{c.todayLabel}</div>
                </div>
              </div>
              <nav aria-label={`${c.athlete.fullName ?? "Löparen"}s sidor`} className="grid grid-cols-4 gap-1.5">
                {[
                  { l: "Idag", h: "/dashboard" },
                  { l: "Kalender", h: "/calendar" },
                  { l: "Form", h: "/trender" },
                  { l: "Blocket", h: "/analys" },
                ].map((x) => (
                  <Link
                    key={x.h}
                    href={`${x.h}?athlete=${c.athlete.id}`}
                    className="flex min-h-10 items-center justify-center rounded-[10px] bg-[var(--surface-raised)] text-sm text-[var(--foreground)] hover:opacity-80"
                  >
                    {x.l}
                  </Link>
                ))}
              </nav>
              {(c.interruption || c.lastDiary) && (
                <ul className="flex list-disc flex-col gap-1 border-t border-[var(--line)] pt-2.5 pl-4 text-sm text-[var(--ink-2)]">
                  {c.interruption && (
                    <li>
                      {c.interruption.kind === "injured" ? "Skadad" : "Sjuk"} i dagboken{" "}
                      {c.interruption.days === 1
                        ? formatDateShort(c.interruption.from)
                        : `${formatDateShort(c.interruption.from)}–${formatDateShort(c.interruption.to)}, ${c.interruption.days} dagar`}
                      .{c.lastDiary && c.lastDiary > c.interruption.to ? " Ingen notering efter det." : ""}
                    </li>
                  )}
                  {c.lastDiary && <li>Senaste dagboksanteckning {formatDateShort(c.lastDiary)}.</li>}
                </ul>
              )}
            </article>
          ) : (
            <article key={c.athlete.id} className="flex flex-col gap-2 rounded-[14px] border border-[var(--line)] p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-lg font-semibold text-[var(--foreground)]">{(c.athlete.fullName ?? "Löpare")}</span>
                <span className="text-sm text-[var(--ink-2)]">{c.plannedCount} pass planerade i veckan</span>
              </div>
              <EmptyState title="Ingen klocka kopplad">Planen syns, men inte vad som blev gjort.</EmptyState>
            </article>
          ),
        )}
      </section>
    </Page>
  );
}
