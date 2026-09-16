import Link from "next/link";
import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";
import { WORKOUT_LABELS, workoutTypeColorVar, type WorkoutType } from "@/lib/planning";
import { formatHoursMinutes, formatKm } from "@/lib/format";
import { describePlannedWorkout, type RepGroupLike } from "@/lib/workout-summary";
import { LinkPending } from "@/components/ui/LinkPending";

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
  planned_rep_groups: RepGroupLike[] | null;
  /** Tränarens text till löparen. Det enda på skärmen som är skrivet av en
   * människa till just den här personen — därför står den framme. */
  description: string | null;
};

export type TodayDone = {
  id: string;
  category: string;
  name: string | null;
  distanceMeters: number;
  durationSeconds: number;
};

/** Färgstapeln som bär passets typ, i full radhöjd. Vila, test och häck har
 * ingen kategorifärg — de får linjens, samma regel som workoutTypeColorVar. */
function Bar({ colorVar }: { colorVar: string | null }) {
  return (
    <span
      aria-hidden
      className="w-[3px] shrink-0 self-stretch rounded-full"
      style={{ backgroundColor: colorVar ?? "var(--line)", minHeight: "2.25rem" }}
    />
  );
}

export function TodaySession({
  planned,
  done,
  href,
}: {
  planned: TodayPlanned[];
  done: TodayDone[];
  /** Dagens datum i kalendern. */
  href: string;
}) {
  const empty = planned.length === 0 && done.length === 0;
  /* Kortets kulör: det planerade passets typ i första hand, annars det
     genomförda. Vila, test och häck saknar kategorifärg och ger null, vilket
     lämnar kortet i den vanliga ytan — en vilodag ska inte skrika. */
  const accent =
    (planned[0] ? workoutTypeColorVar(planned[0].workout_type) : null) ??
    (done[0] && isActivityCategory(done[0].category) ? categoryColorVar(done[0].category) : null);

  return (
    /* Rubriken står UTANFÖR kortet, som i sektionerna nedanför (flyttad
       2026-09-15). Den låg tidigare inuti, vilket gav sidan två sorters
       rubriker: en fristående ovanför ett rutnät och en inbakad i en ruta.
       Samma sektionsskal som Status och nyckeltalen redan använder. */
    <section className="flex flex-col gap-3">
      <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
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
        className="relative flex flex-col gap-3 overflow-hidden rounded-lg border p-4 transition-colors"
        style={{
          borderColor: accent
            ? `color-mix(in oklab, ${accent} 45%, var(--line))`
            : "var(--line)",
          backgroundColor: accent
            ? `color-mix(in oklab, ${accent} 10%, var(--surface))`
            : "var(--surface)",
        }}
      >
        {/* Tomt läge sägs rakt ut. En vilodag är ett giltigt svar på "vad ska
            jag göra idag", och ska inte se ut som att något saknas. */}
        {empty && (
          <p className="text-sm text-[var(--ink-3)]">
            Inget pass planerat eller loggat idag.
          </p>
        )}

        {/* Planerat först: det är instruktionen. Genomfört är kvittot. */}
        {planned.map((p) => {
          const label = WORKOUT_LABELS[p.workout_type as WorkoutType] ?? p.workout_type;
          const detail = describePlannedWorkout(p);
          const comment = (p.description ?? "").trim();
          return (
            /* Typen som rubrik, repetitionerna som det stora talet. "5×1000"
               är vad passet ÄR — det stod tidigare som en grå detaljrad under
               namnet, i samma storlek som allt annat på kortet. */
            <div key={p.id} className="flex flex-col gap-1">
              <span className="display text-2xl leading-none font-bold text-[var(--foreground)] uppercase">
                {label}
              </span>
              {detail && (
                <span className="display tabular text-xl leading-tight font-semibold text-[var(--status-watch-ink)]">
                  {detail}
                </span>
              )}
              {p.title && <span className="text-sm text-[var(--ink-2)]">{p.title}</span>}
              {comment && (
                <p className="mt-0.5 border-l-2 border-[var(--line)] pl-2 text-sm leading-snug whitespace-pre-line text-[var(--ink-2)]">
                  {comment}
                </p>
              )}
              {!detail && !p.title && !comment && (
                <span className="text-sm text-[var(--ink-3)]">Planerat</span>
              )}
            </div>
          );
        })}

        {done.map((d) => {
          const label = isActivityCategory(d.category)
            ? CATEGORY_LABELS[d.category]
            : (d.name ?? "Pass");
          return (
            <div key={d.id} className="flex items-stretch gap-3">
              <Bar colorVar={isActivityCategory(d.category) ? categoryColorVar(d.category) : null} />
              <div className="flex min-w-0 flex-col gap-0.5">
                <div className="flex flex-wrap items-baseline gap-x-2">
                  <span className="display text-lg leading-tight font-semibold text-[var(--foreground)]">
                    {label}
                  </span>
                  <span className="display rounded-full border border-[var(--line)] px-2 py-0.5 text-xs text-[var(--ink-2)]">
                    Genomfört
                  </span>
                </div>
                <span className="tabular text-sm text-[var(--ink-3)]">
                  {[
                    d.distanceMeters > 0 ? formatKm(d.distanceMeters) : null,
                    d.durationSeconds > 0 ? formatHoursMinutes(d.durationSeconds) : null,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "Loggat"}
                </span>
              </div>
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
