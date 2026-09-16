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
   *                             delades i /arsoversikt + /blockplan
   *
   * Samma fälla som kommentaren här redan varnade för i augusti (regeln
   * dashboard → idag pekade åt fel håll och gav 404 på "Till appen"), utan
   * att de andra två raderna sågs över samtidigt.
   *
   * Historiken, så nästa läsare slipper gräva i git-loggen:
   *   idag      → dashboard  (2026-08-12, namnet togs tillbaka)
   *   blocket   → trender    (2026-08-13, sidan visade redan trendanalys)
   *   sasongen  → arsplan + blockplan (2026-08-17, delad i två)
   *   oversikt  → uppfoljning (2026-08-27, ersatt av en bredare vy)
   *   arsplan   → blockplan  (2026-08-27), tillbaka 2026-09-15, och
   *                             vidare till blockoversikt 2026-09-16
   *
   * 2026-09-15 roterade planeringens tre namn ett steg:
   *   blockplan (block och tidslinje)  → arsplan
   *   detaljplan (blockens veckor)     → blockplan
   *   /detaljplan är nu en NY sida: innevarande veckas planering.
   *
   * Därför finns INGEN regel för /detaljplan: adressen lever vidare och
   * svarar, den visar bara något annat. Och regeln arsplan → blockplan är
   * borttagen — efter rotationen pekade den på sig själv, vilket är en
   * oändlig omdirigering och exakt den fälla som beskrivs ovan.
   */
  async redirects() {
    return [
      { source: "/idag", destination: "/dashboard", permanent: true },

      // Trendanalysen, två generationer av namn.
      { source: "/trends", destination: "/trender", permanent: true },
      { source: "/blocket", destination: "/trender", permanent: true },

      /* Planeringen. /sasongen delades i två sidor, så det finns inget exakt
       * mål — årsplanen är den halva som ärvde sidans identitet (block,
       * tidslinje, veckorutnät). */
      { source: "/planering", destination: "/arsoversikt", permanent: true },
      { source: "/sasongen", destination: "/arsoversikt", permanent: true },
      // Sidan hette Årsplan i två dygn (2026-09-15 till 09-16). Kort, men
      // adressen hann delas och menyn hann läras in.
      { source: "/arsplan", destination: "/arsoversikt", permanent: true },
      // Hette Blocköversikt i ett dygn (2026-09-16), innan namnet landade på
      // Årsöversikt — sidan visar hela året, inte ett block.
      { source: "/blockoversikt", destination: "/arsoversikt", permanent: true },

      // Översikt ersattes av Uppföljning, som gör samma sak i "Dag"-läget.
      { source: "/oversikt", destination: "/uppfoljning", permanent: true },
    ];
  },
};

export default nextConfig;
