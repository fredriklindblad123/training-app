"""
Vercel Python-funktion (FastAPI/ASGI) för multi-user Garmin-synk och
PDF-dagboksimport.

Endpoints:
  POST /api/garmin/login  - ansluter ett Garmin-konto till en app-användare.
  POST /api/garmin/sync   - synkar aktiviteter, antingen för en specifik
                             användare (on-demand, "Synka nu"-knappen) eller
                             för alla anslutna användare (schemalagd cron).
  POST /api/diary/import  - tolkar en uppladdad PDF-träningsdagbok med
                             Claude och fyller i diary_entries per datum.

Skyddas av tre separata mekanismer (miljövariabler):
  INTERNAL_API_SECRET - delas bara med vår egen Next.js-server (server
                         actions), så att ingen utomstående kan trigga
                         inloggning/synk åt en godtycklig user_id.
  CRON_SECRET          - Vercel skickar automatiskt "Authorization: Bearer
                         <CRON_SECRET>" på schemalagda anrop, se vercel.json.
  Supabase-sessionstoken - /api/diary/import anropas direkt av webbläsaren
                         (filuppladdning), så den verifierar istället den
                         inloggade användarens egen Supabase-token.

Bygger vidare på samma Garmin-integration som scripts/sync_garmin.py
(garminconnect/garth) - se docs/garmin-api.md för bakgrund och kända
begränsningar hos det inofficiella biblioteket.
"""

import asyncio
import base64
import io
import os
from datetime import date, datetime, timedelta, timezone
from typing import List, Literal, Optional

import requests
from anthropic import AsyncAnthropic
from fastapi import FastAPI, Request, UploadFile, File, Form
from fastapi.responses import JSONResponse
from garminconnect import Garmin, GarminConnectAuthenticationError
from pydantic import BaseModel

app = FastAPI()

SUPABASE_URL = os.environ["SUPABASE_URL"]
SERVICE_KEY = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
ANON_KEY = os.environ.get("NEXT_PUBLIC_SUPABASE_ANON_KEY")
INTERNAL_SECRET = os.environ.get("INTERNAL_API_SECRET")
CRON_SECRET = os.environ.get("CRON_SECRET")
ANTHROPIC_API_KEY = os.environ.get("ANTHROPIC_API_KEY")

SYNC_DAYS = 7  # hur långt bakåt en vanlig synk (cron/upprepad "Synka nu") tittar
FIRST_SYNC_DAYS = 365  # hur långt bakåt den allra första synken för en användare tittar

# Sömn hämtas en dag per API-anrop, till skillnad från aktiviteter som kommer
# i ett svep. Fönstret hålls därför kort — 365 anrop skulle ta minuter och
# nästan säkert trigga Garmins rate-limiting (se docs/garmin-api.md).
SLEEP_SYNC_DAYS = 7
FIRST_SLEEP_SYNC_DAYS = 30

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


def _authenticated_user_id(request: Request) -> Optional[str]:
    """Verifierar en Supabase-sessionstoken (skickad av webbläsaren direkt,
    inte via vår Next.js-server) och returnerar den inloggade
    användarens id, eller None om token saknas/är ogiltig.

    Används av /api/diary/import, som webbläsaren anropar direkt vid
    filuppladdning (för att slippa Next.js Server Actions body-size-gräns).
    Vi litar aldrig på en klient-angiven user_id — den hämtas alltid från
    Supabase utifrån token:en.
    """
    auth_header = request.headers.get("authorization", "")
    if not auth_header.startswith("Bearer ") or not ANON_KEY:
        return None
    token = auth_header.removeprefix("Bearer ")
    try:
        resp = requests.get(
            f"{SUPABASE_URL}/auth/v1/user",
            headers={"Authorization": f"Bearer {token}", "apikey": ANON_KEY},
            timeout=15,
        )
        if not resp.ok:
            return None
        return resp.json().get("id")
    except Exception:
        return None


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


# --- PDF-dagboksimport --------------------------------------------------
# En pappers-/PDF-träningsdagbok (t.ex. FIG:s mall) har en tabell: rader =
# veckonummer, kolumner = veckodag. Idrottarens egna kommentarer är
# färgkodade (grönt=bra, rosa=mindre bra) och skiljs från tränarens
# (blått=kom-ihåg, rött=undvik). Ren textextraktion från en PDF tappar all
# färginformation och gör det nästan omöjligt att skilja de tre delarna åt
# tillförlitligt — Claude läser däremot PDF-sidor som bilder och kan se
# färgerna direkt, vilket är varför vi använder Anthropic API här istället
# för en regelbaserad tolkare.

