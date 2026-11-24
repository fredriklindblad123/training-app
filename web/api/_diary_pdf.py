"""
Tolkar Alices träningsdagbok (PDF) till en post per datum (2026-11-24).

Utbruten ur scripts/import_diary_tone.py så att appen kan ta emot dagboken
direkt (POST /api/diary/preview och /api/diary/import i index.py). Samma
läsning av rutnätet och färgerna — se skriptets dokumentation för varför
kolumnerna läses ur tabellens lodräta linjer och inte ur veckodagsrubrikerna.

Dagboken följer FIG:s mall:
    svart = passet           -> session_log
    grönt = bra kommentarer  -> notes_good_text / notes_good_chars
    rosa  = mindre bra       -> notes_bad_text / notes_bad_chars
    blått = tränarens kommentarer, läses inte
Grönt och rosa i läsordning blir `notes`, som vid importerna för hand.

ÅRTALET. PDF:en har bara veckonummer. Skriptet hårdkodade årtal per filnamn;
här räknas det fram ur veckornas ordning: veckorna står nyast först, och
den nyaste veckan där löparen skrivit grönt eller rosa får det senaste år där
den inte ligger i framtiden (räknat från inskicksdagen) — skolårets mall har
kommande veckor förifyllda, så filens nyaste vecka duger inte. Datum efter
inskicksdagen tas aldrig med. Varje gång veckonumret ökar när man går bakåt i dokumentet har
ett årsskifte passerats. Ordningen kontrolleras i stället för att antas — en
fil med veckorna äldst först läses åt andra hållet.
"""

from __future__ import annotations

import collections
import datetime as dt
import re
from typing import Optional

import fitz  # PyMuPDF

GREEN, PINK, BLACK = 0x00FF00, 0xFF00FF, 0x000000


def _vsegs(p) -> list[tuple[int, float, float]]:
    out = []
    for dr in p.get_drawings():
        for it in dr["items"]:
            if it[0] == "l" and abs(it[1].x - it[2].x) < 1 and abs(it[1].y - it[2].y) > 20:
                out.append((round(it[1].x), min(it[1].y, it[2].y), max(it[1].y, it[2].y)))
            if it[0] == "re" and it[1].width < 2 and it[1].height > 20:
                out.append((round(it[1].x0), it[1].y0, it[1].y1))
    return out


def _grid_at(segs, y) -> Optional[list[int]]:
    xs = sorted({x for x, y0, y1 in segs if y0 - 2 <= y <= y1 + 2})
    return xs if len(xs) >= 9 else None


def _cells(doc) -> list[tuple[int, int, dict]]:
    """(veckoindex, veckodag 0-6, {black, green, pink, note}) i dokumentordning.
    Veckoindex räknar veckoblocken i den ordning de står, med veckonumret
    sparat i `weeks`."""
    weeks: list[int] = []
    out: dict[tuple[int, int], dict] = collections.defaultdict(
        lambda: {"black": "", "green": "", "pink": "", "note": ""}
    )
    grid = None
    for p in doc:
        segs = _vsegs(p)
        page_grid = _grid_at(segs, p.rect.height / 2) or next(
            (g for g in (_grid_at(segs, y) for y in range(0, int(p.rect.height), 20)) if g), None
        ) or grid
        if page_grid:
            grid = page_grid
        if grid is None:
            continue
        spans = []
        line_no = 0
        for b in p.get_text("dict")["blocks"]:
            for ln in b.get("lines", []):
                line_no += 1
                for s in ln["spans"]:
                    if s["text"].strip():
                        spans.append((s["bbox"][0], s["bbox"][1], s["text"], s["color"], line_no))
        hdr_y = max([y for x, y, t, c, n in spans if t.strip().lower().rstrip(".") in ("måndag", "v")] or [-1])
        wk = sorted(
            (y, int(t.strip()))
            for x, y, t, c, n in spans
            if grid[0] - 2 <= x < grid[1] and re.fullmatch(r"\d{1,2}", t.strip()) and y > hdr_y
        )
        # Ett veckoblock per veckonummer i dokumentordning. En vecka som
        # fortsätter på nästa sida har inget nytt nummer och hamnar i samma
        # block.
        page_idx = []
        for _, wn in wk:
            if not weeks or weeks[-1] != wn or page_idx:
                weeks.append(wn)
            page_idx.append(len(weeks) - 1)
        carry = len(weeks) - 1 if weeks and not wk else None
        last_line: dict = {}
        for x, y, t, c, n in spans:
            g = _grid_at(segs, y + 4) or grid
            if y <= hdr_y + 2 or x < g[1] - 1:
                continue
            col = None
            for i in range(7):
                if g[1 + i] - 1 <= x < g[2 + i] - 1:
                    col = i
            if col is None:
                continue
            cur = carry if carry is not None and carry >= 0 else None
            if wk:
                # Text ovanför sidans första veckonummer hör till veckan från
                # förra sidan.
                cur = page_idx[0] - 1 if page_idx[0] > 0 else None
                for (wy, _), idx in zip(wk, page_idx):
                    if y >= wy - 3:
                        cur = idx
            if cur is None:
                continue
            kind = "green" if c == GREEN else "pink" if c == PINK else "black" if c == BLACK else None
            if not kind:
                continue
            key = (cur, col)
            for field in [kind] + (["note"] if kind in ("green", "pink") else []):
                sep = " " if out[key][field] and last_line.get((key, field)) != n else ""
                out[key][field] += sep + t
                last_line[(key, field)] = n
    return [(w, d, v) for (w, d), v in out.items()], weeks


