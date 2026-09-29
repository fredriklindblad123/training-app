"""
Hämtar pulskurvan (sekund för sekund) och klockans zongränser per aktivitet
och fyller activity_hr_streams + activities.hr_zone_bounds.

Varför: Garmins zontider (hrTimeInZone_1..5) räknas mot klockans egna
gränser, och för Alice låg de långt under hennes uppmätta trösklar (zon 4
från 165, LT1 183). Med kurvan räknar databasen (compute_lab_zones, trigger
på activity_hr_streams) fram tid i de uppmätta zonerna i hr_zone_sets, så
att appen kan visa klockans och labbets siffror sida vid sida.

Kräver migrationen 20260929140000_lab_hr_zones.sql.

Körning:
    cd ~/traningsapp
    set -a; source web/.env.local; set +a
    .venv/bin/python3 scripts/backfill_hr_streams.py \
        --user-id 7db90b90-... [--dry-run] [--limit 20]

Två Garmin-anrop per aktivitet, så scriptet pausar mellan anrop och kan
köras om: aktiviteter som redan har en kurva hoppas över.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from typing import Optional

import requests
from garminconnect import Garmin

DEFAULT_DELAY_SECONDS = 1.5

# Samma som synken (web/api/index.py). maxchart styr hur många punkter
# Garmin lämnar ut; högt nog för att få varje sekund även på ett långpass.
MAX_CHART_POINTS = 100000


def sb_headers(key: str) -> dict:
    return {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}


def sb_get_all(url: str, key: str, path: str) -> list[dict]:
    """PostgREST begränsar svaret till 1000 rader — bläddra med Range."""
    rows: list[dict] = []
    step = 1000
    while True:
        headers = {**sb_headers(key), "Range": f"{len(rows)}-{len(rows) + step - 1}"}
        resp = requests.get(f"{url}/rest/v1/{path}", headers=headers, timeout=60)
        resp.raise_for_status()
        page = resp.json()
        rows.extend(page)
        if len(page) < step:
            return rows


def parse_hr_stream(details: dict) -> Optional[tuple[list[int], list[int]]]:
    """(sekunder från start, puls) ur get_activity_details. Bara punkter med
    puls sparas; glapp hanteras i compute_lab_zones (över 30 s räknas inte).
    None när passet saknar puls."""
    descriptors = details.get("metricDescriptors") or []
    idx = {d.get("key"): d.get("metricsIndex") for d in descriptors}
    ts_i, hr_i = idx.get("directTimestamp"), idx.get("directHeartRate")
    if ts_i is None or hr_i is None:
        return None
    offsets: list[int] = []
    hr: list[int] = []
    start: Optional[float] = None
    last: Optional[int] = None
    for row in details.get("activityDetailMetrics") or []:
        metrics = (row or {}).get("metrics") or []
        if len(metrics) <= max(ts_i, hr_i):
            continue
        ts, bpm = metrics[ts_i], metrics[hr_i]
        if ts is None:
            continue
        # Från passets start, inte första pulsvärdet: varvens tidsfönster
        # (compute_split_hr) räknas från aktivitetens start_time.
        if start is None:
            start = ts
        if bpm is None or bpm <= 0:
            continue
        offset = int(round((ts - start) / 1000))
        if last is not None and offset <= last:
            continue
        offsets.append(offset)
        hr.append(int(round(bpm)))
        last = offset
    return (offsets, hr) if len(hr) >= 2 else None


def parse_zone_bounds(zones: object) -> Optional[list[int]]:
    """Klockans undre gräns för zon 1–5 ur get_activity_hr_in_timezones."""
    if not isinstance(zones, list) or len(zones) != 5:
        return None
    try:
        ordered = sorted(zones, key=lambda z: z["zoneNumber"])
        return [int(z["zoneLowBoundary"]) for z in ordered]
    except (KeyError, TypeError, ValueError):
        return None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--user-id", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--limit", type=int, default=None)
    parser.add_argument("--delay", type=float, default=DEFAULT_DELAY_SECONDS)
    args = parser.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY saknas — source web/.env.local först.")
        return 1

    token_rows = sb_get_all(url, key, f"garmin_tokens?select=token&user_id=eq.{args.user_id}")
    if not token_rows:
        print("Ingen Garmin-token för användaren.")
        return 1
    client = Garmin()
    client.garth.loads(token_rows[0]["token"])

    activities = sb_get_all(
        url,
        key,
        f"activities?select=id,external_id,start_time,name&user_id=eq.{args.user_id}"
        "&source=eq.garmin&avg_hr=gt.0&order=start_time.desc",
    )
    done = {
        r["activity_id"]
        for r in sb_get_all(
            url, key, f"activity_hr_streams?select=activity_id&user_id=eq.{args.user_id}"
        )
    }
    todo = [a for a in activities if a["id"] not in done and a.get("external_id")]
    if args.limit:
        todo = todo[: args.limit]
    print(f"{len(activities)} aktiviteter med puls, {len(done)} har kurva, {len(todo)} att hämta.")

    written = failed = no_hr = 0
    for n, activity in enumerate(todo, 1):
        label = f"[{n}/{len(todo)}] {activity['start_time'][:10]} {activity['name'] or ''}"
        try:
            details = client.get_activity_details(
                activity["external_id"], maxchart=MAX_CHART_POINTS, maxpoly=0
            )
            stream = parse_hr_stream(details or {})
            time.sleep(args.delay)
            bounds = parse_zone_bounds(client.get_activity_hr_in_timezones(activity["external_id"]))
        except Exception as e:  # ett pass får aldrig fälla hela körningen
            failed += 1
            print(f"{label}: fel, hoppar över ({e})")
            time.sleep(args.delay * 2)
            continue

        if stream is None:
            no_hr += 1
            print(f"{label}: ingen pulskurva")
        elif args.dry_run:
            print(f"{label}: {len(stream[1])} punkter, klockans gränser {bounds}")
        else:
            if bounds is not None:
                requests.patch(
                    f"{url}/rest/v1/activities?id=eq.{activity['id']}",
                    headers={**sb_headers(key), "Prefer": "return=minimal"},
                    json={"hr_zone_bounds": bounds},
                    timeout=60,
                ).raise_for_status()
            requests.post(
                f"{url}/rest/v1/activity_hr_streams?on_conflict=activity_id",
                headers={**sb_headers(key), "Prefer": "resolution=merge-duplicates,return=minimal"},
                json={
                    "activity_id": activity["id"],
                    "user_id": args.user_id,
                    "offsets": stream[0],
                    "hr": stream[1],
                },
                timeout=60,
            ).raise_for_status()
            written += 1
            if n % 25 == 0:
                print(f"{label}: {written} sparade hittills")
        time.sleep(args.delay)

    print(f"Klart: {written} sparade, {no_hr} utan puls, {failed} fel.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
