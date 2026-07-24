import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { formatDuration, formatKm } from "@/lib/format";
import { SV_MONTHS, pad2 } from "@/lib/calendar-utils";

type Period = "year" | "month" | "week";

function fmtDate(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function getRange(
  period: Period,
  anchor: Date,
): { start: string; endExclusive: string; label: string } {
  if (period === "year") {
    const y = anchor.getFullYear();
    return { start: `${y}-01-01`, endExclusive: `${y + 1}-01-01`, label: `${y}` };
  }
  if (period === "month") {
    const y = anchor.getFullYear();
    const m = anchor.getMonth() + 1;
    const next = m === 12 ? { y: y + 1, m: 1 } : { y, m: m + 1 };
    return {
      start: `${y}-${pad2(m)}-01`,
      endExclusive: `${next.y}-${pad2(next.m)}-01`,
      label: `${SV_MONTHS[m - 1]} ${y}`,
    };
  }
  const jsDay = anchor.getDay();
  const diffToMonday = (jsDay + 6) % 7;
  const monday = new Date(anchor);
  monday.setDate(anchor.getDate() - diffToMonday);
  const nextMonday = new Date(monday);
  nextMonday.setDate(monday.getDate() + 7);
  return {
    start: fmtDate(monday),
    endExclusive: fmtDate(nextMonday),
    label: `Vecka från ${fmtDate(monday)}`,
  };
}

function shiftAnchor(period: Period, anchor: Date, dir: 1 | -1): Date {
  const d = new Date(anchor);
  if (period === "year") d.setFullYear(d.getFullYear() + dir);
  else if (period === "month") d.setMonth(d.getMonth() + dir);
  else d.setDate(d.getDate() + dir * 7);
  return d;
}

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; date?: string }>;
}) {
  const { period: periodParam, date: dateParam } = await searchParams;
  const period: Period =
    periodParam === "month" || periodParam === "week" ? periodParam : "year";
  const anchor = dateParam ? new Date(`${dateParam}T00:00:00`) : new Date();

  const { start, endExclusive, label } = getRange(period, anchor);
  const prevAnchor = shiftAnchor(period, anchor, -1);
  const nextAnchor = shiftAnchor(period, anchor, 1);

  const supabase = await createClient();
  const { data: activities } = await supabase
    .from("activities")
    .select("distance_meters, duration_seconds, activity_type")
    .gte("start_time", start)
    .lt("start_time", endExclusive);

  const totalDistance = (activities ?? []).reduce(
    (sum, a) => sum + (a.distance_meters ?? 0),
    0,
  );
  const totalDuration = (activities ?? []).reduce(
    (sum, a) => sum + (a.duration_seconds ?? 0),
    0,
  );
  const sessionCount = activities?.length ?? 0;

  const byType = new Map<string, { count: number; distance: number }>();
  for (const a of activities ?? []) {
    const type = a.activity_type ?? "okänd";
    const existing = byType.get(type) ?? { count: 0, distance: 0 };
    existing.count += 1;
    existing.distance += a.distance_meters ?? 0;
    byType.set(type, existing);
  }

  return (
    <div className="flex flex-1 flex-col gap-6 px-6 py-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          Statistik
        </h1>
        <div className="flex gap-2 text-sm">
          {(["week", "month", "year"] as Period[]).map((p) => (
            <Link
              key={p}
              href={`/stats?period=${p}`}
              className={`rounded px-3 py-1 ${
                period === p
                  ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                  : "border border-zinc-300 dark:border-zinc-700"
              }`}
            >
              {p === "week" ? "Vecka" : p === "month" ? "Månad" : "År"}
            </Link>
          ))}
        </div>
      </div>

      <div className="flex items-center gap-4">
        <Link
          href={`/stats?period=${period}&date=${fmtDate(prevAnchor)}`}
          className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
        >
          ←
        </Link>
        <span className="font-medium text-zinc-900 dark:text-zinc-100">
          {label}
        </span>
        <Link
          href={`/stats?period=${period}&date=${fmtDate(nextAnchor)}`}
          className="text-zinc-500 hover:text-zinc-950 dark:hover:text-zinc-50"
        >
          →
        </Link>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatTile label="Distans" value={formatKm(totalDistance)} />
        <StatTile label="Tid" value={formatDuration(totalDuration)} />
        <StatTile label="Antal pass" value={`${sessionCount}`} />
      </div>

      {byType.size > 0 && (
        <div className="flex flex-col gap-2">
          <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
            Per aktivitetstyp
          </h2>
          <table className="w-full max-w-md text-sm">
            <tbody>
              {[...byType.entries()].map(([type, stats]) => (
                <tr
                  key={type}
                  className="border-t border-zinc-100 dark:border-zinc-800"
                >
                  <td className="py-1 pr-4">{type}</td>
                  <td className="pr-4">{stats.count} pass</td>
                  <td>{formatKm(stats.distance)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function StatTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <div className="text-xs text-zinc-500 dark:text-zinc-400">{label}</div>
      <div className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">
        {value}
      </div>
    </div>
  );
}
