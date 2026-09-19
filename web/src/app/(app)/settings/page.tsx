import { createClient } from "@/lib/supabase/server";
import {
  connectGarmin,
  syncGarminNow,
  saveThresholds,
  saveGoal,
  addAthlete,
  removeAthlete,
} from "./actions";
import { getScopedProfile } from "@/lib/auth-scope";
import { LT2_SOURCE_LABELS } from "@/lib/threshold-test";
import { GOAL_EVENTS } from "@/lib/race-pace";
import { formatDateTime } from "@/lib/format";
import { buttonClass, fieldClass, primaryButtonClass } from "@/components/ui/controls";

const ATHLETE_ADDED_LABEL: Record<string, string> = {
  linked: "Löparen kopplad — hittar redan ett konto på den e-posten.",
  invited: "Inbjudan sparad. Löparen kopplas automatiskt nästa gång du lägger till samma e-post, när kontot finns.",
};

const STATUS_LABEL: Record<string, string> = {
  connected: "Ansluten",
  needs_reauth: "Behöver återanslutas",
  error: "Fel vid senaste synk",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; athleteAdded?: string }>;
}) {
  const { error, athleteAdded } = await searchParams;
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from("garmin_connections")
    .select("status, last_synced_at, last_error")
    .maybeSingle();
  const scoped = await getScopedProfile(supabase);
  /* Frågan MÅSTE scopas till den egna raden. RLS låter en coach läsa sina
   * länkade löpares profiler ("profiles: coach läser länkad löpares rad"), så
   * ett oscopat select returnerar coachens rad plus en per adept — och
   * .maybeSingle() svarar då med null, inte med den första raden. Följden var
   * att hela formuläret på den här sidan stod tomt för varje coach, även när
   * värdena fanns sparade. scoped.userId är redan hämtat, så det kostar
   * ingen extra rundtur. */
  const { data: profile } = scoped
    ? await supabase
        .from("profiles")
        .select(
          "lt1_hr, lt2_hr, threshold_hr_low, threshold_hr_high, max_hr, lt2_source, lt2_measured_on, goal_event, goal_seconds",
        )
        .eq("id", scoped.userId)
        .maybeSingle()
    : { data: null };

  // K8: ett fälttest är en uppskattning, ett laktattest en mätning — visa
  // alltid vilket ett sparat LT2 bygger på, aldrig som en anonym siffra.
  const lt2SourceLabel = profile?.lt2_source
    ? [
        LT2_SOURCE_LABELS[profile.lt2_source] ?? profile.lt2_source,
        profile.lt2_measured_on,
      ]
        .filter(Boolean)
        .join(" ")
    : null;

  const goalSeconds = profile?.goal_seconds != null ? Number(profile.goal_seconds) : null;
  const goalTimeValue =
    goalSeconds != null
      ? `${Math.floor(goalSeconds / 60)}:${(goalSeconds % 60).toFixed(2).padStart(5, "0")}`.replace(
          /\.00$/,
          "",
        )
      : "";

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">
        Inställningar
      </h1>

      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Garmin-koppling
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Anslut ditt Garmin-konto för att automatiskt synka träningspass. Passen
          hämtas dagligen, eller när du klickar &quot;Synka nu&quot;.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {connection && (
          <div className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
            <div className="text-sm">
              Status:{" "}
              <span className="font-medium text-[var(--foreground)]">
                {STATUS_LABEL[connection.status] ?? connection.status}
              </span>
            </div>
            {connection.last_synced_at && (
              <div className="text-sm text-[var(--ink-3)]">
                Senast synkad: {formatDateTime(connection.last_synced_at)}
              </div>
            )}
            {connection.last_error && (
              <div className="text-sm text-red-600">{connection.last_error}</div>
            )}
            {connection.status === "needs_reauth" && (
              <p className="text-sm text-amber-600 dark:text-amber-400">
                Garmin-inloggningen har slutat fungera (t.ex. efter att Garmin
                ändrat sitt inloggningsflöde) — anslut på nytt nedan.
              </p>
            )}
            <form action={syncGarminNow}>
              <button
                type="submit"
                className={primaryButtonClass}
              >
                Synka nu
              </button>
            </form>
          </div>
        )}
        {!connection && (
          <p className="text-sm text-[var(--ink-3)]">
            Inget Garmin-konto anslutet än.
          </p>
        )}

        <form
          action={connectGarmin}
          className="flex flex-col gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 sm:max-w-sm"
        >
          <label className="flex flex-col gap-1 text-sm">
            Garmin-e-post
            <input
              type="email"
              name="garmin_email"
              required
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Garmin-lösenord
            <input
              type="password"
              name="garmin_password"
              required
              className={fieldClass}
            />
          </label>
          <p className="text-xs text-[var(--ink-3)]">
            Lösenordet sparas aldrig — bara en inloggningssession som förnyas
            automatiskt vid varje synk.
          </p>
          <button
            type="submit"
            className={buttonClass}
          >
            {connection ? "Anslut på nytt" : "Anslut Garmin"}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Personligt tröskelband
        </h2>
        <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
          Garmins autozoner är en gissning baserad på ålder och maxpuls —
          Andreas Almgren styr istället tröskelträning mot ett eget kalibrerat
          pulsband (för honom 167–178 slag/min), satt utifrån vad ett
          laktattest faktiskt visar. Fyll i vad du vet; resten kan lämnas tomt
          tills ett test finns.
        </p>
        <form
          action={saveThresholds}
          className="grid grid-cols-2 gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 sm:max-w-lg sm:grid-cols-3"
        >
          <label className="flex flex-col gap-1 text-sm">
            Tröskelband låg
            <input
              type="number"
              min="0"
              name="threshold_hr_low"
              defaultValue={profile?.threshold_hr_low ?? ""}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tröskelband hög
            <input
              type="number"
              min="0"
              name="threshold_hr_high"
              defaultValue={profile?.threshold_hr_high ?? ""}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Maxpuls
            <input
              type="number"
              min="0"
              name="max_hr"
              defaultValue={profile?.max_hr ?? ""}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            LT1 (aerob tröskel)
            <input
              type="number"
              min="0"
              name="lt1_hr"
              defaultValue={profile?.lt1_hr ?? ""}
              className={fieldClass}
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            LT2 (anaerob tröskel)
            <input
              type="number"
              min="0"
              name="lt2_hr"
              defaultValue={profile?.lt2_hr ?? ""}
              className={fieldClass}
            />
            {lt2SourceLabel && (
              <span className="text-xs text-[var(--ink-3)]">{lt2SourceLabel}</span>
            )}
          </label>
          <div className="col-span-2 sm:col-span-3">
            <button
              type="submit"
              className={primaryButtonClass}
            >
              Spara tröskelband
            </button>
          </div>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Måltid
        </h2>
        <p className="max-w-3xl text-sm text-[var(--ink-2)]">
          Vad du siktar mot på din huvudgren. Fartbanden i Form-vyns växeldiagram härleds ur
          måltiden — träningsfarter ska utgå från vad du siktar mot, inte från vad du redan
          sprungit. Utan mål används ditt bästa resultat de senaste två åren i stället, och har du
          inga resultat går fartvyn inte att visa.
        </p>
        <form action={saveGoal} className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1 text-sm">
            Gren
            <select name="goal_event" defaultValue={profile?.goal_event ?? ""} className={fieldClass}>
              <option value="">— ingen —</option>
              {GOAL_EVENTS.map((e) => (
                <option key={e} value={e}>
                  {e}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Måltid
            <input
              type="text"
              inputMode="decimal"
              name="goal_time"
              placeholder="4:32"
              defaultValue={goalTimeValue}
              className={fieldClass}
            />
            <span className="text-xs text-[var(--ink-3)]">mm:ss eller sekunder</span>
          </label>
          <div className="col-span-2 flex items-end sm:col-span-1">
            <button type="submit" className={primaryButtonClass}>
              Spara mål
            </button>
          </div>
        </form>
      </section>

      {scoped?.role === "coach" && (
        <section className="flex flex-col gap-3">
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Löpare du coachar
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-[var(--ink-2)]">
            Lägg till en löpares e-post. Har hen redan ett konto kopplas ni direkt; annars
            sparas en inbjudan — lägg till samma e-post igen när löparen har signat upp, så
            kopplas ni då.
          </p>

          {athleteAdded && ATHLETE_ADDED_LABEL[athleteAdded] && (
            <p className="text-sm text-emerald-700 dark:text-emerald-400">
              {ATHLETE_ADDED_LABEL[athleteAdded]}
            </p>
          )}

          {scoped.linkedAthletes.length > 0 && (
            <ul className="flex flex-col gap-2">
              {scoped.linkedAthletes.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-[var(--line)] px-3 py-2 text-sm"
                >
                  <span className="text-[var(--foreground)]">
                    {a.fullName ?? "Namnlös löpare"}
                  </span>
                  <form action={removeAthlete}>
                    <input type="hidden" name="athlete_id" value={a.id} />
                    <button
                      type="submit"
                      className="text-xs text-[var(--ink-3)] hover:text-red-600 dark:hover:text-red-400"
                    >
                      Ta bort
                    </button>
                  </form>
                </li>
              ))}
            </ul>
          )}

          <form
            action={addAthlete}
            className="flex flex-wrap items-end gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 sm:max-w-sm"
          >
            <label className="flex flex-1 flex-col gap-1 text-sm">
              Löparens e-post
              <input
                type="email"
                name="athlete_email"
                required
                className={fieldClass}
              />
            </label>
            <button
              type="submit"
              className={buttonClass}
            >
              Lägg till
            </button>
          </form>
        </section>
      )}
    </div>
  );
}
