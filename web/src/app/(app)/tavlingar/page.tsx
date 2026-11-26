import { PageHeader } from "@/components/ui/Page";
import { formatDateShort } from "@/lib/format";
import { priorityLabel } from "@/lib/planning";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, assignableAthletes, canEditPlanning } from "@/lib/auth-scope";
import { fieldClass, primaryButtonClass, smallButtonClass } from "@/components/ui/controls";
import {
  createPlannedCompetition,
  deletePlannedCompetition,
  toggleCompetitionAthlete,
  updatePlannedCompetition,
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

const MONTHS_SHORT = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];
const MONTHS_LONG = [
  "Januari", "Februari", "Mars", "April", "Maj", "Juni",
  "Juli", "Augusti", "September", "Oktober", "November", "December",
];

/** A-lopp: fylld prick. B-lopp: ring. Samma märke i tidslinjen och listan. */
function PriorityMark({ priority }: { priority: string }) {
  return priority === "A" ? (
    <span aria-hidden className="inline-block h-3 w-3 shrink-0 rounded-full bg-[var(--foreground)]" />
  ) : (
    <span aria-hidden className="inline-block h-2.5 w-2.5 shrink-0 rounded-full border-2 border-[var(--foreground)]" />
  );
}

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


  const daysUntil = (date: string) =>
    Math.round(
      (new Date(`${date}T00:00:00Z`).getTime() - new Date(`${todayKey}T00:00:00Z`).getTime()) /
        86_400_000,
    );

  /* En rad per tävling (2026-11-26, begärt: "snyggare, tydligare vy över
   * när tävlingarna ligger"). Datumet står stort till vänster så att
   * kolumnen läses som en kalender; korten i rutnät gick att läsa var för
   * sig men inte som en följd. A- och B-lopp skiljs med form och vikt, inte
   * med rött och gult — de färgerna är reserverade för sjuk och skadad (B4). */
  function RaceRow({ race, past: isPast }: { race: (typeof races)[number]; past: boolean }) {
    const days = daysUntil(race.date);
    const [, m, d] = race.date.split("-").map(Number);
    const weekday = formatDateShort(race.date, true).split(" ")[0];
    return (
      <li id={raceAnchor(race)} className={`flex scroll-mt-24 gap-3 px-3.5 py-3 ${isPast ? "opacity-60" : ""}`}>
        <div className="flex w-11 shrink-0 flex-col items-center pt-0.5">
          <span className="text-[0.6875rem] text-[var(--ink-3)] uppercase">{weekday}</span>
          <span className="display tabular text-2xl leading-none font-bold text-[var(--foreground)]">{d}</span>
          <span className="text-[0.6875rem] text-[var(--ink-3)]">{MONTHS_SHORT[m - 1]}</span>
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="display flex min-w-0 items-center gap-2 text-base leading-tight font-semibold text-[var(--foreground)]">
              <PriorityMark priority={race.priority} />
              <span className="truncate">{race.name}</span>
            </span>
            {!isPast && (
              <span className="tabular shrink-0 text-xs text-[var(--ink-2)]">
                {days === 0 ? "Idag" : days === 1 ? "Imorgon" : `om ${days} d`}
              </span>
            )}
          </div>
          <span className="text-xs text-[var(--ink-3)]">
            {priorityLabel(race.priority)}
            {race.location ? ` · ${race.location}` : ""}
          </span>
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
                    aria-pressed={on}
                    title={on ? `Ta bort ${a.fullName ?? "löpare"}` : `Lägg till ${a.fullName ?? "löpare"}`}
                    className={`display min-h-8 rounded-full border px-2.5 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
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
            /* Redigering bakom en utfällning: den behövs sällan, och ett
               formulär per kort framme hade gjort listan till en vägg av fält.
               Namn och datum skickas med som prev_* — de är nyckeln som håller
               ihop löparnas rader, och utan dem hade en namnändring skapat en
               andra tävling i stället för att ändra den som finns. */
            <details className="text-xs">
              <summary className="cursor-pointer list-none text-[11px] text-[var(--ink-3)] hover:text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
                Redigera
              </summary>
              <form action={updatePlannedCompetition} className="mt-2 flex flex-col gap-2">
                <input type="hidden" name="prev_name" value={race.name} />
                <input type="hidden" name="prev_competition_date" value={race.date} />
                <div className="flex flex-wrap items-end gap-2">
                  <label className="flex flex-col gap-1">
                    Namn
                    <input name="name" defaultValue={race.name} required className={fieldClass} />
                  </label>
                  <label className="flex flex-col gap-1">
                    Datum
                    <input
                      type="date"
                      name="competition_date"
                      defaultValue={race.date}
                      required
                      className={fieldClass}
                    />
                  </label>
                  <label className="flex flex-col gap-1">
                    Prioritet
                    <select name="priority" defaultValue={race.priority} className={fieldClass}>
                      <option value="A">A-lopp</option>
                      <option value="B">B-lopp</option>
                    </select>
                  </label>
                  <label className="flex flex-col gap-1">
                    Plats
                    <input name="location" defaultValue={race.location ?? ""} className={fieldClass} />
                  </label>
                </div>
                <div className="flex gap-2">
                  <button type="submit" className={smallButtonClass}>
                    Spara
                  </button>
                </div>
              </form>

              <form action={deletePlannedCompetition} className="mt-2">
                <input type="hidden" name="name" value={race.name} />
                <input type="hidden" name="competition_date" value={race.date} />
                <button
                  type="submit"
                  className={smallButtonClass}
                >
                  Ta bort tävlingen
                </button>
              </form>
            </details>
          )}
        </div>
      </li>
    );
  }

  const raceAnchor = (r: { date: string; name: string }) =>
    `t-${r.date}-${r.name.toLowerCase().replace(/[^a-z0-9åäö]+/g, "-")}`;

  /** Tävlingarna per månad, i ordning. */
  function byMonth(list: typeof races) {
    const out: { key: string; label: string; races: typeof races }[] = [];
    for (const r of list) {
      const key = r.date.slice(0, 7);
      const last = out[out.length - 1];
      if (last && last.key === key) last.races.push(r);
      else
        out.push({
          key,
          label: `${MONTHS_LONG[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`,
          races: [r],
        });
    }
    return out;
  }

  /* Tidslinjen: månaderna från denna till den sista inlagda tävlingen, en
   * markering per tävling. Den svarar på frågan listan inte kan svara på
   * med en blick — hur tävlingarna ligger i förhållande till varandra, var
   * det är tätt och var det är luft. (En tidigare tidslinje togs bort
   * 2026-11-21 för att den var hög; den här är en rad.) */
  function renderTimeline() {
    if (upcoming.length === 0) return null;
    const start = `${todayKey.slice(0, 7)}-01`;
    const lastKey = upcoming[upcoming.length - 1].date.slice(0, 7);
    const months: string[] = [];
    for (let k = start.slice(0, 7); k <= lastKey && months.length < 18; ) {
      months.push(k);
      const [y, mo] = k.split("-").map(Number);
      k = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
    }
    const endExclusive = (() => {
      const [y, mo] = months[months.length - 1].split("-").map(Number);
      return mo === 12 ? `${y + 1}-01-01` : `${y}-${String(mo + 1).padStart(2, "0")}-01`;
    })();
    const t0 = Date.parse(`${start}T00:00:00Z`);
    const span = Date.parse(`${endExclusive}T00:00:00Z`) - t0;
    const pos = (date: string) => ((Date.parse(`${date}T00:00:00Z`) - t0) / span) * 100;
    const shown = upcoming.filter((r) => r.date < endExclusive);
    // Täta tävlingar på olika höjd: på mobil är en månad ~25 px, och två
    // lopp med en veckas mellanrum hamnade annars ovanpå varandra.
    const lastInLane: number[] = [];
    const lanes = shown.map((r) => {
      const x = pos(r.date);
      let lane = lastInLane.findIndex((lx) => x - lx >= 4);
      if (lane < 0) lane = Math.min(lastInLane.length, 2);
      lastInLane[lane] = x;
      return lane;
    });
    const laneCount = Math.max(1, ...lanes.map((l) => l + 1));
    return (
      <div className="rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-3.5">
        <div className="relative" style={{ height: `${2.25 + laneCount * 1.1}rem` }}>
          {/* Månadernas gränser */}
          {months.map((mk, i) => (
            <div
              key={mk}
              className="absolute top-0 bottom-0 border-l border-[var(--line)]"
              style={{ left: `${(i / months.length) * 100}%` }}
            />
          ))}
          {/* Idag */}
          <div
            className="absolute top-0 bottom-5 w-0.5 rounded bg-[var(--ink-3)]"
            style={{ left: `${pos(todayKey)}%` }}
            title="Idag"
          />
          {/* Tävlingarna */}
          {shown.map((r, i) => (
            <a
              key={`${r.date}|${r.name}`}
              href={`#${raceAnchor(r)}`}
              title={`${r.name} · ${formatDateShort(r.date, true)} · ${priorityLabel(r.priority)}`}
              aria-label={`${r.name}, ${formatDateShort(r.date, true)}, ${priorityLabel(r.priority)}`}
              className="absolute flex h-6 w-6 -translate-x-1/2 items-center justify-center"
              style={{ left: `${pos(r.date)}%`, top: `${0.25 + lanes[i] * 1.1}rem` }}
            >
              <span
                className={`rounded-full ${
                  r.priority === "A"
                    ? "h-4 w-4 border-2 border-[var(--surface)] bg-[var(--foreground)]"
                    : "h-2.5 w-2.5 border-2 border-[var(--foreground)] bg-[var(--surface)]"
                }`}
              />
            </a>
          ))}
          {/* Månadsnamn */}
          {months.map((mk, i) => (
            <span
              key={`l${mk}`}
              className="absolute bottom-0 pl-1 text-[0.6875rem] text-[var(--ink-3)]"
              style={{ left: `${(i / months.length) * 100}%` }}
            >
              {months.length > 9 && i % 2 === 1 ? "" : MONTHS_SHORT[Number(mk.slice(5, 7)) - 1]}
            </span>
          ))}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-[var(--ink-3)]">
          <span className="flex items-center gap-1.5">
            <PriorityMark priority="A" /> A-lopp
          </span>
          <span className="flex items-center gap-1.5">
            <PriorityMark priority="B" /> B-lopp
          </span>
          <span className="flex items-center gap-1.5">
            <span aria-hidden className="h-3 w-0.5 rounded bg-[var(--ink-3)]" /> idag
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col gap-8 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Tävling"
        lead="Vad gruppen har framför sig. Tävlingarna syns i planeringen och kalendern; resultaten fylls i under Lopp."
      />


      {canEdit && (
        <details className="group rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between px-4 font-semibold text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
            + Lägg till tävling
            <span aria-hidden className="text-[var(--ink-3)] transition-transform group-open:rotate-90">›</span>
          </summary>
          <form
            action={createPlannedCompetition}
            className="flex flex-col gap-3 border-t border-[var(--line)] p-4"
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
                <select name="priority" defaultValue="B" className={fieldClass}>
                  <option value="A">A-lopp</option>
                  <option value="B">B-lopp</option>
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
        </details>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Kommande
        </h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-[var(--ink-3)]">Inga tävlingar inlagda framåt.</p>
        ) : (
          <>
            {renderTimeline()}
            {byMonth(upcoming).map((g) => (
              <div key={g.key} className="flex flex-col gap-1.5">
                <h3 className="display flex items-baseline justify-between text-xs font-semibold tracking-[0.08em] text-[var(--ink-3)] uppercase">
                  {g.label}
                  <span className="font-normal tracking-normal normal-case">
                    {g.races.length} {g.races.length === 1 ? "tävling" : "tävlingar"}
                  </span>
                </h3>
                <ul className="flex flex-col divide-y divide-[var(--line)] rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
                  {g.races.map((r) => (
                    <RaceRow key={`${r.date}|${r.name}`} race={r} past={false} />
                  ))}
                </ul>
              </div>
            ))}
          </>
        )}
      </section>

      {past.length > 0 && (
        <details className="group flex flex-col gap-3">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between font-semibold text-[var(--foreground)] [&::-webkit-details-marker]:hidden">
            Genomförda ({past.length})
            <span aria-hidden className="text-[var(--ink-3)] transition-transform group-open:rotate-90">›</span>
          </summary>
          <ul className="mt-3 flex flex-col divide-y divide-[var(--line)] rounded-[14px] border border-[var(--line)] bg-[var(--surface)]">
            {past.map((r) => (
              <RaceRow key={`${r.date}|${r.name}`} race={r} past />
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
