import {
  GEAR_COLOR_VAR,
  GEAR_LABELS,
  gearSeparation,
  type Gear,
  type TrainingGears as TrainingGearsData,
} from "@/lib/training-gears";

/* ------------------------------------------------------------------------ *
 * TrainingGears — "Träningens tre växlar"
 *
 * Två block på samma pulsaxel: var de tre träningsformerna *borde* ligga, och
 * var de faktiskt ligger. Formen är vald för att jämförelsen ska vara
 * omöjlig att missa — målbanden är tydligt åtskilda, och ligger utfallet
 * ovanpå varandra syns det direkt att växlarna smält ihop.
 *
 * Utfallet ritas som mittersta hälften (p25–p75) med medianen som streck,
 * inte som min–max: ett enda pass med tappat pulsband skulle annars sträcka
 * ut bandet över hela axeln och dölja var tyngdpunkten faktiskt ligger.
 *
 * Positionering sker med procent i absolut positionerade element, aldrig med
 * en skalad svg — en <svg preserveAspectRatio="none"> hade dragit ut allt i
 * x-led på breda skärmar, vilket redan gick fel en gång i lugn-diagrammet.
 * ------------------------------------------------------------------------ */

export function TrainingGears({ data }: { data: TrainingGearsData }) {
  const { gears, lt1, lt2, axisMin, axisMax } = data;
  const span = axisMax - axisMin || 1;
  const pos = (hr: number) => ((hr - axisMin) / span) * 100;
  const separation = gearSeparation(data);

  const ltLines = (
    <>
      <span
        className="absolute -top-1 -bottom-1 w-px border-l border-dashed border-[var(--ink-3)]"
        style={{ left: `${pos(lt1)}%` }}
      />
      <span
        className="absolute -top-1 -bottom-1 w-px border-l border-dashed border-[var(--ink-3)]"
        style={{ left: `${pos(lt2)}%` }}
      />
    </>
  );

  return (
    <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      {separation != null && (
        <p
          className="text-base font-medium"
          style={{
            color: separation <= 5 ? "var(--status-concern)" : "var(--foreground)",
          }}
        >
          {separation <= 5
            ? `Tröskel och intervall skiljer bara ${separation} slag i median — växlarna har smält ihop.`
            : `Tröskel och intervall skiljer ${separation} slag i median.`}
        </p>
      )}
      <p className="mt-1 max-w-2xl text-sm text-[var(--ink-2)]">
        De tre formerna ska ligga på åtskilda intensiteter: distans under aerob tröskel ({lt1}),
        tröskel mellan trösklarna, intervall över anaerob tröskel ({lt2}). Ligger de ovanpå
        varandra tränas samma sak flera gånger i veckan under olika namn.
      </p>

      <div className="mt-5 min-w-0 overflow-x-auto">
        <div className="min-w-[26rem]">
          <GearBlock heading="Så borde de ligga">
            {gears.map((g) => (
              <GearRow key={g.key} label={GEAR_LABELS[g.key]}>
                <span
                  className="absolute top-1 h-3.5 rounded-sm border"
                  style={{
                    left: `${pos(g.target.low)}%`,
                    width: `${pos(g.target.high) - pos(g.target.low)}%`,
                    borderColor: GEAR_COLOR_VAR[g.key],
                    background: `color-mix(in oklab, ${GEAR_COLOR_VAR[g.key]} 18%, transparent)`,
                  }}
                />
                {ltLines}
              </GearRow>
            ))}
          </GearBlock>

          <div className="my-4 border-t border-[var(--line)]" />

          <GearBlock heading="Så ligger de">
            {gears.map((g) => (
              <GearRow key={g.key} label={GEAR_LABELS[g.key]}>
                {g.actual ? (
                  <>
                    <span
                      className="absolute top-1 h-3.5 rounded-sm"
                      style={{
                        left: `${pos(g.actual.p25)}%`,
                        width: `${Math.max(pos(g.actual.p75) - pos(g.actual.p25), 0.8)}%`,
                        background: GEAR_COLOR_VAR[g.key],
                      }}
                      title={`${GEAR_LABELS[g.key]}: median ${g.actual.median}, mittersta hälften ${g.actual.p25}–${g.actual.p75}, n=${g.actual.n}`}
                    />
                    <span
                      className="absolute top-0.5 h-4.5 w-0.5 bg-[var(--foreground)]"
                      style={{ left: `${pos(g.actual.median)}%` }}
                    />
                  </>
                ) : (
                  <span className="absolute top-1 text-xs text-[var(--ink-3)]">
                    inget underlag
                  </span>
                )}
                {ltLines}
              </GearRow>
            ))}
          </GearBlock>

          {/* Axeln sist, delad av båda blocken. */}
          <div className="mt-2 grid grid-cols-[5rem_1fr] gap-3">
            <span />
            <div className="relative h-9 border-t border-[var(--line)]">
              {[axisMin + 3, lt1, lt2, axisMax - 3].map((hr) => (
                <span
                  key={hr}
                  className="absolute top-1 -translate-x-1/2 text-[0.65rem] tabular-nums text-[var(--ink-3)]"
                  style={{ left: `${pos(hr)}%` }}
                >
                  {Math.round(hr)}
                </span>
              ))}
              <span
                className="absolute top-5 -translate-x-1/2 text-[0.6rem] font-medium text-[var(--ink-2)]"
                style={{ left: `${pos(lt1)}%` }}
              >
                LT1
              </span>
              <span
                className="absolute top-5 -translate-x-1/2 text-[0.6rem] font-medium text-[var(--ink-2)]"
                style={{ left: `${pos(lt2)}%` }}
              >
                LT2
              </span>
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
          Distans mäts <strong>per pass</strong> (snittpuls över lugna pass och långpass på minst
          20 minuter). Tröskel och intervall mäts <strong>per repetition</strong>: aktiva varv på
          minst 400 m och 60 sekunder, och bara ur passets huvudaktivitet — annars hade
          uppvärmningens kilometrar räknats som intervallrepetitioner. Olika enheter är
          avsiktligt — ett distanspass har en intensitet, ett intervallpass har en per repetition
          — men det gör jämförelsen ungefärlig.
        </p>
        <p className="mt-2 text-[var(--ink-2)]">
          Golven på 400 m och 60 sekunder finns för att snittpulsen ska hinna bli meningsfull; på
          ett 200-metersryck ligger pulsen efter hela vägen. Följden är att avståndet mellan tröskel
          och intervall snarast <em>underskattas</em> här. Måttet använder inga pulszoner, bara
          puls och trösklarna ur din profil — till skillnad från Intensitetsfördelningen, som
          ärver klockans zonkalibrering.
        </p>
      </details>
    </div>
  );
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
      : gear.key === "distans" && gear.shareOverCeiling != null && gear.shareOverCeiling >= 0.25
        ? "var(--status-concern)"
        : gear.key === "troskel" && gear.shareOverCeiling != null && gear.shareOverCeiling >= 0.25
          ? "var(--status-concern)"
          : "var(--ink-2)";
  return (
    <span className="text-sm font-normal" style={{ color: tone }}>
      {text}
    </span>
  );
}
