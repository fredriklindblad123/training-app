import Link from "next/link";
import { createClient } from "@/lib/supabase/server";

export default async function PrivatePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-16 text-center">
      <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">
        Inloggad som {user?.email}
      </h1>
      <Link
        href="/calendar"
        className="rounded bg-[var(--foreground)] px-4 py-2 text-[var(--background)] hover:opacity-90"
      >
        Till kalendern
      </Link>
    </div>
  );
}
