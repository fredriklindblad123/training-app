import Image from "next/image";

/* Klubbmärket: IFK Göteborg Friidrotts sköld plus klubbnamnet.
 *
 * Appen är byggd för en förening och en grupp — medeldistans i IFK Göteborg
 * Friidrott — och det ska synas. En adept som loggar in ska se att det här är
 * klubbens verktyg, inte en anonym träningsapp.
 *
 * Logotypen ligger som fil i public/ och hämtas inte från klubbens hemsida
 * vid varje sidvisning. Den sidan är en SportAdmin-mall vars bild-URL
 * (im/getLogga.asp?SID=…&v=51) bär ett versionsnummer i frågesträngen — den
 * kan bytas ut eller försvinna utan förvarning, och ett sidhuvud som går
 * sönder för att någon annan bytt CMS är inte värt bekvämligheten.
 */

export function ClubMark({
  size = "sm",
  showName = true,
}: {
  size?: "sm" | "lg";
  /** Av i trånga lägen där skölden ensam räcker som avsändare. */
  showName?: boolean;
}) {
  const px = size === "lg" ? 56 : 28;

  return (
    <span className="flex items-center gap-2.5">
      <Image
        src="/ifk-logga.png"
        alt="IFK Göteborg Friidrott"
        width={px}
        height={Math.round((px * 210) / 137)}
        priority={size === "lg"}
        className="shrink-0"
      />
      {showName && (
        <span className="flex min-w-0 flex-col leading-tight">
          <span
            className={`display font-semibold text-[var(--foreground)] ${
              size === "lg" ? "text-lg" : "text-sm"
            }`}
          >
            IFK Göteborg Friidrott
          </span>
          <span
            className={`tracking-[0.09em] uppercase ${
              size === "lg" ? "text-xs" : "text-[0.6rem]"
            }`}
            style={{ color: "var(--brand-blue)" }}
          >
            Medeldistans
          </span>
        </span>
      )}
    </span>
  );
}
