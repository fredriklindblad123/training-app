"use client";

import { useEffect } from "react";

/* Rullar sidan till ett element vid första renderingen.
 *
 * Finns för Blockplanen, som listar ett blocks alla veckor i kronologisk
 * ordning. Tränaren arbetar nästan alltid i veckan som pågår, och den låg
 * mitt i en lång lista som fick letas fram vid varje besök. Ordningen är
 * kvar — historiken ligger ovanför och nås genom att rulla uppåt, vilket är
 * hur man förväntar sig att en tidslinje beter sig.
 *
 * En klientkomponent och inte en #-länk i adressen: sidan ska landa rätt när
 * man klickar "Blockplan" i menyn, utan att adressen behöver bära ett ankare.
 *
 * `behavior: "instant"` med flit. En mjuk rullning från sidans topp genom
 * hela historiken tar lång tid och ser ut som att sidan skenar; här är målet
 * utgångsläget, inte en förflyttning man ska kunna följa med blicken.
 *
 * Gör ingenting om elementet saknas — ett block utan innevarande vecka (helt
 * i det förflutna eller helt i framtiden) ska ligga kvar överst.
 */
export function ScrollToAnchor({ targetId }: { targetId: string }) {
  useEffect(() => {
    document.getElementById(targetId)?.scrollIntoView({ block: "start", behavior: "instant" });
  }, [targetId]);

  return null;
}
