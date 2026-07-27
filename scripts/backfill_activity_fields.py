"""
Fyller retroaktivt i de nya activities-kolumnerna från P0.3
(docs/insikter-roadmap.md) genom att läsa raw_data som redan ligger i
Supabase — inga Garmin-anrop görs.

Bakgrund: `activities.raw_data` (jsonb) innehåller sedan tidigare en massa
Garmin-fält (avgPower, avgGroundContactTime, avgGradeAdjustedSpeed, ...) som
aldrig mappats till egna kolumner. Migrationen
supabase/migrations/20260726100000_activity_raw_data_fields.sql lägger till
kolumnerna; det här skriptet fyller dem för alla befintliga rader.

Körning:
    set -a; source web/.env.local; set +a
    .venv/bin/python3 scripts/backfill_activity_fields.py --dry-run
    .venv/bin/python3 scripts/backfill_activity_fields.py

Viktigt: skrivningarna görs som en bulk-UPSERT (on_conflict=id) i batchar,
inte en rad i taget. Payloaden innehåller ENDAST de nya P0.3-kolumnerna plus
de fält som måste följa med rakt igenom oförändrade för att PostgREST-upserten
ska klara NOT NULL-constraints på "insert"-grenen (id, user_id, external_id,
start_time) — aldrig category eller category_source. activities har en
BEFORE UPDATE-trigger (set_activity_category) som annars skulle kunna skriva
över category; eftersom category_source, activity_type, name,
training_effect_label, distance_meters, duration_seconds och raw_data alla
lämnas orörda i payloaden räknar triggern om exakt samma category som redan
låg där, så beteendet är opåverkat.
"""

from __future__ import annotations

import argparse
import os
import sys
from typing import Optional

import requests

PAGE_SIZE = 1000  # PostgREST-tak per anrop, oavsett hur många rader tabellen har
BATCH_SIZE = 200  # rader per bulk-upsert-anrop

# NOT NULL-kolumner utan default på activities. Måste följa med oförändrade i
# varje upsert-rad, annars stupar upsertens "insert"-gren på en NOT NULL-
# constraint innan den ens hinner konflikthantera mot befintlig rad.
PASSTHROUGH_COLUMNS = ("user_id", "external_id", "start_time")

# Käll-fält i raw_data -> ny kolumn. Värdet är antingen None (rakt igenom)
# eller en funktion som konverterar Garmins råvärde till kolumnens format.
NUMERIC_FIELDS = {
    "avg_power": "avgPower",
    "norm_power": "normPower",
    "avg_ground_contact_time": "avgGroundContactTime",
    "avg_vertical_oscillation": "avgVerticalOscillation",
    "avg_vertical_ratio": "avgVerticalRatio",
    "fastest_1k_seconds": "fastestSplit_1000",
}
ROUNDED_INT_FIELDS = {
    "body_battery_drain": "differenceBodyBattery",
    "moderate_intensity_minutes": "moderateIntensityMinutes",
    "vigorous_intensity_minutes": "vigorousIntensityMinutes",
}
# Specialfall: avgGradeAdjustedSpeed är m/s och måste konverteras till
# sek/km, precis som avg_pace_seconds_per_km görs i web/api/index.py.
GAP_COLUMN = "avg_gap_seconds_per_km"
GAP_SOURCE_FIELD = "avgGradeAdjustedSpeed"

ALL_COLUMNS = (
    list(NUMERIC_FIELDS) + list(ROUNDED_INT_FIELDS) + [GAP_COLUMN]
)


def pace_seconds_per_km(speed_m_per_s: Optional[float]) -> Optional[float]:
    """Konvertera m/s till sek/km. Samma formel som _pace_seconds_per_km i
    web/api/index.py — duplicerad här medvetet så skriptet kan köras
    fristående utan att importera FastAPI-appen."""
    if not speed_m_per_s:
        return None
    return 1000 / speed_m_per_s


