import Link from "next/link";
import { type BlockType } from "@/lib/planning";

/* Delad navigering mellan kalenderns tidshorisonter, plus BandBlock-typen
 * som veckans/månadens/årets vyer använder för att integrera säsongsblocken
 * direkt i sina rutnät (se lib/planning.ts: blockForDate/blocksInRange) i
 * stället för att visa dem som ett separat band ovanför kalendern.
 *
 * Horisonten är samma val i alla tre vyerna, så den bor på ett ställe i
 * stället för att dupliceras med små skillnader per sida. */

export type Horizon = "week" | "month" | "year";

export function HorizonToggle({
  current,
  weekHref,
  monthHref,
  yearHref,
}: {
  current: Horizon;
  weekHref: string;
  monthHref: string;
  yearHref: string;
}) {
  const items: { key: Horizon; label: string; href: string }[] = [
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

export type BandBlock = {
  id: string;
  name: string;
  block_type: BlockType;
  start_date: string;
  end_date: string;
  focus?: string | null;
};
