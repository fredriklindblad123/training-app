"use client";

import { useState } from "react";
import { CATEGORY_LABELS, CATEGORY_VALUES } from "@/lib/categories";

const DAY_TYPE_OPTIONS = [
  { value: "", label: "Ej satt" },
  { value: "training", label: "Träning" },
  { value: "rest", label: "Vila" },
  { value: "sick", label: "Sjuk" },
  { value: "injured", label: "Skadad" },
];

const inputClass =
  "rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900";

// Kategori (+ distans/tid) är en underhierarki av Dagtyp: bara relevant och
// synlig när dagtyp=Träning och det saknas ett synkat Garmin-pass (då
// redigeras kategori istället per-pass i Garmin-data-sektionen).
export function TrainingDayFields({
  defaultDayType,
  defaultCategory,
  defaultDistanceKm,
  defaultDurationMin,
}: {
  defaultDayType: string;
  defaultCategory: string;
  defaultDistanceKm: string;
  defaultDurationMin: string;
}) {
  const [dayType, setDayType] = useState(defaultDayType);

  return (
    <>
      <label className="flex flex-col gap-1 text-sm">
        Dagtyp
        <select
          name="day_type"
          value={dayType}
          onChange={(e) => setDayType(e.target.value)}
          className={inputClass}
        >
          {DAY_TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      {dayType === "training" && (
        <div className="col-span-2 flex flex-col gap-3 border-l-2 border-zinc-200 pl-3 dark:border-zinc-700 sm:col-span-4">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Inget synkat Garmin-pass den här dagen — logga det manuellt:
          </p>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <label className="flex flex-col gap-1 text-sm">
              Kategori
              <select name="category" defaultValue={defaultCategory} className={inputClass}>
                <option value="">Ej satt</option>
                {CATEGORY_VALUES.map((c) => (
                  <option key={c} value={c}>
                    {CATEGORY_LABELS[c]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Distans (km)
              <input
                type="number"
                step="0.1"
                min="0"
                name="distance_km"
                defaultValue={defaultDistanceKm}
                className={inputClass}
              />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Tid (min)
              <input
                type="number"
                min="0"
                name="duration_min"
                defaultValue={defaultDurationMin}
                className={inputClass}
              />
            </label>
          </div>
        </div>
      )}
    </>
  );
}
