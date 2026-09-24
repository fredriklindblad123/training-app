import { mentionsStrength } from "@/lib/diary-text";
import { STATUS_COLOR, STATUS_LABEL } from "@/lib/calendar-utils";
import type { DayStatus } from "@/lib/calendar-utils";

/* Det dagboken säger om en dag, utöver de loggade passen.
 *
 * Delad av månads-, block-, vecko- och dagvyn så att en dag ser likadan ut
 * oavsett tidshorisont (uttrycklig begäran 2026-09-24). Tidigare ritade
 * veckovyn styrkemarkören men inte månads- eller blockvyn, dagvyn visade
 * ingenting alls, och dashboardens veckoremsa hoppade över dagen helt — fyra
 * ytor, fyra svar om samma dag.
 *
 * FÄRGEN ÄR POÄNGEN. "Träning"-markören bar tidigare --day-trained, en
 * emerald som ligger ΔE 12 från --cat-threshold i OKLab. I en tiopixelsprick
 * i månadsrutnätet är det samma färg: den 18 september lästes som ett
 * tröskelpass av appens ägare, och dagen innehöll ingen löpning alls.
 * Avståndet till alla andra passfärger är 21–38, så grönt mot grönt var det
 * enda par som gick att förväxla — och det var det som råkade stå bredvid
 * varandra i rutnätet.
 *
 * Nu gäller: nämner loggen styrka ritas ett STYRKEPASS i passkategorins egen
 * färg (--cat-strength), för det är vad det är. Säger dagboken bara "tränat"
 * utan att avslöja vad, ritas en dämpad notering i --ink-note — utanför både
 * passfärgerna och dagsutfallets färger, så den aldrig kan läsas som en
 * passtyp. Se docs/ux-genomgang.md.
 */

export function DiaryMarkers({
  dayType,
  sessionLog,
  hasSessions,
  compact = false,
}: {
  dayType: DayStatus | null;
  sessionLog: string | null | undefined;
  /** Dagen har minst ett loggat pass. Styr om "tränat" behöver sägas alls. */
  hasSessions: boolean;
  /** Månads- och blockrutnätet har trängre celler än vecko- och dagvyn. */
  compact?: boolean;
}) {
  /* Styrkemarkören svarar på frågan "varför står det något här när inget
     pass är loggat". Har dagen ett pass är frågan redan besvarad, och en
     andra prick bredvid passet läses som ett andra pass.

     Villkoret saknades när markören flyttades hit från veckovyn 2026-09-24,
     och rapporterades samma dag: den 15 september visade både tröskel och
     styrka i månadsrutnätet. Loggen säger mycket riktigt "Styrka med
     gummiband" — men sist i en rad som börjar med "Uppvärmning 3km
     Tröskelintervaller 6x3min". Det är ett tillägg till tröskelpasset, inte
     ett eget pass. Fyra av sex dagar den veckan såg ut att ha dubbla pass.

     Detaljen går inte förlorad: hela loggen står i dagvyns träningsdagbok. */
  const strength = !hasSessions && mentionsStrength(sessionLog);
  // "Tränat" utan mer information säger bara att dagen inte var tom. Har
  // dagen pass, eller vet vi att det var styrka, är den raden ren upprepning.
  const bareTraining = dayType === "training" && !hasSessions && !strength;
  const size = compact ? "text-[11px]" : "text-xs";

  return (
    <>
      {dayType != null && dayType !== "training" && (
        <span
          className={`inline-flex w-fit items-center rounded px-1.5 py-0.5 text-[10px] font-medium text-white ${STATUS_COLOR[dayType]}`}
        >
          {STATUS_LABEL[dayType]}
        </span>
      )}

      {strength && (
        <span
          className={`flex items-start gap-1.5 leading-snug ${size} text-[var(--ink-2)]`}
          title="Styrka nämnd i träningsloggen — inget pass loggat med volym"
        >
          <span
            aria-hidden
            className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full opacity-60"
            style={{ backgroundColor: "var(--cat-strength)" }}
          />
          Styrka (ur loggen)
        </span>
      )}

      {bareTraining && (
        <span
          className={`flex items-start gap-1.5 leading-snug ${size} text-[var(--ink-note)]`}
          title="Dagboken säger tränat, men inget pass är loggat och loggen säger inte vad det var"
        >
          <span
            aria-hidden
            className="mt-[3px] inline-block h-2.5 w-2.5 shrink-0 rounded-full"
            style={{ backgroundColor: "var(--ink-note)" }}
          />
          Tränat (ur dagboken)
        </span>
      )}
    </>
  );
}
