import Link from "next/link";
import type { SignatureOccurrence, SignatureGroupResult } from "@/lib/session-signature";
import { CATEGORY_LABELS, categoryColorVar, isActivityCategory } from "@/lib/categories";
import { formatRaceTime, per400, type RacePace } from "@/lib/race-pace";

/* P2.1: passkvalitet för återkommande nyckelpass.
 *
 * Medvetet en tabell och inte ett diagram. Det som ska jämföras är enskilda
 * varvtider mellan ett tiotal genomföranden — läsaren vill se de faktiska
 * sekunderna ("290,4 mot 302,0"), inte uppskatta dem ur en kurva. Ett
 * diagram hade dolt precis den precisionen som är hela poängen. */

export type SignatureGroup = SignatureGroupResult;

/** "2026-01-05" -> "/calendar/2026/1/5". Dagvyn tar månad och dag utan
 * inledande nollor. */
function dayHref(date: string): string {
  const [y, m, d] = date.split("-");
  return `/calendar/${y}/${Number(m)}/${Number(d)}`;
}

function fmtTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = seconds - m * 60;
  return m > 0 ? `${m}:${s.toFixed(1).padStart(4, "0")}` : `${s.toFixed(1)}`;
}

function OccurrenceRow({
  occurrence,
  bestSeconds,
  isBest,
  distanceMeters,
}: {
  occurrence: SignatureOccurrence;
  bestSeconds: number;
  isBest: boolean;
  distanceMeters: number;
}) {
  const delta = occurrence.meanRepSeconds - bestSeconds;
  const times = occurrence.signature.groups.flatMap((g) => g.times);
  const pace = per400(occurrence.meanRepSeconds, distanceMeters);

  return (
    <tr className="border-t border-[var(--line)]">
      <td className="py-1.5 pr-3 whitespace-nowrap">
        {/* Länk till dagvyn — därifrån finns hela passet: varvtabell,
            dagbokstext och nattens sömndata. */}
        <Link
          href={dayHref(occurrence.date)}
          className="text-[var(--ink-2)] underline-offset-2 hover:text-[var(--foreground)] hover:underline"
        >
          {occurrence.date}
        </Link>
      </td>
      <td className="py-1.5 pr-3 whitespace-nowrap text-[var(--ink-2)]">
        {occurrence.signature.label}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums font-medium text-[var(--foreground)]">
        {fmtTime(occurrence.meanRepSeconds)}
        {isBest && (
          <span className="ml-1 text-xs font-normal text-emerald-600 dark:text-emerald-400">
            bäst
          </span>
        )}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--ink-3)]">
        {delta <= 0.05 ? "—" : `+${delta.toFixed(1)}s`}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--ink-2)]">
        {pace != null ? pace.toFixed(1) : "—"}
      </td>
      <td className="py-1.5 pr-3 text-right tabular-nums text-[var(--ink-2)]">
        {occurrence.meanRepHr ? Math.round(occurrence.meanRepHr) : "—"}
      </td>
      <td className="py-1.5 tabular-nums text-xs text-[var(--ink-3)]">
        {times.map((t) => fmtTime(t)).join("  ")}
      </td>
    </tr>
  );
}

/* Jämförelsen mot tävlingsfart är meningsfull för intervallpass men inte för
 * tröskelpass — tröskelrepetitioner *ska* vara långsammare än loppfart, och
 * en differens där hade läst som ett underkännande av ett pass som gjorde
 * precis vad det skulle. Därför visas skillnaden bara för intervaller; för
 * övriga passtyper visas farten utan omdöme. */
function showsRaceDelta(category: string | null): boolean {
  return category === "interval";
}

