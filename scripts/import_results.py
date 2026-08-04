"""
Importerar Alices tävlingsresultat till `competitions` + `competition_events`.

Körning:
    source .venv/bin/activate
    export SUPABASE_URL=...
    export SUPABASE_SERVICE_ROLE_KEY=...
    export RESULTS_USER_ID=...            # Supabase auth.users-id (UUID)
    python scripts/import_results.py "~/Downloads/Alice resultat.csv"          # torrkörning
    python scripts/import_results.py "~/Downloads/Alice resultat.csv" --commit # skriver

Källan är kalkylbladet med en rad per tävling och en kolumn per gren. Filen
läses som .xlsx även när den heter .csv (Excel-exporten behåller ofta fel
ändelse) — formatet sniffas på ZIP-signaturen, inte på filnamnet.

**Idempotent.** Tävlingar slås upp på (user_id, namn, datum) och grenar på
(competition_id, gren) innan något skrivs, så skriptet kan köras om varje
gång kalkylbladet uppdaterats utan att skapa dubbletter. Det är hela poängen:
underlaget kommer fyllas på med 2025–2026 års lopp, och då ska samma körning
bara lägga till det som tillkommit.

Vad skriptet medvetet INTE gör:
  - Sätter inte `priority`. Kalkylbladet vet inte vilka lopp som var A-, B-
    eller C-tävlingar, och att gissa ur namnet ("IUSM final" borde väl vara
    A?) vore att hitta på data. Allt importeras som 'C' och får justeras för
    hand där det spelar roll.
  - Tolkar inte icke-numeriska placeringar. 'Q' (kvalificerad) och
    '(lagtävling)' lämnas som null eftersom placement är integer i schemat;
    ett inledande heltal tas till vara ('3 (lagtävling)' -> 3).
"""

from __future__ import annotations

import argparse
import csv
import os
import re
import sys
import zipfile
from datetime import datetime, timedelta
from xml.etree import ElementTree as ET

import requests

NS = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
EXCEL_EPOCH = datetime(1899, 12, 30)

# Grenar som mäts i tid. Allt annat i kalkylbladet (höjd, längd, stav, kula,
# spjut, tresteg, kast med boll) är mångkampsgrenar från åren före
# specialiseringen och mäts i meter — de importeras med sin fritext men får
# inget result_seconds, se migrationen 20260803100000.
RUNNING_EVENTS = {
    "60m", "60mH", "80m", "200m", "300m", "400m", "600m", "800m",
    "3 x 800m", "4 x 800m", "1000m", "1500m", "1500m H", "1100m",
    "2000m", "2000m H", "2400m", "3000m", "4000m", "4300m", "10000m",
    "Stafett 200mx4", "Stafett 60mx5",
}

# Kalkylbladet skriver långa distanser med tusenavgränsare ("3.000m"), vilket
# annars blir en egen gren skild från "3000m" och delar upp serien i två.
EVENT_ALIASES = {
    "2.400m": "2400m", "3.000m": "3000m", "4.000m": "4000m",
    "4.300m": "4300m", "10.000m": "10000m",
}

# Kolumner som beskriver tävlingen, inte en gren. Missas någon här hamnar den
# som en påhittad "gren" i competition_events — det hände när Var och
# Placering tillkom i källfilen 2026-08.
NON_EVENT_COLUMNS = {"Tävling", "Var", "Inne/Ute", "Placering", "Datum"}


def parse_placement(text: str):
    """'3' -> 3, '3 (lagtävling)' -> 3, 'Q' -> None.

    placement är integer i schemat, men källan innehåller även kvalifikation
    ('Q') och lagtävlingsnoteringar. Ett inledande heltal tas till vara,
    resten lämnas som null hellre än att tvinga in text i en sifferkolumn."""
    m = re.match(r"\s*(\d+)", text or "")
    return int(m.group(1)) if m else None


# --------------------------------------------------------------------------
# Läsning: xlsx utan externa beroenden, annars vanlig CSV
# --------------------------------------------------------------------------

def _fmt_excel_time(fraction: float) -> str:
    total = fraction * 86400
    minutes, seconds = divmod(total, 60)
    return f"{int(minutes)}:{seconds:06.3f}".rstrip("0").rstrip(".")


