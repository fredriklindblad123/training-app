"use client";

import { useState } from "react";
import { RaceProgressionChart, type RaceProgressionSeries } from "@/components/charts/RaceProgressionChart";

/* Grenval och banfilter för grenutvecklingen (2026-11-23).
 *
 * VARFÖR I WEBBLÄSAREN. Förut var varje gren en länk: ett tryck laddade om
 * hela Lopp-sidan från servern, med tävlingar, träningsdata och
 * upptrappning, och chipen svarade först när allt kommit tillbaka. Med tre
 * grenar att välja blev det tre sidladdningar ("trögt, långsamt och svårt
 * att få till"). Nu skickar servern alla grenars lopp en gång, och valet
 * byter bara vilka kurvor som ritas. URL:en uppdateras med replaceState så
 * att valet följer med om sidan laddas om eller delas — utan att servern
 * anropas.
 *
 * KOMPAKT. Grenarna med flest lopp syns direkt; resten ligger under "Fler
 * grenar". Vald gren bär sin kurvas färg som en prick, inte som en helfylld
 * knapp, så att raden går att läsa även när flera är valda. */

const VISIBLE = 5;

type Bana = "alla" | "inne" | "ute";

export function RaceProgressionPicker({
  series,
  counts,
  initialSelected,
  initialBana,
}: {
  /** En serie per valbar gren, med ALLA lopp (inne och ute). */
  series: RaceProgressionSeries[];
  /** Antal tidtagna lopp per gren, för etiketten. */
  counts: Record<string, number>;
  initialSelected: string[];
  initialBana: Bana;
}) {
  const [selected, setSelected] = useState<string[]>(initialSelected);
  const [bana, setBana] = useState<Bana>(initialBana);
  const hiddenSelected = series.slice(VISIBLE).some((s) => initialSelected.includes(s.event));
  const [showAll, setShowAll] = useState(hiddenSelected);

  function syncUrl(nextSelected: string[], nextBana: Bana) {
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("gren");
      if (nextSelected.length === 0) url.searchParams.append("gren", "inga");
      else for (const e of nextSelected) url.searchParams.append("gren", e);
      if (nextBana === "alla") url.searchParams.delete("bana");
      else url.searchParams.set("bana", nextBana);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // Valet fungerar ändå — det följer bara inte med vid omladdning.
    }
  }

  function toggle(event: string) {
    const next = selected.includes(event) ? selected.filter((e) => e !== event) : [...selected, event];
    setSelected(next);
    syncUrl(next, bana);
  }

  function only(event: string) {
    setSelected([event]);
    syncUrl([event], bana);
  }

  function pickBana(b: Bana) {
    setBana(b);
    syncUrl(selected, b);
  }

  const venue = bana === "inne" ? "indoor" : bana === "ute" ? "outdoor" : null;
  const shown = series
    .filter((s) => selected.includes(s.event))
    .map((s) => ({ ...s, points: venue ? s.points.filter((p) => p.venue === venue) : s.points }));
  const options = showAll ? series : series.slice(0, VISIBLE);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-xs text-[var(--ink-3)]">
            Grenar · tryck för att lägga till eller ta bort
          </span>
          {selected.length > 1 && (
            <button
              type="button"
              onClick={() => only(selected[selected.length - 1])}
              className="text-xs text-[var(--ink-2)] underline underline-offset-2"
            >
              Visa bara {selected[selected.length - 1]}
            </button>
          )}
        </div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Grenar">
          {options.map((s) => {
            const active = selected.includes(s.event);
            return (
              <button
                key={s.event}
                type="button"
                aria-pressed={active}
                onClick={() => toggle(s.event)}
                className={`flex min-h-9 items-center gap-1.5 rounded-full border px-3 text-sm ${
                  active
                    ? "border-[var(--foreground)] bg-[var(--surface-raised)] font-semibold text-[var(--foreground)]"
                    : "border-[var(--line)] text-[var(--ink-2)] hover:text-[var(--foreground)]"
                }`}
              >
                <span
                  aria-hidden
                  className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                  style={active ? { backgroundColor: s.color } : { border: "1.5px solid var(--ink-3)" }}
                />
                {s.event}
                <span className="text-xs font-normal text-[var(--ink-3)]">{counts[s.event]}</span>
              </button>
            );
          })}
          {series.length > VISIBLE && (
            <button
              type="button"
              onClick={() => setShowAll((v) => !v)}
              className="min-h-9 rounded-full px-2 text-sm text-[var(--ink-2)] underline underline-offset-2"
            >
              {showAll ? "Färre" : `Fler grenar (${series.length - VISIBLE})`}
            </button>
          )}
        </div>
      </div>

      <div role="group" aria-label="Bana" className="inline-flex self-start rounded-[9px] bg-[var(--surface-raised)] p-[2px]">
        {(
          [
            { key: "alla", label: "Inne och ute" },
            { key: "inne", label: "Inomhus" },
            { key: "ute", label: "Utomhus" },
          ] as const
        ).map((b) => (
          <button
            key={b.key}
            type="button"
            aria-pressed={bana === b.key}
            onClick={() => pickBana(b.key)}
            className={`flex min-h-8 items-center rounded-[7px] px-2.5 text-xs ${
              bana === b.key
                ? "bg-[var(--surface)] font-semibold text-[var(--foreground)] shadow-sm"
                : "text-[var(--ink-2)] hover:text-[var(--foreground)]"
            }`}
          >
            {b.label}
          </button>
        ))}
      </div>

      {selected.length === 0 ? (
        <p className="text-sm text-[var(--ink-3)]">Välj en gren ovanför för att se kurvan.</p>
      ) : (
        <RaceProgressionChart series={shown} emptyLabel="Inga lopp i de valda grenarna med det valda banfiltret." />
      )}
    </div>
  );
}