function SignatureCard({ group, racePace }: { group: SignatureGroup; racePace: RacePace | null }) {
  const { category, distanceMeters, occurrences } = group;
  const best = occurrences.reduce((a, b) => (a.meanRepSeconds <= b.meanRepSeconds ? a : b));
  // Nyast först — den senaste körningen är den man vill se direkt.
  const shown = [...occurrences].reverse().slice(0, 8);

  const latest = occurrences[occurrences.length - 1];
  const first = occurrences[0];
  const changePct =
    ((latest.meanRepSeconds - first.meanRepSeconds) / first.meanRepSeconds) * 100;

  // Senaste genomförandets fart, normaliserad till sekunder per 400 m — den
  // enda enheten som gör 300:or, 400:or och 1000:or jämförbara med varandra
  // och med loppfarten.
  const latestPer400 = per400(latest.meanRepSeconds, distanceMeters);
  const raceDelta =
    racePace && latestPer400 != null && showsRaceDelta(category)
      ? latestPer400 - racePace.per400
      : null;

  return (
    <details className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-4" open={false}>
      <summary className="cursor-pointer list-none">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <span className="flex items-center gap-2 font-medium text-[var(--foreground)]">
            {isActivityCategory(category ?? "") && (
              <span
                className="inline-block h-2.5 w-2.5 shrink-0 rounded-full"
                style={{ backgroundColor: categoryColorVar(category as never) }}
                aria-hidden="true"
              />
            )}
            {isActivityCategory(category ?? "")
              ? `${CATEGORY_LABELS[category as never]} · ${distanceMeters} m`
              : `${distanceMeters} m`}
          </span>
          <span className="text-sm text-[var(--ink-3)]">
            {occurrences.length} genomföranden · bäst {fmtTime(best.meanRepSeconds)}{" "}
            {best.meanRepHr ? `vid puls ${Math.round(best.meanRepHr)}` : ""}
          </span>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-[var(--ink-3)]">
          <span>
            {first.date} → {latest.date}:{" "}
            <span
              className={
                changePct < -0.5
                  ? "text-emerald-600 dark:text-emerald-400"
                  : changePct > 0.5
                    ? "text-amber-600 dark:text-amber-400"
                    : ""
              }
            >
              {changePct > 0 ? "+" : ""}
              {changePct.toFixed(1)} % i snittid
            </span>
          </span>
          {latestPer400 != null && (
            <span className="tabular-nums">
              senast {latestPer400.toFixed(1)} s/400 m
              {raceDelta != null && (
                <>
                  {" · "}
                  <span
                    className={
                      raceDelta > 0
                        ? "text-amber-600 dark:text-amber-400"
                        : "text-emerald-600 dark:text-emerald-400"
                    }
                  >
                    {raceDelta > 0 ? "+" : "−"}
                    {Math.abs(raceDelta).toFixed(1)} s mot tävlingsfart
                  </span>
                </>
              )}
            </span>
          )}
        </div>
      </summary>

      <div className="mt-3 overflow-x-auto rounded-lg border border-[var(--line)] bg-[var(--surface)]">
        <table className="w-full min-w-[36rem] text-sm">
          <thead>
            <tr className="text-left text-xs text-[var(--ink-3)]">
              <th className="pb-1 font-normal">Datum</th>
              <th className="pb-1 font-normal">Upplägg</th>
              <th className="pb-1 text-right font-normal">Snitt/rep</th>
              <th className="pb-1 text-right font-normal">Mot bäst</th>
              <th className="pb-1 text-right font-normal">s/400 m</th>
              <th className="pb-1 pr-3 text-right font-normal">Puls</th>
              <th className="pb-1 font-normal">Varvtider</th>
            </tr>
          </thead>
          <tbody>
            {shown.map((o) => (
              <OccurrenceRow
                key={`${o.activityId}`}
                occurrence={o}
                bestSeconds={best.meanRepSeconds}
                isBest={o.activityId === best.activityId}
                distanceMeters={distanceMeters}
              />
            ))}
          </tbody>
        </table>
      </div>
      {occurrences.length > shown.length && (
        <p className="mt-2 text-xs text-[var(--ink-3)]">
          Visar de {shown.length} senaste av {occurrences.length}.
        </p>
      )}
    </details>
  );
}

export function SessionQuality({
  groups,
  racePace,
  showRaceReference = true,
}: {
  groups: SignatureGroup[];
  racePace: RacePace | null;
  /** Referensrutan för tävlingsfart. Av i tröskelsektionen, där ingen
   * jämförelse mot loppfart visas och rutan bara hade varit brus. */
  showRaceReference?: boolean;
}) {
  if (groups.length === 0) {
    return (
      <p className="text-sm text-[var(--ink-3)]">
        Inga återkommande nyckelpass i perioden. Vyn kräver varvdata, som hämtas med{" "}
        <code className="text-xs">scripts/backfill_activity_splits.py</code>.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-[var(--ink-3)]">
        Pass grupperas på passtyp och på den repdistans som dominerar
        kvalitetsarbetet — inte på passets namn, som varierar för samma session, och inte
        på exakt upplägg: av 106 intervallpass fanns 102 olika upplägg, så exakta
        upprepningar finns nästan inte. Ett tröskelpass på 400 m och ett intervallpass på
        400 m hålls isär, eftersom de springs på helt olika fart.
        {" "}En 400:a ur 15×400 är inte fullt jämförbar med en ur 5×400 — därför visas
        upplägget per rad, så du kan väga in det själv.
      </p>
      {/* Referensen skrivs alltid ut. Ett måltempo som styr hur alla pass
          läses får inte vara en osynlig default — grenen, tiden och hur många
          lopp den vilar på ska gå att ifrågasätta. */}
      {showRaceReference &&
        (racePace ? (
        <p className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--ink-2)]">
          <strong className="font-medium text-[var(--foreground)]">
            Tävlingsfart: {racePace.per400.toFixed(1)} s per 400 m
          </strong>{" "}
          — ur {formatRaceTime(racePace.seconds)} på {racePace.distanceMeters} m ({racePace.date}),
          din bästa tid i den gren du tävlat mest i de senaste två åren ({racePace.races} lopp).
          Intervallfarten jämförs mot den. Tröskelpass får ingen jämförelse: de{" "}
          <em>ska</em> ligga långsammare än loppfart.
        </p>
        ) : (
          <p className="rounded-lg border border-[var(--line)] bg-[var(--surface)] p-3 text-sm text-[var(--ink-2)]">
          Ingen jämförelse mot tävlingsfart: det saknas registrerade resultat på 800–5000 m från
            de senaste två åren. Lägg in resultat under <em>Resultat</em> så räknas farten fram.
          </p>
        ))}
      {groups.map((g) => (
        <SignatureCard
          key={`${g.category ?? "okänd"}|${g.distanceMeters}`}
          group={g}
          racePace={racePace}
        />
      ))}
    </div>
  );
}
