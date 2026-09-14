/* Vaktar server/klient-gränsen.
 *
 * En klientkomponent kan inte ta emot en funktion som prop — funktioner går
 * inte att serialisera, och felet syns först när komponenten faktiskt
 * renderas. Det gör att både `tsc` och `next build` går igenom rent, och att
 * ett rökttest som bara hämtar sidor utan session missar det helt: den
 * komponent som bröt produktionen 2026-09-14 (AthleteSwitcher med en
 * buildHref-prop) renderas bara för en inloggad tränare.
 *
 * Kör med: node scripts/check-client-boundary.mjs
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOTS = ["src/components", "src/app"];
const files = [];
for (const root of ROOTS) {
  const walk = (d) => {
    for (const e of readdirSync(d)) {
      const p = join(d, e);
      if (statSync(p).isDirectory()) walk(p);
      else if (p.endsWith(".tsx")) files.push(p);
    }
  };
  walk(root);
}

const problems = [];
for (const file of files) {
  const text = readFileSync(file, "utf8");
  if (!/^\s*["']use client["']/m.test(text.slice(0, 200))) continue;
  for (const m of text.matchAll(/^\s*(\w+)\??:\s*\([^)]*\)\s*=>/gm)) {
    problems.push(`${file}: prop "${m[1]}" är en funktion`);
  }
}

if (problems.length > 0) {
  console.error("Funktionsprop på klientkomponent — går inte att skicka från en serverkomponent:");
  for (const p of problems) console.error("  " + p);
  process.exit(1);
}
console.log(`OK — ${files.length} filer granskade, inga funktionsprops på klientkomponenter.`);
