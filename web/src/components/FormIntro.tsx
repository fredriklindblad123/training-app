import { LT2_SOURCE_LABELS } from "@/lib/threshold-test";

/* Ramen kring hela Form-vyn.
 *
 * Vyn räknar fram skarpa tal — "43 % av varven ligger över tröskeln" — och
 * skarpa tal läses som fakta. Men varje sådant tal vilar på två antaganden
 * som båda kan vara fel: att klockans mätning stämmer, och att trösklarna i
 * profilen är rätt. Är LT1 satt fem slag för lågt byter halva vyn färg.
 *
 * För en 17-åring som läser sin egen träning är skillnaden viktig. Den här
 * rutan står först, alltid utfälld, och säger vad vyn är: en beskrivning av
 * hur medeldistansträning hänger ihop och var träningen hamnar — inte ett
 * omdöme om ett pass eller en period.
 */

export function FormIntro({
  lt1,
  lt2,
  lt2Source,
  lt2MeasuredOn,
  hasGarminData,
}: {
  lt1: number | null;
  lt2: number | null;
  /** `profiles.lt2_source`: test_field, test_lactate eller manuell. */
  lt2Source: string | null;
  lt2MeasuredOn: string | null;
  /** Falskt när löparen inte har några pass alls — då är vyn ren kunskap. */
  hasGarminData: boolean;
}) {
  const hasThresholds = lt1 != null && lt2 != null;
  const estimated = lt2Source == null || lt2Source === "manuell";

  return (
    /* Inledningen i "Träningens tre växlar" sedan 2026-10-08 — tidigare ett
       eget kort, "Så ska den här vyn läsas", överst på sidan. */
    <div className="flex flex-col">
      <p className="max-w-3xl text-sm text-[var(--ink-2)]">
        Hur distans, tröskel och intervall hänger ihop — och var din träning hamnar. Vägledning
        och underlag för samtal med tränaren, inte betyg.
        {hasGarminData && " Allt bygger på att klockans puls och dina trösklar stämmer."}
      </p>

      {hasThresholds && estimated && (
        <p className="mt-3 max-w-3xl rounded border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--ink-2)]">
          <strong className="text-[var(--foreground)]">Dina trösklar är uppskattade, inte testade.</strong>{" "}
          LT1 {lt1} och LT2 {lt2}
          {lt2MeasuredOn ? ` (sparade ${lt2MeasuredOn})` : ""} — läs siffrorna som ungefärliga. Ett
          tröskeltest gör hela sidan säkrare.
        </p>
      )}

      {hasThresholds && !estimated && lt2Source && (
        <p className="mt-2 text-sm text-[var(--ink-3)]">
          Trösklarna kommer från {(LT2_SOURCE_LABELS[lt2Source] ?? lt2Source).toLowerCase()}
          {lt2MeasuredOn ? ` ${lt2MeasuredOn}` : ""}.
        </p>
      )}

      {!hasThresholds && (
        <p className="mt-3 max-w-3xl rounded border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--ink-2)]">
          <strong className="text-[var(--foreground)]">Inga trösklar ifyllda ännu.</strong> Fyll i
          dem under Inställningar så jämförs din träning mot dem.
        </p>
      )}
    </div>
  );
}
