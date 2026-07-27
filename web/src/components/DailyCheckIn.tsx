"use client";

import { useState, useTransition } from "react";
import { saveCheckIn, type SaveCheckInResult } from "@/app/(app)/calendar/checkin-actions";

type ScoreKey = "feeling" | "effort" | "soreness" | "motivation";

type Scores = Record<ScoreKey, number | null>;

type CheckInStats = { streakDays: number; weeklyAvgFeeling: number | null };

// Två färgskalor med olika betydelse: "må bra"-frågorna (känsla, motivation)
// går rött→grönt (dåligt→bra), medan "intensitets"-frågorna (ansträngning,
// ömhet) går kallt→hett (lågt→högt) — högt är inte "bra" för de senare, bara
// mer. Samma femgradiga knapprads-mönster (ord + färg) återanvänds i alla
// fyra, enligt P0.4:s krav på tryckbara knappar istället för sifferfält.
const WELLBEING_COLORS = [
  "bg-red-600",
  "bg-orange-500",
  "bg-amber-400",
  "bg-lime-500",
  "bg-emerald-600",
];

const INTENSITY_COLORS = [
  "bg-sky-400",
  "bg-teal-500",
  "bg-amber-400",
  "bg-orange-500",
  "bg-red-600",
];

const QUESTIONS: {
  key: ScoreKey;
  label: string;
  words: [string, string, string, string, string];
  colors: string[];
}[] = [
  {
    key: "feeling",
    label: "Känsla i kroppen",
    words: ["Uselt", "Dåligt", "Okej", "Bra", "Superbra"],
    colors: WELLBEING_COLORS,
  },
  {
    key: "effort",
    label: "Ansträngning i dagens pass",
    words: ["Väldigt lätt", "Lätt", "Måttlig", "Hård", "Maximal"],
    colors: INTENSITY_COLORS,
  },
  {
    key: "soreness",
    label: "Muskelömhet",
    words: ["Ingen alls", "Lite", "Märkbar", "Öm", "Mycket öm"],
    colors: INTENSITY_COLORS,
  },
  {
    key: "motivation",
    label: "Motivation/ork",
    words: ["Ingen ork", "Låg", "Neutral", "Pigg", "Superpigg"],
    colors: WELLBEING_COLORS,
  },
];

function feelingComparisonText(today: number, weeklyAvg: number): string {
  const diff = today - weeklyAvg;
  const avgText = weeklyAvg.toFixed(1);
  if (Math.abs(diff) < 0.3) {
    return `Känslan idag ligger ungefär som ditt snitt senaste veckan (${avgText}).`;
  }
  if (diff > 0) {
    return `Känslan idag ligger över ditt snitt senaste veckan (${avgText}).`;
  }
  return `Känslan idag ligger under ditt snitt senaste veckan (${avgText}).`;
}

export function DailyCheckIn({
  entryDate,
  initialDone,
  initialScores,
  initialStats,
}: {
  entryDate: string;
  initialDone: boolean;
  initialScores: Scores;
  initialStats: CheckInStats;
}) {
  const [scores, setScores] = useState<Scores>(initialScores);
  const [done, setDone] = useState(initialDone);
  const [editing, setEditing] = useState(false);
  const [stats, setStats] = useState<CheckInStats>(initialStats);
  const [isPending, startTransition] = useTransition();

  function pick(key: ScoreKey, value: number) {
    const next = { ...scores, [key]: value };
    setScores(next);

    if (
      next.feeling != null &&
      next.effort != null &&
      next.soreness != null &&
      next.motivation != null
    ) {
      const { feeling, effort, soreness, motivation } = next;
      startTransition(async () => {
        const result: SaveCheckInResult = await saveCheckIn({
          entryDate,
          feeling,
          effort,
          soreness,
          motivation,
        });
        if (result.ok) {
          setStats({ streakDays: result.streakDays, weeklyAvgFeeling: result.weeklyAvgFeeling });
          setDone(true);
          setEditing(false);
        }
      });
    }
  }

  if (done && !editing) {
    return (
      <section className="flex flex-col gap-2 rounded border border-emerald-600/40 bg-emerald-50 p-4 dark:border-emerald-500/30 dark:bg-emerald-950/30">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
            Dagens incheckning klar
            {stats.streakDays > 1 ? ` — ${stats.streakDays}:e dagen i rad` : ""}
          </p>
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="text-xs text-zinc-500 underline hover:text-zinc-950 dark:hover:text-zinc-50"
          >
            ändra
          </button>
        </div>
        {stats.weeklyAvgFeeling != null && scores.feeling != null && (
          <p className="text-xs text-zinc-600 dark:text-zinc-400">
            {feelingComparisonText(scores.feeling, stats.weeklyAvgFeeling)}
          </p>
        )}
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
      <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">
        Dagens incheckning
        {isPending && <span className="ml-2 text-xs text-zinc-400">sparar…</span>}
      </p>
      {QUESTIONS.map((q) => (
        <div key={q.key} className="flex flex-col gap-1">
          <span className="text-xs text-zinc-500 dark:text-zinc-400">{q.label}</span>
          <div className="grid grid-cols-5 gap-1">
            {q.words.map((word, i) => {
              const value = i + 1;
              const selected = scores[q.key] === value;
              return (
                <button
                  key={value}
                  type="button"
                  disabled={isPending}
                  onClick={() => pick(q.key, value)}
                  className={`flex flex-col items-center gap-0.5 rounded px-1 py-2 text-[10px] font-medium text-white ${q.colors[i]} ${
                    selected
                      ? "ring-2 ring-zinc-950 ring-offset-1 dark:ring-zinc-50"
                      : "opacity-80 hover:opacity-100"
                  }`}
                >
                  <span className="text-sm font-semibold">{value}</span>
                  <span className="text-center leading-tight">{word}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </section>
  );
}
