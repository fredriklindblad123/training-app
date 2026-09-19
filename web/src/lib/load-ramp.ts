// Rampen: hur stort steget blev, inte hur stor nivån är.
//
// Garmins `training_load` är ett EPOC-härlett tal utan enhet och utan
// jämförbarhet mellan personer — "belastning 2847" går inte att ställa mot
// något mål. Det enda belastningstalet faktiskt duger till är att jämföras med
// sig självt över tid: blev den här veckan ett rimligt steg från de föregående?
// Det är en fråga med ett svar man kan agera på, och den ryms på en rad.
//
// Därför ersätter det här hela det gamla staplade belastningsdiagrammet.

/** Veckor bakåt som rampen mäts mot. Fyra: kort nog att fånga en faktisk
 * uppbyggnad, långt nog att en enstaka vilovecka inte får bestämma basen. */
const BASE_WEEKS = 4;

/** Över den här ökningen är steget värt att flagga. 15 % är den vanliga
 * tumregeln för veckosteg; den är inte en naturlag och skrivs ut som en
 * rekommendation i UI:t, inte som en gräns. */
export const RAMP_WARN = 0.15;

export type LoadRamp = {
  /** Veckan som mäts, som måndagsnyckel (YYYY-MM-DD). */
  week: string;
  /** Veckans totala belastning. */
  value: number;
  /** Medelbelastning över de föregående veckorna. */
  base: number;
  /** Förändring mot basen, som andel: 0,38 = +38 %. */
  change: number;
  /** Antal veckor bakom `base` — färre än BASE_WEEKS i början av ett block. */
  baseWeeks: number;
};

/**
 * Rampen för den senast *avslutade* veckan.
 *
 * Den pågående veckan utesluts medvetet: en halvfärdig vecka jämförd mot fyra
 * hela visar alltid ett fall, och en sådan siffra hade sagt "du har backat
 * 60 %" varje måndag. `currentWeekKey` är innevarande veckas måndagsnyckel —
 * finns den sist i serien hoppas den över.
 *
 * `null` när underlaget inte räcker: minst två föregående veckor med
 * belastning krävs, annars är basen ett enda tal och rampen brus.
 */
export function computeLoadRamp(
  weekKeys: string[],
  weeklyTotals: number[],
  currentWeekKey: string,
): LoadRamp | null {
  let last = weekKeys.length - 1;
  if (last >= 0 && weekKeys[last] === currentWeekKey) last -= 1;
  if (last < 1) return null;

  const value = weeklyTotals[last] ?? 0;
  if (value <= 0) return null;

  const prior = weeklyTotals
    .slice(Math.max(0, last - BASE_WEEKS), last)
    .filter((v) => v > 0);
  if (prior.length < 2) return null;

  const base = prior.reduce((a, b) => a + b, 0) / prior.length;
  if (base <= 0) return null;

  return {
    week: weekKeys[last],
    value,
    base,
    change: value / base - 1,
    baseWeeks: prior.length,
  };
}
