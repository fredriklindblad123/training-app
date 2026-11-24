import Link from "next/link";
import { PageHeader } from "@/components/ui/Page";
import { HowCalculated } from "@/components/ui/Explain";
import { DiaryUpload } from "@/components/DiaryUpload";
import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId } from "@/lib/auth-scope";
import { formatDateShort } from "@/lib/format";

/* Skicka in dagboken (2026-11-24). Löparen laddar upp sin PDF när hon vill —
 * hela filen varje gång går bra, det som redan finns känns igen. Under
 * uppladdningen: tidigare inskick, så att det syns vad som kommit in och när. */

export default async function DagbokPage({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const { athlete: athleteParam } = await searchParams;
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const userId = resolveScopedUserId(scoped, athleteParam);
  const athleteQuery = scoped.role === "coach" ? userId : null;

  const { data: imports } = await supabase
    .from("diary_imports")
    .select("id, created_at, file_name, first_date, last_date, inserted, filled, replaced, kept")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(10);

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <PageHeader
        title="Skicka in dagboken"
        lead="Ladda upp träningsdagboken som PDF. Du ser vad som läggs till innan något sparas."
      />

      <DiaryUpload athlete={athleteQuery} />

      <HowCalculated>
        <p>
          Appen läser dagboken som den är uppställd i FIG:s mall: en rad per vecka, en kolumn per dag. Svart text
          blir passet, grön text det som var bra och rosa text det som var mindre bra. Blå text är tränarens och
          läses inte.
        </p>
        <p>
          Dagar som redan finns med samma text hoppas över. Finns dagen redan med annan text behålls den om du inte
          väljer PDF:ens version. Det som fyllts i i appen — känsla, sömn, tränarens kommentarer — rörs aldrig.
        </p>
        <p>Veckor efter dagens datum läses inte, även om mallen redan har dem ifyllda.</p>
      </HowCalculated>

      {imports && imports.length > 0 && (
        <section className="flex flex-col gap-2">
          <h2 className="text-xs font-semibold tracking-wide text-[var(--ink-3)] uppercase">Tidigare inskick</h2>
          <ul className="flex flex-col divide-y divide-[var(--line)] rounded-[14px] border border-[var(--line)] text-sm">
            {imports.map((i) => (
              <li key={i.id} className="flex flex-col gap-0.5 px-3.5 py-2.5">
                <span className="flex justify-between gap-2">
                  <span className="font-semibold">
                    {formatDateShort(String(i.created_at).slice(0, 10))} {String(i.created_at).slice(0, 4)}
                  </span>
                  <span className="text-[var(--ink-3)]">
                    {i.first_date ? `${formatDateShort(i.first_date)}–${formatDateShort(i.last_date)}` : ""}
                  </span>
                </span>
                <span className="text-[var(--ink-2)]">
                  {i.inserted} nya, {i.filled} kompletterade
                  {i.replaced ? `, ${i.replaced} ersatta` : ""}
                  {i.kept ? `, ${i.kept} behöll det som fanns` : ""}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Link href={athleteQuery ? `/calendar?athlete=${athleteQuery}` : "/calendar"} className="self-start text-sm text-[var(--ink-2)] underline">
        Till kalendern
      </Link>
    </div>
  );
}
