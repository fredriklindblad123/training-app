// Delad logik för dashboardens KPI-ringar: hur mycket ringen ska fyllas och
// vilken status (bra/håll koll/avviker) den ska färgas med, givet ett värde
// och ett riktvärde.
//
// Ringen är alltid orienterad så att "fullare ring" betyder "minst lika bra
// som riktvärdet" — oavsett om markören är en sådan där högt är bra
// (distans, HRV) eller där lågt är bra (vilopuls, muskelömhet). Utan den
// vändningen skulle en lite fylld ring kunna betyda "bra" för en
// lower_is_better-markör, vilket motsäger hur en ring normalt läses.

export type RingDirection = "higher_is_better" | "lower_is_better" | "neutral";
export type RingStatus = "good" | "watch" | "concern" | "neutral" | "unknown";

/** Andel av riktvärdet som räknas som "bra" respektive "håll koll" — under
 * den nedre gränsen blir det rött. Samma gränser oavsett markör, så att en
 * ring alltid går att jämföra rakt av mot en annan. */
const GOOD_THRESHOLD = 0.9;
const WATCH_THRESHOLD = 0.6;

export function ringFillAndStatus(
  value: number | null,
  target: number | null,
  direction: RingDirection,
): { fill: number; status: RingStatus } {
  if (direction === "neutral") {
    if (value == null || target == null || target <= 0) return { fill: 0, status: "unknown" };
    return { fill: clamp01(value / target), status: "neutral" };
  }

  if (value == null || target == null || target <= 0) return { fill: 0, status: "unknown" };

  // Noll av något man vill ha lite av (t.ex. 0 skadedagar) är bästa möjliga
  // utfall — kvoten target/value vore annars odefinierad.
  if (direction === "lower_is_better" && value <= 0) return { fill: 1, status: "good" };

  const achievement = direction === "higher_is_better" ? value / target : target / value;
  const fill = clamp01(achievement);

  let status: RingStatus;
  if (achievement >= GOOD_THRESHOLD) status = "good";
  else if (achievement >= WATCH_THRESHOLD) status = "watch";
  else status = "concern";

  return { fill, status };
}

function clamp01(n: number): number {
  return Math.min(Math.max(n, 0), 1);
}
