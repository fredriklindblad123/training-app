"use client";

import { useEffect } from "react";

/* Rullar Blockplanen till veckan tränaren arbetar i, vid laddning.
 *
 * Sidan listar ett blocks alla veckor kronologiskt. Tränaren arbetar nästan
 * alltid i veckan som pågår, och den låg mitt i en lång lista som fick letas
 * fram vid varje besök. Ordningen är kvar — historiken ligger ovanför och nås
 * genom att rulla uppåt, vilket är hur en tidslinje förväntas bete sig.
 *
 * REGELN: första veckoraden vars datum är detta eller senare.
 *
 * Ett uttryck, två fall. Finns innevarande vecka i ett block är den första
 * raden som uppfyller villkoret. Gör den inte det — glapp mellan block, eller
 * en säsong som inte börjat — blir det i stället nästa vecka som faktiskt är
 * planerad, vilket är det enda vettiga svaret på "visa var jag är". Jämförelsen
 * är ren strängjämförelse, vilket fungerar eftersom ISO-datum sorterar
 * lexikografiskt.
 *
 * Klientkomponent och inte en #-länk: sidan ska landa rätt när man klickar
 * "Blockplan" i menyn, utan att adressen behöver bära ett ankare.
 *
 * `behavior: "instant"` med flit. En mjuk rullning genom hela historiken tar
 * lång tid och ser ut som att sidan skenar; här är målet utgångsläget, inte en
 * förflyttning man ska kunna följa med blicken.
 *
 * Gör ingenting om ingen rad kvalificerar — ett block helt i det förflutna
 * ska ligga kvar där det är.
 */
export function ScrollToAnchor({ fromWeek }: { fromWeek: string }) {
  useEffect(() => {
    const rows = Array.from(document.querySelectorAll<HTMLElement>("[data-week]"));
    const target = rows.find((r) => (r.dataset.week ?? "") >= fromWeek);
    target?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [fromWeek]);

  return null;
}
