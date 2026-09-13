import type { ReactNode } from "react";

/* Ett nyckeltal: stort tal, liten etikett.
 *
 * Poängen är storleksförhållandet. Appen hade 345 av 397 textklasser på
 * text-sm eller text-xs — allt låg på samma nivå, vilket är varför ett
 * mätvärde aldrig stack ut ur sin omgivning. Ett instrumentgränssnitt bygger
 * på motsatsen: talet ska vara ungefär fyra gånger etiketten, så ögat hittar
 * det utan att läsa.
 *
 * Talet sätts med tabular-nums (klassen .tabular i globals.css) så att
 * kolumner med siffror står rakt och inte hoppar i sidled när värdet ändras —
 * det märks direkt i en lista med en rad per löpare.
 */

export type StatTone = "neutral" | "good" | "watch" | "concern";

/** Tonen färgar BARA underraden, aldrig talet. Ett mätvärde ska läsas som ett
 * mätvärde; färgar man talet rött blir siffran en bedömning innan man hunnit
 * se vad den står för. Samma resonemang som DailyStatus redan följer, och
 * språkkravet i docs/tranarloopen.md avsnitt 6. */
const TONE_VAR: Record<StatTone, string | undefined> = {
  neutral: undefined,
  good: "var(--status-good)",
  watch: "var(--status-watch)",
  concern: "var(--status-concern)",
};

export function Stat({
  label,
  value,
  unit,
  sub,
  tone = "neutral",
  size = "md",
}: {
  label: ReactNode;
  value: ReactNode;
  /** Enheten sätts mindre och dämpad intill talet — "80 ms", inte "80ms". */
  unit?: ReactNode;
  sub?: ReactNode;
  tone?: StatTone;
  /** `lg` för ensamma hjältetal, `md` i en rad av flera, `sm` inuti en lista. */
  size?: "sm" | "md" | "lg";
}) {
  /* Storlekarna kommer ur prototypen: hjältetalet ~54px, radens tal ~30px,
     listans ~20px. Förhållandet till etiketten (11px) är ungefär 5:1, 3:1 och
     2:1 — det är den spännvidden som gör att ögat hittar talet utan att läsa
     etiketten först. `leading-none` för att ett tal inte har underlängder och
     annars får ett tomrum under sig som bryter radens grundlinje. */
  const valueClass =
    size === "lg"
      ? "text-[3.25rem] leading-none"
      : size === "sm"
        ? "text-xl leading-none"
        : "text-[1.875rem] leading-none";
  const toneVar = TONE_VAR[tone];

  return (
    <div className="flex flex-col gap-1">
      <div className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
        {label}
      </div>
      <div className={`display tabular font-bold text-[var(--foreground)] ${valueClass}`}>
        {value}
        {unit && (
          <span className="ml-1 text-[0.5em] font-medium text-[var(--ink-3)]">{unit}</span>
        )}
      </div>
      {sub && (
        <div className="text-xs" style={toneVar ? { color: toneVar } : undefined}>
          <span className={toneVar ? "" : "text-[var(--ink-3)]"}>{sub}</span>
        </div>
      )}
    </div>
  );
}

/** En rad nyckeltal med hårfina skiljelinjer i stället för marginaler.
 *
 * Linjerna är gap på en linjefärgad bakgrund, inte border per cell: med
 * borders får ytterkanterna dubbla streck så fort raden bryts till två rader
 * på smal skärm. */
export function StatRow({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 | 4 }) {
  const cols = { 2: "grid-cols-2", 3: "grid-cols-2 sm:grid-cols-3", 4: "grid-cols-2 sm:grid-cols-4" }[
    columns
  ];
  return (
    <div
      className={`grid ${cols} gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)]`}
    >
      {children}
    </div>
  );
}

/** En cell i StatRow — egen yta så gap-linjerna syns emellan. */
export function StatCell({ children }: { children: ReactNode }) {
  return <div className="bg-[var(--surface)] px-3 py-3">{children}</div>;
}
