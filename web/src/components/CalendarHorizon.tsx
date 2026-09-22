import Link from "next/link";
import { type PhaseType } from "@/lib/planning";
import { buttonClass, fieldClass } from "@/components/ui/controls";

/* Delad navigering mellan kalenderns tidshorisonter, plus BandBlock-typen
 * som veckans/månadens/årets vyer använder för att integrera säsongsblocken
 * direkt i sina rutnät (se lib/planning.ts: blockForDate/blocksInRange) i
 * stället för att visa dem som ett separat band ovanför kalendern.
 *
 * Horisonten är samma val i alla fyra vyerna, så den bor på ett ställe i
 * stället för att dupliceras med små skillnader per sida. CalendarNav är
 * hela huvudmenyn (föregående/nästa, rubrik, hoppa-till-datum, horisont) —
 * exakt samma rad i dag-, vecko-, månads- och årsvyn, bara med olika hrefs. */

export type Horizon = "day" | "week" | "month" | "block" | "year";

export function HorizonToggle({
  current,
  dayHref,
  weekHref,
  monthHref,
  blockHref,
  yearHref,
}: {
  current: Horizon;
  dayHref: string;
  weekHref: string;
  monthHref: string;
  /** Null när löparen inte har några block alls — då ritas ingen flik.
   * Övriga horisonter finns alltid; ett block är något någon lagt upp. */
  blockHref: string | null;
  yearHref: string;
}) {
  /* Block ligger mellan Månad och År (begäran 2026-09-21). Ordningen är
     växande tidsspann, och ett block är längre än en månad men kortare än
     ett år — det är också den ordning tränaren tänker i när hon zoomar ut
     från veckan mot säsongen. */
  const items: { key: Horizon; label: string; href: string }[] = [
    { key: "day", label: "Dag", href: dayHref },
    { key: "week", label: "Vecka", href: weekHref },
    { key: "month", label: "Månad", href: monthHref },
    ...(blockHref ? [{ key: "block" as const, label: "Block", href: blockHref }] : []),
    { key: "year", label: "År", href: yearHref },
  ];

  return (
    <div className="flex gap-1 text-sm" role="group" aria-label="Tidshorisont">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={current === item.key ? "page" : undefined}
          className={`rounded px-3 py-1 ${
            current === item.key
              ? "bg-[var(--foreground)] text-[var(--background)]"
              : "border border-[var(--line)] hover:bg-[var(--surface-raised)]"
          }`}
        >
          {item.label}
        </Link>
      ))}
    </div>
  );
}

/** Huvudmenyn för alla fyra kalendervyerna: föregående/nästa (ett steg —
 * bra för att bläddra dag för dag eller vecka för vecka), rubrik, "hoppa
 * till datum" (bra för att hoppa 20 dagar i ett enda klick i stället för
 * 20), och horisontväxlaren. Formuläret postar till /calendar/goto, som
 * löser om datumet till rätt URL för den horisont man just nu står i. */
export function CalendarNav({
  current,
  title,
  prevHref,
  nextHref,
  jumpDate,
  dayHref,
  weekHref,
  monthHref,
  blockHref,
  yearHref,
  athleteId,
}: {
  current: Horizon;
  title: React.ReactNode;
  prevHref: string;
  nextHref: string;
  /** Referensdatum (YYYY-MM-DD) som hoppa-till-datum-fältet förifylls med. */
  jumpDate: string;
  dayHref: string;
  weekHref: string;
  monthHref: string;
  /** Se HorizonToggle: null döljer fliken. */
  blockHref: string | null;
  yearHref: string;
  /** Fas 0-uppföljning: en coachs valda löpare — skickas med som dolt fält
   * i "hoppa till datum"-formuläret (GET till /calendar/goto), som annars
   * inte har någon URL att läsa den ur (formuläret postar bara horizon+date). */
  athleteId?: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link
          href={prevHref}
          className={buttonClass}
        >
          ←
        </Link>
        <h1 className="text-2xl font-semibold text-[var(--foreground)]">{title}</h1>
        <Link
          href={nextHref}
          className={buttonClass}
        >
          →
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action="/calendar/goto" className="flex items-center gap-1.5 text-sm">
          <input type="hidden" name="horizon" value={current} />
          {athleteId && <input type="hidden" name="athlete" value={athleteId} />}
          <input
            type="date"
            name="date"
            defaultValue={jumpDate}
            aria-label="Hoppa till datum"
            className={fieldClass}
          />
          <button
            type="submit"
            className={buttonClass}
          >
            Hoppa
          </button>
        </form>
        <HorizonToggle
          current={current}
          dayHref={dayHref}
          weekHref={weekHref}
          monthHref={monthHref}
          blockHref={blockHref}
          yearHref={yearHref}
        />
      </div>
    </div>
  );
}

export type BandBlock = {
  id: string;
  name: string;
  phase: PhaseType;
  start_date: string;
  end_date: string;
  focus?: string | null;
};
