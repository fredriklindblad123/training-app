import { login, signup } from "./actions";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; message?: string }>;
}) {
  const { error, message } = await searchParams;

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-6 px-6 py-16">
      <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
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
          className="text-sm text-zinc-700 dark:text-zinc-300"
        >
          E-post
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />

        <label
          htmlFor="password"
          className="text-sm text-zinc-700 dark:text-zinc-300"
        >
          Lösenord
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          minLength={6}
          className="rounded border border-zinc-300 px-3 py-2 dark:border-zinc-700 dark:bg-zinc-900"
        />

        <div className="mt-2 flex flex-col gap-2 sm:flex-row">
          <button
            formAction={login}
            className="flex-1 rounded bg-zinc-950 px-4 py-2 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
          >
            Logga in
          </button>
          <button
            formAction={signup}
            className="flex-1 rounded border border-zinc-300 px-4 py-2 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"
          >
            Skapa konto
          </button>
        </div>
      </form>
    </div>
  );
}