def _years(weeks: list[int], today: dt.date, written: set[int]) -> list[int]:
    """Ett årtal per veckoblock, se ÅRTALET överst. `written` är de
    veckoblock där löparen själv skrivit (grönt eller rosa)."""
    if not weeks:
        return []
    # Riktning: nyast först om veckonumren oftast minskar (årsskiften, där
    # 1 följer på 52, räknas inte).
    down = sum(1 for a, b in zip(weeks, weeks[1:]) if 0 < a - b < 26)
    up = sum(1 for a, b in zip(weeks, weeks[1:]) if 0 < b - a < 26)
    order = list(range(len(weeks))) if down >= up else list(range(len(weeks) - 1, -1, -1))
    # Relativa år längs dokumentet: bakåt i tiden ska veckonumret minska, och
    # ökar det har ett årsskifte passerats (vecka 1 följs av vecka 52).
    rel = [0] * len(weeks)
    r = 0
    for prev, i in zip(order, order[1:]):
        if weeks[i] > weeks[prev]:
            r -= 1
        rel[i] = r
    # Ankaret är den nyaste veckan hon skrivit i, inte den nyaste veckan i
    # filen: skolårets mall har kommande veckor förifyllda ("Påsklov",
    # "LOV"), och 26/27-filen sträcker sig till vecka 22 2027.
    anchor = next((i for i in order if i in written), order[0])
    y = today.year + 1
    while _monday(y, weeks[anchor]) > today:
        y -= 1
    shift = y - rel[anchor]
    return [shift + x for x in rel]


def _monday(year: int, week: int) -> dt.date:
    try:
        return dt.date.fromisocalendar(year, week, 1)
    except ValueError:  # vecka 53 finns inte alla år
        return dt.date.fromisocalendar(year, 52, 1)


def _clean(s: str) -> Optional[str]:
    s = re.sub(r"\s+", " ", s).strip()
    return s or None


def parse_diary_pdf(data: bytes, today: dt.date) -> list[dict]:
    """En post per datum med text, sorterad på datum:
    {entry_date, session_log, notes, notes_good_text, notes_bad_text,
     notes_good_chars, notes_bad_chars}."""
    doc = fitz.open(stream=data, filetype="pdf")
    cells, weeks = _cells(doc)
    written = {w for w, d, v in cells if v["green"].strip() or v["pink"].strip()}
    years = _years(weeks, today, written)
    by_date: dict[str, dict] = {}
    for w, d, v in cells:
        try:
            date = dt.date.fromisocalendar(years[w], weeks[w], d + 1)
        except ValueError:
            continue
        if date > today:  # förifylld mall, inte dagbok
            continue
        key = date.isoformat()
        if key in by_date:  # samma vecka två gånger i filen: första vinner
            continue
        green, pink = _clean(v["green"]), _clean(v["pink"])
        row = {
            "entry_date": key,
            "session_log": _clean(v["black"]),
            "notes": _clean(v["note"]),
            "notes_good_text": green,
            "notes_bad_text": pink,
            "notes_good_chars": len(green or ""),
            "notes_bad_chars": len(pink or ""),
        }
        if row["session_log"] or row["notes"]:
            by_date[key] = row
    return [by_date[k] for k in sorted(by_date)]
