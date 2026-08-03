// Plan mot utfall (K2, docs/tranarperspektiv.md). Parar ihop ordinerade pass
// (`planned_workouts`) med genomförda pass (`TrainingSession`, lib/sessions.ts)
// och räknar efterlevnad per period.
//
// `planned_workouts.status` och `.linked_activity_id` finns i schemat sedan
// första migrationen men skrivs aldrig — se avsnitt 1 i tranarperspektiv.md.
// Den här modulen skriver dem fortfarande inte. Kopplingen räknas i
// läsvägen varje gång sidan laddas, av samma skäl som lib/sessions.ts
// grupperar aktiviteter till pass i läsvägen i stället för att skriva
// tillbaka en `session_id`: kopplingen blir trivialt reversibel (ingen
// migration, ingen backfill), och ändras planens typ eller passets kategori
// i efterhand slår det igenom direkt nästa gång sidan renderas i stället för
// att kräva att någon kör om en synk. Priset är att kopplingen räknas om vid
// varje sidladdning i stället för en enda gång — för en vecka eller ett
// block i taget är den kostnaden obetydlig.

import type { TrainingSession } from "@/lib/sessions";
import { QUALITY_WORKOUT_TYPES } from "@/lib/planning";

/** Det planerade passet som matchningen behöver. Namnen matchar kolumnerna
 * i `planned_workouts` rakt av, så en rad från `.select(...)` kan skickas in
 * utan mellansteg. */
export type PlannedWorkout = {
  id: string;
  /** YYYY-MM-DD, samma format som `TrainingSession.date`. */
  scheduled_date: string;
  slot: number | null;
  workout_type: string;
  title: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
};

export type PlanOutcome = "genomfört" | "avvikande typ" | "ej genomfört" | "oplanerat";

export type PlanMatch = {
  /** null när utfallet var oplanerat — inget planerat pass den dagen/slotten. */
  planned: PlannedWorkout | null;
  /** null när det planerade passet inte genomfördes. */
  session: TrainingSession | null;
  outcome: PlanOutcome;
};

function isQualityType(type: string): boolean {
  return (QUALITY_WORKOUT_TYPES as readonly string[]).includes(type);
}

/** Tidpunkt på dagen ur `startTime`, i samma tre fack som `SLOT_LABELS`
 * (lib/planning.ts): förmiddag/eftermiddag/kväll. Passet har inget lagrat
 * slot-värde — bara planen har det — så det här är en härledning enbart för
 * matchningen, inte ett riktigt fält på `TrainingSession`. Timmen läses ur
 * strängen precis som resten av appen läser ut datumdelen (`.slice(0, 10)`)
 * i stället för att gå via `Date`, så att den lokala tid Garmin skrev in
 * inte tolkas om via klientens tidszon. */
function inferredSlot(startTime: string): number {
  const hour = Number(startTime.slice(11, 13));
  if (hour < 12) return 1;
  if (hour < 18) return 2;
  return 3;
}

/** Utfallet för ett parat (eller oparat) planerat pass.
 *
 * Specialfall: en planerad vilodag utan genomfört pass är `genomfört` — att
 * inte träna *är* att göra vilodagen. Har ett pass ändå genomförts den dagen
 * är det `avvikande typ` (vilan blev inte av), aldrig `ej genomfört` (något
 * hände ju). */
function outcomeFor(planned: PlannedWorkout, session: TrainingSession | null): PlanOutcome {
  if (planned.workout_type === "rest") {
    return session == null ? "genomfört" : "avvikande typ";
  }
  if (session == null) return "ej genomfört";
  return planned.workout_type === session.category ? "genomfört" : "avvikande typ";
}

/**
 * Parar ihop planerade och genomförda pass, dag för dag.
 *
 * Matchningsregler, i ordning — se K2 i docs/tranarperspektiv.md:
 * 1. Samma dag och samma slot (planens lagrade slot mot passets härledda,
 *    se `inferredSlot`) → parade.
 * 2. Kvar utan slot-träff, flera pass samma dag → para i tidsordning
 *    (planerade sorterade på slot, genomförda på starttid).
 * 3–6. Utfallet för varje par, se `outcomeFor`. Planerat utan genomfört pass
 *    → "ej genomfört". Genomfört utan planerat → "oplanerat" — det är inte
 *    ett fel, se fallgrop 2 i K2: merparten av historiken saknar plan.
 */
