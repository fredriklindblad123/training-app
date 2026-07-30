import Link from "next/link";
import { type BlockType } from "@/lib/planning";

/* Delad navigering mellan kalenderns tidshorisonter, plus BandBlock-typen
 * som veckans/månadens/årets vyer använder för att integrera säsongsblocken
 * direkt i sina rutnät (se lib/planning.ts: blockForDate/blocksInRange) i
 * stället för att visa dem som ett separat band ovanför kalendern.
 *
 * Horisonten är samma val i alla fyra vyerna, så den bor på ett ställe i
 * stället för att dupliceras med små skillnader per sida. CalendarNav är
 * hela huvudmenyn (föregående/nästa, rubrik, hoppa-till-datum, horisont) —
 * exakt samma rad i dag-, vecko-, månads- och årsvyn, bara med olika hrefs. */

export type Horizon = "day" | "week" | "month" | "year";

export function HorizonToggle({
  current,
  dayHref,
  weekHref,
  monthHref,
  yearHref,
}: {
  current: Horizon;
  dayHref: string;
  weekHref: string;
  monthHref: string;
  yearHref: string;
}) {
  const items: { key: Horizon; label: string; href: string }[] = [
    { key: "day", label: "Dag", href: dayHref },
    { key: "week", label: "Vecka", href: weekHref },
    { key: "month", label: "Månad", href: monthHref },
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
              ? "bg-zinc-950 text-white dark:bg-zinc-50 dark:text-zinc-950"
              : "border border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
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
  yearHref,
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
  yearHref: string;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <Link
          href={prevHref}
          className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          ←
        </Link>
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">{title}</h1>
        <Link
          href={nextHref}
          className="rounded border border-zinc-300 px-2 py-1 text-sm text-zinc-500 hover:bg-zinc-100 hover:text-zinc-950 dark:border-zinc-700 dark:hover:bg-zinc-900 dark:hover:text-zinc-50"
        >
          →
        </Link>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <form action="/calendar/goto" className="flex items-center gap-1.5 text-sm">
          <input type="hidden" name="horizon" value={current} />
          <input
            type="date"
            name="date"
            defaultValue={jumpDate}
            aria-label="Hoppa till datum"
            className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            type="submit"
            className="rounded border border-zinc-300 px-3 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Hoppa
          </button>
        </form>
        <HorizonToggle
          current={current}
          dayHref={dayHref}
          weekHref={weekHref}
          monthHref={monthHref}
          yearHref={yearHref}
        />
      </div>
    </div>
  );
}

export type BandBlock = {
  id: string;
  name: string;
  block_type: BlockType;
  start_date: string;
  end_date: string;
  focus?: string | null;
};
