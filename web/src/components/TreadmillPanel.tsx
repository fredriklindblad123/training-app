"use client";

import { useState } from "react";
import { TreadmillCalibrator, deviationText, kmhLabel, pace } from "@/components/TreadmillCalibrator";
import { buttonClass, primaryButtonClass, smallButtonClass } from "@/components/ui/controls";
import { actualKmh, paceToKmh, setKmhFor, type Calibration, type CalibrationPoint } from "@/lib/treadmill";
import { chooseTreadmill } from "@/app/(app)/lopband/actions";
import { formatDateShort } from "@/lib/format";

export type BandView = {
  id: string;
  name: string;
  beltLengthCm: number;
  calibration: {
    id: string;
    measuredOn: string;
    calibration: Calibration;
    points: CalibrationPoint[];
    mine: boolean;
  } | null;
};

/* Farterna i omräkningstabellen, min/km: från lugnt till 1500-fart. */
const TABLE_PACES = [330, 300, 270, 255, 240, 225, 210, 195, 180];

type Open = null | { kind: "new" } | { kind: "again"; band: BandView } | { kind: "loaded"; band: BandView };

export function TreadmillPanel({
  bands,
  chosenId,
  athlete,
  whose,
}: {
  bands: BandView[];
  chosenId: string | null;
  /** Löparen coachen tittar på, annars null. */
  athlete: string | null;
  /** "ditt" eller "Alices" — vems band valet gäller. */
  whose: string;
}) {
  const [open, setOpen] = useState<Open>(bands.length === 0 ? { kind: "new" } : null);
  const ordered = [...bands].sort((a, b) => Number(b.id === chosenId) - Number(a.id === chosenId));

  return (
    <div className="flex flex-col gap-4">
      {open && (
        <TreadmillCalibrator
          key={open.kind + ("band" in open ? open.band.id : "")}
          athlete={athlete}
          onClose={() => setOpen(null)}
          mode={
            open.kind === "new"
              ? { kind: "new" }
              : open.kind === "again"
                ? { kind: "again", treadmillId: open.band.id, name: open.band.name, beltLengthCm: open.band.beltLengthCm }
                : { kind: "loaded", calibrationId: open.band.calibration!.id, name: open.band.name, beltLengthCm: open.band.beltLengthCm }
          }
        />
      )}
      {!open && (
        <button type="button" className={buttonClass} onClick={() => setOpen({ kind: "new" })}>
          Mät ett nytt band
        </button>
      )}

      {ordered.map((b) => {
        const c = b.calibration?.calibration ?? null;
        const chosen = b.id === chosenId;
        return (
          <article key={b.id} className="flex flex-col gap-3 rounded-[14px] border border-[var(--line)] p-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="display text-lg font-semibold text-[var(--foreground)]">{b.name}</h3>
              {chosen && <span className="text-xs text-[var(--ink-2)]">{whose === "ditt" ? "Ditt band" : `${whose} band`}</span>}
            </div>
            {b.calibration && c ? (
              <>
                <p className="text-sm text-[var(--ink-2)]">
                  {deviationText(actualKmh({ ...c, loadedFactor: null }, 15), 15)} Mätt {formatDateShort(b.calibration.measuredOn)},{" "}
                  {b.calibration.points.length} {b.calibration.points.length === 1 ? "fart" : "farter"}, bandet {b.beltLengthCm} cm.
                </p>
                <p className="text-xs text-[var(--ink-3)]">
                  {c.loadedFactor != null
                    ? `Med löpare på bandet går det ${kmhLabel(Math.abs(1 - c.loadedFactor) * 100)} % ${c.loadedFactor < 1 ? "långsammare" : "fortare"} än tomt. Tabellen räknar med löpare.`
                    : "Mätt på tomt band. Med en löpare på bandet går det oftast lite långsammare, och det är inte med i tabellen."}
                </p>
                <table className="tabular w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-[var(--ink-3)]">
                      <th className="pb-1 font-normal">Fart</th>
                      <th className="pb-1 font-normal">Visar bandet den, springer du</th>
                      <th className="pb-1 font-normal">För att springa den, ställ in</th>
                    </tr>
                  </thead>
                  <tbody>
                    {TABLE_PACES.map((p) => {
                      const k = paceToKmh(p);
                      const set = setKmhFor(c, k);
                      return (
                        <tr key={p} className="border-t border-[var(--line)]">
                          <td className="py-1.5 font-semibold text-[var(--foreground)]">{pace(k)}</td>
                          <td className="py-1.5 text-[var(--ink-2)]">{pace(actualKmh(c, k))}</td>
                          <td className="py-1.5 text-[var(--ink-2)]">
                            {pace(set)} <span className="text-xs text-[var(--ink-3)]">({kmhLabel(set)} km/h)</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </>
            ) : (
              <p className="text-sm text-[var(--ink-2)]">Inte mätt än.</p>
            )}
            <div className="flex flex-wrap gap-2">
              {!chosen && (
                <form action={chooseTreadmill}>
                  <input type="hidden" name="treadmill_id" value={b.id} />
                  {athlete && <input type="hidden" name="athlete" value={athlete} />}
                  <button type="submit" className={primaryButtonClass}>
                    {whose === "ditt" ? "Gör till mitt band" : `Gör till ${whose} band`}
                  </button>
                </form>
              )}
              <button type="button" className={smallButtonClass} onClick={() => setOpen({ kind: "again", band: b })}>
                Mät igen
              </button>
              {b.calibration?.mine && (
                <button type="button" className={smallButtonClass} onClick={() => setOpen({ kind: "loaded", band: b })}>
                  {c?.loadedFactor != null ? "Kontrollmät med löpare igen" : "Kontrollmät med löpare"}
                </button>
              )}
              {chosen && (
                <form action={chooseTreadmill}>
                  {athlete && <input type="hidden" name="athlete" value={athlete} />}
                  <button type="submit" className={smallButtonClass}>
                    Inte {whose === "ditt" ? "mitt" : `${whose}`} band längre
                  </button>
                </form>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
