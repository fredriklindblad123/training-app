import type { createClient } from "@/lib/supabase/server";
import { formatKm, formatMinutes, formatPace } from "@/lib/format";
import { pairPlanDone } from "@/lib/pair-plan";
import { withoutEdgeLaps } from "@/lib/same-session";

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

/** Över, under eller på planen (2026-11-27, begärt: "en liten symbol").
 * Neutral riktning, inget betyg — se dirOf. */
export type GapDir = "over" | "under" | "on";
export type GapRow = { label: string; plan: string; done: string; diff: string; dir?: GapDir };

/** Volym (distans, tid): inom 3 % av planen räknas som på planen — en
 * kilometer hit eller dit på en vecka om 40 km är ingen avvikelse. */
function volDir(done: number, plan: number): GapDir {
  if (plan <= 0) return "on";
  const r = done / plan;
  return r > 1.03 ? "over" : r < 0.97 ? "under" : "on";
}

/** Riktningen för fart och puls, ur samma ord som skillnaden skrivs med.
 * Fart: snabbare = över. Puls: inom den planerade zonen = på planen —
 * distanspassets plan är "under LT1", så under LT1 är på planen. */
export function dirOf(row: GapRow): GapDir {
  if (row.dir) return row.dir;
  const d = row.diff;
  if (/snabbare/.test(d)) return "over";
  if (/långsammare/.test(d)) return "under";
  if (/under LT1|vid LT1|inom bandet|över LT2/.test(d)) return "on";
  if (/över LT1|över bandet/.test(d)) return "over";
  if (/under bandet|under LT2/.test(d)) return "under";
  return "on";
}

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
      dir: volDir(done.distanceMeters, pd),
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
      dir: volDir(dMin, pMin),
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
  split_index: number;
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
    .select("activity_id, split_index, split_type, distance_meters, duration_seconds, hr_end, max_hr")
    .in("activity_id", activityIds);
  const by = new Map<string, Lap[]>();
  for (const l of (data ?? []) as Lap[]) by.set(l.activity_id, [...(by.get(l.activity_id) ?? []), l]);
  for (const [id, laps] of by) {
    const maxes = laps.map((l) => l.max_hr).filter((h): h is number => h != null).map(Number);
    // Ensamt uppvärmnings-/nerjoggsvarv bort, se withoutEdgeLaps.
    const work = withoutEdgeLaps(
      laps.filter(
        (l) =>
          l.split_type === "active" &&
          (l.duration_seconds ?? 0) >= 25 &&
          (l.distance_meters ?? 0) > 0 &&
          (l.duration_seconds as number) / ((l.distance_meters as number) / 1000) < 360,
      ),
      laps,
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

/* Veckan mot planen (2026-11-24) — samma jämförelse som för ett pass, men
 * summerad över veckans dagar. Samma dagsregel som "Blocket mot planen"
 * (lib/block-vs-plan.ts): bara dagar som passerat, och idag först när dagens
 * pass är gjort — annars ligger dagens planerade pass med i "plan" men inte
 * i "gjort".
 *
 * Distans och tid summeras rakt (löpning utan alternativträning; tid utan
 * styrka). Fart och puls räknas bara på de pass som går att para med ett
 * planerat pass (pairPlanDone, dag för dag) — ett oplanerat pass har inget
 * mål att jämföras med:
 *   Snittfart   distans- och långpass: summerad tid / summerad distans,
 *               planens fart ur planens distans och tid.
 *   Repfart     kvalitetspass med fartmål: snittet av målen mot snittet av
 *               passens repmedian.
 *   Puls        som för ett pass, per passtyp. */

export type WeekPlanRow = GapPlan & { scheduled_date: string };

type WeekSession = {
  date: string;
  category: string;
  distanceMeters: number;
  durationSeconds: number;
  avgHr: number | null;
  trainingSeconds: number;
  dominantId: string;
  /** Löpdistans i meter, utan alternativträning (sessionKm × 1000). */
  runMeters: number;
};

export function weekGap(
  plans: WeekPlanRow[],
  sessions: WeekSession[],
  reps: Map<string, RepStats>,
  thresholds: GapThresholds,
  weekStart: string,
  today: string,
): (PlanGap & { from: string; to: string; paired: number }) | null {
  const trainedToday = sessions.some((s) => s.date === today);
  const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
  const to = trainedToday ? today : yesterday;
  if (to < weekStart) return null;
  const duePlans = plans.filter((p) => p.scheduled_date >= weekStart && p.scheduled_date <= to);
  const done = sessions.filter((s) => s.date >= weekStart && s.date <= to);
  if (duePlans.length === 0) return null;

  const rows: GapRow[] = [];
  const planKm = duePlans
    .filter((p) => p.workout_type !== "cross_training")
    .reduce((s, p) => s + (p.target_distance_meters ?? 0), 0);
  // Löpdistans per aktivitet (sessionKm): en nerjogg efter crosstrainer räknas,
  // cykelkilometer gör det inte — oavsett vilken kategori passet fick.
  const doneKm = done.reduce((s, d) => s + d.runMeters, 0);
  if (planKm > 0)
    rows.push({
      label: "Distans",
      plan: formatKm(planKm),
      done: formatKm(doneKm),
      diff: signed(Math.round((doneKm - planKm) / 100) / 10, (x) => formatKm(x * 1000)),
      dir: volDir(doneKm, planKm),
    });
  const planSec = duePlans
    .filter((p) => p.workout_type !== "strength")
    .reduce((s, p) => s + (p.target_duration_seconds ?? 0), 0);
  const doneSec = done.reduce((s, d) => s + d.trainingSeconds, 0);
  if (planSec > 0) {
    const pm = Math.round(planSec / 60);
    const dm = Math.round(doneSec / 60);
    rows.push({ label: "Tid", plan: formatMinutes(pm), done: formatMinutes(dm), diff: signed(dm - pm, (x) => formatMinutes(x)), dir: volDir(dm, pm) });
  }

  // Para dag för dag.
  const pairs: { p: WeekPlanRow; d: WeekSession }[] = [];
  const dates = [...new Set(duePlans.map((p) => p.scheduled_date))];
  for (const date of dates)
    for (const { plan, done: d } of pairPlanDone(
      duePlans.filter((p) => p.scheduled_date === date),
      done.filter((s) => s.date === date),
      (p) => p.workout_type,
      (s) => s.category,
    ))
      if (plan && d) pairs.push({ p: plan, d });

  const easy = pairs.filter(
    ({ p, d }) =>
      (p.workout_type === "easy" || p.workout_type === "long_run") &&
      (p.target_distance_meters ?? 0) > 0 &&
      (p.target_duration_seconds ?? 0) > 0 &&
      d.distanceMeters > 0,
  );
  if (easy.length > 0) {
    const pp = easy.reduce((s, x) => s + (x.p.target_duration_seconds as number), 0) /
      (easy.reduce((s, x) => s + (x.p.target_distance_meters as number), 0) / 1000);
    const dp = easy.reduce((s, x) => s + x.d.durationSeconds, 0) / (easy.reduce((s, x) => s + x.d.distanceMeters, 0) / 1000);
    rows.push({ label: "Snittfart distans", plan: mmss(pp), done: mmss(dp), diff: paceDiff(dp, pp) });
  }
  const quality = pairs.filter(({ p, d }) => p.target_pace_seconds_per_km && (reps.get(d.dominantId)?.reps ?? 0) > 0);
  if (quality.length > 0) {
    const pp = quality.reduce((s, x) => s + (x.p.target_pace_seconds_per_km as number), 0) / quality.length;
    const dp = quality.reduce((s, x) => s + (reps.get(x.d.dominantId) as RepStats).pace, 0) / quality.length;
    rows.push({ label: "Repfart", plan: mmss(pp), done: mmss(dp), diff: paceDiff(dp, pp) });
  }

  const { lt1, lt2 } = thresholds;
  const easyHr = easy.filter((x) => x.d.avgHr != null);
  if (lt1 && easyHr.length > 0) {
    // Tidsviktat, som passets egen snittpuls.
    const hr = Math.round(
      easyHr.reduce((s, x) => s + (x.d.avgHr as number) * x.d.durationSeconds, 0) /
        easyHr.reduce((s, x) => s + x.d.durationSeconds, 0),
    );
    rows.push({
      label: "Puls distans",
      plan: `under ${lt1}`,
      done: String(hr),
      diff: hr < lt1 ? `${lt1 - hr} under LT1` : hr === lt1 ? "vid LT1" : `${hr - lt1} över LT1`,
    });
  }
  const thr = pairs
    .filter((x) => x.p.workout_type === "threshold")
    .map((x) => reps.get(x.d.dominantId)?.hrEnd)
    .filter((h): h is number => h != null);
  if (lt1 && lt2 && thr.length > 0) {
    const hr = Math.round(median(thr));
    rows.push({
      label: "Puls tröskelrep",
      plan: `${lt1}–${lt2}`,
      done: String(hr),
      diff: hr < lt1 ? `${lt1 - hr} under bandet` : hr > lt2 ? `${hr - lt2} över bandet` : "inom bandet",
    });
  }
  const intv = pairs
    .filter((x) => x.p.workout_type === "interval")
    .map((x) => reps.get(x.d.dominantId)?.maxHr)
    .filter((h): h is number => h != null);
  if (lt2 && intv.length > 0) {
    const hr = Math.round(median(intv));
    rows.push({
      label: "Puls intervall",
      plan: `över ${lt2}`,
      done: String(hr),
      diff: hr >= lt2 ? `${hr - lt2} över LT2` : `${lt2 - hr} under LT2`,
    });
  }

  if (rows.length === 0) return null;
  const notes: string[] = [];
  const counted = [
    easy.length ? `${easy.length} ${easy.length === 1 ? "distanspass" : "distanspass"}` : null,
    quality.length ? `${quality.length} ${quality.length === 1 ? "kvalitetspass" : "kvalitetspass"}` : null,
  ].filter(Boolean);
  if (counted.length) notes.push(`Fart och puls på ${counted.join(" och ")} som var planerade.`);
  if (rows.some((r) => r.label.startsWith("Puls")) && !thresholds.measured)
    notes.push("Trösklarna är självskattade, inte uppmätta i ett test.");
  return { rows, note: notes.length ? notes.join(" ") : null, from: weekStart, to, paired: pairs.length };
}
