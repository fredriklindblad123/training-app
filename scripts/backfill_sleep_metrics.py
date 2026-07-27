"""
Backfillar historisk sömn-, vilopuls- och HRV-data till daily_metrics
(P0.1 i docs/insikter-roadmap.md).

Varför scriptet finns: den löpande synken i web/api/index.py hämtar bara
7 dagar sömn bakåt (30 vid första synken), eftersom Garmins sömn-endpoint
tar *ett anrop per dag*. Ett års historik blir 365 anrop — alldeles för
långsamt för Vercels 5-minutersgräns och en nästan säker rate-limiting-
träff. Därför körs backfillen lokalt, i lugn takt, härifrån.

Utan den här historiken kan inga kombinerade insikter beräknas: dagboken
täcker aug 2025–maj 2026 medan daily_metrics bara täcker juni–juli 2026,
alltså noll överlapp (se avsnitt 1.1 i roadmapen).

Körning:
    cd ~/traningsapp
    set -a; source web/.env.local; set +a
    .venv/bin/python3 scripts/backfill_sleep_metrics.py \
        --user-id 7db90b90-... --from 2025-08-01 --to 2026-06-24

Autentisering sker med den sparade Garmin-sessionen i garmin_tokens
(samma token som web/api/index.py använder) — inget lösenord behövs.

OBS: `garth`, biblioteket bakom inloggningen, är övergivet av sin
underhållare och Garmin har ändrat sitt inloggningsflöde (se
docs/garmin-api.md). Backfillen kan därför misslyckas helt eller delvis.
Scriptet rapporterar hur många dagar som faktiskt hämtades — lita på den
siffran, inte på att kommandot returnerade utan fel.
"""

from __future__ import annotations

import argparse
import os
import sys
import time
from datetime import date, timedelta
from typing import Optional

import requests
from garminconnect import Garmin, GarminConnectAuthenticationError

# Garmin svarar med 429 om man kör för hårt. 2 sekunder mellan anrop är
# medvetet konservativt: en backfill är en engångskörning som får ta tid,
# och att bli blockerad kostar betydligt mer än att vänta.
DEFAULT_DELAY_SECONDS = 2.0

# Skriv till databasen löpande i stället för allt på slutet, så ett avbrott
# (rate-limit, nätverk, ctrl-C) inte kastar bort det som redan hämtats.
FLUSH_EVERY = 25


def sb_headers(service_key: str) -> dict:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def sb_select(supabase_url: str, service_key: str, table: str, params: dict) -> list[dict]:
    resp = requests.get(
        f"{supabase_url}/rest/v1/{table}",
        headers=sb_headers(service_key),
        params=params,
        timeout=30,
    )
    resp.raise_for_status()
    return resp.json()


