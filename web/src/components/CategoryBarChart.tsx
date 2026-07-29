"use client";

import { useState } from "react";
import Link from "next/link";
import {
  CATEGORY_LABELS,
  CATEGORY_VALUES,
  categoryColorVar,
  type ActivityCategory,
} from "@/lib/categories";
import { formatDuration } from "@/lib/format";

export type SessionDatum = {
  id: string;
  date: string;
  name: string | null;
  km: number;
  seconds: number;
};

export type CategoryDatum = {
  category: ActivityCategory;
  km: number;
  seconds: number;
  count: number;
  sessions: SessionDatum[];
};

type Metric = "distance" | "time";

/** "2026-01-05" -> "/calendar/2026/1/5". Dagvyn tar månad och dag utan
 * inledande nollor. */
function dayHref(date: string): string {
  const [y, m, d] = date.split("-");
  return `/calendar/${y}/${Number(m)}/${Number(d)}`;
}

function metricValue(d: CategoryDatum, metric: Metric): number {
  return metric === "distance" ? d.km : d.seconds;
}

function formatMetric(value: number, metric: Metric): string {
  return metric === "distance" ? `${value.toFixed(1)} km` : formatDuration(value);
}

/** En enda liggande stapel, fördelad mellan kategorierna efter andel — inte
 * ett tårtdiagram och inte en stapel per kategori. Bara stapeln syns i
 * förstaintrycket; klick på den fäller ut namn/värde/andel per kategori,
 * samma "detaljerad analys bakom klick"-princip som KpiRing. Klick på en
 * kategori-rad där under fäller i sin tur ut passen i den kategorin. */
export function CategoryBarChart({
  data,
  metric,
}: {
  data: CategoryDatum[];
  metric: Metric;
}) {
  const [expanded, setExpanded] = useState<ActivityCategory | null>(null);

  // Fast kategoriordning oavsett vilka som förekommer — identitet ska aldrig
  // hoppa mellan kategorier när urvalet ändras.
  const rows = CATEGORY_VALUES.map((category) =>
    data.find((d) => d.category === category),
  ).filter((d): d is CategoryDatum => !!d && metricValue(d, metric) > 0);

  if (rows.length === 0) {
    return (
      <p className="text-sm text-zinc-500 dark:text-zinc-400">
        Inga kategoriserade pass i den här perioden.
      </p>
    );
  }

  const total = rows.reduce((sum, d) => sum + metricValue(d, metric), 0);

  return (
    <details className="group">
      <summary className="flex cursor-pointer list-none rounded-lg p-1 hover:bg-zinc-50 dark:hover:bg-zinc-900 [&::-webkit-details-marker]:hidden">
        <div className="flex h-3 w-full overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          {rows.map((d) => {
            const value = metricValue(d, metric);
            const share = value / total;
            return (
              <div
                key={d.category}
                className="h-full"
                style={{ width: `${share * 100}%`, backgroundColor: categoryColorVar(d.category) }}
              >
                <span className="sr-only">
                  {CATEGORY_LABELS[d.category]}: {formatMetric(value, metric)} (
                  {Math.round(share * 100)}%)
                </span>
              </div>
            );
          })}
        </div>
      </summary>

      <ul className="mt-2 flex flex-col gap-0.5">
        {rows.map((d) => {
          const value = metricValue(d, metric);
          const share = value / total;
          const isOpen = expanded === d.category;
          return (
            <li key={d.category}>
              <details
                open={isOpen}
                onToggle={(e) => setExpanded(e.currentTarget.open ? d.category : null)}
              >
                <summary className="flex cursor-pointer list-none items-center gap-2 rounded px-1 py-0.5 hover:bg-zinc-50 dark:hover:bg-zinc-900 [&::-webkit-details-marker]:hidden">
                  <span
                    className="h-2 w-2 shrink-0 rounded-sm"
                    style={{ backgroundColor: categoryColorVar(d.category) }}
                  />
                  <span className="text-xs text-zinc-600 dark:text-zinc-400">
                    {CATEGORY_LABELS[d.category]}
                  </span>
                  <span className="ml-auto text-xs tabular-nums text-zinc-900 dark:text-zinc-100">
                    {formatMetric(value, metric)} · {Math.round(share * 100)}%
                  </span>
                </summary>
                <ul className="mt-1 ml-4 flex flex-col gap-0.5 border-l border-zinc-100 pl-3 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
                  {d.sessions
                    .slice()
                    .sort((a, b) => a.date.localeCompare(b.date))
                    .map((s) => (
                      <li key={s.id}>
                        <Link
                          href={dayHref(s.date)}
                          className="hover:text-zinc-900 hover:underline dark:hover:text-zinc-100"
                        >
                          {s.date} — {s.name ?? "Pass"}
                        </Link>{" "}
                        · {s.km.toFixed(1)} km · {formatDuration(s.seconds)}
                      </li>
                    ))}
                </ul>
              </details>
            </li>
          );
        })}
      </ul>
    </details>
  );
}
