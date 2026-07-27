/* ---------------------------------------------------------------------------
 * P2.1 i docs/insikter-roadmap.md: passkvalitet för återkommande nyckelpass.
 *
 * Frågan som faktiskt betyder något för en medeldistanslöpare är inte "hur
 * mycket sprang jag" utan *"går samma pass snabbare nu än för tre månader
 * sedan, vid samma eller lägre puls?"*
 *
 * För att kunna ställa den frågan måste pass som är samma pass gå att känna
 * igen. Passnamnen duger inte — samma session heter omväxlande
 * "Tröskel 15x400m/1min vila", "15x400" och "Göteborg Löpning". Signaturen
 * byggs därför ur varvdatan (P0.2): antal aktiva varv och deras distanser.
 *
 * ── Avrundning ────────────────────────────────────────────────────────────
 * GPS-mätta varv landar aldrig exakt: 394, 403, 398, 405, 400, 402 m är alla
 * samma 400-meterintervall. Distansen avrundas därför innan den jämförs.
 * ------------------------------------------------------------------------ */

/** Ett varv, med kolumnnamn som i activity_splits. */
export type SignatureLap = {
  activity_id: string;
  split_index: number;
  split_type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  avg_hr: number | null;
  max_hr: number | null;
};

/** En grupp likadana repetitioner i följd, t.ex. 4 × 600 m. */
export type RepGroup = {
  distanceMeters: number;
  count: number;
  /** Varvtiderna i sekunder, i den ordning de sprangs. */
  times: number[];
};

export type SessionSignature = {
  /** Stabil nyckel för gruppering, t.ex. "2x1000+4x600". */
  key: string;
  /** Läsbar etikett, t.ex. "2×1000 m + 4×600 m". */
  label: string;
  groups: RepGroup[];
  totalReps: number;
  /** Summerad distans i det kvalitativa arbetet, exklusive vila. */
  activeMeters: number;
};

/**
 * Avrundar en GPS-mätt varvdistans till närmaste rimliga banlängd.
 *
 * Under 250 m används 50-metersteg (150/200-meterryck ska inte klumpas ihop),
 * däröver 100-metersteg. En 394-metersmätning och en 406-metersmätning blir
 * båda 400.
 */
export function roundRepDistance(meters: number): number {
  const step = meters < 250 ? 50 : 100;
  return Math.round(meters / step) * step;
}

/** Minsta andel av passets typiska repetition som ett varv måste ha för att
 * räknas som en egen repetition. */
const MIN_REP_RATIO = 0.3;

/** Absolut golv, oavsett hur korta passets repetitioner är. */
const MIN_REP_METERS = 60;

/**
 * De aktiva varv som faktiskt är repetitioner.
 *
 * Klockan producerar strövarv: en felaktig lap-tryckning ger ett 50-meters
 * varv mitt i ett 2×1000-pass. Utan filtrering blir det en egen signatur
 * ("2×1000 m + 1×50 m") som splittrar samma pass i två grupper, och drar ner
 * snittiden katastrofalt eftersom ett 18-sekundersvarv medelvärdesbildas
 * med två på 305 sekunder.
 *
 * Gränsen är relativ mot passets egen median, så ett riktigt 300-metersryck
 * i ett 1200/600/300-pass överlever medan ett 50-metersströ i ett
 * 400-meterspass faller bort.
 */
function activeReps(laps: SignatureLap[]): SignatureLap[] {
  const active = laps
    .filter((l) => l.split_type === "active" && l.distance_meters && l.duration_seconds)
    .sort((a, b) => a.split_index - b.split_index);
  if (active.length === 0) return [];

  const distances = active
    .map((l) => l.distance_meters as number)
    .sort((a, b) => a - b);
  const medianDistance = distances[Math.floor(distances.length / 2)];
  const floor = Math.max(MIN_REP_METERS, medianDistance * MIN_REP_RATIO);

  return active.filter((l) => (l.distance_meters as number) >= floor);
}