DIARY_EXTRACTION_PROMPT = """\
Det här är en scannad/PDF-baserad träningsdagbok i tabellform. Varje rad \
börjar med ett veckonummer (kolumnen "V."), och därefter en kolumn per \
veckodag (Måndag till Söndag).

I varje dags cell kan det finnas flera olika sorters text, ofta \
färgkodade:
- Svart text: själva träningsloggen (uppvärmning, intervaller, distans, \
  tempo, tider) — detta är sessionens faktabeskrivning.
- Grön eller rosa/magenta text: idrottarens EGEN kommentar/känsla efter \
  passet (grönt = positivt, rosa = mindre bra/skada/motivation).
- Blå eller röd text (oftast högst upp i veckans rad, en gång per vecka \
  snarare än per dag): TRÄNARENS kommentar till idrottaren (blått = kom \
  ihåg, rött = undvik). Om en tränarkommentar står i en enskild dags-cell, \
  koppla den till den dagen; om den står lösryckt för hela veckan (t.ex. i \
  Måndagscellen men avser hela veckan), koppla den till veckans första dag \
  med faktiskt träningsinnehåll.

Extrahera EN post per dag som har NÅGOT innehåll (även bara "Vila" eller \
"Sjuk" räknas, men hoppa över helt tomma celler). För varje post, ange:
- week: veckonumret (heltal, från "V."-kolumnen)
- weekday: 1 för måndag, 2 för tisdag, ... 7 för söndag (ISO-veckodag)
- day_type: "training" om det finns ett genomfört pass, "rest" om det bara \
  står vila/ledigt, "sick" vid sjukdom, "injured" vid skada. Använd null om \
  osäkert.
- session_log: den svarta faktatexten om träningen (uppvärmning, \
  intervaller, tider, distans) ordagrant eller nästan ordagrant. Null om \
  det inte finns någon träningslogg (t.ex. bara "Vila").
- athlete_comment: idrottarens egen gröna/rosa kommentar, ordagrant. Null \
  om ingen sådan finns.
- coach_comment: tränarens blå/röda kommentar, ordagrant. Null om ingen \
  sådan finns.

Hoppa över rader/celler som bara innehåller schemainformation utan \
koppling till träning (skollov-rubriker utan innehåll, lovrubriker utan \
pass, etc) om de är helt tomma på träningsdata.

Detta är ett UTDRAG (vissa sidor) ur ett större dokument, inte hela \
dagboken. Läs igenom alla sidor i just detta utdrag och extrahera alla \
veckor/dagar du kan se fullständigt. Om en veckorad verkar avklippt eller \
ofullständig i det här utdraget (t.ex. bara delvis synlig längst upp eller \
längst ner), hoppa över den raden helt istället för att gissa — den \
kommer att täckas av ett annat utdrag.
"""


class DiaryDayEntry(BaseModel):
    week: int
    weekday: int
    day_type: Optional[Literal["training", "rest", "sick", "injured"]] = None
    session_log: Optional[str] = None
    athlete_comment: Optional[str] = None
    coach_comment: Optional[str] = None


class DiaryExtraction(BaseModel):
    entries: List[DiaryDayEntry]


def _week_to_date(week: int, weekday: int, school_year_start: int) -> Optional[str]:
    """Räknar om (veckonummer, veckodag) till ett kalenderdatum.

    Läsår spänner över årsskiftet: veckor efter sommaren (> 26) hör till
    school_year_start, veckor på våren (<= 26) hör till school_year_start + 1.
    """
    if not (1 <= week <= 53) or not (1 <= weekday <= 7):
        return None
    year = school_year_start if week > 26 else school_year_start + 1
    try:
        return date.fromisocalendar(year, week, weekday).isoformat()
    except ValueError:
        return None


# En hel läsårsdagbok i ett enda Claude-anrop blåser antingen förbi
# Anthropic SDK:ns egen "streaming krävs för anrop över ~10 min"-spärr,
# eller (om den ändå gick igenom) Vercels hårda 5-minuters-gräns för
# serverless-funktioner på gratisplanen. Lösningen är att dela PDF:en i
# mindre sidgrupper och köra ett snabbare, mindre anrop per grupp.
# Färre sidor per grupp + högre max_tokens ger gott om utrymme kvar även
# för väldigt textrika veckor (vissa dagsceller i den här sortens dagbok
# är flera hundra ord), så svaret inte kapas mitt i JSON:en
# (stop_reason="max_tokens" ger parsed_output=None, inte ett tydligt fel).
PAGES_PER_CHUNK = 4
CHUNK_MAX_TOKENS = 16000


def _split_pdf_pages(pdf_bytes: bytes, pages_per_chunk: int) -> list[bytes]:
    from pypdf import PdfReader, PdfWriter

    reader = PdfReader(io.BytesIO(pdf_bytes))
    chunks: list[bytes] = []
    for start in range(0, len(reader.pages), pages_per_chunk):
        writer = PdfWriter()
        for page in reader.pages[start : start + pages_per_chunk]:
            writer.add_page(page)
        buf = io.BytesIO()
        writer.write(buf)
        chunks.append(buf.getvalue())
    return chunks


