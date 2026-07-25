"""
Synkar Garmin-aktiviteter till Supabase `activities`-tabellen.

Körning:
    source .venv/bin/activate
    export SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=...
    export GARMIN_SUPABASE_USER_ID=...   # din Supabase auth.users-id (UUID)
    python scripts/sync_garmin.py --days 30

Autentisering mot Garmin cachas i ~/.garminconnect efter första lyckade
inloggning (interaktiv, lösenordet syns aldrig och sparas aldrig i
klartext). Kör skriptet själv i din egen terminal första gången.
Efterföljande körningar återanvänder den sparade token:en automatiskt,
utan att fråga efter lösenord igen.
"""

from __future__ import annotations

import argparse
import getpass
import os
import sys
from datetime import date, timedelta

import requests
from garminconnect import Garmin, GarminConnectAuthenticationError

TOKENSTORE = os.path.expanduser("~/.garminconnect")


def get_client() -> Garmin:
    client = Garmin()
    try:
        client.login(TOKENSTORE)
        return client
    except (FileNotFoundError, GarminConnectAuthenticationError):
        pass

    email = os.environ.get("GARMIN_EMAIL") or input("Garmin-e-post: ")
    password = os.environ.get("GARMIN_PASSWORD") or getpass.getpass("Garmin-lösenord: ")
    client = Garmin(email, password)
    client.login()
    client.garth.dump(TOKENSTORE)
    return client


def to_iso_utc(garmin_gmt: str | None) -> str | None:
    """'2026-07-22 15:47:47' -> '2026-07-22T15:47:47Z'"""
    if not garmin_gmt:
        return None
    return garmin_gmt.replace(" ", "T") + "Z"



# Bara dessa sporter ska sparas — allt annat (båt, golf, promenad, ...) som
# Garmin råkar synka ska ignoreras helt. Speglar web/api/index.py.
_ALLOWED_SUBSTRINGS = ("running", "strength", "cycling", "biking", "swim")
_ALLOWED_EXACT = {"cross_country_skiing", "skate_skiing"}


def is_allowed_activity(a: dict) -> bool:
    type_key = ((a.get("activityType") or {}).get("typeKey") or "").lower()
    if any(s in type_key for s in _ALLOWED_SUBSTRINGS):
        return True
    return type_key in _ALLOWED_EXACT


def map_activity(a: dict, user_id: str) -> dict:
    avg_speed = a.get("averageSpeed")
    return {
        "user_id": user_id,
        "source": "garmin",
        "external_id": str(a.get("activityId")),
        "activity_type": (a.get("activityType") or {}).get("typeKey"),
        "name": a.get("activityName"),
        "start_time": to_iso_utc(a.get("startTimeGMT")),
        "duration_seconds": a.get("duration"),
        "distance_meters": a.get("distance"),
        "avg_pace_seconds_per_km": (1000 / avg_speed) if avg_speed else None,
        "avg_hr": round(a["averageHR"]) if a.get("averageHR") is not None else None,
        "max_hr": round(a["maxHR"]) if a.get("maxHR") is not None else None,
        "hr_zone_1_seconds": a.get("hrTimeInZone_1"),
        "hr_zone_2_seconds": a.get("hrTimeInZone_2"),
        "hr_zone_3_seconds": a.get("hrTimeInZone_3"),
        "hr_zone_4_seconds": a.get("hrTimeInZone_4"),
        "hr_zone_5_seconds": a.get("hrTimeInZone_5"),
        "aerobic_training_effect": a.get("aerobicTrainingEffect"),
        "anaerobic_training_effect": a.get("anaerobicTrainingEffect"),
        "training_effect_label": a.get("trainingEffectLabel"),
        "training_load": a.get("activityTrainingLoad"),
        "vo2max": a.get("vO2MaxValue"),
        "avg_cadence": a.get("averageRunningCadenceInStepsPerMinute"),
        "avg_stride_length": a.get("avgStrideLength"),
        "elevation_gain": a.get("elevationGain"),
        "elevation_loss": a.get("elevationLoss"),
        "calories": a.get("calories"),
        "location_name": a.get("locationName"),
        "start_lat": a.get("startLatitude"),
        "start_lng": a.get("startLongitude"),
        "raw_data": a,
    }


def upsert_activities(supabase_url: str, service_key: str, rows: list[dict]) -> list[dict]:
    resp = requests.post(
        f"{supabase_url}/rest/v1/activities",
        headers={
            "apikey": service_key,
            "Authorization": f"Bearer {service_key}",
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        },
        params={"on_conflict": "user_id,source,external_id"},
        json=rows,
        timeout=30,
    )
    if not resp.ok:
        print(resp.text, file=sys.stderr)
    resp.raise_for_status()
    return resp.json()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--days", type=int, default=30, help="Antal dagar bakåt att synka (default 30)"
    )
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    user_id = os.environ.get("GARMIN_SUPABASE_USER_ID")

    missing = [
        name
        for name, val in [
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", service_key),
            ("GARMIN_SUPABASE_USER_ID", user_id),
        ]
        if not val
    ]
    if missing:
        sys.exit(f"Saknar miljövariabler: {', '.join(missing)}")

    client = get_client()

    start = date.today() - timedelta(days=args.days)
    activities = client.get_activities_by_date(start.isoformat(), date.today().isoformat())
    activities = [a for a in activities if is_allowed_activity(a)]
    print(f"Hittade {len(activities)} matchande aktiviteter senaste {args.days} dagarna.")

    if not activities:
        return

    rows = [map_activity(a, user_id) for a in activities]
    result = upsert_activities(supabase_url, service_key, rows)
    print(f"Synkade {len(result)} aktiviteter till Supabase.")


if __name__ == "__main__":
    main()
