"use client";

import { useState, useTransition } from "react";
import { formatDateShort } from "@/lib/format";
import { primaryButtonClass, buttonClass } from "@/components/ui/controls";
import {
  importDiaryPdf,
  previewDiaryPdf,
  type DiaryImportDone,
  type DiaryPreview,
} from "@/app/(app)/dagbok/actions";

/* Skicka in dagboken (2026-11-24): välj fil → förhandsvisning → spara.
 *
 * Förhandsvisningen är hela poängen. Inskicken överlappar, och där PDF:en
 * säger något annat än det som redan finns är det som finns oftast det
 * bättre (rättad stavning, märkta sjukdagar — se lib/diary-import.ts). Därför
 * visas de dagarna sida vid sida, och "Behåll" är förvalt. */

function short(s: string | null, n = 140): string {
  const t = (s ?? "").trim();
  return t.length > n ? `${t.slice(0, n)}…` : t || "—";
}

export function DiaryUpload({ athlete }: { athlete: string | null }) {
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<DiaryPreview | null>(null);
  const [replace, setReplace] = useState<Set<string>>(new Set());
  const [done, setDone] = useState<DiaryImportDone | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function form(): FormData {
    const fd = new FormData();
    if (file) fd.set("file", file);
    if (athlete) fd.set("athlete", athlete);
    for (const d of replace) fd.append("replace", d);
    return fd;
  }

  function choose(f: File | null) {
    setFile(f);
    setPreview(null);
    setDone(null);
    setError(null);
    setReplace(new Set());
    if (!f) return;
    const fd = new FormData();
    fd.set("file", f);
    if (athlete) fd.set("athlete", athlete);
    start(async () => {
      const res = await previewDiaryPdf(fd);
      if (res.ok) setPreview(res);
      else setError(res.error);
    });
  }

  function save() {
    start(async () => {
      const res = await importDiaryPdf(form());
      if (res.ok) {
        setDone(res);
        setPreview(null);
        setFile(null);
      } else setError(res.error);
    });
  }

  const count = (k: string) => preview?.changes.filter((c) => c.kind === k).length ?? 0;
  const differs = preview?.changes.filter((c) => c.kind === "differs") ?? [];
  const news = preview?.changes.filter((c) => c.kind === "new" || c.kind === "fill") ?? [];
  const nothingToDo = preview != null && news.length === 0 && replace.size === 0;

  return (
    <div className="flex flex-col gap-4">
      <label className="flex cursor-pointer flex-col items-center gap-1.5 rounded-[14px] border border-dashed border-[var(--line)] px-4 py-6 text-center hover:bg-[var(--surface-raised)]">
        <span className="font-semibold text-[var(--foreground)]">{file ? file.name : "Välj dagboken (PDF)"}</span>
        <span className="text-xs text-[var(--ink-3)]">
          {file ? "Tryck för att välja en annan fil" : "Hela filen går bra — det som redan finns känns igen"}
        </span>
        <input
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          onChange={(e) => choose(e.target.files?.[0] ?? null)}
        />
      </label>

      {pending && <p className="text-sm text-[var(--ink-2)]">{preview ? "Sparar…" : "Läser dagboken…"}</p>}
      {error && (
        <p className="rounded-lg border border-[var(--line)] p-3 text-sm text-[var(--foreground)]">{error}</p>
      )}

      {done && (
        <div className="rounded-[14px] border border-[var(--line)] p-3.5 text-sm">
          <p className="font-semibold text-[var(--foreground)]">Dagboken är inskickad.</p>
          <p className="mt-1 text-[var(--ink-2)]">
            {done.inserted} nya dagar, {done.filled} kompletterade
            {done.replaced ? `, ${done.replaced} ersatta` : ""}
            {done.kept ? `, ${done.kept} behöll det som fanns` : ""}.
          </p>
        </div>
      )}

      {preview && !pending && (
        <div className="flex flex-col gap-3">
          <div className="rounded-[14px] border border-[var(--line)] p-3.5">
            <p className="text-xs text-[var(--ink-3)]">
              {formatDateShort(preview.first)} {preview.first.slice(0, 4)} – {formatDateShort(preview.last)}{" "}
              {preview.last.slice(0, 4)} · {preview.changes.length} dagar med text
            </p>
            <dl className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-sm">
              <dt className="text-[var(--ink-2)]">Nya dagar</dt>
              <dd className="tabular text-right font-semibold">{count("new")}</dd>
              <dt className="text-[var(--ink-2)]">Kompletteras</dt>
              <dd className="tabular text-right font-semibold">{count("fill")}</dd>
              <dt className="text-[var(--ink-2)]">Redan inskickade, oförändrade</dt>
              <dd className="tabular text-right font-semibold">{count("same")}</dd>
              <dt className="text-[var(--ink-2)]">Skiljer sig från det som finns</dt>
              <dd className="tabular text-right font-semibold">{count("differs")}</dd>
            </dl>
          </div>

          {news.length > 0 && (
            <details className="rounded-[14px] border border-[var(--line)]">
              <summary className="cursor-pointer p-3.5 text-sm font-semibold">
                Det här läggs till ({news.length} {news.length === 1 ? "dag" : "dagar"})
              </summary>
              <ul className="flex flex-col divide-y divide-[var(--line)] border-t border-[var(--line)] text-sm">
                {news.map((c) => {
                  return (
                    <li key={c.date} className="flex gap-3 px-3.5 py-2">
                      <span className="tabular w-12 shrink-0 text-[var(--ink-3)]">{formatDateShort(c.date)}</span>
                      <span className="text-[var(--ink-2)]">
                        {c.kind === "new" ? "Ny dag" : c.log === "fill" ? "Passet läggs till" : "Anteckningen läggs till"}
                        {` · ${short(c.log === "fill" || c.kind === "new" ? c.after.log : c.after.note, 60)}`}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </details>
          )}

          {differs.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-sm text-[var(--ink-2)]">
                De här dagarna finns redan med annan text. Det som finns behålls om du inte väljer PDF:ens version —
                ofta är det redan rättat eller kompletterat.
              </p>
              {differs.map((c) => {
                const swap = replace.has(c.date);
                const toggle = () =>
                  setReplace((s) => {
                    const n = new Set(s);
                    if (n.has(c.date)) n.delete(c.date);
                    else n.add(c.date);
                    return n;
                  });
                return (
                  <div key={c.date} className="rounded-[14px] border border-[var(--line)] p-3 text-sm">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold">{formatDateShort(c.date)}</span>
                      <div role="group" aria-label={`Version för ${c.date}`} className="inline-flex rounded-[9px] bg-[var(--surface-raised)] p-[2px]">
                        {[
                          { v: false, label: "Behåll" },
                          { v: true, label: "Ta PDF:ens" },
                        ].map((o) => (
                          <button
                            key={o.label}
                            type="button"
                            aria-pressed={swap === o.v}
                            onClick={() => swap !== o.v && toggle()}
                            className={`min-h-8 rounded-[7px] px-2.5 text-xs ${
                              swap === o.v
                                ? "bg-[var(--surface)] font-semibold text-[var(--foreground)] shadow-sm"
                                : "text-[var(--ink-2)]"
                            }`}
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <div className="mt-2 grid gap-2 sm:grid-cols-2">
                      <div className={swap ? "opacity-50" : ""}>
                        <p className="text-xs text-[var(--ink-3)]">Finns nu</p>
                        {c.log === "differs" && <p className="text-[var(--foreground)]">{short(c.before?.log ?? null)}</p>}
                        {c.note === "differs" && <p className="text-[var(--ink-2)]">{short(c.before?.note ?? null)}</p>}
                      </div>
                      <div className={swap ? "" : "opacity-50"}>
                        <p className="text-xs text-[var(--ink-3)]">I PDF:en</p>
                        {c.log === "differs" && <p className="text-[var(--foreground)]">{short(c.after?.log ?? null)}</p>}
                        {c.note === "differs" && <p className="text-[var(--ink-2)]">{short(c.after?.note ?? null)}</p>}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3">
            <button type="button" className={primaryButtonClass} disabled={nothingToDo} onClick={save}>
              {nothingToDo ? "Inget nytt att spara" : "Spara i dagboken"}
            </button>
            <button type="button" className={buttonClass} onClick={() => choose(null)}>
              Avbryt
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
