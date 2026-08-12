"""
Hämtar Alices egen "Känsla"/"Upplevd ansträngning"-skattning (Garmin Connect-
appens "Utvärdering") för befintliga aktiviteter och fyller
activities.garmin_feel/garmin_rpe.

Varför: ersätter den dagliga incheckningen (diary_entries.feeling/rpe) som
källa till subjektiv känsla/ansträngning — incheckningen fylldes i för
sällan för att ge meningsfull data, medan den här skattningen redan görs i
Garmin-appen efter varje pass. Se migration
20260812100000_garmin_feel_rpe.sql för fältmappningen (verifierad mot skarp
data 2026-08-12: directWorkoutFeel är 0/25/50/75/100, directWorkoutRpe är
0-100 i steg om 10).

Kräver migrationen 20260812100000_garmin_feel_rpe.sql.

Körning:
    cd ~/traningsapp
    set -a; source web/.env.local; set +a
    .venv/bin/python3 scripts/backfill_garmin_feel_rpe.py \
        --user-id 7db90b90-... --dry-run

Ett Garmin-anrop per aktivitet, så scriptet pausar mellan anrop och kan
köras om: aktiviteter som redan har garmin_feel eller garmin_rpe hoppas
över. Samma rate-limit-hantering som scripts/backfill_activity_splits.py —
avbryter direkt vid 429/blockering istället för att fortsätta hamra.
"""

from __future__ import annotations

import argparse
import os
import sys
import time

import requests
from garminconnect import Garmin, GarminConnectAuthenticationError

DEFAULT_DELAY_SECONDS = 1.5


def sb_headers(key: str) -> dict:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def sb_get(url: str, key: str, path: str) -> list[dict]:
    resp = requests.get(f"{url}/rest/v1/{path}", headers=sb_headers(key), timeout=60)
    resp.raise_for_status()
    return resp.json()


def map_garmin_feel(direct_workout_feel: int | None) -> int | None:
    """Speglar web/api/index.py — håll dem i synk."""
    if direct_workout_feel is None:
        return None
    return max(1, min(5, round(direct_workout_feel / 25) + 1))


def map_garmin_rpe(direct_workout_rpe: int | None) -> int | None:
    if direct_workout_rpe is None:
        return None
    return max(0, min(10, round(direct_workout_rpe / 10)))


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--user-id", required=True)
    p.add_argument("--delay", type=float, default=DEFAULT_DELAY_SECONDS)
    p.add_argument("--limit", type=int, help="max antal aktiviteter (för test)")
    p.add_argument("--force", action="store_true", help="hämta om även aktiviteter som redan har värden")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY måste vara satta.")

    activities = sb_get(
        url, key,
        f"activities?user_id=eq.{args.user_id}"
        "&select=id,external_id,name,start_time,garmin_feel,garmin_rpe"
        "&order=start_time.desc&limit=2000",
    )
    todo = activities if args.force else [
        a for a in activities if a.get("garmin_feel") is None and a.get("garmin_rpe") is None
    ]
    if args.limit:
        todo = todo[: args.limit]

    print(f"Aktiviteter totalt:      {len(activities)}")
    print(f"Saknar Känsla/Ansträngning: {len(todo) if not args.force else '(--force, hämtar alla)'}")
    print(f"Att hämta:               {len(todo)}")
    if todo:
        print(f"Uppskattad tid:          ~{len(todo) * args.delay / 60:.0f} min")

    if args.dry_run:
        print("\n--dry-run: inga Garmin-anrop, inga skrivningar.")
        for a in todo[:5]:
            print(f"  {a['start_time'][:10]}  {(a['name'] or '').strip()[:40]:42s}")
        return
    if not todo:
        print("\nInget att göra.")
        return

    token_rows = sb_get(url, key, f"garmin_tokens?select=token&user_id=eq.{args.user_id}")
    if not token_rows:
        sys.exit("Ingen sparad Garmin-anslutning för användaren.")
    client = Garmin()
    try:
        client.garth.loads(token_rows[0]["token"])
    except Exception as e:
        sys.exit(f"Kunde inte läsa den sparade Garmin-sessionen: {e}")

    print()
    done = 0
    empty = 0
    failed = 0

    for i, act in enumerate(todo, start=1):
        try:
            evaluation = client.get_activity_evaluation(act["external_id"])
        except GarminConnectAuthenticationError as e:
            sys.exit(f"\nGarmin-sessionen underkändes: {e}\nAnslut på nytt i appen och kör om. {done} klara.")
        except Exception as e:
            msg = str(e)
            if "429" in msg or "Too Many" in msg or "blocked" in msg.lower():
                sys.exit(
                    f"\nGarmin rate-limitar oss vid {act['start_time'][:10]} ({msg}).\n"
                    f"{done} aktiviteter klara. Vänta, höj --delay och kör om."
                )
            failed += 1
            print(f"  {act['start_time'][:10]} fel: {type(e).__name__}: {msg[:70]}")
            time.sleep(args.delay)
            continue

        summary = (evaluation or {}).get("summaryDTO") or {}
        feel = map_garmin_feel(summary.get("directWorkoutFeel"))
        rpe = map_garmin_rpe(summary.get("directWorkoutRpe"))
        if feel is None and rpe is None:
            empty += 1
            time.sleep(args.delay)
            continue

        # PATCH, inte POST-upsert: en POST med bara id/garmin_feel/garmin_rpe
        # och on_conflict=id ser ut som en INSERT för Postgres innan
        # konfliktlösningen hinner slå till, och user_id (not null, saknas i
        # payloaden) stoppar hela satsen — verifierat mot skarp data
        # 2026-08-12. Raden finns redan (vi läste just dess id), så en ren
        # UPDATE är både korrekt och enklare.
        resp = requests.patch(
            f"{url}/rest/v1/activities",
            headers={**sb_headers(key), "Prefer": "return=minimal"},
            params={"id": f"eq.{act['id']}"},
            json={"garmin_feel": feel, "garmin_rpe": rpe},
            timeout=30,
        )
        resp.raise_for_status()

        done += 1
        if i % 20 == 0:
            print(f"  {i}/{len(todo)}  ({done} ifyllda, {empty} tomma, {failed} fel)")
        time.sleep(args.delay)

    print(f"\nKLART: {done} aktiviteter ifyllda, {empty} hade ingen skattning, {failed} misslyckades.")


if __name__ == "__main__":
    main()
