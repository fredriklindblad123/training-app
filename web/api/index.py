"""
Vercel Python-funktion (FastAPI/ASGI) för multi-user Garmin-synk.

Endpoints:
  POST /api/garmin/login  - ansluter ett Garmin-konto till en app-användare.
  POST /api/garmin/sync   - synkar aktiviteter, antingen för en specifik
                             användare (on-demand, "Synka nu"-knappen) eller
                             för alla anslutna användare (schemalagd cron).

Skyddas av två separata mekanismer (miljövariabler):
  INTERNAL_API_SECRET - delas bara med vår egen Next.js-server (server
                         actions), så att ingen utomstående kan trigga
                         inloggning/synk åt en godtycklig user_id.
  CRON_SECRET          - Vercel skickar automatiskt "Authorization: Bearer
                         <CRON_SECRET>" på schemalagda anrop, se vercel.json.

Bygger vidare på samma Garmin-integration som scripts/sync_garmin.py
(garminconnect/garth) - se docs/garmin-api.md för bakgrund och kända
begränsningar hos det inofficiella biblioteket.

PDF-dagboksimport (t.ex. FIG:s mall) sköts inte längre via en app-endpoint
— görs istället manuellt, några gånger per år, direkt mot Supabase. Se
diary_entries.session_log/coach_notes i docs/data-model.md.
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

# Sömn hämtas en dag per API-anrop, till skillnad från aktiviteter som kommer
# i ett svep. Fönstret hålls därför kort — 365 anrop skulle ta minuter och
# nästan säkert trigga Garmins rate-limiting (se docs/garmin-api.md).
SLEEP_SYNC_DAYS = 7
FIRST_SLEEP_SYNC_DAYS = 30

# Varvdata kostar ett Garmin-anrop per pass. Taket skyddar mot att den första
# synken för en användare (ett helt år bakåt) drar hundratals anrop och både
# spränger Vercels femminutersgräns och triggar rate-limiting. Historik hämtas
# i stället med scripts/backfill_activity_splits.py.
SPLITS_PER_SYNC = 10

# Samma resonemang som SPLITS_PER_SYNC — self-evaluation (Känsla/Upplevd
# ansträngning) kostar också ett Garmin-anrop per pass. Historik hämtas i
# stället med scripts/backfill_garmin_feel_rpe.py.
EVALUATIONS_PER_SYNC = 10

# Andel av passets snabbaste varv som krävs för att räknas som aktivt varv.
# Separationen i verklig data är knivskarp: ca 4,5 m/s för en 400:a mot
# 0,8 m/s för joggvila.
ACTIVE_SPEED_RATIO = 0.55

# Kortare varv än så är nästan alltid en felryckning på klockan.
MIN_LAP_SECONDS = 5

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


def _sb_patch(table: str, row_id: str, fields: dict) -> None:
    """Ren UPDATE av en befintlig rad, till skillnad från _sb_upsert.

    En POST-upsert med bara ett fåtal kolumner (t.ex. id + garmin_feel +
    garmin_rpe) ser ut som en INSERT för Postgres innan ON CONFLICT hinner
    slå till, så saknade NOT NULL-kolumner (user_id m.fl.) stoppar hela
    satsen även när raden redan finns — verifierat mot skarp data
    2026-08-12. PATCH har inget sådant problem.
    """
    resp = requests.patch(
        f"{SUPABASE_URL}/rest/v1/{table}",
        headers={**_sb_headers(), "Prefer": "return=minimal"},
        params={"id": f"eq.{row_id}"},
        json=fields,
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


def _map_garmin_feel(direct_workout_feel: Optional[int]) -> Optional[int]:
    """Garmins directWorkoutFeel (0/25/50/75/100 = Mycket svag..Mycket stark)
    till samma 1-5-skala appen redan använder på andra hållknappsrader.
    Verifierat mot skarp data 2026-08-12 (se migration 20260812100000)."""
    if direct_workout_feel is None:
        return None
    return max(1, min(5, round(direct_workout_feel / 25) + 1))


def _map_garmin_rpe(direct_workout_rpe: Optional[int]) -> Optional[int]:
    """Garmins directWorkoutRpe (0-100 i steg om 10, Borg-liknande) till 0-10."""
    if direct_workout_rpe is None:
        return None
    return max(0, min(10, round(direct_workout_rpe / 10)))


def _pace_seconds_per_km(speed_m_per_s: Optional[float]) -> Optional[float]:
    """Konvertera m/s (Garmins averageSpeed/avgGradeAdjustedSpeed) till sek/km."""
    if not speed_m_per_s:
        return None
    return 1000 / speed_m_per_s


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
        "avg_pace_seconds_per_km": _pace_seconds_per_km(avg_speed),
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
        # P0.3 (docs/insikter-roadmap.md): fält som redan fanns i raw_data
        # men aldrig mappats till egna kolumner. Se även
        # scripts/backfill_activity_fields.py för retroaktiv ifyllning.
        "avg_power": a.get("avgPower"),
        "norm_power": a.get("normPower"),
        "avg_ground_contact_time": a.get("avgGroundContactTime"),
        "avg_vertical_oscillation": a.get("avgVerticalOscillation"),
        "avg_vertical_ratio": a.get("avgVerticalRatio"),
        "avg_gap_seconds_per_km": _pace_seconds_per_km(a.get("avgGradeAdjustedSpeed")),
        "fastest_1k_seconds": a.get("fastestSplit_1000"),
        # Garmins differenceBodyBattery är slut minus start, alltså negativ när
        # passet kostat energi (−11 = batteriet föll 11). Kolumnen heter drain
        # och ska därför vara ett positivt tapp, annars ritas ett större tapp
        # som ett lägre värde i varje diagram som rör fältet.
        "body_battery_drain": (
            -round(a["differenceBodyBattery"])
            if a.get("differenceBodyBattery") is not None
            else None
        ),
        "moderate_intensity_minutes": (
            round(a["moderateIntensityMinutes"])
            if a.get("moderateIntensityMinutes") is not None
            else None
        ),
        "vigorous_intensity_minutes": (
            round(a["vigorousIntensityMinutes"])
            if a.get("vigorousIntensityMinutes") is not None
            else None
        ),
        "raw_data": a,
    }


def _map_sleep(day: str, sleep: dict, user_id: str) -> Optional[dict]:
    """Plocka ut dagens sömn/återhämtning ur Garmins dailySleepData-svar.

    Returnerar None för dagar utan mätning (klockan inte använd), så vi
    slipper skriva tomma rader.
    """
    dto = sleep.get("dailySleepDTO") or {}
    if not dto.get("sleepTimeSeconds"):
        return None

    scores = dto.get("sleepScores") or {}
    overall = scores.get("overall") or {}

    return {
        "user_id": user_id,
        "metric_date": dto.get("calendarDate") or day,
        "sleep_seconds": dto.get("sleepTimeSeconds"),
        "deep_sleep_seconds": dto.get("deepSleepSeconds"),
        "light_sleep_seconds": dto.get("lightSleepSeconds"),
        "rem_sleep_seconds": dto.get("remSleepSeconds"),
        "awake_seconds": dto.get("awakeSleepSeconds"),
        "nap_seconds": dto.get("napTimeSeconds"),
        "sleep_score": overall.get("value"),
        "resting_hr": sleep.get("restingHeartRate"),
        "hrv_overnight_avg": sleep.get("avgOvernightHrv"),
        "avg_respiration": dto.get("averageRespirationValue"),
        "avg_sleep_stress": dto.get("avgSleepStress"),
        "raw_data": dto,
    }


def _sync_sleep(client: Garmin, user_id: str, days: int) -> int:
    """Hämta sömn/återhämtning dag för dag och spara i daily_metrics.

    Garmins sömn-endpoint tar en dag per anrop, så fönstret hålls kort
    (se SLEEP_SYNC_DAYS) — ett helt år skulle bli 365 anrop och nästan
    säkert trigga rate-limiting. Fel på enskilda dagar hoppas över: sömn är
    sekundärt mot aktiviteterna och ska inte kunna få hela synken att fallera.
    """
    rows = []
    for offset in range(days + 1):
        day = (date.today() - timedelta(days=offset)).isoformat()
        try:
            sleep = client.get_sleep_data(day)
        except Exception:
            continue
        if not sleep:
            continue
        row = _map_sleep(day, sleep, user_id)
        if row:
            rows.append(row)

    if rows:
        _sb_upsert("daily_metrics", rows, "user_id,metric_date")
    return len(rows)


def _classify_laps(laps: list[dict]) -> list[str]:
    """Aktivt eller vila per varv, utifrån fart relativt passets snabbaste.

    Garmins eget intensityType duger inte — det är "INTERVAL" för samtliga
    varv i ett intervallpass, även vilovarven. Speglar
    scripts/backfill_activity_splits.py; håll dem i synk.
    """
    speeds = []
    for lap in laps:
        dur = lap.get("duration") or 0
        dist = lap.get("distance") or 0
        speeds.append(dist / dur if dur > 0 else 0.0)

    fastest = max(speeds) if speeds else 0.0
    if fastest <= 0:
        return ["active"] * len(laps)
    return ["active" if s >= fastest * ACTIVE_SPEED_RATIO else "rest" for s in speeds]


def _sync_splits(client: Garmin, user_id: str, activities: list[dict]) -> int:
    """Hämta varvdata för nya pass med fler än ett varv.

    Ett Garmin-anrop per pass, så antalet begränsas hårt: en vanlig dag har
    ett strukturerat pass, medan den allra första synken för en användare
    hämtar ett helt år och skulle kunna ge hundratals anrop — det spränger
    både Vercels femminutersgräns och Garmins rate-limiting. Historik hämtas
    därför med scripts/backfill_activity_splits.py, som kan köras lokalt i
    lugn takt.

    Fel sväljs per pass: varvdata är sekundärt mot aktiviteterna och ska
    aldrig kunna fälla hela synken.
    """
    candidates = [
        a for a in activities
        if (a.get("lapCount") or 0) > 1 and a.get("activityId") is not None
    ]
    if not candidates:
        return 0

    # Nyast först — hinner taket ta slut är det de senaste passen som betyder
    # mest, och resten fångas av backfill-skriptet.
    candidates.sort(key=lambda a: a.get("startTimeGMT") or "", reverse=True)
    candidates = candidates[:SPLITS_PER_SYNC]

    # activity_splits pekar på activities.id, men upserten ovan returnerar
    # inga id:n (return=minimal). De måste därför läsas tillbaka via
    # external_id, som är Garmins activityId.
    external_ids = [str(a["activityId"]) for a in candidates]
    rows = _sb_select(
        "activities",
        "id,external_id",
        {"user_id": f"eq.{user_id}", "external_id": f"in.({','.join(external_ids)})"},
    )
    id_by_external = {r["external_id"]: r["id"] for r in rows}
    if not id_by_external:
        return 0

    # Hoppa över pass som redan har varv, så upprepade synkar inte gör om
    # jobbet mot Garmin.
    existing = {
        r["activity_id"]
        for r in _sb_select(
            "activity_splits",
            "activity_id",
            {"activity_id": f"in.({','.join(id_by_external.values())})"},
        )
    }

    written = 0
    for activity in candidates:
        activity_id = id_by_external.get(str(activity["activityId"]))
        if not activity_id or activity_id in existing:
            continue
        try:
            data = client.get_activity_splits(activity["activityId"])
        except Exception:
            continue

        laps = [
            lap for lap in ((data or {}).get("lapDTOs") or [])
            if (lap.get("duration") or 0) >= MIN_LAP_SECONDS
        ]
        if not laps:
            continue

        kinds = _classify_laps(laps)
        _sb_upsert(
            "activity_splits",
            [
                {
                    "activity_id": activity_id,
                    "split_index": i,
                    "split_type": kind,
                    "distance_meters": lap.get("distance"),
                    "duration_seconds": lap.get("duration"),
                    "avg_pace_seconds_per_km": _pace_seconds_per_km(lap.get("averageSpeed")),
                    "avg_gap_seconds_per_km": _pace_seconds_per_km(lap.get("avgGradeAdjustedSpeed")),
                    "avg_hr": round(lap["averageHR"]) if lap.get("averageHR") is not None else None,
                    "max_hr": round(lap["maxHR"]) if lap.get("maxHR") is not None else None,
                    "avg_cadence": lap.get("averageRunCadence"),
                    "avg_power": lap.get("averagePower"),
                    "elevation_gain": lap.get("elevationGain"),
                    "start_time": lap.get("startTimeGMT"),
                }
                for i, (lap, kind) in enumerate(zip(laps, kinds))
            ],
            "activity_id,split_index",
        )
        written += 1

    return written


def _sync_evaluations(client: Garmin, user_id: str, activities: list[dict]) -> int:
    """Hämta Alices egen "Känsla"/"Upplevd ansträngning"-skattning per pass
    (Garmin Connect-appens "Utvärdering", inte klockans egna beräkningar).

    Ersätter den dagliga incheckningen (diary_entries.feeling/rpe, se
    migration 20260812100000_garmin_feel_rpe.sql) som källa till subjektiv
    känsla/ansträngning — incheckningen fylldes i för sällan för att ge
    meningsfull data, medan den här skattningen redan görs i Garmin-appen
    efter varje pass.

    Samma anropstak och mönster som _sync_splits: ett Garmin-anrop per pass,
    nyast först, historik hämtas separat med
    scripts/backfill_garmin_feel_rpe.py.
    """
    candidates = [a for a in activities if a.get("activityId") is not None]
    if not candidates:
        return 0

    candidates.sort(key=lambda a: a.get("startTimeGMT") or "", reverse=True)
    candidates = candidates[:EVALUATIONS_PER_SYNC]

    external_ids = [str(a["activityId"]) for a in candidates]
    rows = _sb_select(
        "activities",
        "id,external_id,garmin_feel,garmin_rpe",
        {"user_id": f"eq.{user_id}", "external_id": f"in.({','.join(external_ids)})"},
    )
    by_external = {r["external_id"]: r for r in rows}

    written = 0
    for activity in candidates:
        row = by_external.get(str(activity["activityId"]))
        # Redan ifyllt (eller aktivitetsraden saknas av annan anledning) —
        # hoppa över så upprepade synkar inte gör om jobbet mot Garmin.
        if not row or row.get("garmin_feel") is not None or row.get("garmin_rpe") is not None:
            continue
        try:
            evaluation = client.get_activity_evaluation(activity["activityId"])
        except Exception:
            continue

        summary = (evaluation or {}).get("summaryDTO") or {}
        feel = _map_garmin_feel(summary.get("directWorkoutFeel"))
        rpe = _map_garmin_rpe(summary.get("directWorkoutRpe"))
        if feel is None and rpe is None:
            continue

        _sb_patch("activities", row["id"], {"garmin_feel": feel, "garmin_rpe": rpe})
        written += 1

    return written


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

    # Varvdata efter att aktiviteterna sparats — den behöver deras databas-id.
    try:
        split_count = _sync_splits(client, user_id, activities)
    except Exception:
        # Varvdata är sekundärt och får aldrig fälla synken.
        split_count = 0

    # Känsla/ansträngning, samma resonemang — sekundärt mot aktiviteterna.
    try:
        evaluation_count = _sync_evaluations(client, user_id, activities)
    except Exception:
        evaluation_count = 0

    sleep_days = FIRST_SLEEP_SYNC_DAYS if is_first_sync else SLEEP_SYNC_DAYS
    sleep_count = _sync_sleep(client, user_id, sleep_days)

    # Spara ev. förnyad token (garth roterar refresh-token vid användning).
    _sb_upsert("garmin_tokens", [{"user_id": user_id, "token": client.garth.dumps()}], "user_id")
    _mark_connection(user_id, "connected", None, synced=True)
    return {
        "user_id": user_id,
        "ok": True,
        "count": len(activities),
        "sleep_days": sleep_count,
        "split_activities": split_count,
        "evaluated_activities": evaluation_count,
    }


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