async def _extract_diary_chunk(
    client: AsyncAnthropic, chunk_bytes: bytes
) -> List[DiaryDayEntry]:
    chunk_b64 = base64.standard_b64encode(chunk_bytes).decode("utf-8")
    response = await client.messages.parse(
        model="claude-sonnet-5",
        max_tokens=CHUNK_MAX_TOKENS,
        messages=[
            {
                "role": "user",
                "content": [
                    {
                        "type": "document",
                        "source": {
                            "type": "base64",
                            "media_type": "application/pdf",
                            "data": chunk_b64,
                        },
                    },
                    {"type": "text", "text": DIARY_EXTRACTION_PROMPT},
                ],
            }
        ],
        output_format=DiaryExtraction,
    )
    if response.parsed_output is None:
        # T.ex. stop_reason="max_tokens" (svaret kapades mitt i JSON:en) eller
        # "refusal" — logga den faktiska orsaken istället för ett kryptiskt
        # AttributeError längre upp i kedjan.
        raise ValueError(
            f"parsed_output saknas, stop_reason={response.stop_reason!r}"
        )
    return response.parsed_output.entries


async def _extract_diary_chunk_safe(
    client: AsyncAnthropic, chunk_bytes: bytes
) -> List[DiaryDayEntry]:
    """Som _extract_diary_chunk, men sväljer fel per sidgrupp — en trasig
    grupp ska inte fälla hela importen när alla körs parallellt."""
    try:
        return await _extract_diary_chunk(client, chunk_bytes)
    except Exception as e:
        # Skrivs till Vercels runtime-loggar (`vercel logs`) — utan detta
        # försvinner den faktiska felorsaken helt när felet sväljs här.
        print(f"[diary_import] sidgrupp misslyckades: {type(e).__name__}: {e}")
        return []


@app.post("/api/diary/import")
async def diary_import(
    request: Request,
    file: UploadFile = File(...),
    school_year_start: int = Form(...),
):
    user_id = _authenticated_user_id(request)
    if not user_id:
        return JSONResponse({"error": "unauthorized"}, status_code=401)

    if not ANTHROPIC_API_KEY:
        return JSONResponse(
            {"error": "ANTHROPIC_API_KEY är inte konfigurerad på servern"}, status_code=500
        )

    pdf_bytes = await file.read()
    try:
        chunks = _split_pdf_pages(pdf_bytes, PAGES_PER_CHUNK)
    except Exception as e:
        return JSONResponse({"error": f"Kunde inte läsa PDF:en: {e}"}, status_code=400)

    print(f"[diary_import] {len(chunks)} sidgrupper (à {PAGES_PER_CHUNK} sidor)")

    client = AsyncAnthropic(api_key=ANTHROPIC_API_KEY)
    # Kör alla sidgrupper parallellt istället för i sekvens — annars blir
    # den sammanlagda väntetiden lätt för lång för Vercels körtidsgräns.
    chunk_results = await asyncio.gather(
        *[_extract_diary_chunk_safe(client, c) for c in chunks]
    )

    for i, entries in enumerate(chunk_results):
        weeks_seen = sorted({e.week for e in entries})
        print(f"[diary_import] chunk {i}: {len(entries)} poster, veckor={weeks_seen}")

    entries_by_key: dict[tuple[int, int], DiaryDayEntry] = {}
    chunk_errors = sum(1 for r in chunk_results if not r)
    for entries in chunk_results:
        for entry in entries:
            entries_by_key[(entry.week, entry.weekday)] = entry

    print(f"[diary_import] {len(entries_by_key)} unika (vecka, veckodag) efter sammanslagning")

    if not entries_by_key and chunk_errors > 0:
        return JSONResponse(
            {"error": f"Kunde inte tolka PDF:en (alla {chunk_errors} delar misslyckades)"},
            status_code=502,
        )

    rows = []
    skipped = 0
    for entry in entries_by_key.values():
        entry_date = _week_to_date(entry.week, entry.weekday, school_year_start)
        if not entry_date:
            skipped += 1
            continue
        rows.append(
            {
                "user_id": user_id,
                "entry_date": entry_date,
                "day_type": entry.day_type,
                "session_log": entry.session_log,
                "notes": entry.athlete_comment,
                "coach_notes": entry.coach_comment,
            }
        )

    if rows:
        # Supabase REST har en gräns på antal rader per upsert-anrop — dela
        # upp i batchar för att vara säker även för ett helt läsår.
        for i in range(0, len(rows), 200):
            _sb_upsert("diary_entries", rows[i : i + 200], "user_id,entry_date")

    return JSONResponse(
        {"ok": True, "imported": len(rows), "skipped": skipped, "chunk_errors": chunk_errors}
    )
