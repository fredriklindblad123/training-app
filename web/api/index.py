"""
Vercel Python-funktion (FastAPI/ASGI) för multi-user Garmin-synk.

Två endpoints:
  POST /api/garmin/login  - ansluter ett Garmin-konto till en app-användare.
  POST /api/garmin/sync   - synkar aktiviteter, antingen för en specifik
                             användare (on-demand, "Synka nu"-knappen) eller
                             för alla anslutna användare (schemalagd cron).

Skyddas av två separata hemligheter (miljövariabler):
  INTERNAL_API_SECRET - delas bara med vår egen Next.js-server (server
                         actions), så att ingen utomstående kan trigga
                         inloggning/synk åt en godtycklig user_id.
  CRON_SECRET          - Vercel skickar automatiskt "Authorization: Bearer
                         <CRON_SECRET>" på schemalagda anrop, se vercel.json.

Bygger vidare på samma Garmin-integration som scripts/sync_garmin.py
(garminconnect/garth) - se docs/garmin-api.md för bakgrund och kända
begränsningar hos det inofficiella biblioteket.
"""

import os
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import requests
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from garminconnect import Garmin, GarminConnectAuthenticationError

app = FastAPI()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
INTERNAL_SECRET = os.environ.get("INTERNAL_API_SECRET")
CRON_SECRET = os.environ.get("CRON_SECRET")

SYNC_DAYS = 7  # hur långt bakåt en vanlig synk (cron/upprepad "Synka nu") tittar
FIRST_SYNC_DAYS = 365  # hur långt bakåt den allra första synken för en användare tittar

# Bara dessa sporter ska sparas — allt annat (båt, golf, promenad, ...) som
# Garmin råkar synka ska ignoreras helt, aldrig nå activities-tabellen.
# Utförskidåkning är medvetet uteslutet — bara längdskidåkning räknas.
# Substr-matchning genomgående (inte exakt jämförelse) eftersom Garmin har
# suffix-varianter, t.ex. "cross_country_skiing_ws".
_ALLOWED_SUBSTRINGS = (
    "running",
    "strength",
    "cycling",
    "biking",
    "swim",
    "cross_country_skiing",
    "skate_skiing",
)


def _is_allowed_activity(a: dict) -> bool:
    type_key = ((a.get("activityType") or {}).get("typeKey") or "").lower()
    return any(s in type_key for s in _ALLOWED_SUBSTRINGS)


def _sb_headers() -> dict:
    return {
        "apikey": SERVICE_KEY,
        "Authorization": f"Bearer {SERVICE_KEY}",
        "Content-Type": "application/json",
    }


def _sb_upsert(table: str, rows: list[dict], on_conflict: str) -> None:
    resp = requests.post(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**_sb_headers(), "Prefer": "resolution=merge-duplicates,return=minimal"},
        params={"on_conflict": on_conflict},
        json=rows,
        timeout=30,
    )
    resp.raise_for_status()


