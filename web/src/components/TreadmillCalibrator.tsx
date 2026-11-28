"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BeltCounter } from "@/components/BeltCounter";
import { buttonClass, fieldClass, primaryButtonClass } from "@/components/ui/controls";
import {
  fitCalibration,
  kmhFrom,
  kmhToPace,
  parseBeltSpeed,
  revolutionsFrom,
  type CalibrationPoint,
} from "@/lib/treadmill";
import { saveCalibration, saveLoadedCheck } from "@/app/(app)/lopband/actions";

/* Mätningen av ett löpband, steg för steg (2026-11-28). Se lib/treadmill.ts
 * för räkningen och BeltCounter för själva varvräkningen.
 *
 * Tre lägen:
 * - nytt band: namn och längd först, sedan farterna
 * - mät igen: samma band och längd, nya farter
 * - kontroll med löpare: en enda fart, jämförd med linjen för tomt band */

export function pace(kmh: number): string {
  const s = Math.round(kmhToPace(kmh));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
export const kmhLabel = (kmh: number) => kmh.toFixed(1).replace(".", ",");

/** "Bandet går 2,4 % långsammare än det visar vid 4:00/km." */
export function deviationText(actual: number, set: number): string {
  const pct = (actual / set - 1) * 100;
  const at = `vid ${pace(set)}/km`;
  if (Math.abs(pct) < 0.5) return `Bandet går i stort sett rätt ${at}.`;
  return `Bandet går ${Math.abs(pct).toFixed(1).replace(".", ",")} % ${pct < 0 ? "långsammare" : "fortare"} än det visar ${at}.`;
}

type Mode =
  | { kind: "new" }
  | { kind: "again"; treadmillId: string; name: string; beltLengthCm: number }
  | { kind: "loaded"; calibrationId: string; name: string; beltLengthCm: number };

export function TreadmillCalibrator({ mode, athlete, onClose }: { mode: Mode; athlete: string | null; onClose: () => void }) {
  const router = useRouter();
  const [name, setName] = useState(mode.kind === "new" ? "" : mode.name);
  const [lengthText, setLengthText] = useState(mode.kind === "new" ? "" : String(mode.beltLengthCm));
  const length = Number(lengthText.replace(",", "."));
  const lengthOk = length >= 100 && length <= 1000;
  const [points, setPoints] = useState<CalibrationPoint[]>([]);
  const [speedText, setSpeedText] = useState("");
  const [measuring, setMeasuring] = useState<null | "kamera" | "knack">(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const speed = parseBeltSpeed(speedText);
  const fit = fitCalibration(points);
  const single = mode.kind === "loaded";

  function finish(times: number[], method: "kamera" | "knack") {
    setMeasuring(null);
    const r = revolutionsFrom(times);
    if (!r || !speed) {
      setError("Varven gick inte att räkna ut. Mät den farten igen.");
      return;
    }
    setError(null);
    setPoints((prev) => [
      ...prev,
      { setKmh: speed.kmh, actualKmh: kmhFrom(length, r.period), revs: r.revs, seconds: r.seconds, method },
    ]);
    setSpeedText("");
  }

  function save() {
    setError(null);
    start(async () => {
      const res =
        mode.kind === "loaded"
          ? await saveLoadedCheck({ calibrationId: mode.calibrationId, point: points[0] })
          : await saveCalibration({
              treadmillId: mode.kind === "again" ? mode.treadmillId : null,
              newBand: mode.kind === "new" ? { name, beltLengthCm: length } : null,
              beltLengthCm: length,
              points,
              athlete,
            });
      if (!res.ok) setError(res.error);
      else {
        router.refresh();
        onClose();
      }
    });
  }

  const canMeasure = lengthOk && speed != null && (!single || points.length === 0);

  return (
    <div className="flex flex-col gap-5 rounded-[14px] border border-[var(--line)] p-4">
      {mode.kind === "new" ? (
        <div className="flex flex-col gap-3">
          <h3 className="display text-lg font-semibold text-[var(--foreground)]">1. Bandet</h3>
          <label className="flex flex-col gap-1 text-sm">
            Namn
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Friidrottshuset, band 2" className={fieldClass} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Bandets längd runt, i centimeter
            <input value={lengthText} onChange={(e) => setLengthText(e.target.value)} inputMode="decimal" placeholder="305" className={`${fieldClass} w-32`} />
          </label>
          <details className="text-sm text-[var(--ink-2)]">
            <summary className="cursor-pointer">Så mäter du bandet</summary>
            <ol className="mt-2 flex list-decimal flex-col gap-1 pl-5">
              <li>Stäng av bandet och dra ut säkerhetsnyckeln.</li>
              <li>Gör ett tydligt kritstreck tvärs över bandet, och en tejpbit på ramen precis bredvid.</li>
              <li>Mät från strecket längs bandet och sätt ett nytt litet streck vid måttbandets slut. Dra bandet för hand och mät vidare därifrån.</li>
              <li>Fortsätt tills första strecket är tillbaka vid tejpen. Summan är bandets längd.</li>
              <li>Mät på centimetern. En centimeter fel ger ungefär en sekund fel per kilometer.</li>
            </ol>
          </details>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          <h3 className="display text-lg font-semibold text-[var(--foreground)]">
            {single ? `Kontroll med löpare · ${mode.name}` : `Mät igen · ${mode.name}`}
          </h3>
          <p className="text-sm text-[var(--ink-2)]">
            {single
              ? "Löparen springer på bandet och någon annan mäter. En fart räcker, gärna nära tröskelfarten."
              : `Bandets längd ${mode.beltLengthCm} cm.`}
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3">
        <h3 className="display text-lg font-semibold text-[var(--foreground)]">{mode.kind === "new" ? "2. Farterna" : "Farten"}</h3>
        {!single && (
          <p className="text-sm text-[var(--ink-2)]">
            {mode.kind === "new" ? "Gärna på tomt band. " : ""}Mät tre farter eller fler, till exempel 5:00, 4:00 och 3:15 per km. Fler
            farter ger en säkrare linje.
          </p>
        )}

        {points.length > 0 && (
          <table className="tabular w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-[var(--ink-3)]">
                <th className="font-normal">Bandet visar</th>
                <th className="font-normal">Verklig fart</th>
                <th className="font-normal">Varv</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {points.map((p, i) => (
                <tr key={i} className="border-t border-[var(--line)]">
                  <td className="py-1.5">{pace(p.setKmh)}/km</td>
                  <td className="py-1.5 font-semibold text-[var(--foreground)]">{pace(p.actualKmh)}/km</td>
                  <td className="py-1.5 text-[var(--ink-2)]">
                    {p.revs} på {Math.round(p.seconds)} s
                  </td>
                  <td className="py-1.5 text-right">
                    <button type="button" className="text-xs text-[var(--ink-2)] underline" onClick={() => setPoints(points.filter((_, j) => j !== i))}>
                      Ta bort
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {measuring ? (
          <>
            <p className="text-sm font-semibold text-[var(--foreground)]">
              Bandet på {speed ? `${pace(speed.kmh)}/km (${kmhLabel(speed.kmh)} km/h)` : speedText}
            </p>
            <BeltCounter method={measuring} onDone={finish} onCancel={() => setMeasuring(null)} />
          </>
        ) : (
          (!single || points.length === 0) && (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-sm">
                Vad bandet är inställt på
                <input value={speedText} onChange={(e) => setSpeedText(e.target.value)} placeholder="4:00 eller 15,0" inputMode="decimal" className={`${fieldClass} w-40`} />
                <span className="text-xs text-[var(--ink-3)]">
                  {speed ? `${pace(speed.kmh)}/km · ${kmhLabel(speed.kmh)} km/h` : "min/km eller km/h, som bandet visar"}
                </span>
              </label>
              {!lengthOk && mode.kind === "new" && <p className="text-xs text-[var(--ink-3)]">Fyll i bandets längd först.</p>}
              <div className="flex flex-wrap gap-2">
                <button type="button" className={buttonClass} disabled={!canMeasure} style={{ opacity: canMeasure ? 1 : 0.4 }} onClick={() => setMeasuring("kamera")}>
                  Mät med kameran
                </button>
                <button type="button" className={buttonClass} disabled={!canMeasure} style={{ opacity: canMeasure ? 1 : 0.4 }} onClick={() => setMeasuring("knack")}>
                  Mät genom att knacka
                </button>
              </div>
            </div>
          )
        )}
      </div>

      {!single && fit && points.length >= 1 && !measuring && (
        <div className="flex flex-col gap-1 text-sm text-[var(--ink-2)]">
          <p>{deviationText(fit.slope * 15 + fit.intercept, 15)}</p>
          {points.length < 3 && <p className="text-xs text-[var(--ink-3)]">Med färre än tre farter går det inte att se om linjen passar alla farter.</p>}
          {fit.maxResidualKmh != null && fit.maxResidualKmh > 0.15 && (
            <p className="text-xs text-[var(--ink-3)]">
              En fart ligger {kmhLabel(fit.maxResidualKmh)} km/h från linjen. Mät den gärna igen.
            </p>
          )}
        </div>
      )}

      {error && <p className="text-sm text-[var(--foreground)]">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className={primaryButtonClass}
          disabled={pending || points.length === 0 || (mode.kind === "new" && !name.trim())}
          style={{ opacity: pending || points.length === 0 ? 0.4 : 1 }}
          onClick={save}
        >
          {pending ? "Sparar…" : "Spara"}
        </button>
        <button type="button" className={buttonClass} onClick={onClose}>
          Avbryt
        </button>
      </div>
    </div>
  );
}
