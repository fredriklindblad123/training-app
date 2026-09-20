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
    <section className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
      <h2 className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
        Så ska den här vyn läsas
      </h2>

      <p className="mt-2 max-w-3xl text-sm text-[var(--ink-2)]">
        Sidan är till för att visa <strong>hur medeldistansträning hänger ihop</strong> — vad
        distans, tröskel och intervall gör med kroppen, och var din egen träning hamnar. Den är
        vägledande, inte ett facit. Siffrorna är underlag för ett samtal med din tränare, inte ett
        omdöme om ett pass eller en period.
      </p>

      {hasGarminData && (
        <p className="mt-2 max-w-3xl text-sm text-[var(--ink-2)]">
          Allt som räknas fram här vilar på två antaganden som båda kan vara fel:{" "}
          <strong>att klockans mätning stämmer</strong> — pulsband glappar, optiska givare låser
          sig på stegfrekvensen, värme och kupering flyttar både puls och fart — och{" "}
          <strong>att trösklarna i din profil är rätt</strong>. Ligger en tröskel några slag fel
          byter halva sidan färg utan att din träning har ändrats det minsta.
        </p>
      )}

      {hasThresholds && estimated && (
        <p className="mt-3 max-w-3xl rounded border border-[var(--line)] bg-[var(--surface-raised)] p-3 text-sm text-[var(--ink-2)]">
          <strong className="text-[var(--foreground)]">Dina trösklar är inmatade, inte testade.</strong>{" "}
          LT1 {lt1} och LT2 {lt2} kommer från en uppskattning
          {lt2MeasuredOn ? ` sparad ${lt2MeasuredOn}` : ""}, inte från ett test. Det gör inte
          siffrorna värdelösa — men läs allt som bygger på dem som ungefärligt. Ett 30-minuters
          maxtest, där snittpulsen de sista 20 minuterna ger LT2, skulle göra hela sidan säkrare.
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
          <strong className="text-[var(--foreground)]">Du har inga trösklar ifyllda ännu.</strong>{" "}
          Avsnitten som jämför din träning mot dem är därför dolda. Förklaringarna av hur
          träningen fungerar gäller ändå — och fyller du i aerob och anaerob tröskel under
          Inställningar så räknas resten fram.
        </p>
      )}
    </section>
  );
}
