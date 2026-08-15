import Link from "next/link";

/* Löparväljare, samma knapprads-stil som redan finns inline i /sasongen och
 * /flerarsplan — utbruten hit så att de fyra nya coach-medvetna sidorna
 * (dashboard, kalender, trender, tävlingsresultat) inte behöver upprepa
 * samma markup fyra gånger. `buildHref` låter varje sida bestämma exakt hur
 * länken ser ut (vilka egna filter/parametrar som ska bevaras) — komponenten
 * bryr sig bara om att rendera knapparna konsekvent. */
export function AthleteSwitcher({
  linkedAthletes,
  activeId,
  buildHref,
}: {
  linkedAthletes: { id: string; fullName: string | null }[];
  activeId: string;
  buildHref: (athleteId: string) => string;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 rounded border border-zinc-200 p-3 text-sm dark:border-zinc-800">
      <span className="text-zinc-500 dark:text-zinc-400">Löpare:</span>
      {linkedAthletes.length === 0 ? (
        <span className="text-zinc-400 dark:text-zinc-600">
          Inga löpare kopplade än — lägg till en under Inställningar.
        </span>
      ) : (
        linkedAthletes.map((a) => (
          <Link
            key={a.id}
            href={buildHref(a.id)}
            aria-current={a.id === activeId ? "page" : undefined}
            className={`rounded px-3 py-1 ${
              a.id === activeId
                ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
                : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
            }`}
          >
            {a.fullName ?? "Namnlös löpare"}
          </Link>
        ))
      )}
    </div>
  );
}