def sb_upsert(supabase_url: str, service_key: str, rows: list[dict]) -> None:
    resp = requests.post(
        f"{supabase_url}/rest/v1/daily_metrics",
        headers={
            **sb_headers(service_key),
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        params={"on_conflict": "user_id,metric_date"},
        json=rows,
        timeout=60,
    )
    resp.raise_for_status()


def map_sleep(day: str, sleep: dict, user_id: str) -> Optional[dict]:
    """Samma mappning som _map_sleep i web/api/index.py. Duplicerad medvetet
    så scriptet kan köras fristående utan att importera FastAPI-appen.

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


def daterange(start: date, end: date) -> list[str]:
    days = (end - start).days
    return [(start + timedelta(days=i)).isoformat() for i in range(days + 1)]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--user-id", required=True, help="Supabase auth.users-id (UUID)")
    parser.add_argument("--from", dest="date_from", required=True, help="YYYY-MM-DD")
    parser.add_argument("--to", dest="date_to", required=True, help="YYYY-MM-DD")
    parser.add_argument(
        "--delay",
        type=float,
        default=DEFAULT_DELAY_SECONDS,
        help=f"sekunder mellan Garmin-anrop (default {DEFAULT_DELAY_SECONDS})",
    )
    parser.add_argument(
        "--force",
        action="store_true",
        help="hämta om även dagar som redan finns i daily_metrics",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="visa vad som skulle hämtas utan att anropa Garmin eller skriva",
    )
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not supabase_url or not service_key:
        sys.exit(
            "SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY måste vara satta.\n"
            "Kör: set -a; source web/.env.local; set +a"
        )

    start = date.fromisoformat(args.date_from)
    end = date.fromisoformat(args.date_to)
    if end < start:
        sys.exit("--to måste vara samma dag som eller efter --from")

    all_days = daterange(start, end)

    # Vilka dagar finns redan? Backfillen ska gå att köra om utan att göra om
    # arbete — och utan att i onödan belasta Garmin med anrop vi inte behöver.
    existing = {
        r["metric_date"]
        for r in sb_select(
            supabase_url,
            service_key,
            "daily_metrics",
            {
                "select": "metric_date",
                "user_id": f"eq.{args.user_id}",
                "metric_date": f"gte.{args.date_from}",
                "and": f"(metric_date.lte.{args.date_to})",
            },
        )
    }
    todo = all_days if args.force else [d for d in all_days if d not in existing]

    print(f"Intervall:     {args.date_from} → {args.date_to} ({len(all_days)} dagar)")
    print(f"Finns redan:   {len(existing)}")
    print(f"Att hämta:     {len(todo)}")
    if todo:
        est = len(todo) * args.delay / 60
        print(f"Uppskattad tid: ~{est:.0f} min vid {args.delay}s per anrop")

    if args.dry_run:
        print("\n--dry-run: inga Garmin-anrop, inga skrivningar.")
        if todo:
            print(f"Först: {todo[0]}   Sist: {todo[-1]}")
        return

    if not todo:
        print("\nInget att göra.")
        return

    token_rows = sb_select(
        supabase_url,
        service_key,
        "garmin_tokens",
        {"select": "token", "user_id": f"eq.{args.user_id}"},
    )
    if not token_rows:
        sys.exit(f"Ingen sparad Garmin-anslutning för user_id={args.user_id}")

    client = Garmin()
    try:
        client.garth.loads(token_rows[0]["token"])
    except Exception as e:
        sys.exit(f"Kunde inte läsa den sparade Garmin-sessionen: {e}")

    print()
    buffer: list[dict] = []
    fetched = 0
    empty = 0
    failed = 0

    def flush() -> None:
        if buffer:
            sb_upsert(supabase_url, service_key, buffer)
            buffer.clear()

    for i, day in enumerate(todo, start=1):
        try:
            sleep_data = client.get_sleep_data(day)
        except GarminConnectAuthenticationError as e:
            flush()
            sys.exit(
                f"\nGarmin-sessionen underkändes på {day}: {e}\n"
                f"Anslut Garmin på nytt i appen (/settings) och kör om.\n"
                f"Hämtade {fetched} dagar innan avbrottet."
            )
        except Exception as e:
            msg = str(e)
            # 429/Cloudflare: fortsätt inte hamra — det gör bara blockeringen
            # längre. Avbryt tydligt och spara det som redan hämtats.
            if "429" in msg or "Too Many" in msg or "blocked" in msg.lower():
                flush()
                sys.exit(
                    f"\nGarmin rate-limitar oss ({msg}) vid {day}.\n"
                    f"Hämtade {fetched} dagar innan avbrottet — vänta en stund, "
                    f"höj --delay och kör om (redan hämtade dagar hoppas över)."
                )
            failed += 1
            print(f"  {day}  fel: {type(e).__name__}: {msg[:80]}")
            time.sleep(args.delay)
            continue

        row = map_sleep(day, sleep_data or {}, args.user_id) if sleep_data else None
        if row:
            buffer.append(row)
            fetched += 1
        else:
            empty += 1

        if i % FLUSH_EVERY == 0:
            flush()
            print(f"  {i}/{len(todo)} klart ({fetched} med data, {empty} utan, {failed} fel)")

        time.sleep(args.delay)

    flush()

    print()
    print(f"KLART: {fetched} dagar med sömndata skrevs till daily_metrics.")
    print(f"       {empty} dagar saknade mätning (klockan inte använd).")
    if failed:
        print(f"       {failed} dagar misslyckades och hoppades över.")


if __name__ == "__main__":
    main()
