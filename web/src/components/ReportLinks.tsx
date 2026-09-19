/* Djupanalyser per löpare, länkade överst i Form-vyn.
 *
 * Vissa frågor går inte att svara på med ett diagram — vad dagboksorden
 * korrelerar med, vad som faktiskt krävs för ett måltid. De analyserna görs
 * utanför appen och publiceras som en rapport.
 *
 * ── Varför brickor och inte listrader ────────────────────────────────────
 * Resten av vyn är fullbreda sektioner som fälls ut. En rapport är något
 * annat: den lämnar appen, den är skriven en gång och ändras inte, och den
 * läses i sin helhet i stället för att skummas. Låg den som ännu en rad i
 * samma språk försvann den bland mätningarna. Brickorna ligger därför i en
 * rad bredvid varandra, ikonledda och smalare än allt annat på sidan —
 * formen säger "det här är ett dokument" innan man hunnit läsa rubriken.
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

      <div className="flex flex-wrap gap-3">
        {reports.map((r) => (
          <a
            key={r.id}
            href={r.url}
            target="_blank"
            rel="noopener noreferrer"
            title={r.summary ?? undefined}
            className="group flex w-full max-w-[22rem] flex-1 items-start gap-3 rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 transition-colors hover:border-[var(--ink-3)] hover:bg-[var(--surface-raised)] sm:w-auto sm:min-w-[16rem]"
          >
            <ReportIcon />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="flex items-baseline gap-1.5">
                <span className="truncate font-medium text-[var(--foreground)]">{r.title}</span>
                {/* Pil snett uppåt: länken lämnar appen. */}
                <span
                  aria-hidden
                  className="inline-block h-1.5 w-1.5 shrink-0 -rotate-45 border-t border-r border-current text-[var(--ink-3)] transition-transform group-hover:-translate-y-px group-hover:translate-x-px"
                />
              </span>
              {r.summary && (
                <span className="line-clamp-2 text-xs leading-snug text-[var(--ink-2)]">
                  {r.summary}
                </span>
              )}
              <span className="tabular text-[0.65rem] text-[var(--ink-3)]">{r.published_on}</span>
            </span>
          </a>
        ))}
      </div>
    </section>
  );
}

/** Ett uppslaget dokument med en kurva i. Egen form, inte samma prickar och
 *  staplar som mätvärdena använder — ikonen är halva skillnaden mot resten
 *  av vyn. */
function ReportIcon() {
  return (
    <span
      aria-hidden
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md"
      style={{ background: "color-mix(in oklab, var(--cat-race) 16%, transparent)" }}
    >
      <svg viewBox="0 0 20 20" className="h-5 w-5" fill="none" aria-hidden>
        <path
          d="M4.5 2.5h7l4 4v11h-11z"
          stroke="var(--cat-race)"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <path d="M11.5 2.5v4h4" stroke="var(--cat-race)" strokeWidth="1.4" strokeLinejoin="round" />
        <path
          d="M6.8 13.6l2-2.6 1.7 1.5 2.4-3.4"
          stroke="var(--cat-race)"
          strokeWidth="1.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
