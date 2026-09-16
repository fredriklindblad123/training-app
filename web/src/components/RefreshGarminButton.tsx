"use client";

import { useFormStatus } from "react-dom";
import { circleButtonClass } from "@/components/ui/CircleButton";

/* Själva knappen i uppdateringsformuläret.
 *
 * Egen klientkomponent av samma skäl som LinkPending: useFormStatus läser
 * status från formuläret OVANFÖR sig i trädet, så den måste sitta inuti
 * <form> — men bara den behöver vara klient, inte formuläret eller den
 * serverkomponent som hämtar tidsstämpeln.
 *
 * Cirkel sedan 2026-09-16, i samma form som adepternas avatarer: raden hade
 * annars blivit fyra cirklar bredvid tre textknappar, vilket läser som två
 * olika saker som råkat hamna intill varandra. Klockslaget för senaste synk
 * flyttade in i title — det var en textrad bredvid knappen förut, och en
 * sådan får inte plats i en rad av cirklar.
 *
 * Återkopplingen är hela poängen. En Garmin-synk tar flera sekunder (inloggning,
 * aktiviteter, varv, sömn — för tränaren gånger antalet adepter), och utan
 * något som ändrar sig ser knappen ut att vara trasig. Då klickar man igen,
 * vilket startar om alltihop.
 *
 * Knappen låses under tiden av samma anledning. `aria-busy` så att en
 * skärmläsare får veta det, inte bara den som ser texten byta.
 */
export function RefreshGarminButton({ title }: { title: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      aria-label={title}
      title={title}
      className={circleButtonClass}
    >
      {/* Samma pil i båda lägena, men snurrande när det pågår. En ikon som
          BYTS ut fick knappen att hoppa; en som roterar gör det inte. */}
      <svg
        viewBox="0 0 24 24"
        className={`h-4 w-4 ${pending ? "motion-safe:animate-spin" : ""}`}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.9}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
      >
        <path d="M20 11a8 8 0 1 0-.6 4M20 5v6h-6" />
      </svg>
    </button>
  );
}
