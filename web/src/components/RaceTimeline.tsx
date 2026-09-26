import { priorityLabel } from "@/lib/planning";

/* Kommande tävlingar på ett band.
 *
 * Bandet finns för frågan listan inte svarar på: hur ligger loppen mot
 * VARANDRA. Tre tävlingar på fjorton dagar i maj och sedan tomt till augusti
 * är en planeringsfråga man ser direkt här och aldrig i en lista.
 *
 * ETIKETTERNA FÅR EGNA BANOR NÄR DE KROCKAR, och det är hela poängen med den
 * här implementationen. Säsongsbandets tävlingsmarkörer togs bort just för att
 * de skrev över varandra: alla låg på samma rad, centrerade över sin punkt, och
 * två lopp några veckor isär blev oläsliga. Här får varje etikett den första
 * bana där den inte överlappar en redan utplacerad, så bandet växer nedåt i
 * stället för att bli gröt.
 *
 * Bredden uppskattas i procent av bandet. Den exakta pixelbredden är inte känd
 * på servern, och att mäta i klienten vore en helt ny sorts komplexitet för en
 * tröskel som bara avgör när två etiketter råkar nudda varandra — samma
 * avvägning som axisTicks i SeasonTimeline gör.
 */

export type TimelineRace = {
  name: string;
  date: string;
  priority: string;
  athletes: number;
};

/** Ungefärlig etikettbredd som andel av bandet. Tilltaget i överkant: hellre
 * en extra bana än två namn som ligger på varandra. */
const LABEL_PCT = 15;

const MONTHS = ["jan", "feb", "mar", "apr", "maj", "jun", "jul", "aug", "sep", "okt", "nov", "dec"];

function dayNumber(dateKey: string): number {
  return Math.floor(Date.UTC(
    Number(dateKey.slice(0, 4)),
    Number(dateKey.slice(5, 7)) - 1,
    Number(dateKey.slice(8, 10)),
  ) / 864e5);
}

/** Första dagen i varje månad mellan två datum, till axeln. */
function monthTicks(fromKey: string, toKey: string): { key: string; label: string }[] {
  const out: { key: string; label: string }[] = [];
  let y = Number(fromKey.slice(0, 4));
  let m = Number(fromKey.slice(5, 7));
  const endY = Number(toKey.slice(0, 4));
  const endM = Number(toKey.slice(5, 7));
  while (y < endY || (y === endY && m <= endM)) {
    out.push({
      key: `${y}-${String(m).padStart(2, "0")}-01`,
      label: m === 1 ? `${MONTHS[0]} ${String(y).slice(2)}` : MONTHS[m - 1],
    });
    m += 1;
    if (m > 12) { m = 1; y += 1; }
  }
  return out;
}

/* Tävlingsfärgen är --cat-race oavsett prioritet. B-lopp bar tidigare
 * --status-watch, som är mätvärdesstatusens gula "se upp" — så ett B-lopp
 * blev orange i tränarvyerna och magenta i adeptens dagvy, och gulen sa
 * dessutom "varning" om ett lopp. Rapporterat 2026-09-26.
 *
 * Prioriteten bärs nu av FYLLNAD i stället för kulör: A-lopp fyllda, B-lopp
 * ihåliga ringar. Samma språk som PassMarker (fylld = genomfört, ihålig =
 * planerat), och hue behåller en enda betydelse. */
export function RaceTimeline({ races, todayKey }: { races: TimelineRace[]; todayKey: string }) {
  if (races.length === 0) return null;

  const last = races.reduce((a, b) => (a.date > b.date ? a : b)).date;
  const min = dayNumber(todayKey);
  /* Minst ett kvartal brett även om enda loppet är nästa vecka — annars blir
   * bandet en punkt vid kanten och säger ingenting om avstånd. */
  const max = Math.max(dayNumber(last), min + 90);
  const span = Math.max(1, max - min);
  const pct = (dateKey: string) => ((dayNumber(dateKey) - min) / span) * 100;

  const sorted = [...races].sort((a, b) => a.date.localeCompare(b.date));

  // Banfördelning: första bana där etiketten får plats.
  const laneEnds: number[] = [];
  const placed = sorted.map((r) => {
    const left = pct(r.date);
    let lane = laneEnds.findIndex((end) => left > end);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = left + LABEL_PCT;
    return { race: r, left, lane };
  });
  const lanes = Math.max(1, laneEnds.length);

  const ticks = monthTicks(todayKey, last).filter((t) => pct(t.key) >= 0 && pct(t.key) <= 100);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
        Säsongen framför oss
      </h2>
      <div className="day-surface overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
        <div className="min-w-[32rem]">
          {/* Månadsrutnätet ritas bakom både linjen och etiketterna, så att man
              kan läsa AV när ett lopp ligger och inte bara att det ligger
              "någonstans till höger". */}
          <div className="relative" style={{ height: `${lanes * 2.5 + 1.75}rem` }}>
            {ticks.map((t) => (
              <span
                key={t.key}
                aria-hidden
                className="absolute top-0 bottom-5 w-px bg-[var(--line)]"
                style={{ left: `${pct(t.key)}%` }}
              />
            ))}

            {/* Idag-markören är bandets vänsterkant: allt som visas ligger
                framför en. Ett streck vid noll säger var man står. */}
            <span aria-hidden className="absolute top-0 bottom-5 left-0 w-0.5 bg-[var(--foreground)]" />

            {placed.map(({ race, left, lane }) => (
              <div
                key={`${race.date}|${race.name}`}
                className="absolute flex flex-col gap-0.5"
                style={{
                  left: `${left}%`,
                  top: `${lane * 2.5}rem`,
                  // Etiketten växer åt höger från sin punkt. Nära högerkanten
                  // skulle den annars hamna utanför bandet.
                  maxWidth: `${Math.max(12, 100 - left)}%`,
                }}
              >
                <span className="flex items-center gap-1.5">
                  <span
                    aria-hidden
                    className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                    style={{
                      backgroundColor: race.priority === "A" ? "var(--cat-race)" : "transparent",
                      border: "2px solid var(--cat-race)",
                      boxSizing: "border-box",
                    }}
                  />
                  <span className="display truncate text-xs font-semibold text-[var(--foreground)]">
                    {race.name}
                  </span>
                </span>
                <span className="tabular truncate pl-4 text-[10px] text-[var(--ink-3)]">
                  {race.date.slice(5)} · {priorityLabel(race.priority)} ·{" "}
                  {race.athletes} {race.athletes === 1 ? "löpare" : "löpare"}
                </span>
              </div>
            ))}

            {/* Månadsetiketterna längst ned, under banorna. */}
            <div className="absolute inset-x-0 bottom-0 h-4">
              {ticks.map((t) => (
                <span
                  key={t.key}
                  className="absolute top-0 -translate-x-1/2 text-[10px] text-[var(--ink-3)]"
                  style={{ left: `${pct(t.key)}%` }}
                >
                  {t.label}
                </span>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