def read_rows(path: str) -> list[dict]:
    with open(path, "rb") as fh:
        is_xlsx = fh.read(2) == b"PK"
    if not is_xlsx:
        with open(path, encoding="utf-8-sig", newline="") as fh:
            return list(csv.DictReader(fh))

    z = zipfile.ZipFile(path)
    shared = []
    if "xl/sharedStrings.xml" in z.namelist():
        for si in ET.fromstring(z.read("xl/sharedStrings.xml")):
            shared.append("".join(t.text or "" for t in si.iter(f"{NS}t")))

    styles = ET.fromstring(z.read("xl/styles.xml"))
    custom = {n.get("numFmtId"): n.get("formatCode", "") for n in styles.iter(f"{NS}numFmt")}
    kinds = []
    parent = styles.find(f"{NS}cellXfs")
    for xf in parent if parent is not None else []:
        fmt_id = xf.get("numFmtId", "0")
        code = custom.get(fmt_id, "").lower()
        n = int(fmt_id)
        if n in {14, 15, 16, 17, 22} or (code and re.search(r"[dmy]", code) and ":" not in code):
            kinds.append("date")
        elif n in {18, 19, 20, 21, 45, 46, 47} or ":" in code:
            kinds.append("time")
        else:
            kinds.append("num")

    grid: dict[int, dict[str, str]] = {}
    for row in ET.fromstring(z.read("xl/worksheets/sheet1.xml")).iter(f"{NS}row"):
        cells: dict[str, str] = {}
        for c in row.iter(f"{NS}c"):
            column = "".join(ch for ch in c.get("r") if ch.isalpha())
            kind_attr = c.get("t")
            if kind_attr == "inlineStr":
                node = c.find(f"{NS}is")
                cells[column] = "".join(x.text or "" for x in node.iter(f"{NS}t")) if node is not None else ""
                continue
            v = c.find(f"{NS}v")
            if v is None or v.text is None:
                continue
            if kind_attr == "s":
                cells[column] = shared[int(v.text)]
            elif kind_attr == "str":
                cells[column] = v.text
            else:
                style = int(c.get("s", "0"))
                kind = kinds[style] if style < len(kinds) else "num"
                try:
                    number = float(v.text)
                except ValueError:
                    cells[column] = v.text
                    continue
                if kind == "date":
                    cells[column] = (EXCEL_EPOCH + timedelta(days=number)).strftime("%Y-%m-%d")
                elif kind == "time":
                    cells[column] = _fmt_excel_time(number)
                else:
                    cells[column] = f"{number:g}"
        grid[int(row.get("r"))] = cells

    def index(letters: str) -> int:
        n = 0
        for ch in letters:
            n = n * 26 + (ord(ch) - 64)
        return n - 1

    ordered = sorted(grid)
    width = max((index(c) for cells in grid.values() for c in cells), default=0) + 1

    def as_list(cells: dict[str, str]) -> list[str]:
        out = [""] * width
        for column, value in cells.items():
            out[index(column)] = value
        return out

    header = as_list(grid[ordered[0]])
    return [dict(zip(header, as_list(grid[r]))) for r in ordered[1:]]


def parse_seconds(text: str) -> float | None:
    """'2:21.99' -> 141.99. Ingen gren i materialet passerar en timme, så
    formatet är alltid M:SS(.hh) — men hh:mm:ss hanteras för säkerhets skull."""
    parts = text.replace(",", ".").split(":")
    try:
        if len(parts) == 3:
            return int(parts[0]) * 3600 + int(parts[1]) * 60 + float(parts[2])
        if len(parts) == 2:
            return int(parts[0]) * 60 + float(parts[1])
    except ValueError:
        return None
    return None


# --------------------------------------------------------------------------
# Supabase (REST, service role — samma mönster som web/api/index.py)
# --------------------------------------------------------------------------

