"use client";

import { useFormStatus } from "react-dom";

/* Själva knappen i uppdateringsformuläret.
 *
 * Egen klientkomponent av samma skäl som LinkPending: useFormStatus läser
 * status från formuläret OVANFÖR sig i trädet, så den måste sitta inuti
 * <form> — men bara den behöver vara klient, inte formuläret eller den
 * serverkomponent som hämtar tidsstämpeln.
 *
 * Återkopplingen är hela poängen. En Garmin-synk tar flera sekunder (inloggning,
 * aktiviteter, varv, sömn — för tränaren gånger antalet adepter), och utan
 * något som ändrar sig ser knappen ut att vara trasig. Då klickar man igen,
 * vilket startar om alltihop.
 *
 * Knappen låses under tiden av samma anledning. `aria-busy` så att en
 * skärmläsare får veta det, inte bara den som ser texten byta.
 */
export function RefreshGarminButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      title="Hämta senaste träningsdata från Garmin för dig och dina adepter"
      className="display flex items-center gap-1.5 rounded-md border border-[var(--line)] px-2.5 py-1 text-sm font-medium text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)] disabled:cursor-progress disabled:opacity-70"
    >
      {/* Snurran ritas alltid, men är osynlig när inget pågår — då hoppar inte
          knappens bredd i det ögonblick man trycker. */}
      <span
        aria-hidden
        className={`inline-block h-3 w-3 rounded-full border-2 border-current border-r-transparent transition-opacity motion-reduce:animate-none ${
          pending ? "animate-spin opacity-100" : "opacity-0"
        }`}
      />
      {pending ? "Hämtar…" : "Uppdatera"}
    </button>
  );
}
