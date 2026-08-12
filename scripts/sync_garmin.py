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
# Garmin råkar synka ska ignoreras helt. Speglar web/api/index.py. Substr-
# matchning genomgående, eftersom Garmin har suffix-varianter, t.ex.
# "cross_country_skiing_ws".
_ALLOWED_SUBSTRINGS = (
    "running",
    "strength",
    "cycling",
    "biking",
    "swim",
    "cross_country_skiing",
    "skate_skiing",
)


def is_allowed_activity(a: dict) -> bool:
    type_key = ((a.get("activityType") or {}).get("typeKey") or "").lower()
    return any(s in type_key for s in _ALLOWED_SUBSTRINGS)


def map_garmin_feel(direct_workout_feel: int | None) -> int | None:
    """Garmins directWorkoutFeel (0/25/50/75/100 = Mycket svag..Mycket stark)
    till samma 1-5-skala appen använder på andra hållknappsrader. Speglar
    web/api/index.py — håll dem i synk."""
    if direct_workout_feel is None:
        return None
    return max(1, min(5, round(direct_workout_feel / 25) + 1))


def map_garmin_rpe(direct_workout_rpe: int | None) -> int | None:
    """Garmins directWorkoutRpe (0-100 i steg om 10, Borg-liknande) till 0-10."""
    if direct_workout_rpe is None:
        return None
    return max(0, min(10, round(direct_workout_rpe / 10)))


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


# Ett Garmin-anrop per pass (samma resonemang som varvdata i
# web/api/index.py) — taket skyddar mot att en stor --days-körning drar
# hundratals extra anrop och triggar rate-limiting.
EVALUATIONS_PER_RUN = 30


def sync_evaluations(client: Garmin, supabase_url: str, service_key: str, rows: list[dict]) -> int:
    """Hämta Alices egen "Känsla"/"Upplevd ansträngning"-skattning per pass
    (Garmin Connect-appens "Utvärdering") för pass som saknar den än.
    Ersätter den dagliga incheckningen — se migration
    20260812100000_garmin_feel_rpe.sql för bakgrund."""
    candidates = [r for r in rows if r.get("garmin_feel") is None and r.get("garmin_rpe") is None]
    candidates.sort(key=lambda r: r.get("start_time") or "", reverse=True)
    candidates = candidates[:EVALUATIONS_PER_RUN]

    headers = {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    written = 0
    for row in candidates:
        try:
            evaluation = client.get_activity_evaluation(row["external_id"])
        except Exception:
            continue
        summary = (evaluation or {}).get("summaryDTO") or {}
        feel = map_garmin_feel(summary.get("directWorkoutFeel"))
        rpe = map_garmin_rpe(summary.get("directWorkoutRpe"))
        if feel is None and rpe is None:
            continue
        # PATCH, inte POST-upsert: en POST med bara id/garmin_feel/garmin_rpe
        # och on_conflict=id ser ut som en INSERT för Postgres innan
        # konfliktlösningen slår till, och user_id (not null, saknas i
        # payloaden) stoppar hela satsen — verifierat mot skarp data
        # 2026-08-12. Raden finns redan, så en ren UPDATE räcker.
        resp = requests.patch(
            f"{supabase_url}/rest/v1/activities",
            headers=headers,
            params={"id": f"eq.{row['id']}"},
            json={"garmin_feel": feel, "garmin_rpe": rpe},
            timeout=30,
        )
        resp.raise_for_status()
        written += 1
    return written


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

    eval_count = sync_evaluations(client, supabase_url, service_key, result)
    print(f"Hämtade Känsla/Ansträngning för {eval_count} pass.")


if __name__ == "__main__":
    main()
