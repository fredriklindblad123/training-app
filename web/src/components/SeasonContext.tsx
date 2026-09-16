import Link from "next/link";
import { PHASE_LABELS, type PhaseType } from "@/lib/planning";

/* Var i säsongen man befinner sig, överst på dashboarden.
 *
 * Dagens pass svarar på vad man ska göra nu. Det här svarar på varför: vilket
 * block man är inne i och vad man bygger mot. En 16-åring som ser "Allmän
 * förberedelse" och "42 dagar till Skol-SM" läser sitt distanspass annorlunda
 * än en som bara ser "Distans, 8 km".
 *
 * Två celler i samma rutnätsform som resten av sidans kort, så att raden läses
 * som ett kort med en avdelare och inte som två lösa rutor.
 *
 * Saknas något sägs det rakt ut. Ett block som inte finns är inte ett fel —
 * gruppen kan ligga i ett glapp mellan två block — och en tom cell hade sett
 * ut som att något inte laddat.
 */

export function SeasonContext({
  block,
  nextRace,
  todayKey,
}: {
  block: { name: string; phase: string; startDate: string; endDate: string } | null;
  nextRace: { name: string; date: string; priority: string } | null;
  todayKey: string;
}) {
  /* Dagar räknas på rena datumsträngar via UTC-midnatt, aldrig på lokala
   * Date-objekt: sommartidsskiftet gör ett dygn 23 eller 25 timmar långt, och
   * en division med 86400000 hamnar då fel med en dag. */
  const daysBetween = (from: string, to: string) =>
    Math.round(
      (new Date(`${to}T00:00:00Z`).getTime() - new Date(`${from}T00:00:00Z`).getTime()) / 86_400_000,
    );

  const daysLeft = nextRace ? daysBetween(todayKey, nextRace.date) : null;

  const notStarted = block != null && block.startDate > todayKey;
  const daysToBlock = block ? daysBetween(todayKey, block.startDate) : null;

  /* Hur långt in i blocket man är. Veckonummer och inte procent: en tränare
   * planerar i veckor, och "vecka 3 av 8" säger något man kan handla på. */
  const blockWeek =
    block && !notStarted ? Math.floor(daysBetween(block.startDate, todayKey) / 7) + 1 : null;
  const blockWeeks = block
    ? Math.max(1, Math.ceil((daysBetween(block.startDate, block.endDate) + 1) / 7))
    : null;

  return (
    <section className="flex flex-col gap-3">
      <div className="day-grid grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-2">
        <div className="flex flex-col gap-1 bg-[var(--surface)] px-3 py-3">
          <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
            Block
          </span>
          {block ? (
            <>
              <span className="display text-xl leading-tight font-bold text-[var(--foreground)]">
                {block.name}
              </span>
              <span className="tabular text-xs text-[var(--ink-3)]">
                {PHASE_LABELS[block.phase as PhaseType] ?? block.phase}
                {/* Har blocket inte börjat än står nedräkningen i stället för
                    veckonumret. "Vecka -2 av 8" vore obegripligt, och att bara
                    visa namnet hade dolt att man ligger i ett glapp. */}
                {notStarted
                  ? ` · börjar om ${daysToBlock} ${daysToBlock === 1 ? "dag" : "dagar"}`
                  : blockWeek != null && blockWeeks != null
                    ? ` · vecka ${blockWeek} av ${blockWeeks}`
                    : ""}
              </span>
            </>
          ) : (
            <span className="text-sm text-[var(--ink-3)]">
              Inget block just nu.{" "}
              <Link href="/blockoversikt" className="underline">
                Lägg upp säsongen
              </Link>
            </span>
          )}
        </div>

        <div className="flex flex-col gap-1 bg-[var(--surface)] px-3 py-3">
          <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
            Nästa tävling
          </span>
          {nextRace && daysLeft != null ? (
            <>
              <span className="display text-xl leading-tight font-bold text-[var(--foreground)]">
                {nextRace.name}
              </span>
              <span className="tabular text-xs text-[var(--ink-3)]">
                {/* Nedräkningen är det som gör raden värd sin plats, så den
                    står i klartext och inte bara som ett datum. "Imorgon" och
                    "Idag" skrivs ut: "1 dag kvar" läses långsammare. */}
                {daysLeft === 0
                  ? "Idag"
                  : daysLeft === 1
                    ? "Imorgon"
                    : `${daysLeft} dagar kvar`}{" "}
                · {nextRace.date}
                {nextRace.priority === "A" ? " · A-lopp" : ""}
              </span>
            </>
          ) : (
            <span className="text-sm text-[var(--ink-3)]">
              Ingen tävling inlagd.{" "}
              <Link href="/tavlingsresultat#lagg-till-tavling" className="underline">
                Lägg till
              </Link>
            </span>
          )}
        </div>
      </div>
    </section>
  );
}
