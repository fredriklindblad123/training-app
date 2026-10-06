"""
Hämtar varvdata (laps) för aktiviteter med fler än ett varv och fyller
activity_splits (P0.2 i docs/insikter-roadmap.md).

Varför: activity_splits har funnits i schemat sedan starten men aldrig
fyllts. För en medeldistanslöpare är varvtiderna själva träningen —
passets snitt blandar löpning och vila och säger ingenting om ett
intervallpass. Med varvdata går det att se att 400:orna gick på
87,9 / 88,2 / 88,7 och följa samma nyckelpass över en säsong.

Kräver migrationen 20260727100000_activity_splits_fields.sql.

Körning:
    cd ~/traningsapp
    set -a; source web/.env.local; set +a
    .venv/bin/python3 scripts/backfill_activity_splits.py \
        --user-id 7db90b90-... --dry-run

Ett Garmin-anrop per aktivitet, så scriptet pausar mellan anrop och kan
köras om: aktiviteter som redan har varv hoppas över.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Optional

import requests
from garminconnect import Garmin, GarminConnectAuthenticationError

DEFAULT_DELAY_SECONDS = 1.5

# Aktivt eller vila per varv — se _classify_laps. Uppmätt 2026-10-06 mot
# passnamnen ("8x2min" ska ge åtta rep) på 123 tröskel- och intervallpass.
#
# Den gamla regeln (aktivt om minst 55 % av passets snabbaste varv) sattes
# för stående eller gående vila, ca 0,8 m/s. Joggvila ligger på 2,5–2,8 m/s,
# över 55 % av en tröskelrep, och märktes aktiv: "8x2min" med 90 s joggvila
# blev 15 aktiva varv och nyckelpassen såg en rak 5,75 km. 66 % rätt antal rep.
#
# Ett varv är vila om det är minst 15 % långsammare än BÅDA sina grannar
# (vilan ligger mellan två rep), eller långsammare än hälften av passets
# typiska snabba fart (gång och stillastående, även när två vilovarv ligger i
# rad). 72 % rätt, och båda de rapporterade passen exakt. Typisk snabb fart är
# 90:e percentilen, inte maxfarten — ett varv med trasig GPS-sträcka (ett
# verkligt pass hade 42 949 672 m) gjorde annars hela passet till vila.
# Resten av missarna är nästan alla banrep där GPS:en mätt 100 m som 13 m.
REST_SLOWER_THAN_NEIGHBOURS = 0.85
REST_BELOW_TYPICAL_FAST = 0.5
# Varv kortare än så är felryckningar; de jämförs aldrig som grannar.
NEIGHBOUR_MIN_SECONDS = 10

# Under så här många sekunder är varvet nästan alltid en felryckning på
# klockan snarare än ett riktigt intervall.
MIN_LAP_SECONDS = 5


def sb_headers(key: str) -> dict:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def sb_get(url: str, key: str, path: str) -> list[dict]:
    resp = requests.get(f"{url}/rest/v1/{path}", headers=sb_headers(key), timeout=60)
    resp.raise_for_status()
    return resp.json()


def pace_seconds_per_km(speed_m_per_s: Optional[float]) -> Optional[float]:
    if not speed_m_per_s:
        return None
    return 1000 / speed_m_per_s


def classify_laps(laps: list[dict]) -> list[str]:
    """Aktivt eller vila per varv, utifrån farten mot grannvarven.

    Reserv när Garmin inte märkt varven ett och ett (garmin_lap_kinds).
    Varvdatans intensityType duger inte: det är "INTERVAL" för samtliga varv,
    även vilovarven. Speglar _classify_laps i web/api/index.py; håll dem i
    synk.
    """
    speeds = []
    for lap in laps:
        dur = lap.get("duration") or 0
        dist = lap.get("distance") or 0
        speeds.append(dist / dur if dur > 0 else 0.0)

    real = [i for i, lap in enumerate(laps) if (lap.get("duration") or 0) >= NEIGHBOUR_MIN_SECONDS]
    if not real:
        return ["active"] * len(laps)
    ordered = sorted(speeds[i] for i in real)
    typical_fast = ordered[int(0.9 * (len(ordered) - 1))]
    if typical_fast <= 0:
        return ["active"] * len(laps)

    kinds = []
    for i, s in enumerate(speeds):
        if s < typical_fast * REST_BELOW_TYPICAL_FAST:
            kinds.append("rest")
            continue
        if i not in real:
            kinds.append("active")
            continue
        pos = real.index(i)
        neighbours = [speeds[real[j]] for j in (pos - 1, pos + 1) if 0 <= j < len(real)]
        if neighbours and s <= REST_SLOWER_THAN_NEIGHBOURS * min(neighbours):
            kinds.append("rest")
        else:
            kinds.append("active")
    return kinds


# Garmins egen märkning per varv, ur endpointen typedsplits (samma som
# kolumnen "Typ" i Garmin Connect). Används före fartregeln när den finns.
# Uppmätt 2026-10-06: märkningen per varv finns i 30 av Alices kvalitetspass
# och stämmer med passnamnet i ungefär 21 av 23 som går att kontrollera. I de
# övriga passen täcker en enda INTERVAL_ACTIVE alla varv, vila inräknad
# (lapIndexes 1–30), och säger då ingenting — där tar fartregeln över.
GARMIN_ACTIVE_TYPES = {"INTERVAL_ACTIVE"}
GARMIN_LAP_TYPES = {"INTERVAL_ACTIVE", "INTERVAL_RECOVERY", "INTERVAL_REST", "INTERVAL_WARMUP", "INTERVAL_COOLDOWN"}


def garmin_lap_kinds(typed: dict, laps: list[dict]) -> Optional[list[str]]:
    """Aktivt eller vila per varv ur Garmins typed splits, eller None.

    None när Garmin inte märkt varje varv för sig — då gäller fartregeln.
    Uppvärmning, nerjogg och vila blir "rest": de är inte repetitioner.
    """
    marked = [s for s in (typed or {}).get("splits") or [] if s.get("type") in GARMIN_LAP_TYPES]
    if not marked or any(len(s.get("lapIndexes") or []) != 1 for s in marked):
        return None
    type_by_lap = {s["lapIndexes"][0]: s["type"] for s in marked}
    if any(lap.get("lapIndex") not in type_by_lap for lap in laps):
        return None
    return ["active" if type_by_lap[lap["lapIndex"]] in GARMIN_ACTIVE_TYPES else "rest" for lap in laps]


def map_lap(activity_id: str, index: int, lap: dict, split_type: str) -> dict:
    speed = lap.get("averageSpeed")
    return {
        "activity_id": activity_id,
        "split_index": index,
        "split_type": split_type,
        "distance_meters": lap.get("distance"),
        "duration_seconds": lap.get("duration"),
        "avg_pace_seconds_per_km": pace_seconds_per_km(speed),
        "avg_gap_seconds_per_km": pace_seconds_per_km(lap.get("avgGradeAdjustedSpeed")),
        "avg_hr": round(lap["averageHR"]) if lap.get("averageHR") is not None else None,
        "max_hr": round(lap["maxHR"]) if lap.get("maxHR") is not None else None,
        "avg_cadence": lap.get("averageRunCadence"),
        "avg_power": lap.get("averagePower"),
        "elevation_gain": lap.get("elevationGain"),
        "start_time": lap.get("startTimeGMT"),
    }


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--user-id", required=True)
    p.add_argument("--delay", type=float, default=DEFAULT_DELAY_SECONDS)
    p.add_argument("--limit", type=int, help="max antal aktiviteter (för test)")
    p.add_argument("--force", action="store_true", help="hämta om även aktiviteter som redan har varv")
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY måste vara satta.")

    activities = sb_get(
        url, key,
        f"activities?user_id=eq.{args.user_id}&select=id,external_id,name,start_time,raw_data&order=start_time&limit=2000",
    )
    multi = [
        a for a in activities
        if (a.get("raw_data") or {}).get("lapCount") and a["raw_data"]["lapCount"] > 1
    ]

    existing: set[str] = set()
    if not args.force:
        rows = sb_get(url, key, "activity_splits?select=activity_id&limit=100000")
        existing = {r["activity_id"] for r in rows}

    todo = [a for a in multi if a["id"] not in existing]
    if args.limit:
        todo = todo[: args.limit]

    print(f"Aktiviteter totalt:      {len(activities)}")
    print(f"Med fler än ett varv:    {len(multi)}")
    print(f"Har redan varv sparade:  {len(multi) - len([a for a in multi if a['id'] not in existing])}")
    print(f"Att hämta:               {len(todo)}")
    if todo:
        print(f"Uppskattad tid:          ~{len(todo) * args.delay / 60:.0f} min")

    if args.dry_run:
        print("\n--dry-run: inga Garmin-anrop, inga skrivningar.")
        for a in todo[:5]:
            print(f"  {a['start_time'][:10]}  {(a['name'] or '').strip()[:40]:42s} varv={a['raw_data']['lapCount']}")
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
    total_laps = 0
    done = 0
    failed = 0

    for i, act in enumerate(todo, start=1):
        try:
            data = client.get_activity_splits(act["external_id"])
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

        laps = (data or {}).get("lapDTOs") or []
        laps = [l for l in laps if (l.get("duration") or 0) >= MIN_LAP_SECONDS]
        if not laps:
            time.sleep(args.delay)
            continue

        try:
            typed = client.connectapi(f"/activity-service/activity/{act['external_id']}/typedsplits")
        except Exception:
            typed = None
        kinds = garmin_lap_kinds(typed, laps) or classify_laps(laps)
        rows = [map_lap(act["id"], idx, lap, kind) for idx, (lap, kind) in enumerate(zip(laps, kinds))]

        resp = requests.post(
            f"{url}/rest/v1/activity_splits",
            headers={**sb_headers(key), "Prefer": "resolution=merge-duplicates,return=minimal"},
            params={"on_conflict": "activity_id,split_index"},
            json=rows,
            timeout=60,
        )
        resp.raise_for_status()

        total_laps += len(rows)
        done += 1
        if i % 20 == 0:
            print(f"  {i}/{len(todo)}  ({total_laps} varv skrivna, {failed} fel)")
        time.sleep(args.delay)

    print(f"\nKLART: {done} aktiviteter, {total_laps} varv skrivna.")
    if failed:
        print(f"       {failed} aktiviteter misslyckades och hoppades över.")


if __name__ == "__main__":
    main()
