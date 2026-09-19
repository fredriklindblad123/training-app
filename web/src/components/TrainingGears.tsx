"use client";

import { useState } from "react";
import {
  formatPacePerKm,
  GEAR_COLOR_VAR,
  GEAR_LABELS,
  gearSeparation,
  type Gear,
  type GearView,
  type TrainingGears as TrainingGearsData,
} from "@/lib/training-gears";

/* ------------------------------------------------------------------------ *
 * TrainingGears — "Träningens tre växlar"
 *
 * Två block på samma axel: var de tre träningsformerna *borde* ligga, och var
 * de faktiskt ligger. Formen är vald för att jämförelsen ska vara omöjlig att
 * missa — målbanden är tydligt åtskilda, och ligger utfallet ovanpå varandra
 * syns det direkt att växlarna smält ihop.
 *
 * ── Två enheter, två oberoende svar ───────────────────────────────────────
 * Pulsvyns band kommer ur profilens trösklar, som kan vara skattade. Fartvyns
 * band kommer ur tävlingsfarten och är därför helt oberoende av dem. Pekar
 * båda åt samma håll står slutsatsen på två ben; gör de inte det är det i sig
 * information. Därför en växling och inte ett val vid inläsning.
 *
 * ── Axelns riktning ───────────────────────────────────────────────────────
 * Hårdare arbete ligger alltid till höger. I pulsvyn betyder det stigande
 * slag, i fartvyn *fallande* sekunder per kilometer — annars hade de tre
 * växlarna bytt plats när man växlade enhet, och jämförelsen gått förlorad.
 *
 * ── Utfallets bredd ───────────────────────────────────────────────────────
 * Mittersta hälften (p25–p75) med medianen som streck, inte min–max: ett
 * enda pass med tappat pulsband skulle annars sträcka bandet över hela axeln.
 *
 * Positionering sker med procent i absolut positionerade element, aldrig med
 * en skalad svg — en <svg preserveAspectRatio="none"> drar ut allt i x-led på
 * breda skärmar, vilket redan gick fel en gång i lugn-diagrammet.
 * ------------------------------------------------------------------------ */

type Metric = "puls" | "fart";

