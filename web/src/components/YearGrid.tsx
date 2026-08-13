"use client";

import Link from "next/link";
import { useState } from "react";
import {
  SV_MONTHS,
  dateKey,
  daysInMonth,
  firstWeekdayOfMonth,
} from "@/lib/calendar-utils";
import { BLOCK_LABELS, BLOCK_COLOR_VARS, BLOCK_TYPES, type BlockType } from "@/lib/planning";

export type YearOutcome = "trained" | "competed" | "sick" | "injured";

/* "Tävlade" får en egen, tydligt skild färg från "Tränade" — båda är gröna i
 * passkategori-paletten (--cat-race ligger nära emerald), vilket hade gjort
 * dem svåra att skilja åt i en 16px ruta. Sjuk/skadad återanvänder samma
 * gult/rött som resten av kalendern (lib/calendar-utils.ts STATUS_COLOR). */
const OUTCOME_COLOR: Record<YearOutcome, string> = {
  trained: "bg-emerald-500",
  competed: "bg-violet-600",
  sick: "bg-amber-500",
  injured: "bg-red-600",
};

const OUTCOME_LABEL: Record<YearOutcome, string> = {
  trained: "Tränade",
  competed: "Tävlade",
  sick: "Sjuk",
  injured: "Skadad",
};

export type PlannedDay = {
  colorVar: string | null;
  label: string;
};

export type BlockDay = {
  blockType: BlockType;
  name: string;
};

type View = "traning" | "block";

const TOGGLE_LABEL: Record<View, string> = {
  traning: "Träning",
  block: "Block",
};

export function YearGrid({
  year,
  todayKey,
  goalDateKey,
  outcomeByDate,
  plannedByDate,
  blockByDate,
  competitionNamesByDate,
}: {
  year: number;
  todayKey: string;
  goalDateKey: string | null;
  outcomeByDate: Record<string, YearOutcome>;
  plannedByDate: Record<string, PlannedDay>;
  blockByDate: Record<string, BlockDay>;
  competitionNamesByDate: Record<string, string[]>;
}) {
  const [view, setView] = useState<View>("traning");

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded border border-zinc-200 p-0.5 text-xs font-medium dark:border-zinc-800">
          {(["traning", "block"] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={`rounded px-3 py-1 ${
                view === v
                  ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
                  : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100"
              }`}
            >
              {TOGGLE_LABEL[v]}
            </button>
          ))}
        </div>

        {view === "traning" ? (
          <div className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
            {(Object.keys(OUTCOME_LABEL) as YearOutcome[]).map((key) => (
              <span key={key} className="flex items-center gap-1">
                <span className={`h-3 w-3 rounded-sm ${OUTCOME_COLOR[key]}`} />
                {OUTCOME_LABEL[key]}
              </span>
            ))}
            <span className="flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm border-2 border-zinc-400 dark:border-zinc-500" />
              Planerat pass (framåt)
            </span>
          </div>
        ) : (
          <div className="flex flex-wrap gap-3 text-xs text-zinc-600 dark:text-zinc-400">
            {BLOCK_TYPES.map((type) => (
              <span key={type} className="flex items-center gap-1">
                <span
                  className="h-3 w-3 rounded-sm"
                  style={{ backgroundColor: BLOCK_COLOR_VARS[type] }}
                />
                {BLOCK_LABELS[type]}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
        {SV_MONTHS.map((monthName, idx) => {
          const month = idx + 1;
          const numDays = daysInMonth(year, month);
          const offset = firstWeekdayOfMonth(year, month);
          const cells: Array<number | null> = [
            ...Array.from({ length: offset }, () => null),
            ...Array.from({ length: numDays }, (_, i) => i + 1),
          ];

          return (
            <div key={month} className="flex flex-col gap-2">
              <Link
                href={`/calendar/${year}/${month}`}
                className="text-sm font-medium text-zinc-800 hover:underline dark:text-zinc-200"
              >
                {monthName}
              </Link>
              <div className="grid grid-cols-7 gap-1">
                {cells.map((day, i) => {
                  if (day === null) {
                    return <span key={`empty-${i}`} />;
                  }
                  const key = dateKey(year, month, day);
                  const isGoalDay = goalDateKey === key;
                  const dayHref = `/calendar/${year}/${month}/${day}`;

                  if (view === "block") {
                    const block = blockByDate[key];
                    return (
                      <Link
                        key={key}
                        href={dayHref}
                        title={`${key}${block ? ` – ${block.name}` : ""}`}
                        className={`h-4 w-4 rounded-sm ${
                          block ? "" : "bg-zinc-100 dark:bg-zinc-800"
                        } ${isGoalDay ? "ring-2 ring-amber-500" : ""}`}
                        style={
                          block ? { backgroundColor: BLOCK_COLOR_VARS[block.blockType] } : undefined
                        }
                      />
                    );
                  }

                  const outcome = outcomeByDate[key];
                  // Samma gräns som resten av kalendern (isPastDay i
                  // dag-/veckovyerna): dagens datum räknas som "framåt" tills
                  // det faktiskt har ett utfall.
                  const planned = !outcome && key >= todayKey ? plannedByDate[key] : undefined;
                  const compNames = competitionNamesByDate[key];
                  return (
                    <Link
                      key={key}
                      href={dayHref}
                      title={`${key}${
                        outcome === "competed" && compNames?.length
                          ? ` – ${compNames.join(", ")}`
                          : outcome
                            ? ` – ${OUTCOME_LABEL[outcome]}`
                            : planned
                              ? ` – Planerat: ${planned.label}`
                              : ""
                      }`}
                      className={`h-4 w-4 rounded-sm ${
                        outcome ? OUTCOME_COLOR[outcome] : "bg-zinc-100 dark:bg-zinc-800"
                      } ${isGoalDay ? "ring-2 ring-amber-500" : ""}`}
                      style={
                        planned?.colorVar
                          ? { boxSizing: "border-box", border: `2px solid ${planned.colorVar}` }
                          : undefined
                      }
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
