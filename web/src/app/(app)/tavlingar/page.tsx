import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, assignableAthletes, canEditPlanning } from "@/lib/auth-scope";
import { fieldClass, primaryButtonClass, smallButtonClass } from "@/components/ui/controls";
import {
  createPlannedCompetition,
  deletePlannedCompetition,
  toggleCompetitionAthlete,
} from "./actions";

/* Tävlingsplaneringen: vad gruppen har framför sig, och hur man ändrar det.
 *
 * Skild från /tavlingsresultat, som är loggen — där fyller man i vad det blev.
 * Den här sidan handlar om vad som SKA hända: vilka tävlingar som är inlagda,
 * när, och vem som ska springa dem. Tävlingarna låg tidigare inklämda som en
 * tabell på Säsongsöversikt, där de konkurrerade med block och veckor om
 * uppmärksamheten och inte gick att ändra utan att gå till en annan sida.
 *
 * EN TÄVLING = FLERA RADER. Att flera löpare springer samma lopp är flera
 * rader i `competitions` med samma namn och datum; det finns ingen
 * kopplingstabell. Sidan grupperar därför på namn + datum, och kryssrutorna
 * lägger till eller tar bort en rad i taget.
 *
 * Kronologiskt med kommande först. Passerade tävlingar ligger kvar längst ned,
 * dämpade — de är historik man ibland vill se, men aldrig det man kom hit för.
 */

