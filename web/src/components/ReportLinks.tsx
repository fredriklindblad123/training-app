/* Djupanalyser per löpare, länkade överst i Form-vyn.
 *
 * Vissa frågor går inte att svara på med ett diagram — vad dagboksorden
 * korrelerar med, var en säsong tog fel väg, vad som faktiskt krävs för ett
 * måltid. De analyserna görs utanför appen och publiceras som en rapport.
 * Länkarna ligger överst eftersom en rapport är ett fynd, inte en mätning:
 * den ska läsas en gång och sedan gå att hitta tillbaka till.
 *
 * Bara rubrik och länk lagras (se migration 20260919140000). Innehållet bor
 * kvar där det publicerats — en kopia i databasen hade blivit en andra
 * version som glider isär från originalet.
 */

export type AthleteReport = {
  id: string;
  title: string;
  url: string;
  summary: string | null;
  published_on: string;
};

export function ReportLinks({ reports }: { reports: AthleteReport[] }) {
  if (reports.length === 0) return null;

  return (
    <section className="flex flex-col gap-2">
      <h2 className="display text-[0.6875rem] font-semibold tracking-[0.09em] text-[var(--ink-3)] uppercase">
        {reports.length === 1 ? "Djupanalys" : "Djupanalyser"}
      </h2>
      <div className="flex flex-col gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)]">
        {reports.map((r) => (
          <a
            key={r.id}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 bg-[var(--surface)] p-4 hover:bg-[var(--surface-raised)]"
          >
            <div className="min-w-0 flex-1">
              <p className="flex flex-wrap items-baseline gap-x-2 font-medium text-[var(--foreground)]">
                {r.title}
                <span className="tabular text-xs font-normal text-[var(--ink-3)]">
                  {r.published_on}
                </span>
              </p>
              {r.summary && (
                <p className="mt-0.5 max-w-3xl text-sm text-[var(--ink-2)]">{r.summary}</p>
              )}
            </div>
            {/* Pil snett uppåt: länken lämnar appen. */}
            <span
              aria-hidden
              className="mt-1.5 inline-block h-2 w-2 shrink-0 -rotate-45 border-t border-r border-current text-[var(--ink-3)]"
            />
          </a>
        ))}
      </div>
    </section>
  );
}
