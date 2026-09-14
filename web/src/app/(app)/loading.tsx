/* Laddskelett för alla sidor under (app).
 *
 * Fram till 2026-09-14 fanns ingen loading-fil alls i appen. Varje sida är
 * serverrenderad och gör flera Supabase-frågor, så ett klick i menyn gav
 * exakt ingenting förrän hela svaret kom — ingen markering, ingen rörelse,
 * inget tecken på att klicket ens registrerats. Det är den upplevda
 * långsamheten, och den är skild från hur lång tid frågorna faktiskt tar:
 * Next dokumenterar uttryckligen att en dynamisk route utan loading.js
 * blockerar navigeringen.
 *
 * Skelettet speglar sidornas faktiska form — rubrik, nyckeltalsrad, innehåll
 * — i stället för en spinner. En spinner säger "vänta"; ett skelett säger
 * "det här kommer", och gör dessutom att sidan inte hoppar när innehållet
 * landar, eftersom ytorna redan har rätt höjd.
 *
 * Menyn ligger i layouten och står kvar under tiden. Det är hela poängen:
 * man ser vilket val man gjorde medan sidan hämtas.
 */

function Bar({ className = "" }: { className?: string }) {
  return <div className={`rounded bg-[var(--line)] ${className}`} />;
}

export default function Loading() {
  return (
    /* aria-busy + polite: en skärmläsare ska få veta att något är på väg utan
       att avbryta det användaren håller på med. Själva platshållarna är
       aria-hidden — de betyder ingenting upplästa. */
    <div
      className="flex flex-1 flex-col gap-8 px-6 py-8"
      aria-busy="true"
      aria-live="polite"
    >
      <span className="sr-only">Laddar sidan…</span>

      <div aria-hidden className="animate-pulse motion-reduce:animate-none flex flex-col gap-8">
        {/* Sidrubrik */}
        <div className="flex flex-col gap-2">
          <Bar className="h-8 w-56" />
          <Bar className="h-4 w-full max-w-xl opacity-60" />
        </div>

        {/* Nyckeltalsrad — samma form som StatRow: hårfina skiljelinjer som
            gap på linjefärgad bakgrund, inte en ram per ruta. */}
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-[var(--line)] bg-[var(--line)] sm:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex flex-col gap-2 bg-[var(--surface)] px-3 py-3">
              <Bar className="h-2.5 w-16 opacity-60" />
              <Bar className="h-7 w-20" />
              <Bar className="h-2.5 w-14 opacity-60" />
            </div>
          ))}
        </div>

        {/* Innehållsytor. Tre block med fallande höjd — sidorna ser olika ut,
            men alla börjar med något stort och fortsätter med mindre. */}
        <div className="flex flex-col gap-4">
          <Bar className="h-5 w-40" />
          <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
            <Bar className="h-40 w-full opacity-40" />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
              <Bar className="h-20 w-full opacity-40" />
            </div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4">
              <Bar className="h-20 w-full opacity-40" />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
