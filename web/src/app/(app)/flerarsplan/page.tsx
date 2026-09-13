import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId, viewableAthletes } from "@/lib/auth-scope";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
import { createYearPlan, updateYearPlan, deleteYearPlan } from "./actions";

/* Flerårsplan (fas 0): mål, volym och tävlingar/läger per år, en rad per
 * årsetikett ("16 år", "2027", vad tränaren råkar kalla den). Motsvarar
 * Flerårsplan-fliken i "Träningsplanering Friidrottstränare steg 3" (Svensk
 * Friidrott) — se supabase/migrations/20260814120000_multi_year_plan_and_
 * exercises.sql för varför fälten är fri text snarare än en striktare
 * modell: originalfliken är själv löst formulerad (kryssrutor och fritext),
 * en striktare modell hade tvingat in data källan inte har.
 *
 * Samma athlete-scoping-mönster som /blockplan (lib/auth-scope.ts,
 * URL-`athlete`-param) — en löpare ser bara sig själv, en coach växlar via
 * väljaren. */

const input =
  "rounded border border-[var(--line)] px-2 py-1 text-sm dark:border-zinc-700 bg-[var(--surface)]";
const primaryBtn =
  "w-fit rounded bg-[var(--foreground)] px-4 py-2 text-sm text-[var(--background)] hover:opacity-90";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1 text-sm">
      <span className="text-[var(--ink-2)]">{label}</span>
      {children}
    </label>
  );
}

type ResultTarget = { event: string; target: string };

type YearPlanRow = {
  id: string;
  year_label: string;
  overall_goal: string | null;
  general_training_goal: string | null;
  specific_training_goal: string | null;
  weekly_hours: number | null;
  weekly_days: number | null;
  weekly_sessions: number | null;
  target_competitions: string | null;
  camps: string | null;
  result_targets: ResultTarget[];
  evaluations: string | null;
};

function resultTargetsToText(targets: ResultTarget[]): string {
  return targets.map((t) => `${t.event}: ${t.target}`).join(", ");
}

export default async function FlerarsplanPage({
  searchParams,
}: {
  searchParams: Promise<{ athlete?: string }>;
}) {
  const supabase = await createClient();
  const { athlete: athleteParam } = await searchParams;

  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null; // Layouten redirectar redan utan inloggning.
  const scopedUserId = resolveScopedUserId(scoped, athleteParam);

  function athleteHref(id: string): string {
    return `/flerarsplan?athlete=${id}`;
  }

  const { data: plans } = await supabase
    .from("multi_year_plans")
    .select("*")
    .eq("user_id", scopedUserId)
    .order("sort_order");
  const yearPlans = (plans ?? []) as YearPlanRow[];

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-[var(--foreground)]">Flerårsplan</h1>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-3)]">
            Mål, volym och tävlingar/läger per år — motsvarar Flerårsplan-fliken i mallen
            från Svensk Friidrott. Kan laddas ner ifylld nedan.
          </p>
        </div>
        {yearPlans.length > 0 && (
          <Link
            href={`/flerarsplan/export?athlete=${scopedUserId}`}
            className={primaryBtn}
          >
            Ladda ner Excel
          </Link>
        )}
      </div>

      {scoped.role === "coach" && (
        <AthleteSwitcher
          athletes={viewableAthletes(scoped)}
          activeId={scopedUserId}
          viewerUserId={scoped.userId}
          buildHref={athleteHref}
        />
      )}

      <section className="flex flex-col gap-3">
        {yearPlans.length === 0 ? (
          <p className="text-sm text-[var(--ink-3)]">
            Inga år inlagda än — lägg till det första nedan.
          </p>
        ) : (
          <div className="flex flex-col gap-2">
            {yearPlans.map((y) => (
              <details key={y.id} className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
                <summary className="flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="font-medium text-[var(--foreground)]">{y.year_label}</span>
                  {y.overall_goal && (
                    <span className="text-sm text-[var(--ink-3)]">
                      {y.overall_goal}
                    </span>
                  )}
                </summary>

                <form
                  action={updateYearPlan}
                  className="mt-4 flex flex-col gap-3 border-t border-[var(--line)] pt-3"
                >
                  <input type="hidden" name="id" value={y.id} />
                  <div className="flex flex-wrap gap-3">
                    <Field label="Årsetikett">
                      <input
                        name="year_label"
                        defaultValue={y.year_label}
                        required
                        className={input}
                      />
                    </Field>
                    <Field label="Träningstid, timmar/vecka">
                      <input
                        type="number"
                        step="0.5"
                        name="weekly_hours"
                        defaultValue={y.weekly_hours ?? ""}
                        className={`${input} w-28`}
                      />
                    </Field>
                    <Field label="Dagar/vecka">
                      <input
                        type="number"
                        name="weekly_days"
                        defaultValue={y.weekly_days ?? ""}
                        className={`${input} w-24`}
                      />
                    </Field>
                    <Field label="Pass/vecka">
                      <input
                        type="number"
                        name="weekly_sessions"
                        defaultValue={y.weekly_sessions ?? ""}
                        className={`${input} w-24`}
                      />
                    </Field>
                  </div>

                  <Field label="Övergripande mål">
                    <input
                      name="overall_goal"
                      defaultValue={y.overall_goal ?? ""}
                      className={input}
                    />
                  </Field>
                  <Field label="Mål allmän träning">
                    <input
                      name="general_training_goal"
                      defaultValue={y.general_training_goal ?? ""}
                      className={input}
                    />
                  </Field>
                  <Field label="Mål specifik träning">
                    <input
                      name="specific_training_goal"
                      defaultValue={y.specific_training_goal ?? ""}
                      className={input}
                    />
                  </Field>
                  <Field label="Huvudtävlingar">
                    <input
                      name="target_competitions"
                      placeholder="DM, Kraftmätningen, USM"
                      defaultValue={y.target_competitions ?? ""}
                      className={input}
                    />
                  </Field>
                  <Field label="Läger">
                    <input
                      name="camps"
                      placeholder="Sverigeläger, Utomlandsläger"
                      defaultValue={y.camps ?? ""}
                      className={input}
                    />
                  </Field>
                  <Field label="Måltider (gren: tid, kommaseparerat)">
                    <input
                      name="result_targets"
                      placeholder="800 m: 2.20, 1500 m: 4.40"
                      defaultValue={resultTargetsToText(y.result_targets ?? [])}
                      className={input}
                    />
                  </Field>
                  <Field label="Utvärderingar">
                    <input
                      name="evaluations"
                      placeholder="Individuellt samtal, Tröskeltest"
                      defaultValue={y.evaluations ?? ""}
                      className={input}
                    />
                  </Field>

                  <div className="flex gap-2">
                    <button type="submit" className={primaryBtn}>
                      Spara ändringar
                    </button>
                    <button
                      type="submit"
                      formAction={deleteYearPlan}
                      className="w-fit rounded border border-[var(--line)] px-3 py-1 text-sm text-red-700 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    >
                      Ta bort
                    </button>
                  </div>
                </form>
              </details>
            ))}
          </div>
        )}

        <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
          <summary className="cursor-pointer text-sm font-medium text-[var(--foreground)]">
            Lägg till år
          </summary>
          <form action={createYearPlan} className="mt-3 flex flex-wrap items-end gap-3">
            <input type="hidden" name="athlete" value={scopedUserId} />
            <Field label="Årsetikett">
              <input name="year_label" required placeholder="16 år" className={input} />
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
