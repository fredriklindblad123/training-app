"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { LinkPending } from "@/components/ui/LinkPending";
import { Dropdown } from "@/components/ui/Dropdown";

/* Löparväljaren: ansikten, inte en meny.
 *
 * Var tidigare namnpills på bred skärm och en hopfällbar meny på smal. Menyn
 * kostade ett extra klick före varje byte och kunde dessutom stå öppen när man
 * inte ville det. Med fyra adepter finns det ingen anledning att gömma dem
 * bakom en lista — de får plats som fyra cirklar, och tränaren pekar på en
 * person i stället för att öppna en meny och läsa namn.
 *
 * Över MAX_AVATARS faller den tillbaka på den gamla menyn. Ansikten fungerar
 * så länge man känner igen dem på en initial; en hel klubb gör man inte.
 *
 * Kulören härleds ur löparens id och är därmed STABIL — samma person har
 * samma färg i varje vy, varje dag. En slumpad eller indexbaserad färg hade
 * flyttat sig när roster ändras, och då betyder färgen ingenting.
 *
 * Syns inte alls i planeringsvyerna (se NO_SWITCHER_PATHS): de visar redan
 * alla löpare sida vid sida.
 */

type Athlete = { id: string; fullName: string | null };

const NO_SWITCHER_PATHS = ["/blockoversikt", "/blockplan", "/detaljplan", "/uppfoljning"];

/** Fler än så här och ansiktena blir en rad prickar man ändå måste läsa. */
const MAX_AVATARS = 6;

/* Tonerna är valda för att gå isär även för den som inte skiljer rött från
 * grönt: de skiljer sig i ljushet lika mycket som i kulör. Mörk text på ljus
 * platta, så initialen är läsbar i båda teman utan att tonen måste bytas. */
const AVATAR_TONES = [
  "#d98b5f",
  "#7fa9d4",
  "#b48fd0",
  "#86bf9a",
  "#d4a35f",
  "#c98fa0",
];

function toneFor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return AVATAR_TONES[h % AVATAR_TONES.length];
}

function initial(name: string | null): string {
  return (name ?? "?").trim().charAt(0).toUpperCase() || "?";
}

export function HeaderAthleteSwitcher({
  athletes,
  defaultAthleteId,
}: {
  athletes: Athlete[];
  /** Vilken löpare sidan faller tillbaka på utan `?athlete=`. Räknas fram på
   * servern (resolveScopedUserId) — klienten kan inte känna till regeln. */
  defaultAthleteId: string;
}) {
  const pathname = usePathname();
  const params = useSearchParams();

  if (athletes.length === 0) return null;
  if (NO_SWITCHER_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`))) {
    return null;
  }

  const active = params.get("athlete") ?? defaultAthleteId;

  /** Samma sida, samma filter, annan löpare. */
  const hrefFor = (id: string) => {
    const next = new URLSearchParams(params.toString());
    next.set("athlete", id);
    return `${pathname}?${next.toString()}`;
  };

  if (athletes.length > MAX_AVATARS) {
    const activeName = athletes.find((a) => a.id === active)?.fullName ?? "Löpare";
    const pill = (on: boolean) =>
      `block rounded-md px-2.5 py-1 font-medium transition-colors ${
        on
          ? "bg-[var(--foreground)] text-[var(--background)]"
          : "text-[var(--ink-2)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
      }`;
    return (
      <Dropdown label={activeName} align="left" width="w-48">
        {athletes.map((a) => (
          <Link key={a.id} href={hrefFor(a.id)} className={pill(active === a.id)}>
            {a.fullName ?? "Namnlös"}
          </Link>
        ))}
      </Dropdown>
    );
  }

  return (
    <div role="group" aria-label="Välj löpare" className="flex items-center gap-1.5">
      {athletes.map((a) => {
        const on = active === a.id;
        return (
          <Link
            key={a.id}
            href={hrefFor(a.id)}
            aria-current={on ? "page" : undefined}
            title={a.fullName ?? "Namnlös"}
            className="relative flex"
          >
            <span
              className={`display flex h-8 w-8 items-center justify-center rounded-full text-sm font-bold text-[#17191c] transition-all ${
                on
                  ? "ring-2 ring-[var(--foreground)] ring-offset-2 ring-offset-[var(--background)]"
                  : "opacity-55 hover:opacity-90"
              }`}
              style={{ backgroundColor: toneFor(a.id) }}
            >
              {initial(a.fullName)}
            </span>
            {/* Namnet finns för skärmläsare — en initial i en cirkel säger
                inget utan sammanhang. */}
            <span className="sr-only">{a.fullName ?? "Namnlös löpare"}</span>
            <LinkPending />
          </Link>
        );
      })}
    </div>
  );
}