/**
 * Bygger en signatur ur ett passs varv.
 *
 * Endast varv märkta `active` räknas — vilan varierar i längd och skulle
 * göra två genomföranden av samma pass olika. Returnerar null när passet
 * inte har något strukturerat kvalitetsarbete alls (t.ex. en rak distans).
 */
export function buildSessionSignature(laps: SignatureLap[]): SessionSignature | null {
  const active = activeReps(laps);

  // Ett enda varv är en rak löprunda, inte ett intervallpass.
  if (active.length < 2) return null;

  const groups: RepGroup[] = [];
  for (const lap of active) {
    const distance = roundRepDistance(lap.distance_meters as number);
    const last = groups[groups.length - 1];
    if (last && last.distanceMeters === distance) {
      last.count += 1;
      last.times.push(lap.duration_seconds as number);
    } else {
      groups.push({ distanceMeters: distance, count: 1, times: [lap.duration_seconds as number] });
    }
  }

  const key = groups.map((g) => `${g.count}x${g.distanceMeters}`).join("+");
  const label = groups
    .map((g) => `${g.count}×${g.distanceMeters} m`)
    .join(" + ");

  return {
    key,
    label,
    groups,
    totalReps: active.length,
    activeMeters: groups.reduce((sum, g) => sum + g.count * g.distanceMeters, 0),
  };
}

/** Ett genomförande av ett pass med en viss signatur. */
export type SignatureOccurrence = {
  activityId: string;
  date: string;
  signature: SessionSignature;
  /** Snitt över de aktiva varven, sekunder. */
  meanRepSeconds: number;
  /** Snittpuls över aktiva varv, viktad på tid. */
  meanRepHr: number | null;
  laps: SignatureLap[];
};

/**
 * Grupperar genomföranden på signatur och returnerar bara de signaturer som
 * förekommer mer än en gång — ett pass som körts en enda gång säger inget om
 * utveckling, vilket är hela poängen med vyn.
 */
export function groupBySignature(
  occurrences: SignatureOccurrence[],
  { minOccurrences = 2 }: { minOccurrences?: number } = {},
): { signature: SessionSignature; occurrences: SignatureOccurrence[] }[] {
  const byKey = new Map<string, SignatureOccurrence[]>();
  for (const occ of occurrences) {
    byKey.set(occ.signature.key, [...(byKey.get(occ.signature.key) ?? []), occ]);
  }

  return [...byKey.entries()]
    .filter(([, list]) => list.length >= minOccurrences)
    .map(([, list]) => ({
      signature: list[0].signature,
      occurrences: [...list].sort((a, b) => a.date.localeCompare(b.date)),
    }))
    .sort((a, b) => b.occurrences.length - a.occurrences.length);
}

/** Bygger ett genomförande ur ett passs varv. Null när passet saknar signatur. */
export function toOccurrence(
  activityId: string,
  date: string,
  laps: SignatureLap[],
): SignatureOccurrence | null {
  const signature = buildSessionSignature(laps);
  if (!signature) return null;

  // Samma filtrering som signaturen bygger på — annars räknas strövarv in i
  // snittiden trots att de inte finns i signaturen.
  const active = activeReps(laps);
  const times = active.map((l) => l.duration_seconds as number);
  const meanRepSeconds = times.reduce((a, b) => a + b, 0) / times.length;

  // Tidsviktad puls: ett 2000-metersvarv ska väga tyngre än ett 200-meters.
  const withHr = active.filter((l) => l.avg_hr != null);
  const hrWeight = withHr.reduce((sum, l) => sum + (l.duration_seconds as number), 0);
  const meanRepHr =
    hrWeight > 0
      ? withHr.reduce((sum, l) => sum + (l.avg_hr as number) * (l.duration_seconds as number), 0) /
        hrWeight
      : null;

  return { activityId, date, signature, meanRepSeconds, meanRepHr, laps };
}
