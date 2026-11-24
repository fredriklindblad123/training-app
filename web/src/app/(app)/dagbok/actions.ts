"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { toDateKey } from "@/lib/week-series";
import {
  dayTypeFor,
  diffDiary,
  fieldsFor,
  type DayChange,
  type ExistingDiaryRow,
  type ParsedDiaryDay,
} from "@/lib/diary-import";

/* Dagboken skickas in från appen (2026-11-24). Två steg, samma fil båda
 * gångerna: förhandsvisa (ingenting skrivs) och skicka in (med de dagar
 * löparen valt att ersätta). Filen tolkas om i andra steget i stället för att
 * förhandsvisningen sparas någonstans — tolkningen är snabb och
 * deterministisk, och servern behöver då inte lita på något klienten skickar
 * tillbaka utom datumen. */

/** Vercels gräns för ett funktionsanrop är 4,5 MB, och filen skickas vidare
 * till Python som base64 (+33 %). Dagböckerna hittills: 0,16–0,54 MB. */
const MAX_BYTES = 3 * 1024 * 1024;

const COLUMNS =
  "id, entry_date, session_log, notes, notes_good_text, notes_bad_text, notes_good_chars, notes_bad_chars, day_type";

/* Python-funktionen nås på produktionsdomänen (se lib/garmin-sync.ts för
 * varför inte VERCEL_URL). På en förhandsversion finns den nya endpointen
 * bara på grenens egen adress, så där används den. DIARY_API_BASE gör det
 * möjligt att peka på en lokalt körd uvicorn. */
function apiBase(): string {
  if (process.env.DIARY_API_BASE) return process.env.DIARY_API_BASE;
  if (process.env.VERCEL_ENV === "preview" && process.env.VERCEL_BRANCH_URL)
    return `https://${process.env.VERCEL_BRANCH_URL}`;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
  return "http://localhost:3000";
}

export type DiaryPreview = {
  ok: true;
  fileName: string;
  first: string;
  last: string;
  changes: DayChange[];
};
export type DiaryResult = { ok: false; error: string };

type Ctx = { userId: string; parsed: ParsedDiaryDay[]; existing: ExistingDiaryRow[]; file: File };

async function load(formData: FormData): Promise<Ctx | DiaryResult> {
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return { ok: false, error: "Du är inte inloggad." };
  const athlete = (formData.get("athlete") as string | null) || undefined;
  const userId = resolveScopedUserId(scoped, athlete);

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "Välj en PDF-fil." };
  if (file.size > MAX_BYTES) return { ok: false, error: "Filen är större än 3 MB." };
  const bytes = Buffer.from(await file.arrayBuffer());
  if (bytes.subarray(0, 4).toString() !== "%PDF") return { ok: false, error: "Filen är inte en PDF." };

  let parsed: ParsedDiaryDay[];
  try {
    const res = await fetch(`${apiBase()}/api/diary/parse`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-internal-secret": process.env.INTERNAL_API_SECRET ?? "" },
      body: JSON.stringify({ pdf_base64: bytes.toString("base64"), today: toDateKey(new Date()) }),
    });
    const body = (await res.json().catch(() => ({}))) as { days?: ParsedDiaryDay[]; error?: string };
    if (!res.ok || !body.days) return { ok: false, error: body.error ?? "Kunde inte läsa PDF:en." };
    parsed = body.days;
  } catch {
    return { ok: false, error: "Kunde inte nå tjänsten som läser PDF:en. Försök igen om en stund." };
  }
  if (parsed.length === 0)
    return {
      ok: false,
      error: "Hittade inga dagar i filen. Är det träningsdagboken (FIG:s mall med en kolumn per veckodag)?",
    };

  const { data } = await supabase
    .from("diary_entries")
    .select(COLUMNS)
    .eq("user_id", userId)
    .gte("entry_date", parsed[0].entry_date)
    .lte("entry_date", parsed[parsed.length - 1].entry_date);
  return { userId, parsed, existing: (data ?? []) as ExistingDiaryRow[], file };
}

export async function previewDiaryPdf(formData: FormData): Promise<DiaryPreview | DiaryResult> {
  const ctx = await load(formData);
  if ("ok" in ctx) return ctx;
  return {
    ok: true,
    fileName: ctx.file.name,
    first: ctx.parsed[0].entry_date,
    last: ctx.parsed[ctx.parsed.length - 1].entry_date,
    changes: diffDiary(ctx.parsed, ctx.existing),
  };
}

export type DiaryImportDone = {
  ok: true;
  inserted: number;
  filled: number;
  replaced: number;
  kept: number;
};

export async function importDiaryPdf(formData: FormData): Promise<DiaryImportDone | DiaryResult> {
  const ctx = await load(formData);
  if ("ok" in ctx) return ctx;
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  const replace = new Set(formData.getAll("replace").map(String));

  const changes = diffDiary(ctx.parsed, ctx.existing);
  const parsedBy = new Map(ctx.parsed.map((p) => [p.entry_date, p]));
  const rowBy = new Map(ctx.existing.map((r) => [r.entry_date, r]));
  const previous: Record<string, Record<string, unknown>> = {};
  let inserted = 0,
    filled = 0,
    replaced = 0,
    kept = 0;

  for (const c of changes) {
    const p = parsedBy.get(c.date) as ParsedDiaryDay;
    const row = rowBy.get(c.date);
    const swap = c.kind === "differs" && replace.has(c.date);
    const which = {
      log: c.log === "fill" || (swap && c.log === "differs"),
      note: c.note === "fill" || (swap && c.note === "differs"),
    };
    if (c.kind === "differs" && !swap) kept++;
    if (!which.log && !which.note) continue;

    const fields = fieldsFor(p, which);
    if (!row) {
      const { error } = await supabase.from("diary_entries").insert({
        user_id: ctx.userId,
        entry_date: c.date,
        day_type: dayTypeFor(p.session_log, p.notes),
        ...fields,
      });
      if (error) return { ok: false, error: `Kunde inte spara ${c.date}: ${error.message}` };
      inserted++;
      continue;
    }
    previous[c.date] = Object.fromEntries(
      Object.keys(fields).map((k) => [k, (row as unknown as Record<string, unknown>)[k] ?? null]),
    );
    const { error } = await supabase
      .from("diary_entries")
      .update({ ...fields, ...(row.day_type == null ? { day_type: dayTypeFor(p.session_log, p.notes) } : {}) })
      .eq("id", row.id);
    if (error) return { ok: false, error: `Kunde inte spara ${c.date}: ${error.message}` };
    if (c.kind === "new") inserted++;
    else if (swap) replaced++;
    else filled++;
  }

  // Filen sparas så att tränaren kan se exakt vad som skickades in. Ett fel
  // här stoppar inte inskicket — dagboken är redan skriven.
  const path = `${ctx.userId}/${new Date().toISOString().replace(/[:.]/g, "-")}.pdf`;
  const { error: upErr } = await supabase.storage
    .from("diary-pdfs")
    .upload(path, ctx.file, { contentType: "application/pdf" });

  await supabase.from("diary_imports").insert({
    user_id: ctx.userId,
    uploaded_by: auth.user?.id ?? ctx.userId,
    file_name: ctx.file.name,
    file_path: upErr ? null : path,
    first_date: ctx.parsed[0].entry_date,
    last_date: ctx.parsed[ctx.parsed.length - 1].entry_date,
    inserted,
    filled,
    replaced,
    kept,
    previous,
  });

  revalidatePath("/calendar");
  revalidatePath("/dashboard");
  revalidatePath("/analys");
  revalidatePath("/dagbok");
  return { ok: true, inserted, filled, replaced, kept };
}
