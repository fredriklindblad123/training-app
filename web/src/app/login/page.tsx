import { login, requestAccount } from "./actions";
import { ClubMark } from "@/components/ClubMark";

/* Registrering är spärrad av auth-hooken hook_restrict_signup_by_email: bara
 * adresser i allowed_signup_emails kan skapa konto. Knappen "Skapa konto" låg
 * därför tidigare här och gav ett obegripligt fel för alla utom de redan
 * inbjudna. Den är ersatt av en förfrågan som en coach godkänner.
 *
 * Villkorstexten är medvetet kort. Den läses av femtonåringar och deras
 * föräldrar, och en sida med fem stycken juridik läses inte alls — fyra
 * punkter som faktiskt går att ta in säger mer än en text ingen öppnar. */

const fieldClass = "rounded-lg border border-[var(--line)] bg-[var(--surface)] px-3 py-2";
const labelClass = "flex flex-col gap-1 text-sm text-[var(--ink-2)]";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div className="mx-auto flex w-full max-w-xl flex-1 flex-col gap-8 px-6 py-12">
      <div className="flex flex-col gap-4">
        <ClubMark size="lg" />
        <div>
          <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">
            Träningsdagboken
          </h1>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Planering och uppföljning för medeldistansgruppen i IFK Göteborg Friidrott.
          </p>
        </div>
      </div>

      {error && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}
      {message && (
        <p className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 p-3 text-sm text-emerald-700 dark:text-emerald-400">
          {message}
        </p>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
          Logga in
        </h2>
        <form className="flex flex-col gap-3">
          <label className={labelClass}>
            E-post
            <input id="email" name="email" type="email" required className={fieldClass} />
          </label>
          <label className={labelClass}>
            Lösenord
            <input
              id="password"
              name="password"
              type="password"
              required
              minLength={6}
              className={fieldClass}
            />
          </label>
          <button
            formAction={login}
            className="mt-1 rounded bg-[var(--foreground)] px-4 py-2 text-[var(--background)] hover:opacity-90"
          >
            Logga in
          </button>
        </form>
      </section>

      <hr className="border-[var(--line)]" />

      <section className="flex flex-col gap-3">
        <div>
          <h2 className="display text-xl leading-tight font-semibold text-[var(--foreground)]">
            Begär ett konto
          </h2>
          <p className="mt-1 text-sm text-[var(--ink-2)]">
            Konton skapas inte automatiskt. Skicka en förfrågan så får du besked när den
            behandlats.
          </p>
        </div>

        {/* Fyra punkter, inte fem stycken. Det här ska gå att läsa klart. */}
        <ul className="flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4 text-sm text-[var(--ink-2)]">
          <li>
            <strong className="text-[var(--foreground)]">Vad appen är till för.</strong> Du loggar
            din träning och dina tävlingsresultat, och får tillbaka en bild av hur träningen
            fördelar sig och hur formen utvecklas. Din tränare i medeldistansgruppen planerar
            passen här. Appen används av IFK Göteborg Friidrott och är inte öppen för andra.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">Din tränare ser det du loggar.</strong>{" "}
            Pass, resultat, dagboksanteckningar och de mått appen räknar fram. Det är hela
            poängen med att ni delar dagbok — men det ska du veta innan du börjar.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">Garmin är frivilligt.</strong> Du kan
            koppla din klocka så att pass hämtas automatiskt, och koppla bort den när du vill. Vill
            du inte koppla den lägger du in pass och resultat för hand — det mesta i appen
            fungerar ändå.
          </li>
          <li>
            <strong className="text-[var(--foreground)]">Är du under 18 krävs målsmans
            samtycke.</strong> Fyll i målsmans namn och e-post nedan, och kryssa i rutan.
          </li>
        </ul>

        <form action={requestAccount} className="flex flex-col gap-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className={labelClass}>
              Ditt namn
              <input name="full_name" type="text" required className={fieldClass} />
            </label>
            <label className={labelClass}>
              Din e-post
              <input name="email" type="email" required className={fieldClass} />
            </label>
            <label className={labelClass}>
              Födelseår
              <input
                name="birth_year"
                type="number"
                min={1900}
                max={2100}
                placeholder="2009"
                className={fieldClass}
              />
            </label>
            <label className={labelClass}>
              Målsmans namn
              <input name="guardian_name" type="text" className={fieldClass} />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              Målsmans e-post
              <input name="guardian_email" type="email" className={fieldClass} />
            </label>
            <label className={`${labelClass} sm:col-span-2`}>
              Något du vill berätta (frivilligt)
              <textarea name="note" rows={2} className={fieldClass} />
            </label>
          </div>

          <label className="flex items-start gap-2 text-sm text-[var(--ink-2)]">
            <input
              name="guardian_consent"
              type="checkbox"
              required
              className="mt-1 h-4 w-4 shrink-0"
            />
            <span>
              Målsman har läst punkterna ovan och samtycker till att jag skapar ett konto och delar
              min träningsdata med min tränare.
            </span>
          </label>

          <button
            type="submit"
            className="rounded-lg border border-[var(--line)] px-4 py-2 hover:bg-[var(--surface-raised)]"
          >
            Skicka förfrågan
          </button>
        </form>
      </section>
    </div>
  );
}