def build_update(row: dict) -> Optional[dict]:
    """Bygg en upsert-payload för en rad utifrån dess raw_data.

    Returnerar None om raw_data saknas helt eller inte innehåller något av
    de nya fälten (inget att uppdatera för den här raden).

    Alla ALL_COLUMNS-nycklar sätts alltid explicit (även till None när
    källfältet saknas i raw_data) — annars skulle olika rader i samma batch
    ha olika nyckeluppsättningar, och PostgREST bulk-upsert bygger sin
    kolumnlista som unionen av alla nycklar i batchen. En rad som saknar en
    nyckel skulle då få den kolumnen satt till NULL av misstag (EXCLUDED.col
    blir NULL för rader utan nyckeln). Genom att alltid inkludera samma
    nyckeluppsättning blir NULL alltid ett medvetet val (fältet saknas
    verkligen i raw_data), aldrig en bieffekt av batchningen.
    """
    raw = row.get("raw_data") or {}
    if not raw:
        return None

    update: dict = {}
    any_present = False

    for column, source_field in NUMERIC_FIELDS.items():
        value = raw.get(source_field)
        update[column] = value
        any_present = any_present or value is not None

    for column, source_field in ROUNDED_INT_FIELDS.items():
        value = raw.get(source_field)
        update[column] = round(value) if value is not None else None
        any_present = any_present or value is not None

    gap = pace_seconds_per_km(raw.get(GAP_SOURCE_FIELD))
    update[GAP_COLUMN] = gap
    any_present = any_present or gap is not None

    if not any_present:
        return None

    update["id"] = row["id"]
    for col in PASSTHROUGH_COLUMNS:
        update[col] = row[col]
    return update


def sb_headers(service_key: str) -> dict:
    return {
        "apikey": service_key,
        "Authorization": f"Bearer {service_key}",
        "Content-Type": "application/json",
    }


def fetch_all_activities(supabase_url: str, service_key: str) -> list[dict]:
    """Paginera igenom activities, PAGE_SIZE rader i taget (PostgREST-taket
    är normalt 1000, men vi hanterar det generellt oavsett tabellstorlek)."""
    rows: list[dict] = []
    offset = 0
    while True:
        resp = requests.get(
            f"{supabase_url}/rest/v1/activities",
            headers=sb_headers(service_key),
            params={
                "select": "id,user_id,external_id,start_time,raw_data",
                "order": "id",
                "limit": PAGE_SIZE,
                "offset": offset,
            },
            timeout=60,
        )
        resp.raise_for_status()
        page = resp.json()
        rows.extend(page)
        if len(page) < PAGE_SIZE:
            break
        offset += PAGE_SIZE
    return rows


def upsert_batch(supabase_url: str, service_key: str, batch: list[dict]) -> None:
    """Skriv en batch rader i ett enda anrop via PostgREST-upsert
    (on_conflict=id, merge-duplicates). Bara kolumnerna som finns i varje
    rad-dict sätts (EXCLUDED.<col> per nyckel) — category/category_source är
    aldrig med, så triggern räknar bara om samma värde den redan hade."""
    resp = requests.post(
        f"{supabase_url}/rest/v1/activities",
        headers={
            **sb_headers(service_key),
            "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        params={"on_conflict": "id"},
        json=batch,
        timeout=60,
    )
    resp.raise_for_status()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Backfilla P0.3-kolumner på activities från befintlig raw_data."
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Visa hur många rader/fält som skulle uppdateras, utan att skriva något.",
    )
    args = parser.parse_args()

    supabase_url = os.environ.get("SUPABASE_URL")
    service_key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    missing = [
        name
        for name, val in [
            ("SUPABASE_URL", supabase_url),
            ("SUPABASE_SERVICE_ROLE_KEY", service_key),
        ]
        if not val
    ]
    if missing:
        sys.exit(f"Saknar miljövariabler: {', '.join(missing)}")

    print("Hämtar aktiviteter från Supabase...")
    rows = fetch_all_activities(supabase_url, service_key)
    print(f"Hittade {len(rows)} aktiviteter totalt.")

    updates = []
    field_counts = {col: 0 for col in ALL_COLUMNS}
    for row in rows:
        update = build_update(row)
        if update is None:
            continue
        updates.append(update)
        for col in ALL_COLUMNS:
            if update.get(col) is not None:
                field_counts[col] += 1

    print(f"\n{len(updates)} av {len(rows)} rader har minst ett av de nya fälten i raw_data.")
    print("Antal rader per kolumn som skulle/kommer få ett värde:")
    for col in ALL_COLUMNS:
        print(f"  {col}: {field_counts[col]}")

    if args.dry_run:
        print("\n--dry-run: inget skrivet till databasen.")
        return

    if not updates:
        print("\nInget att uppdatera.")
        return

    print(f"\nSkriver {len(updates)} rader, i batchar om {BATCH_SIZE}...")
    written = 0
    for i in range(0, len(updates), BATCH_SIZE):
        batch = updates[i : i + BATCH_SIZE]
        upsert_batch(supabase_url, service_key, batch)
        written += len(batch)
        print(f"  ...{written}/{len(updates)} skrivna")

    print(f"\nKlart. {written} rader uppdaterade.")
    print("Antal rader per kolumn som faktiskt fick ett värde:")
    for col in ALL_COLUMNS:
        print(f"  {col}: {field_counts[col]}")


if __name__ == "__main__":
    main()
