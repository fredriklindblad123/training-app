/* Repetitionerna i ett pass, ur klockans råa varv.
 *
 * KLOCKAN DELAR VARV MITT I EN REPETITION. Den tar ett autovarv vid varje
 * kilometer även inne i ett intervall, så en 1600-metersrepetition ligger som
 * två rader — 1000 m plus 600 m. Ett verkligt pass (2 km uppvärmning,
 * 5×1600 m, nedjogg) blev därför tio korta varv i stället för fem långa.
 *
 * Vilorna definierar repetitionerna: allt aktivt mellan två vilor är ETT varv,
 * oavsett hur många rader klockan delat upp det i.
 *
 * MEN BARA NÄR PASSET HAR VILOR. Alla pass märker inte vilan som `rest` — ett
 * annat verkligt pass, 6×3 min med joggvila, har vilorna märkta `active`, och
 * där finns inga gränser att gruppera på. Skulle man ändå slå ihop blev hela
 * passet ett enda varv, vilket är sämre än att inte slå ihop alls.
 *
 * SAMMA REGEL FINNS I SQL, i funktionen latest_splits_with_record som
 * dashboarden använder (se migrationen
 * 20260918090000_merge_split_intervals_between_rests). Två implementationer av
 * samma regel är en risk, och skälet att den finns här också är att dagvyn
 * läser varven direkt ur tabellen: den har ingen funktion att fråga. Ändras
 * regeln måste båda ändras.
 */

export type RawSplit = {
  split_index: number;
  split_type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_hr: number | null;
};

export type MergedSplit = {
  /** Lägsta index bland de sammanslagna raderna — bär ordningen. */
  splitIndex: number;
  /** Hur många av klockans rader varvet består av. 2 betyder att den delat
   * repetitionen mitt i. */
  parts: number;
  isRest: boolean;
  distanceMeters: number;
  durationSeconds: number;
  /** Tidsviktad medelpuls över delarna. Ett rakt medelvärde hade gett ett
   * 200-metersvarv samma tyngd som ett på 1600. */
  avgHr: number | null;
};

export function mergeSplitsBetweenRests(splits: RawSplit[]): MergedSplit[] {
  const sorted = [...splits].sort((a, b) => a.split_index - b.split_index);
  const hasRests = sorted.some((s) => s.split_type === "rest");

  const out: MergedSplit[] = [];
  for (const s of sorted) {
    const isRest = s.split_type === "rest";
    const distance = s.distance_meters ?? 0;
    const duration = s.duration_seconds ?? 0;
    const prev = out[out.length - 1];

    /* Slås ihop med föregående bara om båda är aktiva OCH passet har vilor
     * som gränser. Vilor slås aldrig ihop — två vilor i rad är ovanligt, och
     * att slå ihop dem skulle dölja att det låg en repetition emellan som
     * klockan missat. */
    const mergeable = hasRests && !isRest && prev != null && !prev.isRest;

    if (mergeable) {
      const hrSum =
        (prev.avgHr ?? 0) * prev.durationSeconds + (s.avg_hr ?? 0) * duration;
      const hrWeight =
        (prev.avgHr != null ? prev.durationSeconds : 0) + (s.avg_hr != null ? duration : 0);
      prev.parts += 1;
      prev.distanceMeters += distance;
      prev.durationSeconds += duration;
      prev.avgHr = hrWeight > 0 ? Math.round(hrSum / hrWeight) : prev.avgHr;
    } else {
      out.push({
        splitIndex: s.split_index,
        parts: 1,
        isRest,
        distanceMeters: distance,
        durationSeconds: duration,
        avgHr: s.avg_hr,
      });
    }
  }
  return out;
}
