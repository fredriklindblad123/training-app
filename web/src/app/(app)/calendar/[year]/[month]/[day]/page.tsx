import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  SV_MONTHS,
  dateKey,
  nextDateKey,
  isValidYear,
  isValidMonth,
  isValidDay,
} from "@/lib/calendar-utils";
import { saveDiaryEntry } from "./actions";
import { formatDuration, formatPace, formatKm } from "@/lib/format";

const DAY_TYPE_OPTIONS = [
  { value: "", label: "Ej satt" },
  { value: "training", label: "Träning" },
  { value: "rest", label: "Vila" },
  { value: "sick", label: "Sjuk" },
  { value: "injured", label: "Skadad" },
];

export default async function DayPage({
  params,
}: {
  params: Promise<{ year: string; month: string; day: string }>;
}) {
  const { year: yearParam, month: monthParam, day: dayParam } = await params;
  const year = Number(yearParam);
  const month = Number(monthParam);
  const day = Number(dayParam);
  if (
    !isValidYear(year) ||
    !isValidMonth(month) ||
    !isValidDay(year, month, day)
  ) {
    notFound();
  }

  const dateStr = dateKey(year, month, day);
  const nextDateStr = nextDateKey(year, month, day);
  const prevDate = new Date(year, month - 1, day - 1);
  const nextDate = new Date(year, month - 1, day + 1);

  const supabase = await createClient();

  const [{ data: activities }, { data: diaryEntry }] = await Promise.all([
    supabase
      .from("activities")
      .select("*, activity_splits(*)")
      .gte("start_time", dateStr)
      .lt("start_time", nextDateStr)
      .order("start_time"),
    supabase
      .from("diary_entries")
      .select("*")
      .eq("entry_date", dateStr)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
  ]);

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <Link
            href={`/calendar/${prevDate.getFullYear()}/${prevDate.getMonth() + 1}/${prevDate.getDate()}`}
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            ←
          </Link>
          <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
            {day} {SV_MONTHS[month - 1]} {year}
          </h1>
          <Link
            href={`/calendar/${nextDate.getFullYear()}/${nextDate.getMonth() + 1}/${nextDate.getDate()}`}
            className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            →
          </Link>
        </div>
        <Link
          href={`/calendar/${year}/${month}`}
          className="text-sm text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
        >
          Till månadsvyn
        </Link>
      </div>

      <section className="flex flex-col gap-4">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Garmin-data
        </h2>
        {!activities?.length && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inget synkat pass den här dagen.
          </p>
        )}
        {activities?.map((a) => (
          <div
            key={a.id}
            className="grid grid-cols-2 gap-x-6 gap-y-2 rounded border border-zinc-200 p-4 text-sm sm:grid-cols-4 dark:border-zinc-800"
          >
            <div className="col-span-2 text-base font-medium text-zinc-900 sm:col-span-4 dark:text-zinc-100">
              {a.name ?? "Pass"}{" "}
              <span className="text-zinc-400">({a.activity_type})</span>
            </div>
            <Stat label="Distans" value={formatKm(a.distance_meters)} />
            <Stat label="Tid" value={formatDuration(a.duration_seconds)} />
            <Stat label="Snittpace" value={formatPace(a.avg_pace_seconds_per_km)} />
            <Stat
              label="Puls"
              value={
                a.avg_hr ? `${Math.round(a.avg_hr)} (max ${Math.round(a.max_hr ?? 0)})` : "–"
              }
            />
            <Stat
              label="Träningseffekt"
              value={
                a.aerobic_training_effect
                  ? `${a.aerobic_training_effect.toFixed(1)} (${a.training_effect_label ?? ""})`
                  : "–"
              }
            />
            <Stat
              label="Kadens"
              value={a.avg_cadence ? `${Math.round(a.avg_cadence)} spm` : "–"}
            />
            <Stat
              label="Höjdmeter"
              value={a.elevation_gain != null ? `${Math.round(a.elevation_gain)} m` : "–"}
            />
            <Stat label="Kalorier" value={a.calories ? `${Math.round(a.calories)}` : "–"} />

            {a.activity_splits?.length > 0 && (
              <div className="col-span-2 mt-2 sm:col-span-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-left text-zinc-500 dark:text-zinc-400">
                      <th className="pr-3 font-normal">#</th>
                      <th className="pr-3 font-normal">Distans</th>
                      <th className="pr-3 font-normal">Tid</th>
                      <th className="pr-3 font-normal">Pace</th>
                      <th className="font-normal">Puls</th>
                    </tr>
                  </thead>
                  <tbody>
                    {a.activity_splits
                      .sort(
                        (x: { split_index: number }, y: { split_index: number }) =>
                          x.split_index - y.split_index,
                      )
                      .map(
                        (s: {
                          split_index: number;
                          distance_meters: number | null;
                          duration_seconds: number | null;
                          avg_pace_seconds_per_km: number | null;
                          avg_hr: number | null;
                        }) => (
                          <tr key={s.split_index} className="border-t border-zinc-100 dark:border-zinc-800">
                            <td className="py-1 pr-3">{s.split_index}</td>
                            <td className="pr-3">{formatKm(s.distance_meters)}</td>
                            <td className="pr-3">{formatDuration(s.duration_seconds)}</td>
                            <td className="pr-3">{formatPace(s.avg_pace_seconds_per_km)}</td>
                            <td>{s.avg_hr ? Math.round(s.avg_hr) : "–"}</td>
                          </tr>
                        ),
                      )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Träningsdagbok
        </h2>
        <form
          action={saveDiaryEntry}
          className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800"
        >
          <input type="hidden" name="entry_date" value={dateStr} />
          <input type="hidden" name="entry_id" value={diaryEntry?.id ?? ""} />

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              Dagtyp
              <select
                name="day_type"
                defaultValue={diaryEntry?.day_type ?? ""}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              >
                {DAY_TYPE_OPTIONS.map((opt) => (
                  <option key={opt.value} value={opt.value}>
                    {opt.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              RPE (1–10)
              <input
                type="number"
                name="rpe"
                min={1}
                max={10}
                defaultValue={diaryEntry?.rpe ?? ""}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Humör
              <input
                type="text"
                name="mood"
                defaultValue={diaryEntry?.mood ?? ""}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Sömn (timmar)
              <input
                type="number"
                step="0.5"
                name="sleep_hours"
                defaultValue={diaryEntry?.sleep_hours ?? ""}
                className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              />
            </label>
          </div>

          <label className="flex flex-col gap-1 text-sm">
            Anteckningar
            <textarea
              name="notes"
              rows={4}
              defaultValue={diaryEntry?.notes ?? ""}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>

          <button
            type="submit"
            className="w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Spara
          </button>
        </form>
      </section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-zinc-900 dark:text-zinc-100">{value}</div>
    </div>
  );
}