def _sb_select(table: str, select: str, params: dict) -> list[dict]:
    resp = requests.get(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers=_sb_headers(),
        params={"select": select, **params},
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def _mark_connection(
    user_id: str, status: str, error: Optional[str], synced: bool = False
) -> None:
    payload = {"user_id": user_id, "status": status, "last_error": error}
    if synced:
        payload["last_synced_at"] = datetime.now(timezone.utc).isoformat()
    _sb_upsert("garmin_connections", [payload], "user_id")


def _to_iso_utc(garmin_gmt: Optional[str]) -> Optional[str]:
    if not garmin_gmt:
        return None
    return garmin_gmt.replace(" ", "T") + "Z"


def _map_activity(a: dict, user_id: str) -> dict:
    avg_speed = a.get("averageSpeed")
    return {
        "user_id": user_id,
        "source": "garmin",
        "external_id": str(a.get("activityId")),
        "activity_type": (a.get("activityType") or {}).get("typeKey"),
        "name": a.get("activityName"),
        "start_time": _to_iso_utc(a.get("startTimeGMT")),
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


def _sync_one_user(user_id: str) -> dict:
    token_rows = _sb_select("garmin_tokens", "token", {"user_id": f"eq.{user_id}"})
    if not token_rows:
        return {"user_id": user_id, "ok": False, "error": "ingen sparad Garmin-anslutning"}

    client = Garmin()
    try:
        client.garth.loads(token_rows[0]["token"])
    except Exception as e:  # trasig/korrupt token
        _mark_connection(user_id, "needs_reauth", f"kunde inte läsa sparad session: {e}")
        return {"user_id": user_id, "ok": False, "error": "needs_reauth"}

    # Första synken för en användare (ingen last_synced_at än) hämtar ett helt
    # år bakåt istället för det korta dagliga fönstret, så historiken kommer
    # med direkt efter att man anslutit sitt Garmin-konto.
    connection_rows = _sb_select(
        "garmin_connections", "last_synced_at", {"user_id": f"eq.{user_id}"}
    )
    is_first_sync = not connection_rows or not connection_rows[0].get("last_synced_at")
    days = FIRST_SYNC_DAYS if is_first_sync else SYNC_DAYS

    start = date.today() - timedelta(days=days)
    try:
        activities = client.get_activities_by_date(start.isoformat(), date.today().isoformat())
    except GarminConnectAuthenticationError as e:
        _mark_connection(user_id, "needs_reauth", str(e))
        return {"user_id": user_id, "ok": False, "error": "needs_reauth"}
    except Exception as e:
        _mark_connection(user_id, "error", str(e))
        return {"user_id": user_id, "ok": False, "error": str(e)}

    activities = [a for a in activities if _is_allowed_activity(a)]

    if activities:
        _sb_upsert(
            "activities",
            [_map_activity(a, user_id) for a in activities],
            "user_id,source,external_id",
        )

    # Spara ev. förnyad token (garth roterar refresh-token vid användning).
    _sb_upsert("garmin_tokens", [{"user_id": user_id, "token": client.garth.dumps()}], "user_id")
    _mark_connection(user_id, "connected", None, synced=True)
    return {"user_id": user_id, "ok": True, "count": len(activities)}


@app.get("/api/garmin/health")
def health():
    return {"ok": True}


@app.post("/api/garmin/login")
async def garmin_login(request: Request):
    if not INTERNAL_SECRET or request.headers.get("x-internal-secret") != INTERNAL_SECRET:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    body = await request.json()
    user_id = body.get("user_id")
    email = body.get("email")
    password = body.get("password")
    if not user_id or not email or not password:
        return JSONResponse({"error": "user_id, email och password krävs"}, status_code=400)

    try:
        client = Garmin(email, password)
        client.login()
    except GarminConnectAuthenticationError as e:
        return JSONResponse({"error": f"Garmin-inloggning misslyckades: {e}"}, status_code=401)
    except Exception as e:
        return JSONResponse({"error": f"Oväntat fel vid Garmin-inloggning: {e}"}, status_code=502)

    _sb_upsert("garmin_tokens", [{"user_id": user_id, "token": client.garth.dumps()}], "user_id")
    _mark_connection(user_id, "connected", None)

    return JSONResponse({"ok": True})


@app.post("/api/garmin/sync")
async def garmin_sync(request: Request):
    auth_header = request.headers.get("authorization", "")
    is_cron = bool(CRON_SECRET) and auth_header == f"Bearer {CRON_SECRET}"
    is_internal = bool(INTERNAL_SECRET) and request.headers.get("x-internal-secret") == INTERNAL_SECRET

    if not is_cron and not is_internal:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    body: dict = {}
    try:
        body = await request.json()
    except Exception:
        pass
    user_id = body.get("user_id")

    if user_id:
        return JSONResponse(_sync_one_user(user_id))

    if not is_cron:
        return JSONResponse({"error": "user_id krävs utanför schemalagd synk"}, status_code=400)

    connections = _sb_select("garmin_connections", "user_id", {"status": "eq.connected"})
    results = [_sync_one_user(c["user_id"]) for c in connections]
    return JSONResponse({"ok": True, "results": results})
