import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { enterApp } from "./actions";

const buttonClass =
  "rounded bg-[var(--foreground)] px-4 py-2 text-[var(--background)] hover:opacity-90";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-[var(--background)] px-6 text-center">
      <h1 className="display text-[2.75rem] leading-[1.05] font-bold text-[var(--foreground)]">
        Träningsapp
      </h1>
      <p className="max-w-md text-lg text-[var(--ink-2)]">
        Kalender, träningsdagbok och långsiktig planering för
        medeldistanslöpare. Under uppbyggnad.
      </p>
      {user ? (
        <form action={enterApp}>
          <button type="submit" className={buttonClass}>
            Till appen
          </button>
        </form>
      ) : (
        <Link href="/login" className={buttonClass}>
          Logga in
        </Link>
      )}
    </div>
  );
}
