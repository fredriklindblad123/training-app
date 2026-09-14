import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { VIEW_MODE_COOKIE, type ViewMode } from "@/lib/view-mode";

/* Växeln mellan tränar- och löparläge. Visas bara för en coach — en adept är
 * bara löpare och har inget att växla mellan.
 *
 * Två knappar i en sammanhållen kontroll, inte en av/på-switch: en switch
 * kräver att man vet vad "på" betyder, medan två namngivna lägen där det ena
 * är markerat säger det själv. Samma pill-form som huvudmenyn och
 * löparväljaren använder, så att det läses som "ett val" och inte som en
 * inställning.
 *
 * Server actions i stället för en klientkomponent: att byta läge ÄR en
 * serveråtgärd (cookie + omrendering), och en form gör det utan en enda rad
 * klientkod. Det gör också att växeln fungerar innan JavaScript laddat.
 */

async function setMode(mode: ViewMode) {
  "use server";
  const store = await cookies();
  store.set(VIEW_MODE_COOKIE, mode, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Ett år: läget är en arbetsvana, inte en session. Den som mest coachar
    // ska slippa välja om varje gång hen kommer tillbaka.
    maxAge: 60 * 60 * 24 * 365,
  });
  // "layout" — hela trädet beror på läget: menyn, löparväljaren och vilken
  // användares data sidan hämtar.
  revalidatePath("/", "layout");
}

export function ViewModeToggle({ mode }: { mode: ViewMode }) {
  return (
    <div
      role="group"
      aria-label="Visningsläge"
      className="display flex items-center gap-0.5 rounded-lg border border-[var(--line)] p-0.5 text-sm"
    >
      {(
        [
          { value: "coach", label: "Tränare" },
          { value: "runner", label: "Löpare" },
        ] as const
      ).map((opt) => {
        const active = mode === opt.value;
        return (
          <form
            key={opt.value}
            action={async () => {
              "use server";
              await setMode(opt.value);
            }}
          >
            <button
              type="submit"
              aria-pressed={active}
              className={`rounded-md px-2.5 py-1 font-medium transition-colors ${
                active
                  ? "bg-[var(--foreground)] text-[var(--background)]"
                  : "text-[var(--ink-2)] hover:bg-[var(--surface-raised)] hover:text-[var(--foreground)]"
              }`}
            >
              {opt.label}
            </button>
          </form>
        );
      })}
    </div>
  );
}
