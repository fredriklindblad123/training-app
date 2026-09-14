import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

/* Memoiserad per render-pass med Reacts cache().
 *
 * Utan den skapade varje anropare sin egen klient: layouten en, sidan en,
 * varje server action en. Det gjorde inte bara objekt i onödan — det gjorde
 * också getScopedProfile omöjlig att memoisera, eftersom cache() nycklar på
 * argumenten och en ny klientinstans aldrig är lika med den förra.
 *
 * Mönstret är det Next själv rekommenderar för sitt data access layer
 * (node_modules/next/dist/docs/01-app/02-guides/authentication.md). */
export const createClient = cache(async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll anropas från en Server Component där cookies inte kan
            // sättas. Ofarligt så länge middleware sköter sessionsförnyelse.
          }
        },
      },
    },
  );
});
