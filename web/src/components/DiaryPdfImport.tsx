"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type Status =
  | { kind: "idle" }
  | { kind: "uploading" }
  | { kind: "done"; imported: number; skipped: number }
  | { kind: "error"; message: string };

// Laddar upp filen direkt till Python-endpointen från webbläsaren (inte via
// en Server Action) för att slippa Next.js Server Actions storleksgräns på
// request-body — en PDF-dagbok kan lätt bli några MB. Autentisering sker
// därför med användarens egen Supabase-sessionstoken istället för den
// interna server-till-server-hemligheten.
export function DiaryPdfImport() {
  const [status, setStatus] = useState<Status>({ kind: "idle" });
  const [schoolYearStart, setSchoolYearStart] = useState(
    String(new Date().getMonth() >= 6 ? new Date().getFullYear() : new Date().getFullYear() - 1),
  );
  const router = useRouter();

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const fileInput = form.elements.namedItem("file") as HTMLInputElement;
    const file = fileInput.files?.[0];
    if (!file) return;

    setStatus({ kind: "uploading" });

    const supabase = createClient();
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session) {
      setStatus({ kind: "error", message: "Inte inloggad — ladda om sidan och försök igen." });
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    formData.append("school_year_start", schoolYearStart);

    try {
      const res = await fetch("/api/diary/import", {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: formData,
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ kind: "error", message: body.error ?? "Import misslyckades" });
        return;
      }
      setStatus({ kind: "done", imported: body.imported, skipped: body.skipped });
      form.reset();
      router.refresh();
    } catch {
      setStatus({ kind: "error", message: "Kunde inte nå servern. Försök igen." });
    }
  }

  const isUploading = status.kind === "uploading";

  return (
    <form
      onSubmit={handleSubmit}
      className="flex flex-col gap-3 rounded border border-zinc-200 p-4 sm:max-w-sm dark:border-zinc-800"
    >
      <label className="flex flex-col gap-1 text-sm">
        PDF-fil
        <input
          type="file"
          name="file"
          accept="application/pdf"
          required
          disabled={isUploading}
          className="rounded border border-zinc-300 px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <label className="flex flex-col gap-1 text-sm">
        Läsår (startår, t.ex. 2025 för läsåret 25/26)
        <input
          type="number"
          value={schoolYearStart}
          onChange={(e) => setSchoolYearStart(e.target.value)}
          disabled={isUploading}
          className="rounded border border-zinc-300 px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
        />
      </label>
      <p className="text-xs text-zinc-500 dark:text-zinc-400">
        Veckor efter sommaren (&gt; 26) tolkas som startåret, veckor på våren
        (≤ 26) som året efter. Tar en stund — Claude läser igenom hela PDF:en.
      </p>
      <button
        type="submit"
        disabled={isUploading}
        className="w-fit rounded border border-zinc-300 px-4 py-2 text-sm hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-700 dark:hover:bg-zinc-900"
      >
        {isUploading ? "Läser PDF…" : "Importera dagbok"}
      </button>
      {status.kind === "done" && (
        <p className="text-sm text-emerald-600 dark:text-emerald-400">
          Importerade {status.imported} dagar
          {status.skipped > 0 ? ` (${status.skipped} kunde inte tolkas)` : ""}.
        </p>
      )}
      {status.kind === "error" && (
        <p className="text-sm text-red-600 dark:text-red-400">{status.message}</p>
      )}
    </form>
  );
}