export function TrainingGears({ data }: { data: TrainingGearsData }) {
  const [metric, setMetric] = useState<Metric>("puls");
  const view: GearView = metric === "fart" && data.pace ? data.pace : data.hr;
  const descending = metric === "fart" && data.pace != null;

  const span = view.axisMax - view.axisMin || 1;
  /** Värde → andel av bredden. Fallande skala i fartvyn, så att snabbare
   *  arbete ändå hamnar till höger. */
  const pos = (v: number) =>
    descending ? ((view.axisMax - v) / span) * 100 : ((v - view.axisMin) / span) * 100;

  const fmt = (v: number) => (descending ? formatPacePerKm(v) : String(Math.round(v)));
  const unit = descending ? "min/km" : "slag";
  const separation = gearSeparation(view);

  const markers = (
    <>
      {view.markers.map((m) => (
        <span
          key={m.label}
          className="absolute -top-1 -bottom-1 w-px border-l border-dashed border-[var(--ink-3)]"
          style={{ left: `${pos(m.value)}%` }}
        />
      ))}
    </>
  );

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          {separation != null && (
            <p
              className="text-base font-medium"
              style={{
                color: closeEnough(separation, descending)
                  ? "var(--status-concern)"
                  : "var(--foreground)",
              }}
            >
              {closeEnough(separation, descending)
                ? `Tröskel och intervall skiljer bara ${fmtDiff(separation, descending)} i median — växlarna har smält ihop.`
                : `Tröskel och intervall skiljer ${fmtDiff(separation, descending)} i median.`}
            </p>
          )}
          <p className="mt-1 max-w-2xl text-sm text-[var(--ink-2)]">
            De tre formerna ska ligga på åtskilda intensiteter. Ligger de ovanpå varandra tränas
            samma sak flera gånger i veckan under olika namn. {view.source}
          </p>
        </div>

        {/* Växlingen visas bara när fartvyn går att räkna fram. */}
        {data.pace && (
          <div
            className="flex shrink-0 overflow-hidden rounded border border-[var(--line)] text-sm"
            role="group"
            aria-label="Enhet"
          >
            {(["puls", "fart"] as Metric[]).map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => setMetric(m)}
                aria-pressed={metric === m}
                className={`px-3 py-1 ${
                  metric === m
                    ? "bg-[var(--foreground)] text-[var(--background)]"
                    : "text-[var(--ink-2)]"
                }`}
              >
                {m === "puls" ? "Puls" : "Fart"}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-5 min-w-0 overflow-x-auto">
        <div className="min-w-[26rem]">
          <GearBlock heading="Så borde de ligga">
            {view.gears.map((g) => (
              <GearRow key={g.key} label={GEAR_LABELS[g.key]}>
                <span
                  className="absolute top-1 h-3.5 rounded-sm border"
                  style={{
                    left: `${Math.min(pos(g.target.low), pos(g.target.high))}%`,
                    width: `${Math.abs(pos(g.target.high) - pos(g.target.low))}%`,
                    borderColor: GEAR_COLOR_VAR[g.key],
                    background: `color-mix(in oklab, ${GEAR_COLOR_VAR[g.key]} 18%, transparent)`,
                  }}
                  title={`${GEAR_LABELS[g.key]}: mål ${fmt(g.target.low)}–${fmt(g.target.high)} ${unit}`}
                />
                {markers}
              </GearRow>
            ))}
          </GearBlock>

          <div className="my-4 border-t border-[var(--line)]" />

          <GearBlock heading="Så ligger de">
            {view.gears.map((g) => (
              <GearRow key={g.key} label={GEAR_LABELS[g.key]}>
                {g.actual ? (
                  <>
                    <span
                      className="absolute top-1 h-3.5 rounded-sm"
                      style={{
                        left: `${Math.min(pos(g.actual.p25), pos(g.actual.p75))}%`,
                        width: `${Math.max(Math.abs(pos(g.actual.p75) - pos(g.actual.p25)), 0.8)}%`,
                        background: GEAR_COLOR_VAR[g.key],
                      }}
                      title={`${GEAR_LABELS[g.key]}: median ${fmt(g.actual.median)} ${unit}, mittersta hälften ${fmt(g.actual.p25)}–${fmt(g.actual.p75)}, n=${g.actual.n}`}
                    />
                    <span
                      className="absolute top-0.5 h-4.5 w-0.5 bg-[var(--foreground)]"
                      style={{ left: `${pos(g.actual.median)}%` }}
                    />
                  </>
                ) : (
                  <span className="absolute top-1 text-xs text-[var(--ink-3)]">inget underlag</span>
                )}
                {markers}
              </GearRow>
            ))}
          </GearBlock>

          {/* Axeln sist, delad av båda blocken. */}
          <div className="mt-2 grid grid-cols-[5rem_1fr] gap-3">
            <span />
            <div className="relative h-9 border-t border-[var(--line)]">
              {axisTicks(view, descending).map((v) => (
                <span
                  key={v}
                  className="absolute top-1 -translate-x-1/2 text-[0.65rem] tabular-nums text-[var(--ink-3)]"
                  style={{ left: `${pos(v)}%` }}
                >
                  {fmt(v)}
                </span>
              ))}
              {view.markers.map((m) => (
                <span
                  key={m.label}
                  className="absolute top-5 -translate-x-1/2 text-[0.6rem] font-medium whitespace-nowrap text-[var(--ink-2)]"
                  style={{ left: `${pos(m.value)}%` }}
                >
                  {m.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--ink-3)]">
        <span className="flex items-center gap-1.5">
          <i
            className="inline-block h-2.5 w-4 rounded-sm border"
            style={{
              borderColor: "var(--ink-3)",
              background: "color-mix(in oklab, var(--ink-3) 18%, transparent)",
            }}
          />
          Målområde
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-2.5 w-4 rounded-sm bg-[var(--ink-3)]" />
          Mittersta hälften av utfallet
        </span>
        <span className="flex items-center gap-1.5">
          <i className="inline-block h-3 w-0.5 bg-[var(--foreground)]" />
          Median
        </span>
      </div>

      <details className="mt-4 rounded-lg border border-[var(--line)] p-3 text-sm">
        <summary className="cursor-pointer text-[var(--ink-2)]">Hur växlarna mäts</summary>
        <p className="mt-2 text-[var(--ink-2)]">
          Distans mäts <strong>per pass</strong> (lugna pass och långpass på minst 20 minuter).
          Tröskel och intervall mäts <strong>per repetition</strong>: aktiva varv på minst 400 m
          och 60 sekunder, och bara ur passets huvudaktivitet — annars hade uppvärmningens
          kilometrar räknats som intervallrepetitioner. Olika enheter är avsiktligt, men det gör
          jämförelsen ungefärlig.
        </p>
        <p className="mt-2 text-[var(--ink-2)]">
          <strong>Pulsvyns</strong> band kommer ur trösklarna i din profil. Är de skattade och inte
          testade flyttar sig alla tre banden om skattningen är fel.{" "}
          <strong>Fartvyns</strong> band härleds i stället ur din tävlingsfart och är därför
          oberoende av trösklarna — pekar båda vyerna åt samma håll står slutsatsen på två ben.
          Fartbandens multiplar är konvention, kalibrerade mot 1500 m som referensgren.
        </p>
        <p className="mt-2 text-[var(--ink-2)]">
          Golven på 400 m och 60 sekunder finns för att snittpulsen ska hinna bli meningsfull; på
          ett 200-metersryck ligger pulsen efter hela vägen. Följden är att avståndet mellan
          tröskel och intervall snarast <em>underskattas</em>. Måttet använder inga pulszoner —
          till skillnad från Intensitetsfördelningen, som ärver klockans zonkalibrering.
        </p>
      </details>
    </div>
  );
}

/** Fem jämnt fördelade etiketter, plus vyns egna referenslinjer. */
function axisTicks(view: GearView, descending: boolean): number[] {
  const out: number[] = [];
  for (let i = 0; i <= 3; i++) {
    out.push(view.axisMin + ((view.axisMax - view.axisMin) * i) / 3);
  }
  // Referensvärdena får egna etiketter i pulsvyn, där de är runda tal;
  // i fartvyn skulle de krocka med de jämna stegen.
  if (!descending) out.push(...view.markers.map((m) => m.value));
  return [...new Set(out.map((v) => Math.round(v)))].sort((a, b) => a - b);
}

/** Tröskel och intervall räknas som hopsmälta vid ≤5 slag eller ≤10 s/km. */
function closeEnough(separation: number, descending: boolean): boolean {
  return descending ? separation <= 10 : separation <= 5;
}

function fmtDiff(separation: number, descending: boolean): string {
  return descending
    ? `${Math.round(separation)} sekunder per kilometer`
    : `${Math.round(separation)} slag`;
}

function GearBlock({ heading, children }: { heading: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="mb-2 text-[0.65rem] tracking-wider text-[var(--ink-3)] uppercase">{heading}</p>
      <div className="flex flex-col gap-1">{children}</div>
    </div>
  );
}

function GearRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[5rem_1fr] items-center gap-3">
      <span className="text-right text-sm text-[var(--ink-2)]">{label}</span>
      <span className="relative block h-5.5">{children}</span>
    </div>
  );
}

/** Domraden för en växel, till sektionsrubrikerna. */
export function GearHeadline({ gear, text }: { gear: Gear; text: string }) {
  const tone =
    gear.actual == null
      ? "var(--ink-3)"
      : gear.shareOverCeiling != null && gear.shareOverCeiling >= 0.25
        ? "var(--status-concern)"
        : "var(--ink-2)";
  return (
    <span className="text-sm font-normal" style={{ color: tone }}>
      {text}
    </span>
  );
}
