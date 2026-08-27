import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Adressbyten. Redirects i stället för att jaga varje bokmärke och varje
   * sparad länk — och viktigare, för att ett missat revalidatePath-anrop
   * någonstans i serveråtgärderna ska landa rätt i stället för att tyst sluta
   * uppdatera en sida.
   *
   * REGELN SOM GÖR ATT DET HÄR INTE RUTTNAR: en redirect ska peka på en sida
   * som finns NU, inte på det namn sidan råkade ha när regeln skrevs. Kedjade
   * byten måste därför skrivas om, inte staplas.
   *
   * Det var precis vad som hade hänt när listan sågs över 2026-08-27: två av
   * tre regler pekade på sidor som inte längre existerade, och gav 404 i
   * produktion.
   *
   *   /trends    → /blocket   — men /blocket blev /trender 2026-08-13
   *   /planering → /sasongen  — men /sasongen togs bort 2026-08-17 och
   *                             delades i /arsplan + /detaljplan
   *
   * Samma fälla som kommentaren här redan varnade för i augusti (regeln
   * dashboard → idag pekade åt fel håll och gav 404 på "Till appen"), utan
   * att de andra två raderna sågs över samtidigt.
   *
   * Historiken, så nästa läsare slipper gräva i git-loggen:
   *   idag      → dashboard  (2026-08-12, namnet togs tillbaka)
   *   blocket   → trender    (2026-08-13, sidan visade redan trendanalys)
   *   sasongen  → arsplan + detaljplan (2026-08-17, delad i två)
   *   oversikt  → uppfoljning (2026-08-27, ersatt av en bredare vy)
   *   arsplan   → blockplan  (2026-08-27, sidan handlar om block)
   */
  async redirects() {
    return [
      { source: "/idag", destination: "/dashboard", permanent: true },

      // Trendanalysen, två generationer av namn.
      { source: "/trends", destination: "/trender", permanent: true },
      { source: "/blocket", destination: "/trender", permanent: true },

      /* Planeringen. /sasongen delades i två sidor, så det finns inget exakt
       * mål — blockplanen är den halva som ärvde sidans identitet (block,
       * tidslinje, veckorutnät); detaljplanen var det nya. */
      { source: "/planering", destination: "/blockplan", permanent: true },
      { source: "/sasongen", destination: "/blockplan", permanent: true },
      { source: "/arsplan", destination: "/blockplan", permanent: true },

      // Översikt ersattes av Uppföljning, som gör samma sak i "Dag"-läget.
      { source: "/oversikt", destination: "/uppfoljning", permanent: true },
    ];
  },
};

export default nextConfig;
