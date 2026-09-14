"use client";

import { useLinkStatus } from "next/link";

/* Pendel-markören inuti en <Link>.
 *
 * Egen fil, och det är själva poängen. useLinkStatus är en klient-hook, men
 * den behöver bara vara klient i SIG — inte i komponenten som renderar
 * länken. Genom att lägga "use client" här kan en serverkomponent rendera
 * <Link><Pending /></Link> utan att själv bli klientkomponent.
 *
 * Det var inte akademiskt: när markören först låg direkt i AthleteSwitcher
 * blev hela den komponenten klient, och tio serversidor som skickar in
 * `buildHref` som en inline-funktion slutade fungera — funktioner går inte
 * att serialisera över server/klient-gränsen. Produktionen gav 500 tills det
 * här bröts ut.
 *
 * Hooken fungerar bara som BARN till länken; den läser länkens egen
 * övergångsstatus via context.
 */
export function LinkPending() {
  const { pending } = useLinkStatus();
  return (
    <span
      aria-hidden
      className={`ml-1.5 inline-block h-1 w-1 rounded-full bg-current transition-opacity duration-150 ${
        pending ? "opacity-70" : "opacity-0"
      }`}
    />
  );
}
