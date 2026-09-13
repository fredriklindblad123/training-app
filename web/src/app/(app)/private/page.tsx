import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function PrivatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="text-2xl font-semibold text-[var(--foreground)]">
        Inloggad som {user?.email}
      </h1>
      <Link
        href="/calendar"
        className="rounded bg-zinc-950 px-4 py-2 text-white hover:bg-zinc-800 dark:bg-zinc-50 dark:text-[var(--foreground)] dark:hover:bg-zinc-200"
      >
        Till kalendern
      </Link>
    </div>
  );
}
