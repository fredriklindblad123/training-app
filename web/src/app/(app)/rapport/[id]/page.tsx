import Link from "next/link";
import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ReportBody } from "@/components/ReportBody";

/* /rapport/<id> — en djupanalys läst i appen, bakom appens inloggning.
 *
 * Rapporterna skrivs utanför appen (claude.ai), men en sida där kräver ett
 * claude.ai-konto med åtkomst. Innehållet ligger därför i
 * athlete_reports.body_md och visas här. Vem som får läsa avgörs av
 * radens behörighetsregler: löparen själv och kopplade coacher — finns ingen
 * rad att läsa blir det 404, utan att avslöja om rapporten finns. */

export default async function ReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const supabase = await createClient();
  const { data: report } = await supabase
    .from("athlete_reports")
    .select("id, user_id, title, summary, published_on, body_md")
    .eq("id", id)
    .maybeSingle();
  if (!report?.body_md) notFound();

  return (
    <div className="flex flex-1 flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8">
      <div className="flex flex-col gap-2">
        <Link href={`/trender?athlete=${report.user_id}`} className="text-sm text-[var(--ink-3)] underline underline-offset-2">
          ← Form
        </Link>
        <span className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
          Djupanalys · {report.published_on}
        </span>
        <h1 className="display text-[2rem] leading-[1.08] font-bold text-[var(--foreground)]">{report.title}</h1>
        {report.summary && <p className="max-w-3xl text-[var(--ink-2)]">{report.summary}</p>}
      </div>
      <ReportBody markdown={report.body_md} />
    </div>
  );
}
