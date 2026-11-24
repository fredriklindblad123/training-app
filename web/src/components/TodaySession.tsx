import { formatKm } from "@/lib/format";
import Link from "next/link";
import { pairPlanDone } from "@/lib/pair-plan";
import { planGap, type GapThresholds, type RepStats } from "@/lib/plan-gap";
import { PlanGapTable } from "@/components/PlanGapTable";
import { SessionComments } from "@/components/ui/SessionComments";
import type { LabZoneSet } from "@/lib/zone-sources";
import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";
import { WORKOUT_LABELS, workoutTypeColorVar, type WorkoutType } from "@/lib/planning";
import { describePlannedWorkout, type RepGroupLike } from "@/lib/workout-summary";
import { LinkPending } from "@/components/ui/LinkPending";
import { SessionDetail, type SplitRow } from "@/components/SessionDetail";
import type { SessionReview } from "@/lib/session-review";

/* Dagens pass, överst på adeptens dashboard. Rubriken hette "Idag" fram
 * till 2026-09-15.
 *
 * Det här är den första frågan en löpare har när hon öppnar appen: vad ska
 * jag göra idag, eller vad blev det av det jag gjorde? Kortet låg tidigare
 * längst NED på sidan, under tre ringsektioner och statusrutan — man fick
 * scrolla förbi allt som besvarar långsiktiga frågor för att nå den enda som
 * gäller nu. Flyttat överst 2026-09-15 på uttrycklig begäran.
 *
 * Kortet visar både planerat och genomfört, och det är avsiktligt att båda
 * ryms: mitt på dagen är det vanliga läget att passet är ordinerat men inte
 * kört, och på kvällen att det är kört. Ett kort som bara visade det ena hade
 * varit tomt halva tiden.
 *
 * Hela kortet är en länk till dagen i kalendern — där man loggar, rättar och
 * skriver om passet. Att göra kortet klickbart i stället för att lägga en
 * liten länk i hörnet: den som vill till dagvyn siktar på passet, inte på
 * ordet "öppna".
 */

export type TodayPlanned = {
  id: string;
  slot: number | null;
  workout_type: string;
  title: string | null;
  target_distance_meters: number | null;
  target_duration_seconds: number | null;
  target_pace_seconds_per_km?: number | null;
  planned_rep_groups: RepGroupLike[] | null;
  /** Tränarens text till löparen. Det enda på skärmen som är skrivet av en
   * människa till just den här personen — därför står den framme. */
  description: string | null;
};

export type TodayDone = {
  id: string;
  category: string;
  name: string | null;
  /** Löparens kommentarer på passet i Garmin Connect. */
  comments?: string[];
  distanceMeters: number;
  durationSeconds: number;
  avgHr: number | null;
  /** Sekunder i zon 1–5, från klockan. */
  zoneSeconds: [number, number, number, number, number];
  /** Sekunder i uppmätta zoner, null utan pulskurva/uppmätt uppsättning. */
  labZoneSeconds: [number, number, number, number, number] | null;
  /** Varven, när passet har några. Tomt för ett distanspass. */
  splits: SplitRow[];
  /** "Så gick passet" — samma läsning som dagvyn. null när underlaget inte
   * räcker; då visas ingenting hellre än en gissning. */
  review?: SessionReview | null;
  /** Uppvärmning och nerjogg i ett tröskelpass, räknade som distans
   * (lib/quality-split.ts). Saknas för andra pass. */
  easy?: { meters: number; seconds: number } | null;
  /** Repen i passets huvudaktivitet, för plan mot utfall (lib/plan-gap.ts). */
  reps?: RepStats | null;
};

/** Dagens kulör: det planerade passets typ i första hand, annars det
 * genomförda. Vila, test och häck saknar kategorifärg och ger null.
 *
 * Exporterad eftersom HELA dashboarden färgas av den sedan 2026-09-16, inte
 * bara det här kortet — sidan sätter --day-accent ur samma funktion. Två
 * kopior av regeln hade oundvikligen glidit isär, och då hade sidan och
 * kortet visat olika färger för samma dag. */
