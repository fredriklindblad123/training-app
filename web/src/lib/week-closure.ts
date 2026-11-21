import type { PlanMatch } from "@/lib/plan-matching";
import { trainingSeconds, type TrainingSession } from "@/lib/sessions";
import { strengthDatesFromDiary, type DiaryLogRow } from "@/lib/diary-strength";
import { formatMinutes } from "@/lib/format";

/* Veckobokslut (C4, 2026-11-21).
 *
 * En vecka som är slut får några korta meningar om vad som hände. Bara
 * observationer: hur många planerade pass som blev av, vilka som blev något
 * annat, sjuk- och skadedagar, och hur lång veckan var mot löparens eget
 * snitt. Ingen procentsats och ingen färg — "6 av 7" är ett faktum, "86 %"
 * i grönt eller rött hade varit ett betyg (CLAUDE.md, Ton mot adepterna).
 *
 * Styrka loggas oftast bara i dagboken, så ett planerat styrkepass räknas
 * som gjort när dagboken beskriver ett eget styrkepass samma dag
 * (lib/diary-strength.ts) — och då står det ut att det är självskattat. */

export type WeekClosure = {
  planned: number;
  done: number;
  otherType: number;
  minutes: number;
  sickDays: number;
  injuredDays: number;
  lines: string[];
  selfReported: boolean;
};

export function weekClosure({
  matches,
  sessions,
  diary,
  yearAvgMinutesPerWeek,
}: {
  matches: PlanMatch[];
  sessions: TrainingSession[];
  diary: (DiaryLogRow & { day_type: string | null })[];
  /** Löparens snitt per vecka i år, eller null om det inte går att räkna. */
  yearAvgMinutesPerWeek: number | null;
}): WeekClosure | null {
  const plannedMatches = matches.filter((m) => m.planned && m.planned.workout_type !== "rest");
  if (plannedMatches.length === 0 && sessions.length === 0) return null;

  const strengthDays = new Set(strengthDatesFromDiary(diary));
  let done = 0;
  let otherType = 0;
  let strengthFromDiary = 0;
  for (const m of plannedMatches) {
    if (m.outcome === "genomfört") done++;
    else if (m.outcome === "avvikande typ") {
      done++;
      otherType++;
    } else if (m.planned?.workout_type === "strength" && strengthDays.has(m.planned.scheduled_date)) {
      done++;
      strengthFromDiary++;
    }
  }

  const minutes = sessions.reduce((s, x) => s + trainingSeconds(x), 0) / 60;
  const sickDays = diary.filter((d) => d.day_type === "sick").length;
  const injuredDays = diary.filter((d) => d.day_type === "injured").length;

  const lines: string[] = [];
  if (plannedMatches.length > 0) {
    lines.push(
      done === plannedMatches.length
        ? `Alla ${plannedMatches.length} planerade pass blev av.`
        : `${done} av ${plannedMatches.length} planerade pass blev av.`,
    );
  }
  if (otherType > 0) {
    lines.push(otherType === 1 ? "Ett pass blev av som en annan passtyp än planerat." : `${otherType} pass blev av som en annan passtyp än planerat.`);
  }
  if (injuredDays > 0) lines.push(`${injuredDays} ${injuredDays === 1 ? "dag" : "dagar"} med skada noterad i dagboken.`);
  if (sickDays > 0) lines.push(`${sickDays} ${sickDays === 1 ? "sjukdag" : "sjukdagar"} i dagboken.`);
  if (yearAvgMinutesPerWeek != null && yearAvgMinutesPerWeek > 0 && minutes > 0) {
    const diff = Math.round(minutes - yearAvgMinutesPerWeek);
    lines.push(
      Math.abs(diff) < 10
        ? `Träningstiden, ${formatMinutes(minutes)}, låg i nivå med ditt snitt i år.`
        : `Träningstiden var ${formatMinutes(minutes)}, ${Math.abs(diff)} min ${diff > 0 ? "mer" : "mindre"} än ditt snitt i år (${formatMinutes(yearAvgMinutesPerWeek)}).`,
    );
  }

  return {
    planned: plannedMatches.length,
    done,
    otherType,
    minutes,
    sickDays,
    injuredDays,
    lines,
    selfReported: strengthFromDiary > 0 || sickDays > 0 || injuredDays > 0,
  };
}
