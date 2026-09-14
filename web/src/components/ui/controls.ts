/* Formulärkontrollernas utseende, på ett ställe.
 *
 * Fälten låg tidigare som inline-klasser på varje input och select — tolv
 * varianter av i praktiken samma sak, som drev isär varje gång någon skrev av
 * en granne och råkade utelämna en klass. Ett av dem hade dessutom
 * `hover:bg-...` två gånger, kvar efter en tokenmigrering.
 *
 * Klassträngar snarare än komponenter med flit: det här är inbyggda
 * formulärelement som redan gör precis rätt saker med tangentbord,
 * skärmläsare och `form`-attribut. Att linda dem i React-komponenter hade
 * bara lagt ett lager mellan utvecklaren och plattformen — och tvingat fram
 * en prop för varje attribut man vill skicka vidare.
 */

/** Text-, tal-, datum- och selectfält. */
export const fieldClass =
  "rounded-md border border-[var(--line)] bg-[var(--surface)] px-2 py-1 text-sm " +
  "text-[var(--foreground)] focus:border-[var(--ink-3)] focus:outline-none";

/** Flerradigt fält — samma ram, men luftigare eftersom text ska kunna läsas. */
export const textareaClass = `${fieldClass} min-h-24 leading-relaxed`;

/** Sekundär knapp: ram, ingen fyllning. Standardvalet för allt som inte är
 * sidans huvudhandling. */
export const buttonClass =
  "display w-fit rounded-md border border-[var(--line)] px-3 py-1.5 text-sm font-medium " +
  "text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-raised)] " +
  "hover:text-[var(--foreground)]";

/** Primär knapp: inverterad mot ytan, så den fungerar i båda teman utan en
 * egen accentfärg. En per vy — två primärknappar bredvid varandra betyder att
 * ingen av dem är primär. */
export const primaryButtonClass =
  "display w-fit rounded-md bg-[var(--foreground)] px-4 py-1.5 text-sm font-medium " +
  "text-[var(--background)] transition-opacity hover:opacity-90";

/** Liten sekundärknapp för täta rader (tabellceller, passkort). */
export const smallButtonClass =
  "display rounded-md border border-[var(--line)] px-2 py-0.5 text-xs font-medium " +
  "text-[var(--ink-2)] transition-colors hover:bg-[var(--surface-raised)] " +
  "hover:text-[var(--foreground)]";

/** Destruktiv handling. Färgen sitter i texten, inte i en fylld yta: en röd
 * knapp drar blicken till sig i en lista där den nästan aldrig är det man
 * ska göra. Statusfärgen återanvänds i stället för en egen röd. */
export const dangerButtonClass =
  "display w-fit rounded-md border border-[var(--line)] px-3 py-1 text-sm font-medium " +
  "text-[var(--status-concern)] transition-colors hover:bg-[var(--surface-raised)]";