export function matchPlanToSessions(
  planned: PlannedWorkout[],
  sessions: TrainingSession[],
): PlanMatch[] {
  const plannedByDay = new Map<string, PlannedWorkout[]>();
  for (const p of planned) {
    plannedByDay.set(p.scheduled_date, [...(plannedByDay.get(p.scheduled_date) ?? []), p]);
  }
  const sessionsByDay = new Map<string, TrainingSession[]>();
  for (const s of sessions) {
    sessionsByDay.set(s.date, [...(sessionsByDay.get(s.date) ?? []), s]);
  }

  const days = new Set<string>([...plannedByDay.keys(), ...sessionsByDay.keys()]);
  const matches: PlanMatch[] = [];

  for (const day of [...days].sort()) {
    let remainingPlanned = [...(plannedByDay.get(day) ?? [])];
    const remainingSessions = [...(sessionsByDay.get(day) ?? [])];
    const pairs: { planned: PlannedWorkout; session: TrainingSession }[] = [];

    // Steg 1: samma slot. Bara planerade pass med ett satt slot-värde deltar
    // — flera pass utan slot går vidare till tidsordningen i steg 2.
    for (const p of remainingPlanned) {
      if (p.slot == null) continue;
      const idx = remainingSessions.findIndex((s) => inferredSlot(s.startTime) === p.slot);
      if (idx === -1) continue;
      pairs.push({ planned: p, session: remainingSessions[idx] });
      remainingSessions.splice(idx, 1);
      remainingPlanned = remainingPlanned.filter((x) => x !== p);
    }

    // Steg 2: det som blir kvar paras positionellt i tidsordning.
    const sortedPlanned = [...remainingPlanned].sort((a, b) => (a.slot ?? 1) - (b.slot ?? 1));
    const sortedSessions = [...remainingSessions].sort(
      (a, b) => Date.parse(a.startTime) - Date.parse(b.startTime),
    );
    const pairedCount = Math.min(sortedPlanned.length, sortedSessions.length);
    for (let i = 0; i < pairedCount; i++) {
      pairs.push({ planned: sortedPlanned[i], session: sortedSessions[i] });
    }

    for (const pair of pairs) {
      matches.push({ planned: pair.planned, session: pair.session, outcome: outcomeFor(pair.planned, pair.session) });
    }
    for (const p of sortedPlanned.slice(pairedCount)) {
      matches.push({ planned: p, session: null, outcome: outcomeFor(p, null) });
    }
    for (const s of sortedSessions.slice(pairedCount)) {
      matches.push({ planned: null, session: s, outcome: "oplanerat" });
    }
  }

  return matches;
}

/** Efterlevnad, aggregerat över en godtycklig mängd matchningar — en vecka
 * (veckovyn) eller ett helt block (`/blocket?block=`). Ren sammanräkning, inga
 * antaganden om tidsfönstret. */
export type Compliance = {
  /** Antal planerade pass i perioden, inklusive vilodagar — en ordinerad
   * vilodag är en avsikt precis som ett träningspass, se `outcomeFor`. */
  plannedCount: number;
  /** Antal planerade pass med utfall "genomfört" (exakt typträff, eller en
   * vilodag som hölls). Räknar INTE "avvikande typ" — den bokförs för sig i
   * veckorutnätet ("Annan typ än planerat") och ska inte tysta läggas ihop
   * med en exakt träff här; se fallgrop 1 i K2 (efterlevnad är ingen sifferpoäng). */
  completedCount: number;
  qualityPlanned: number;
  qualityCompleted: number;
  /** null när inget planerat pass i perioden hade ett distansmål — då finns
   * inget att jämföra "faktiskt km" mot, och volymraden ska döljas helt. */
  plannedKm: number | null;
  /** All genomförd distans i perioden, oavsett om passet var planerat. */
  actualKm: number;
  notCompleted: PlanMatch[];
  unplanned: PlanMatch[];
};

export function summarizeCompliance(matches: PlanMatch[]): Compliance {
  let plannedCount = 0;
  let completedCount = 0;
  let qualityPlanned = 0;
  let qualityCompleted = 0;
  let plannedKmSum = 0;
  let sawDistanceTarget = false;
  let actualKm = 0;
  const notCompleted: PlanMatch[] = [];
  const unplanned: PlanMatch[] = [];

  for (const m of matches) {
    const plannedIsQuality = m.planned != null && isQualityType(m.planned.workout_type);

    if (m.planned) {
      plannedCount++;
      if (plannedIsQuality) qualityPlanned++;
      if (m.planned.target_distance_meters != null) {
        sawDistanceTarget = true;
        plannedKmSum += m.planned.target_distance_meters / 1000;
      }
    }
    if (m.session) {
      actualKm += m.session.distanceMeters / 1000;
    }

    switch (m.outcome) {
      case "genomfört":
        completedCount++;
        if (plannedIsQuality) qualityCompleted++;
        break;
      case "ej genomfört":
        notCompleted.push(m);
        break;
      case "oplanerat":
        unplanned.push(m);
        break;
      case "avvikande typ":
        // Bokförs inte här — se kommentaren på `completedCount`.
        break;
    }
  }

  return {
    plannedCount,
    completedCount,
    qualityPlanned,
    qualityCompleted,
    plannedKm: sawDistanceTarget ? plannedKmSum : null,
    actualKm,
    notCompleted,
    unplanned,
  };
}
