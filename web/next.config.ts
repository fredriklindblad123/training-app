import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Sidorna delades om efter loopens kadenser 2026-08-03
   * (docs/tranarloopen.md L1): dashboard → idag, trends → blocket,
   * planering → sasongen. Redirects i stället för att jaga varje bokmärke
   * och varje sparad länk — och viktigare, för att ett missat
   * revalidatePath-anrop någonstans i serveråtgärderna ska landa rätt i
   * stället för att tyst sluta uppdatera en sida.
   *
   * idag → dashboard (2026-08-12): sidan döptes tillbaka till "Dashboard"
   * på uttrycklig begäran (se web/src/app/(app)/layout.tsx). Regeln pekade
   * tidigare åt andra hållet (dashboard → idag) — orörd hade den fångat upp
   * varje besök på det NYA /dashboard och skickat vidare till det numera
   * borttagna /idag, vilket gav 404 på "Till appen"-knappen i produktion. */
  async redirects() {
    return [
      { source: "/idag", destination: "/dashboard", permanent: true },
      { source: "/trends", destination: "/blocket", permanent: true },
      { source: "/planering", destination: "/sasongen", permanent: true },
    ];
  },
};

export default nextConfig;
