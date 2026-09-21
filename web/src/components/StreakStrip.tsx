/* Kontinuiteten som rutor i stället för en siffra.
 *
 * "12 veckor" är ett faktum man läser och glömmer. Tolv rutor är något man
 * ser att man håller på att bygga — och rutorna gör synligt vad som skulle gå
 * förlorat, vilket siffran inte gör.
 *
 * Bara de senaste veckorna ritas, inte hela sviten. En svit på sextio veckor
 * (vilket finns i datan) hade gett sextio streck som inte går att räkna ändå;
 * poängen är att se det senaste och att sviten lever.
 */

import { STATUS_COLOR_VAR, STATUS_LABEL } from "@/lib/calendar-utils";

export type StreakWeek = {
  /** Måndagens datum, till etiketten. */
  weekStart: string;
  /** Genomförda pass den veckan. Noll ritar en tom ruta. */
  sessions: number;
  /** Veckan innehöll ett kvalitetspass — tröskel, intervall eller tävling.
   * Påverkar inte längre färgen, men används i rutans titel. */
  quality: boolean;
  /** Vad som bröt veckan, om något. Skada väger tyngre än sjukdom när båda
   * förekommer — den är det allvarligare avbrottet. */
  interrupted: "sick" | "injured" | null;
  /** Innevarande vecka. Ritas ihålig, se motiveringen vid plupparna. */
  isCurrent: boolean;
};

const MAX_DOTS = 14;

/** Avbrottet vinner över träningen: en vecka med båda är en bruten vecka. */
function dotColor(w: StreakWeek): string {
  if (w.interrupted) return STATUS_COLOR_VAR[w.interrupted];
  return w.sessions > 0 ? STATUS_COLOR_VAR.training : "var(--line)";
}

export function StreakStrip({
  currentWeeks,
  bestWeeks,
  weeks,
}: {
  currentWeeks: number;
  bestWeeks: number;
  weeks: StreakWeek[];
}) {
  const shown = weeks.slice(-MAX_DOTS);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
        Din svit
      </h2>

      <div className="day-surface flex flex-wrap items-center gap-x-5 gap-y-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="flex items-baseline gap-2">
          <span className="display text-3xl leading-none font-bold text-[var(--foreground)]">
            {currentWeeks}
          </span>
          <span className="text-sm text-[var(--ink-2)]">
            {currentWeeks === 1 ? "vecka i rad" : "veckor i rad"}
          </span>
        </div>

        {/* Plupparna sist på raden så att talet läses först.
        
            Färgen säger vad sviten handlar om: grön vecka = tränad, gul =
            bruten av sjukdom, röd = av skada, tom = ingen träning. Tidigare
            skilde färgerna på kvalitets- och distansveckor, vilket beskrev
            något annat än rubriken ovanför — en svit bryts inte av att en
            vecka saknade intervaller. Avbrottet går före grönt: en vecka med
            både träning och sjukdagar är en bruten vecka, precis som
            computeContinuityStreaks räknar den. Avbrottet får dagsutfallets
            färg — gult för sjuk, rött för skadad, samma som kalendern och
            årsvyn. Första versionen gav rött åt båda, vilket sa att en
            förkylning och en skada är samma sak.

            Innevarande vecka ritas IHÅLIG. Den räknas inte in i sviten förrän
            den är slut (se lib/continuity.ts) — annars skulle sviten se
            bruten ut bara för att det är tisdag. Ritad som en fylld plupp
            bland de andra blev det i stället tre gröna intill siffran två,
            vilket såg ut som ett räknefel. Rapporterat 2026-09-21. */}
        <div className="flex flex-wrap items-center gap-1" aria-hidden>
          {shown.map((w) => (
            <span
              key={w.weekStart}
              title={`${w.weekStart}: ${
                w.interrupted
                  ? `${STATUS_LABEL[w.interrupted].toLowerCase()}, ${w.sessions} pass`
                  : `${w.sessions} pass`
              }${w.isCurrent ? " — pågående vecka, räknas när den är slut" : ""}`}
              className="h-3.5 w-3.5 rounded-full"
              style={
                w.isCurrent
                  ? {
                      backgroundColor: "transparent",
                      border: `2px solid ${dotColor(w)}`,
                    }
                  : { backgroundColor: dotColor(w) }
              }
            />
          ))}
        </div>

        {bestWeeks > 0 && (
          <span className="tabular ml-auto text-xs text-[var(--ink-3)]">
            Bästa {bestWeeks} v
          </span>
        )}
      </div>

      {/* Plupparna är dekorativa; samma besked i text för den som inte ser dem. */}
      <span className="sr-only">
        {`Nuvarande svit ${currentWeeks} avslutade veckor, personbästa ${bestWeeks} veckor. ` +
          "Innevarande vecka räknas först när den är slut."}
      </span>
    </section>
  );
}
