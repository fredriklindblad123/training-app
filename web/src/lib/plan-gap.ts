import type { createClient } from "@/lib/supabase/server";
import { formatKm, formatMinutes, formatPace } from "@/lib/format";

/* Plan mot utfall (2026-11-24) — skillnaden mellan det planerade och det
 * genomförda passet i distans, tid, fart och puls, på Idag och i dagvyn.
 *
 * KONTROLLRÄKNAT MOT ALICES PASS 16–24/11 innan det byggdes:
 *
 * HELA PASSET, INTE HUVUDDELEN. Planens distans och tid gäller hela passet
 * med uppvärmning och nerjogg ("12 km, 55 min" för ett tröskelpass), och
 * Garmin delar ett kvalitetspass i tre aktiviteter. Jämförelsen görs därför
 * mot det sammanslagna passet (lib/sessions.ts), med samma tid och distans
 * som vyn redan visar.
 *
 * FARTMÅLET ÄR REPENS. target_pace_seconds_per_km finns bara på
 * kvalitetspassen och betyder fart på repen (3:55–4:00 för tröskel). Det
 * jämförs mot medianen av repen — bara rep på minst en minut, annars drar
 * 30-sekundersrep och backsprinter ner medianen. Distanspass saknar fartmål;
 * där jämförs snittfarten mot den fart planens distans och tid ger.
 *
 * PULSEN MÄTS SOM PÅ FORM. Planen har inget pulsmål, så pulsen läses mot
 * löparens trösklar för den PLANERADE passtypen — klockans kategori stämmer
 * inte alltid (23/11 var planen distans och klockan kallade passet tröskel).
 * Samma mått som växlarna på Form, så att två sidor inte säger olika saker:
 *   distans/långpass  snittpuls för passet mot LT1
 *   tröskel           slutpuls per rep (median) mot bandet LT1–LT2
 *   intervall         högsta puls i passet mot LT2
 *
 * OBSERVATION, INTE BETYG (CLAUDE.md, B4). Skillnaden skrivs ut som tal och
 * ord, i grått. Ingen grön bock för "som planerat", ingen röd för en avvikelse.
 * Tröskelvärden som är självskattade sägs ut. */

export type GapPlan = {
  workout_type: string;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  target_pace_seconds_per_km: number | null;
};

export type GapDone = {
  distanceMeters: number;
  /** Den tid vyn visar för passet (utan styrka). */
  seconds: number;
  avgHr: number | null;
};

export type RepStats = {
  /** Antal rep som räknats (minst en minut, eller alla om inga är så långa). */
  reps: number;
  /** Median, sekunder per km. */
  pace: number;
  /** Median av slutpulsen per rep. */
  hrEnd: number | null;
  /** Högsta puls i aktiviteten. */
  maxHr: number | null;
};

export type GapThresholds = { lt1: number | null; lt2: number | null; measured: boolean };

export type GapRow = { label: string; plan: string; done: string; diff: string };

export type PlanGap = { rows: GapRow[]; note: string | null };

const RUN_TYPES = new Set(["easy", "long_run", "threshold", "interval", "threshold_test", "test"]);

function signed(n: number, fmt: (x: number) => string): string {
  if (Math.abs(n) < 1e-9) return "±0";
  return `${n > 0 ? "+" : "−"}${fmt(Math.abs(n))}`;
}

function paceDiff(done: number, plan: number): string {
  const d = Math.round(done - plan);
  if (Math.abs(d) <= 2) return "som planerat";
  return `${Math.abs(d)} s/km ${d < 0 ? "snabbare" : "långsammare"}`;
}

const mmss = (s: number) => formatPace(s).replace(" /km", "");

