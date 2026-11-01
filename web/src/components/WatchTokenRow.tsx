"use client";

import { useActionState } from "react";
import { createWatchToken, deleteWatchToken, type WatchTokenState } from "@/app/(app)/settings/actions";
import { buttonClass } from "@/components/ui/controls";

/* En rad per person i Inställningar → Klocka. Nyckeln visas bara direkt
 * efter att den skapats — den finns inte sparad någonstans att visa igen. */
export function WatchTokenRow({
  userId,
  name,
  createdAt,
  lastUsedAt,
}: {
  userId: string;
  name: string;
  createdAt: string | null;
  lastUsedAt: string | null;
}) {
  const [state, action, pending] = useActionState<WatchTokenState, FormData>(createWatchToken, null);
  const fresh = state && "token" in state && state.userId === userId ? state.token : null;
  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("sv-SE", {
      timeZone: "Europe/Stockholm",
      dateStyle: "short",
      timeStyle: "short",
    });

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-medium text-[var(--foreground)]">{name}</span>
        <span className="text-xs text-[var(--ink-3)]">
          {createdAt
            ? `Nyckel skapad ${fmt(createdAt)} · ${lastUsedAt ? `klockan hämtade senast ${fmt(lastUsedAt)}` : "inte använd än"}`
            : "Ingen nyckel"}
        </span>
      </div>

      {fresh && (
        <div className="rounded border border-[var(--line)] bg-[var(--surface-raised)] p-2">
          <p className="text-xs text-[var(--ink-2)]">
            Nyckeln visas bara nu. Använd den när urtavlan byggs (watchface/build.sh):
          </p>
          <code className="mt-1 block break-all font-mono text-xs text-[var(--foreground)] select-all">
            {fresh}
          </code>
        </div>
      )}
      {state && "error" in state && <p className="text-xs text-[var(--ink-2)]">{state.error}</p>}

      <div className="flex flex-wrap gap-2">
        <form action={action}>
          <input type="hidden" name="user_id" value={userId} />
          <button type="submit" disabled={pending} className={buttonClass}>
            {createdAt ? "Skapa ny nyckel" : "Skapa nyckel"}
          </button>
        </form>
        {createdAt && (
          <form action={deleteWatchToken}>
            <input type="hidden" name="user_id" value={userId} />
            <button type="submit" className="text-xs text-[var(--ink-3)] underline">
              Ta bort
            </button>
          </form>
        )}
      </div>
    </li>
  );
}