export function dayAccent(
  planned: { workout_type: string }[],
  done: { category: string }[],
): string | null {
  return (
    (planned[0] ? workoutTypeColorVar(planned[0].workout_type) : null) ??
    (done[0] && isActivityCategory(done[0].category) ? categoryColorVar(done[0].category) : null)
  );
}

export function TodaySession({
  planned,
  done,
  href,
  labSet = null,
  compact = false,
  thresholds = null,
}: {
  /** Löparens trösklar, för pulsraden i plan mot utfall. */
  thresholds?: GapThresholds | null;
  /** Utan varvlistan — Idag visar bara sammanfattningen. */
  compact?: boolean;
  planned: TodayPlanned[];
  done: TodayDone[];
  /** Uppmätt zonuppsättning, se lib/zone-sources.ts. */
  labSet?: LabZoneSet | null;
  /** Dagens datum i kalendern. */
  href: string;
}) {
  const empty = planned.length === 0 && done.length === 0;
  return (
    /* Rubriken står UTANFÖR kortet, som i sektionerna nedanför (flyttad
       2026-09-15). Den låg tidigare inuti, vilket gav sidan två sorters
       rubriker: en fristående ovanför ett rutnät och en inbakad i en ruta.
       Samma sektionsskal som Status och nyckeltalen redan använder. */
    <section className="flex flex-col gap-3">
      <h2 className="display text-xs font-semibold tracking-[0.08em] text-[var(--ink-3)] uppercase">
        Dagens pass
      </h2>

      {/* Passets färg bär HELA kortet, inte en tre pixlar bred remsa i kanten.
          Typen ska gå att läsa innan man läst ett enda ord — intervall är
          laddat, distans lugnt, vila nästan ingenting.
          Kulören kommer ur samma --cat-*-token som resten av appen och blandas
          mot ytan med color-mix, så den följer med i mörkt läge automatiskt i
          stället för att lysa. */}
      <Link
        href={href}
        /* Platt kort sedan 2026-11-21 (ny UX): passtypen bärs av en prick
           vid rubriken, inte av en färgad toning över kortet. */
        className="relative flex flex-col gap-3 overflow-hidden rounded-[14px] border border-[var(--line)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--ink-3)]"
      >
        {/* Tomt läge sägs rakt ut. En vilodag är ett giltigt svar på "vad ska
            jag göra idag", och ska inte se ut som att något saknas. */}
        {empty && (
          <p className="text-sm text-[var(--ink-3)]">
            Inget pass planerat eller loggat idag.
          </p>
        )}

        {/* Plan och utfall pass för pass (2026-11-21): planen till vänster,
            det genomförda till höger på samma rad, och "Så gick passet"
            och kommentaren i full bredd under paret. Förut alla planerade
            först och alla genomförda sedan — med två pass samma dag fick
            man para ihop dem själv. */}
        {pairPlanDone(planned, done, (p) => p.workout_type, (d) => d.category).map(({ plan: p, done: d }, i) => {
          const pLabel = p ? (WORKOUT_LABELS[p.workout_type as WorkoutType] ?? p.workout_type) : null;
          const detail = p ? describePlannedWorkout(p) : null;
          const comment = p ? (p.description ?? "").trim() : "";
          const dLabel = d ? (isActivityCategory(d.category) ? CATEGORY_LABELS[d.category] : (d.name ?? "Pass")) : null;
          const dMin = d ? Math.round(d.durationSeconds / 60) : 0;
          const otherType = p && d && p.workout_type !== d.category && !(p.workout_type === "long_run" && d.category === "easy");
          const gap =
            p && d
              ? planGap(
                  {
                    workout_type: p.workout_type,
                    target_distance_meters: p.target_distance_meters,
                    target_duration_seconds: p.target_duration_seconds,
                    target_pace_seconds_per_km: p.target_pace_seconds_per_km ?? null,
                  },
                  { distanceMeters: d.distanceMeters, seconds: d.durationSeconds, avgHr: d.avgHr },
                  d.reps ?? null,
                  thresholds ?? { lt1: null, lt2: null, measured: true },
                )
              : null;
          return (
            <div key={`${p?.id ?? "x"}-${d?.id ?? "y"}`} className={`flex flex-col gap-2 ${i > 0 ? "border-t border-[var(--line)] pt-3" : ""}`}>
              {d ? (
                /* Genomfört: utfallet är huvudsaken, planen en liten rad
                   (2026-11-21, begärt — en markering räcker). */
                <div className="flex flex-col gap-1">
                  <span className="text-xs text-[var(--ink-3)]">
                    {p
                      ? `Planerat: ${[p.title ?? pLabel, detail].filter(Boolean).join(" · ")}${otherType ? " — blev en annan passtyp" : ""}`
                      : "Inte planerat"}
                  </span>
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: isActivityCategory(d.category) ? categoryColorVar(d.category) : "var(--ink-3)" }} />
                    <span className="display text-[1.375rem] leading-tight font-bold text-[var(--foreground)]">{dLabel}</span>
                  </span>
                  <span className="tabular text-[0.9375rem] text-[var(--ink-2)]">
                    {[d.distanceMeters > 0 ? formatKm(d.distanceMeters) : null, dMin > 0 ? `${dMin} min` : null].filter(Boolean).join(" · ")}
                    {d.easy && d.easy.meters > 0 ? ` · varav uppvärmning och nerjogg ${formatKm(d.easy.meters)}` : ""}
                  </span>
                  {gap && (
                    <div className="mt-1.5">
                      <PlanGapTable gap={gap} />
                    </div>
                  )}
                </div>
              ) : p ? (
                /* Inte genomfört (än): planen är huvudsaken. */
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2">
                    <span aria-hidden className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: workoutTypeColorVar(p.workout_type) ?? "var(--ink-3)" }} />
                    <span className="display text-[1.375rem] leading-tight font-bold text-[var(--foreground)]">{p.title ?? pLabel}</span>
                  </span>
                  <span className="tabular text-[0.9375rem] text-[var(--ink-2)]">
                    {[p.title ? pLabel : null, detail].filter(Boolean).join(" · ")}
                  </span>
                  {comment && <p className="line-clamp-3 text-sm leading-snug text-[var(--ink-2)]">{comment}</p>}
                  <span className="text-xs text-[var(--ink-3)]">
                    {p.workout_type === "strength" ? "Planerat · inte loggat med klockan" : "Planerat · inte gjort ännu"}
                  </span>
                </div>
              ) : null}
              {d && (d.review || (d.comments && d.comments.length > 0)) && (
                <div className="flex flex-col gap-1.5 rounded-[10px] px-3 py-2.5" style={{ backgroundColor: "var(--surface-insight)" }}>
                  {d.review && (
                    <>
                      <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">Så gick passet</span>
                      {/* Neutral färg (B4): rubriken beskriver passet, den är inget betyg. */}
                      <p className="text-sm font-medium text-[var(--foreground)]">{d.review.headline}</p>
                      {d.review.lines.map((line, li) => (
                        <p key={li} className="text-sm text-[var(--ink-2)]">{line}</p>
                      ))}
                      {d.review.caveat && <p className="text-xs text-[var(--ink-3)]">{d.review.caveat}</p>}
                    </>
                  )}
                  {d.comments && d.comments.length > 0 && <SessionComments comments={d.comments} />}
                </div>
              )}
              {d && !compact && (
                <SessionDetail
                  splits={d.splits}
                  category={d.category}
                  summary={{
                    distanceMeters: d.distanceMeters,
                    durationSeconds: d.durationSeconds,
                    avgHr: d.avgHr,
                    zoneSeconds: d.zoneSeconds,
                    labZoneSeconds: d.labZoneSeconds,
                  }}
                  labSet={labSet}
                />
              )}
            </div>
          );
        })}

        {/* Länktexten sist och högerställd, där KPI-korten har sin
            utfällningspil. Den satt tidigare uppe bredvid rubriken, men
            rubriken bor inte i kortet längre — och nedre högra hörnet är
            redan den plats där dashboardens kort säger "det finns mer här". */}
        <span className="display flex items-center justify-end text-xs text-[var(--ink-3)]">
          Öppna i kalendern
          <LinkPending />
        </span>
      </Link>
    </section>
  );
}
