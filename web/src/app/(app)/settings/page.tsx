import { createClient } from "@/lib/supabase/server";
import { connectGarmin, syncGarminNow, saveThresholds } from "./actions";
import { LT2_SOURCE_LABELS } from "@/lib/threshold-test";

const STATUS_LABEL: Record<string, string> = {
  connected: "Ansluten",
  needs_reauth: "Behöver återanslutas",
  error: "Fel vid senaste synk",
};

export default async function SettingsPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;
  const supabase = await createClient();
  const { data: connection } = await supabase
    .from("garmin_connections")
    .select("status, last_synced_at, last_error")
    .maybeSingle();
  const { data: profile } = await supabase
    .from("profiles")
    .select(
      "lt1_hr, lt2_hr, threshold_hr_low, threshold_hr_high, max_hr, lt2_source, lt2_measured_on",
    )
    .maybeSingle();

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

  return (
    <div className="flex flex-1 flex-col gap-8 px-6 py-8">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
        Inställningar
      </h1>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Garmin-koppling
        </h2>
        <p className="text-sm text-zinc-500 dark:text-zinc-400">
          Anslut ditt Garmin-konto för att automatiskt synka träningspass. Passen
          hämtas dagligen, eller när du klickar &quot;Synka nu&quot;.
        </p>

        {error && <p className="text-sm text-red-600">{error}</p>}

        {connection && (
          <div className="flex flex-col gap-3 rounded border border-zinc-200 p-4 dark:border-zinc-800">
            <div className="text-sm">
              Status:{" "}
              <span className="font-medium text-zinc-900 dark:text-zinc-100">
                {STATUS_LABEL[connection.status] ?? connection.status}
              </span>
            </div>
            {connection.last_synced_at && (
              <div className="text-sm text-zinc-500 dark:text-zinc-400">
                Senast synkad:{" "}
                {new Date(connection.last_synced_at).toLocaleString("sv-SE")}
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
                className="w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
              >
                Synka nu
              </button>
            </form>
          </div>
        )}
        {!connection && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Inget Garmin-konto anslutet än.
          </p>
        )}

        <form
          action={connectGarmin}
          className="flex flex-col gap-3 rounded border border-zinc-200 p-4 sm:max-w-sm dark:border-zinc-800"
        >
          <label className="flex flex-col gap-1 text-sm">
            Garmin-e-post
            <input
              type="email"
              name="garmin_email"
              required
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Garmin-lösenord
            <input
              type="password"
              name="garmin_password"
              required
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">
            Lösenordet sparas aldrig — bara en inloggningssession som förnyas
            automatiskt vid varje synk.
          </p>
          <button
            type="submit"
            className="w-fit rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            {connection ? "Anslut på nytt" : "Anslut Garmin"}
          </button>
        </form>
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium text-zinc-900 dark:text-zinc-100">
          Personligt tröskelband
        </h2>
        <p className="max-w-2xl text-sm text-zinc-500 dark:text-zinc-400">
          Garmins autozoner är en gissning baserad på ålder och maxpuls —
          Andreas Almgren styr istället tröskelträning mot ett eget kalibrerat
          pulsband (för honom 167–178 slag/min), satt utifrån vad ett
          laktattest faktiskt visar. Fyll i vad du vet; resten kan lämnas tomt
          tills ett test finns.
        </p>
        <form
          action={saveThresholds}
          className="grid grid-cols-2 gap-3 rounded border border-zinc-200 p-4 sm:max-w-lg sm:grid-cols-3 dark:border-zinc-800"
        >
          <label className="flex flex-col gap-1 text-sm">
            Tröskelband låg
            <input
              type="number"
              min="0"
              name="threshold_hr_low"
              defaultValue={profile?.threshold_hr_low ?? ""}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Tröskelband hög
            <input
              type="number"
              min="0"
              name="threshold_hr_high"
              defaultValue={profile?.threshold_hr_high ?? ""}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Maxpuls
            <input
              type="number"
              min="0"
              name="max_hr"
              defaultValue={profile?.max_hr ?? ""}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            LT1 (aerob tröskel)
            <input
              type="number"
              min="0"
              name="lt1_hr"
              defaultValue={profile?.lt1_hr ?? ""}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            LT2 (anaerob tröskel)
            <input
              type="number"
              min="0"
              name="lt2_hr"
              defaultValue={profile?.lt2_hr ?? ""}
              className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
            />
            {lt2SourceLabel && (
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{lt2SourceLabel}</span>
            )}
          </label>
          <div className="col-span-2 sm:col-span-3">
            <button
              type="submit"
              className="w-fit rounded bg-zinc-950 px-4 py-2 text-sm text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
            >
              Spara tröskelband
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
