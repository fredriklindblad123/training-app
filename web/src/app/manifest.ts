import type { MetadataRoute } from "next";

/* Appen tillhör en förening och en grupp, och det ska synas även när den
 * ligger som ikon på hemskärmen. Temafärgen är klubbens blå, uppmätt ur
 * logotypen (public/ifk-logga.png) — samma #0061AB som --brand-blue i
 * globals.css. */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "IFK Göteborg Friidrott · Medeldistans",
    short_name: "IFK Medeldistans",
    description:
      "Träningsdagbok och planering för medeldistansgruppen i IFK Göteborg Friidrott.",
    start_url: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0061AB",
    icons: [
      {
        src: "/ifk-logga.png",
        sizes: "137x210",
        type: "image/png",
      },
      {
        src: "/favicon.ico",
        sizes: "any",
        type: "image/x-icon",
      },
    ],
  };
}
