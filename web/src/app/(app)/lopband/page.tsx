import { createClient } from "@/lib/supabase/server";
import { getScopedProfile, resolveScopedUserId, viewableAthletes } from "@/lib/auth-scope";
import { Page, PageHeader } from "@/components/ui/Page";
import { HowCalculated } from "@/components/ui/Explain";
import { AthleteSwitcher } from "@/components/AthleteSwitcher";
import { TreadmillPanel, type BandView } from "@/components/TreadmillPanel";
import type { CalibrationPoint } from "@/lib/treadmill";

/* Löpband (2026-11-28): mät ett bands verkliga fart och spara det, så att
 * tröskelfarten på bandet blir den man tror. Se lib/treadmill.ts. */

export default async function LopbandPage({ searchParams }: { searchParams: Promise<{ athlete?: string }> }) {
  const { athlete: athleteParam } = await searchParams;
  const supabase = await createClient();
  const scoped = await getScopedProfile(supabase);
  if (!scoped) return null;
  const userId = resolveScopedUserId(scoped, athleteParam);
  const isOther = userId !== scoped.userId;
  const athletes = viewableAthletes(scoped);
  const athleteName = athletes.find((a) => a.id === userId)?.fullName?.split(" ")[0] ?? "Löparens";

  const [{ data: bandRows }, { data: calRows }, { data: profile }] = await Promise.all([
    supabase.from("treadmills").select("id, name, belt_length_cm").order("name"),
    supabase
      .from("treadmill_calibrations")
      .select("id, treadmill_id, measured_on, measured_by, points, slope, intercept, loaded_factor, created_at")
      .order("created_at", { ascending: false }),
    supabase.from("profiles").select("treadmill_id").eq("id", userId).maybeSingle(),
  ]);

  type CalRow = {
    id: string;
    treadmill_id: string;
    measured_on: string;
    measured_by: string;
    points: CalibrationPoint[];
    slope: number;
    intercept: number;
    loaded_factor: number | null;
  };
  const latest = new Map<string, CalRow>();
  for (const c of (calRows ?? []) as CalRow[]) if (!latest.has(c.treadmill_id)) latest.set(c.treadmill_id, c);

  const bands: BandView[] = ((bandRows ?? []) as { id: string; name: string; belt_length_cm: number }[]).map((b) => {
    const c = latest.get(b.id);
    return {
      id: b.id,
      name: b.name,
      beltLengthCm: Number(b.belt_length_cm),
      calibration: c
        ? {
            id: c.id,
            measuredOn: c.measured_on,
            points: c.points,
            mine: c.measured_by === scoped.userId,
            calibration: {
              slope: Number(c.slope),
              intercept: Number(c.intercept),
              loadedFactor: c.loaded_factor != null ? Number(c.loaded_factor) : null,
            },
          }
        : null,
    };
  });

  return (
    <Page>
      <PageHeader title="Löpband" lead="Mät bandets verkliga fart, så att farten på bandet blir den du tror." />
      {scoped.role === "coach" && athletes.length > 1 && (
        <AthleteSwitcher
          athletes={athletes}
          activeId={userId}
          viewerUserId={scoped.userId}
          buildHref={(id) => `/lopband?athlete=${id}`}
        />
      )}
      <TreadmillPanel
        bands={bands}
        chosenId={(profile?.treadmill_id as string | null) ?? null}
        athlete={scoped.role === "coach" ? userId : null}
        whose={isOther ? `${athleteName}s` : "ditt"}
      />
      <HowCalculated>
        <p>
          Bandets verkliga fart är bandets längd delat med tiden för ett varv. Appen tar tiden för varje gång
          kritstrecket passerar, och räknar fram tiden per varv ur alla passager tillsammans. Ett missat varv eller en
          dubbelknack ändrar inte resultatet.
        </p>
        <p>
          Mellan de uppmätta farterna dras en rak linje i km/h. Felet på ett band är oftast en procentsats av farten,
          ibland med en liten förskjutning, och det fångar linjen. Med tre farter eller fler syns det om någon av dem
          inte passar.
        </p>
        <p>
          Bandet går ofta något långsammare med en löpare på, eftersom varje steg bromsar det. Det fångas bara av
          kontrollmätningen med löpare. Utan den gäller tabellen tomt band.
        </p>
        <p>
          När du har valt ett band används det i dagens pass, som visar vad bandet ska ställas på, och för farten du
          skriver i kommentaren till ett löpbandspass i Garmin.
        </p>
      </HowCalculated>
    </Page>
  );
}
