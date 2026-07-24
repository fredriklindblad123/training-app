import { createClient } from "@/lib/supabase/server";
import { createGoal, updateGoalStatus } from "./actions";

const STATUS_LABEL: Record<string, string> = {
  active: "Aktivt",
  completed: "Klart",
  abandoned: "Avbrutet",
};

export default async function GoalsPage() {
  const supabase = await createClient();
  const { data: goals } = await supabase
    .from("goals")
    .select("*")
    .order("event_date", { ascending: true });

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
        Mål
      </h1>

      <section className="flex flex-col gap-3">
        {!goals?.length && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inga mål satta än.
          </p>
        )}
        {goals?.map((goal) => (
          <div
            key={goal.id}
            className="flex flex-wrap items-center justify-between gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
          >
            <div>
              <div className="font-medium text-zinc-900 dark:text-zinc-100">
                {goal.title}
                {goal.target_result && (
                  <span className="text-zinc-500"> — mål: {goal.target_result}</span>
                )}
              </div>
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                {goal.event_date}
                {goal.distance_meters
                  ? ` · ${(goal.distance_meters / 1000).toFixed(2)} km`
                  : ""}
                {" · "}
                {STATUS_LABEL[goal.status] ?? goal.status}
              </div>
              {goal.notes && (
                <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
                  {goal.notes}
                </p>
              )}
            </div>
            {goal.status === "active" && (
              <div className="flex gap-2 text-sm">
                <form action={updateGoalStatus.bind(null, goal.id, "completed")}>
                  <button
                    type="submit"
                    className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Markera klart
                  </button>
                </form>
                <form action={updateGoalStatus.bind(null, goal.id, "abandoned")}>
                  <button
                    type="submit"
                    className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
                  >
                    Avbryt
                  </button>
                </form>
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Nytt mål
        </h2>
        <form
          action={createGoal}
          className="flex flex-col gap-3 rounded border border-zinc-200 p-4 sm:max-w-md dark:border-zinc-800"
        >
          <label className="flex flex-col gap-1 text-sm">
            Titel
            <input
              type="text"
              name="title"
              required
              placeholder="t.ex. SM 1500m 2027"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tävlingsdatum
            <input
              type="date"
              name="event_date"
              required
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Måltid (valfritt)
            <input
              type="text"
              name="target_result"
              placeholder="t.ex. 3:45"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Distans i meter (valfritt)
            <input
              type="number"
              name="distance_meters"
              placeholder="1500"
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Anteckningar
            <textarea
              name="notes"
              rows={3}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <button
            type="submit"
            className="w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Skapa mål
          </button>
        </form>
      </section>
    </div>
  );
}
