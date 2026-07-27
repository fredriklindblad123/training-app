import Link from "next/link";
import { BLOCK_COLOR_VARS, BLOCK_LABELS, type BlockType } from "@/lib/planning";

/* Delad navigering mellan kalenderns tidshorisonter, plus bandet som visar
 * vilket säsongsblock perioden ligger i.
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

/**
 * Säsongsblocken som ett band över den visade perioden.
 *
 * Blocken klipps mot periodens start och slut, så ett block som sträcker sig
 * utanför vyn ändå visas med rätt proportion inom den. Utan klippningen
 * skulle ett halvårslångt grundblock spränga skalan i en veckovy.
 */
export function BlockBand({
  blocks,
  from,
  to,
  className = "",
}: {
  blocks: BandBlock[];
  from: string;
  to: string;
  className?: string;
}) {
  const start = new Date(`${from}T00:00:00`).getTime();
  const end = new Date(`${to}T00:00:00`).getTime();
  const span = Math.max(1, end - start);

  const visible = blocks
    .filter((b) => b.start_date <= to && b.end_date >= from)
    .sort((a, b) => a.start_date.localeCompare(b.start_date));

  if (visible.length === 0) return null;

  const pct = (dateKey: string) => {
    const t = new Date(`${dateKey}T00:00:00`).getTime();
    return ((Math.min(Math.max(t, start), end) - start) / span) * 100;
  };

  return (
    <div className={`flex flex-col gap-1 ${className}`}>
      <div className="relative h-6 overflow-hidden rounded bg-zinc-100 dark:bg-zinc-900">
        {visible.map((b) => {
          const left = pct(b.start_date);
          const width = Math.max(2, pct(b.end_date) - left);
          return (
            <div
              key={b.id}
              className="absolute top-0 flex h-6 items-center overflow-hidden px-2"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: BLOCK_COLOR_VARS[b.block_type],
              }}
              title={`${b.name} — ${BLOCK_LABELS[b.block_type]}, ${b.start_date}–${b.end_date}${
                b.focus ? `. ${b.focus}` : ""
              }`}
            >
              <span className="truncate text-[11px] font-medium text-white drop-shadow-sm">
                {b.name}
              </span>
            </div>
          );
        })}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-zinc-500 dark:text-zinc-400">
        {visible.map((b) => (
          <span key={b.id}>
            {BLOCK_LABELS[b.block_type]}
            {b.focus ? ` — ${b.focus}` : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
