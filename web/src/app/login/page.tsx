import { login, signup } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">
        Logga in
      </h1>

      {error && (
        <p className="max-w-sm text-center text-sm text-red-600">{error}</p>
      )}
      {message && (
        <p className="max-w-sm text-center text-sm text-green-700">
          {message}
        </p>
      )}

      <form className="flex w-full max-w-sm flex-col gap-3">
        <label
          htmlFor="email"
          className="text-sm text-[var(--ink-2)]"
        >
          E-post
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="rounded-lg border border-[var(--line)] px-3 py-2"
        />

        <label
          htmlFor="password"
          className="text-sm text-[var(--ink-2)]"
        >
          Lösenord
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          className="rounded-lg border border-[var(--line)] px-3 py-2"
        />

        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <button
            formAction={login}
            className="flex-1 rounded bg-[var(--foreground)] px-4 py-2 text-[var(--background)] hover:opacity-90"
          >
            Logga in
          </button>
          <button
            formAction={signup}
            className="flex-1 rounded-lg border border-[var(--line)] px-4 py-2 hover:bg-[var(--surface-raised)]"
          >
            Skapa konto
          </button>
        </div>
      </form>
    </div>
  );
}
