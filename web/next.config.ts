import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* Sidorna delades om efter loopens kadenser 2026-08-03
   * (docs/tranarloopen.md L1): dashboard → idag, trends → blocket,
   * planering → sasongen. Redirects i stället för att jaga varje bokmärke
   * och varje sparad länk — och viktigare, för att ett missat
   * revalidatePath-anrop någonstans i serveråtgärderna ska landa rätt i
   * stället för att tyst sluta uppdatera en sida. */
  async redirects() {
    return [
      { source: "/dashboard", destination: "/idag", permanent: true },
      { source: "/trends", destination: "/blocket", permanent: true },
      { source: "/planering", destination: "/sasongen", permanent: true },
    ];
  },
};

export default nextConfig;
