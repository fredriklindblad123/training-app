import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 bg-zinc-50 px-6 text-center font-sans dark:bg-black">
      <h1 className="text-3xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">
        Träningsapp
      </h1>
      <p className="max-w-md text-lg text-zinc-600 dark:text-zinc-400">
        Kalender, träningsdagbok och långsiktig planering för
        medeldistanslöpare. Under uppbyggnad.
      </p>
      <Link
        href={user ? "/dashboard" : "/login"}
        className="rounded bg-zinc-950 px-4 py-2 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-zinc-950 dark:hover:bg-zinc-200"
      >
        {user ? "Till appen" : "Logga in"}
      </Link>
    </div>
  );
}