export default async function TavlingarPage() {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;

  const athletes = assignableAthletes(scoped);
  const athleteIds = athletes.map((a) => a.id);
  const canEdit = canEditPlanning(scoped);
  const todayKey = new Date().toLocaleDateString("sv-SE", { timeZone: "Europe/Stockholm" });

  const { data: rows } = await supabase
    .from("competitions")
    .select("id, user_id, name, competition_date, priority, location, venue")
    .in("user_id", athleteIds.length > 0 ? athleteIds : ["00000000-0000-0000-0000-000000000000"])
    .order("competition_date");

  type Row = {
    id: string;
    user_id: string;
    name: string;
    competition_date: string;
    priority: string;
    location: string | null;
    venue: string | null;
  };

  const byRace = new Map<
    string,
    { name: string; date: string; priority: string; location: string | null; athletes: Set<string> }
  >();
  for (const r of (rows ?? []) as Row[]) {
    const key = `${r.competition_date}|${r.name}`;
    const g = byRace.get(key) ?? {
      name: r.name,
      date: r.competition_date,
      priority: r.priority,
      location: r.location,
      athletes: new Set<string>(),
    };
    g.athletes.add(r.user_id);
    // Högsta prioritet vinner: är loppet A för någon är det ett A-lopp i en
    // vy som visar hela gruppen.
    if (r.priority === "A" || (r.priority === "B" && g.priority === "C")) g.priority = r.priority;
    byRace.set(key, g);
  }

  const races = [...byRace.values()].sort((a, b) => a.date.localeCompare(b.date));
  const upcoming = races.filter((r) => r.date >= todayKey);
  const past = races.filter((r) => r.date < todayKey).reverse();

  const priorityColor = (p: string) =>
    p === "A"
      ? "var(--status-concern-ink)"
      : p === "B"
        ? "var(--status-watch-ink)"
        : "var(--ink-3)";

  const daysUntil = (date: string) =>
    Math.round(
      (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${todayKey}T00:00:00Z`).getTime()) /
        86_400_000,
    );

  function RaceCard({ race, past: isPast }: { race: (typeof races)[number]; past: boolean }) {
    const days = daysUntil(race.date);
    return (
      <div
        className={`flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 ${
          isPast ? "opacity-60" : ""
        }`}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="display text-lg leading-tight font-semibold text-[var(--foreground)]">
            {race.name}
          </span>
          <span
            className="display text-xs font-semibold"
            style={{ color: priorityColor(race.priority) }}
          >
            {race.priority === "C" ? "Träningstävling" : `${race.priority}-lopp`}
          </span>
        </div>

        <div className="tabular flex flex-wrap items-baseline gap-x-2 text-xs text-[var(--ink-3)]">
          <span>{race.date}</span>
          {!isPast && (
            <span>
              ·{" "}
              {days === 0 ? "Idag" : days === 1 ? "Imorgon" : `${days} dagar kvar`}
            </span>
          )}
          {race.location && <span>· {race.location}</span>}
        </div>

        {/* Löparna som kryssrutor: att koppla på och av någon ÄR hela poängen
            med sidan, och en lista man måste öppna ett formulär för att ändra
            hade gjort det till ett ärende. Varje ruta är sin egen form — ett
            klick, en ändring. */}
        <div className="flex flex-wrap gap-1.5">
          {athletes.map((a) => {
            const on = race.athletes.has(a.id);
            return (
              <form key={a.id} action={toggleCompetitionAthlete}>
                <input type="hidden" name="name" value={race.name} />
                <input type="hidden" name="competition_date" value={race.date} />
                <input type="hidden" name="athlete_id" value={a.id} />
                <button
                  type="submit"
                  disabled={!canEdit}
                  title={on ? `Ta bort ${a.fullName ?? "löpare"}` : `Lägg till ${a.fullName ?? "löpare"}`}
                  className={`display rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                    on
                      ? "border-[var(--foreground)] bg-[var(--foreground)] text-[var(--background)]"
                      : "border-[var(--line)] text-[var(--ink-3)] hover:border-[var(--ink-3)] hover:text-[var(--foreground)]"
                  }`}
                >
                  {a.fullName ?? "Namnlös"}
                </button>
              </form>
            );
          })}
        </div>

        {canEdit && (
          <form action={deletePlannedCompetition} className="mt-0.5">
            <input type="hidden" name="name" value={race.name} />
            <input type="hidden" name="competition_date" value={race.date} />
            <button type="submit" className={`${smallButtonClass} text-[var(--status-concern-ink)]`}>
              Ta bort tävlingen
            </button>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <div>
        <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">
          Tävlingar
        </h1>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Vad gruppen har framför sig, i datumordning. Tävlingarna dyker upp
          automatiskt i planeringsvyerna och i träningskalendern. Resultaten
          fyller du i under Lopp.
        </p>
      </div>

      {canEdit && (
        <section className="flex flex-col gap-3">
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Lägg till tävling
          </h2>
          <form
            action={createPlannedCompetition}
            className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4"
          >
            <div className="flex flex-wrap items-end gap-3">
              <label className="flex flex-col gap-1 text-sm">
                Namn
                <input name="name" required placeholder="Terräng SM" className={fieldClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Datum
                <input type="date" name="competition_date" required className={fieldClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Prioritet
                <select name="priority" defaultValue="C" className={fieldClass}>
                  <option value="A">A-lopp</option>
                  <option value="B">B-lopp</option>
                  <option value="C">Träningstävling</option>
                </select>
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Plats
                <input name="location" placeholder="Göteborg" className={fieldClass} />
              </label>
              <label className="flex flex-col gap-1 text-sm">
                Bana
                <select name="venue" defaultValue="" className={fieldClass}>
                  <option value="">—</option>
                  <option value="outdoor">Ute</option>
                  <option value="indoor">Inne</option>
                </select>
              </label>
            </div>

            {/* Ingen förvald löpare. En tävling utan deltagare är meningslös,
                och en förkryssad ruta hade tyst lagt loppet på fel person. */}
            <fieldset className="flex flex-col gap-1.5">
              <legend className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
                Vilka springer
              </legend>
              <div className="flex flex-wrap gap-x-4 gap-y-1.5">
                {athletes.map((a) => (
                  <label key={a.id} className="flex items-center gap-1.5 text-sm">
                    <input type="checkbox" name="athletes" value={a.id} />
                    {a.fullName ?? "Namnlös"}
                  </label>
                ))}
              </div>
            </fieldset>

            <button type="submit" className={primaryButtonClass}>
              Lägg till
            </button>
          </form>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Kommande
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-[var(--ink-3)]">Inga tävlingar inlagda framåt.</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {upcoming.map((r) => (
              <RaceCard key={`${r.date}|${r.name}`} race={r} past={false} />
            ))}
          </div>
        )}
      </section>

      {past.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Genomförda
          </h2>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
            {past.map((r) => (
              <RaceCard key={`${r.date}|${r.name}`} race={r} past />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
