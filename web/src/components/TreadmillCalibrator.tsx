"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BeltCounter } from "@/components/BeltCounter";
import { buttonClass, fieldClass, primaryButtonClass } from "@/components/ui/controls";
import { CalibrationCurve } from "@/components/CalibrationCurve";
import { MIN_TEST_SECONDS } from "@/components/BeltCounter";
import {
  MIN_SPEEDS,
  pointProblem,
  revolutionsProblem,
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
  const [secondsText, setSecondsText] = useState(String(MIN_TEST_SECONDS));
  const seconds = Math.round(Number(secondsText.replace(",", ".")));
  const secondsOk = Number.isFinite(seconds) && seconds >= MIN_TEST_SECONDS && seconds <= 600;
  const [measuring, setMeasuring] = useState<null | "kamera" | "knack">(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [treadmillId, setTreadmillId] = useState<string | null>(mode.kind === "again" ? mode.treadmillId : null);
  const [calibrationId, setCalibrationId] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const speed = parseBeltSpeed(speedText);
  const fit = fitCalibration(points);
  const single = mode.kind === "loaded";
  const speeds = new Set(points.map((p) => p.setKmh.toFixed(1))).size;

  /* Sparar automatiskt: kontrollen med löpare direkt, kalibreringen så fort
     tre farter är mätta, och sedan på nytt för varje fart som läggs till
     eller tas bort (samma rad uppdateras). */
  function persist(next: CalibrationPoint[]) {
    if (!single && new Set(next.map((p) => p.setKmh.toFixed(1))).size < MIN_SPEEDS) return;
    start(async () => {
      if (mode.kind === "loaded") {
        const res = await saveLoadedCheck({ calibrationId: mode.calibrationId, point: next[0] });
        if (!res.ok) return setError(res.error);
        router.refresh();
        onClose();
        return;
      }
      const res = await saveCalibration({
        treadmillId,
        calibrationId,
        newBand: treadmillId ? null : { name, beltLengthCm: length },
        beltLengthCm: length,
        points: next,
        athlete,
      });
      if (!res.ok) return setError(res.error);
      setTreadmillId(res.treadmillId);
      setCalibrationId(res.calibrationId);
      setSaved(`Sparat med ${new Set(next.map((p) => p.setKmh.toFixed(1))).size} farter.`);
      router.refresh();
    });
  }

  function finish(times: number[], method: "kamera" | "knack") {
    setMeasuring(null);
    const problem = revolutionsProblem(times);
    const r = revolutionsFrom(times);
    if (problem || !r || !speed) {
      setError(`${problem ?? "Varven gick inte att räkna ut."} Mät den farten igen.`);
      return;
    }
    const actual = kmhFrom(length, r.period);
    const off = pointProblem(speed.kmh, actual);
    if (off) {
      setError(`${off} Mät den farten igen.`);
      return;
    }
    setError(null);
    const next = [...points, { setKmh: speed.kmh, actualKmh: actual, revs: r.revs, seconds: r.seconds, method }];
    setPoints(next);
    setSpeedText("");
    persist(next);
  }

  function remove(i: number) {
    const next = points.filter((_, j) => j !== i);
    setPoints(next);
    persist(next);
  }

  const canMeasure =
    lengthOk && speed != null && secondsOk && (mode.kind !== "new" || name.trim() !== "") && (!single || points.length === 0);

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
                    <button type="button" className="text-xs text-[var(--ink-2)] underline" onClick={() => remove(i)}>
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
            <BeltCounter method={measuring} seconds={seconds} onDone={finish} onCancel={() => setMeasuring(null)} />
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
              <label className="flex flex-col gap-1 text-sm">
                Testtid, sekunder
                <input value={secondsText} onChange={(e) => setSecondsText(e.target.value)} inputMode="numeric" className={`${fieldClass} w-24`} />
                <span className="text-xs text-[var(--ink-3)]">
                  {secondsOk ? "Testet slutar och sparas av sig självt när tiden är ute." : `Minst ${MIN_TEST_SECONDS} sekunder.`}
                </span>
              </label>
              {mode.kind === "new" && (!lengthOk || !name.trim()) && (
                <p className="text-xs text-[var(--ink-3)]">Fyll i bandets namn och längd först.</p>
              )}
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

      {!single && !measuring && (
        <div className="flex flex-col gap-2 text-sm text-[var(--ink-2)]">
          <p className="tabular">
            {speeds} av minst {MIN_SPEEDS} farter mätta
            {speeds < MIN_SPEEDS ? ". Kalibreringen sparas när tre farter är mätta." : "."}
          </p>
          {fit && points.length >= 2 && (
            <>
              <p>{deviationText(fit.slope * 15 + fit.intercept, 15)}</p>
              <CalibrationCurve calibration={{ slope: fit.slope, intercept: fit.intercept, loadedFactor: null }} points={points} />
              {fit.maxResidualKmh != null && fit.maxResidualKmh > 0.15 && (
                <p className="text-xs text-[var(--ink-3)]">
                  En fart ligger {kmhLabel(fit.maxResidualKmh)} km/h från linjen. Mät den gärna igen.
                </p>
              )}
            </>
          )}
        </div>
      )}

      {error && <p className="text-sm text-[var(--foreground)]">{error}</p>}
      {pending && <p className="text-sm text-[var(--ink-2)]">Sparar…</p>}
      {saved && !pending && <p className="text-sm text-[var(--foreground)]">{saved} Lägg gärna till fler farter.</p>}
      {!measuring && (
        <button type="button" className={saved ? primaryButtonClass : buttonClass} onClick={onClose}>
          {saved ? "Klar" : "Avbryt"}
        </button>
      )}
    </div>
  );
}