export function planGap(
  plan: GapPlan,
  done: GapDone,
  reps: RepStats | null,
  thresholds: GapThresholds,
): PlanGap | null {
  const rows: GapRow[] = [];
  const t = plan.workout_type;

  const pd = plan.target_distance_meters ?? 0;
  if (pd > 0 && done.distanceMeters > 0) {
    rows.push({
      label: "Distans",
      plan: formatKm(pd),
      done: formatKm(done.distanceMeters),
      // Avrundat till en decimal FÖRE tecknet: 13 008 mot 13 000 m gav "+0,0 km".
      diff: signed(Math.round((done.distanceMeters - pd) / 100) / 10, (x) => formatKm(x * 1000)),
    });
  }

  const pt = plan.target_duration_seconds ?? 0;
  if (pt > 0 && done.seconds > 0) {
    const dMin = Math.round(done.seconds / 60);
    const pMin = Math.round(pt / 60);
    rows.push({
      label: "Tid",
      plan: formatMinutes(pMin),
      done: formatMinutes(dMin),
      diff: signed(dMin - pMin, (x) => formatMinutes(x)),
    });
  }

  if (RUN_TYPES.has(t)) {
    if (plan.target_pace_seconds_per_km && reps && reps.reps > 0) {
      rows.push({
        label: "Repfart",
        plan: mmss(plan.target_pace_seconds_per_km),
        done: mmss(reps.pace),
        diff: paceDiff(reps.pace, plan.target_pace_seconds_per_km),
      });
    } else if (!plan.target_pace_seconds_per_km && pd > 0 && pt > 0 && done.distanceMeters > 0 && done.seconds > 0) {
      const p = pt / (pd / 1000);
      const d = done.seconds / (done.distanceMeters / 1000);
      rows.push({ label: "Snittfart", plan: mmss(p), done: mmss(d), diff: paceDiff(d, p) });
    }
  }

  const { lt1, lt2 } = thresholds;
  if ((t === "easy" || t === "long_run") && lt1 && done.avgHr) {
    const hr = Math.round(done.avgHr);
    rows.push({
      label: "Puls, snitt",
      plan: `under ${lt1}`,
      done: String(hr),
      diff: hr < lt1 ? `${lt1 - hr} under LT1` : hr === lt1 ? "vid LT1" : `${hr - lt1} över LT1`,
    });
  } else if (t === "threshold" && lt1 && lt2 && reps?.hrEnd) {
    const hr = Math.round(reps.hrEnd);
    rows.push({
      label: "Puls, slut per rep",
      plan: `${lt1}–${lt2}`,
      done: String(hr),
      diff: hr < lt1 ? `${lt1 - hr} under bandet` : hr > lt2 ? `${hr - lt2} över bandet` : "inom bandet",
    });
  } else if (t === "interval" && lt2 && reps?.maxHr) {
    const hr = Math.round(reps.maxHr);
    rows.push({
      label: "Puls, högsta",
      plan: `över ${lt2}`,
      done: String(hr),
      diff: hr >= lt2 ? `${hr - lt2} över LT2` : `${lt2 - hr} under LT2`,
    });
  }

  if (rows.length === 0) return null;
  const notes: string[] = [];
  if (rows.some((r) => r.label === "Repfart") && reps)
    notes.push(`Repfart: median av ${reps.reps} rep på minst en minut.`);
  if (rows.some((r) => r.label.startsWith("Puls")) && !thresholds.measured)
    notes.push("Trösklarna är självskattade, inte uppmätta i ett test.");
  return { rows, note: notes.length ? notes.join(" ") : null };
}

type Lap = {
  activity_id: string;
  split_type: string | null;
  distance_meters: number | null;
  duration_seconds: number | null;
  hr_end: number | null;
  max_hr: number | null;
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Repen per aktivitet, ur klockans varv. Samma urval som "Samma pass igen"
 * (lib/same-session.ts): aktiva varv på minst 25 s, snabbare än 6:00/km
 * (långsammare är joggvila som råkat märkas aktiv). Rep på minst en minut
 * används när de finns. */
export async function fetchRepStats(
  supabase: Awaited<ReturnType<typeof createClient>>,
  activityIds: string[],
): Promise<Map<string, RepStats>> {
  const out = new Map<string, RepStats>();
  if (activityIds.length === 0) return out;
  const { data } = await supabase
    .from("activity_splits")
    .select("activity_id, split_type, distance_meters, duration_seconds, hr_end, max_hr")
    .in("activity_id", activityIds);
  const by = new Map<string, Lap[]>();
  for (const l of (data ?? []) as Lap[]) by.set(l.activity_id, [...(by.get(l.activity_id) ?? []), l]);
  for (const [id, laps] of by) {
    const maxes = laps.map((l) => l.max_hr).filter((h): h is number => h != null).map(Number);
    const work = laps.filter(
      (l) =>
        l.split_type === "active" &&
        (l.duration_seconds ?? 0) >= 25 &&
        (l.distance_meters ?? 0) > 0 &&
        (l.duration_seconds as number) / ((l.distance_meters as number) / 1000) < 360,
    );
    // Ett kvalitetspass har vila mellan repen; utan vilovarv är det ett
    // distanspass med automatiska kilometervarv.
    if (work.length < 2 || laps.filter((l) => l.split_type === "rest").length < 2) {
      if (maxes.length) out.set(id, { reps: 0, pace: 0, hrEnd: null, maxHr: Math.max(...maxes) });
      continue;
    }
    const long = work.filter((l) => (l.duration_seconds as number) >= 60);
    const use = long.length >= 2 ? long : work;
    const hrs = use.map((l) => l.hr_end).filter((h): h is number => h != null).map(Number);
    out.set(id, {
      reps: use.length,
      pace: median(use.map((l) => (l.duration_seconds as number) / ((l.distance_meters as number) / 1000))),
      hrEnd: hrs.length ? median(hrs) : null,
      maxHr: maxes.length ? Math.max(...maxes) : null,
    });
  }
  return out;
}