class Db:
    def __init__(self, url: str, key: str):
        self.url = url.rstrip("/")
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def get(self, table: str, params: dict) -> list[dict]:
        r = requests.get(f"{self.url}/rest/v1/{table}", headers=self.headers, params=params, timeout=30)
        r.raise_for_status()
        return r.json()

    def insert(self, table: str, rows: list[dict]) -> list[dict]:
        r = requests.post(f"{self.url}/rest/v1/{table}", headers=self.headers, json=rows, timeout=60)
        r.raise_for_status()
        return r.json()

    def patch(self, table: str, params: dict, payload: dict) -> None:
        r = requests.patch(f"{self.url}/rest/v1/{table}", headers=self.headers, params=params, json=payload, timeout=30)
        r.raise_for_status()


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("path", help="Kalkylbladet (.xlsx, även om det heter .csv)")
    ap.add_argument("--commit", action="store_true", help="Skriv till databasen (annars torrkörning)")
    args = ap.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    user_id = os.environ.get("RESULTS_USER_ID")
    if not (url and key and user_id):
        print("Saknar SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY eller RESULTS_USER_ID", file=sys.stderr)
        return 1

    rows = read_rows(os.path.expanduser(args.path))
    db = Db(url, key)

    created_comps = updated_events = created_events = skipped_comps = 0
    unparsed: list[str] = []

    for row in rows:
        name = (row.get("Tävling") or "").strip()
        date_str = (row.get("Datum") or "").strip()
        if not name or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date_str):
            continue
        venue = {"Inne": "indoor", "Ute": "outdoor"}.get((row.get("Inne/Ute") or "").strip())
        location = (row.get("Var") or "").strip() or None
        # Källan har EN placeringskolumn per tävling, medan schemat har
        # placement per gren. Placeringen sätts därför på alla grenar i
        # tävlingen. Det stämmer för de rader som har en gren (nästan alla) —
        # och den enda raden med två grenar och en placering är en lagtävling,
        # där placeringen gäller laget snarare än en enskild gren ändå.
        placement = parse_placement(row.get("Placering") or "")

        events = []
        for column, raw in row.items():
            if column in NON_EVENT_COLUMNS or not column or not (raw or "").strip():
                continue
            event = EVENT_ALIASES.get(column, column)
            value = raw.strip()
            seconds = parse_seconds(value) if event in RUNNING_EVENTS else None
            if event in RUNNING_EVENTS and seconds is None:
                unparsed.append(f"{date_str} {name} {event}={value}")
            events.append({
                "event": event, "actual_result": value,
                "result_seconds": seconds, "placement": placement,
            })

        existing = db.get("competitions", {
            "select": "id",
            "user_id": f"eq.{user_id}",
            "name": f"eq.{name}",
            "competition_date": f"eq.{date_str}",
        })

        if existing:
            comp_id = existing[0]["id"]
            skipped_comps += 1
            # Plats och bana kan ha fyllts i efter första importen — uppdatera
            # dem även på rader som redan finns, annars är omkörningen bara
            # additiv och rättar aldrig något.
            if args.commit and (location or venue):
                db.patch("competitions", {"id": f"eq.{comp_id}"},
                         {k: v for k, v in (("location", location), ("venue", venue)) if v})
        elif args.commit:
            comp_id = db.insert("competitions", [{
                "user_id": user_id, "name": name, "competition_date": date_str,
                "venue": venue, "location": location, "priority": "C",
            }])[0]["id"]
            created_comps += 1
        else:
            comp_id = None
            created_comps += 1

        for order, ev in enumerate(events):
            if comp_id is None:
                created_events += 1
                continue
            found = db.get("competition_events", {
                "select": "id", "competition_id": f"eq.{comp_id}", "event": f"eq.{ev['event']}",
            })
            payload = {**ev, "competition_id": comp_id, "sort_order": order}
            if found:
                if args.commit:
                    db.patch("competition_events", {"id": f"eq.{found[0]['id']}"}, ev)
                updated_events += 1
            else:
                if args.commit:
                    db.insert("competition_events", [payload])
                created_events += 1

    mode = "SKREV" if args.commit else "TORRKÖRNING (inget skrevs)"
    print(f"\n{mode}")
    print(f"  tävlingar:  {created_comps} nya, {skipped_comps} fanns redan")
    print(f"  grenar:     {created_events} nya, {updated_events} uppdaterade")
    if unparsed:
        print(f"  {len(unparsed)} löptider kunde inte tolkas:")
        for u in unparsed[:10]:
            print(f"    {u}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
