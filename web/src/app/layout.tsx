import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Semi_Condensed } from "next/font/google";
import "./globals.css";

/* Typsnitten bär hela formspråket.
 *
 * Barlow Semi Condensed för mätvärden, rubriker och etiketter; Barlow för
 * brödtext. Valet är inte dekorativt: ett instrumentgränssnitt lever på att
 * ett stort tal och en liten etikett går att skilja åt i en blick, och en
 * smal grotesk ger talet plats att bli stort utan att radbryta en tabell.
 * Det är samma logik som en klockdisplay följer.
 *
 * Ersatte Geist 2026-09-13. Geist är en fin text-grotesk men har ingen
 * kondenserad snittvariant, så mätvärden och etiketter fick samma bredd och
 * appen läste platt oavsett storlek. Medvetet varken Inter eller Space
 * Grotesk — de är de två som allt AI-genererat gränssnitt landar i.
 */
const barlow = Barlow({
  variable: "--font-body",
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  display: "swap",
});

const barlowCondensed = Barlow_Semi_Condensed({
  variable: "--font-display",
  subsets: ["latin"],
  weight: ["500", "600", "700"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Träningsapp",
  description: "Träningsapp för medeldistanslöpare",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#0b0e10",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="sv"
      className={`${barlow.variable} ${barlowCondensed.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
