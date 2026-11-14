"""
Läser färgkodningen ur Alices träningsdagbok (PDF) per datum (2026-11-15).

Dagboken följer FIG:s mall: svart = passet, grönt = bra kommentarer,
rosa = mindre bra kommentarer, blått = coachens kommentarer (räknas inte).
Färgen följde inte med när texten importerades; den här utläsningen sparar
antal gröna och rosa tecken per datum i diary_entries.notes_good_chars /
notes_bad_chars (migration 20261115100000_diary_note_tone.sql).

VARFÖR RUTNÄTET OCH INTE RUBRIKERNA: veckodagsrubrikerna är centrerade i
kolumnerna, så text i början av en kolumn ligger till vänster om rubriken.
Att placera texten efter rubrikernas läge lade den en dag för tidigt — det var
precis den förskjutningen passloggen hösten 2025 fick vid den ursprungliga
importen. Kolumnerna läses därför ur tabellens lodräta linjer, per textrad:
en sida kan ha två tabeller med olika kolumnbredd (sida 21 i skolårsfilen).
Veckorna står nyast först, och en vecka kan fortsätta på nästa sida.

Kontroll 2026-11-15: den svarta passtexten per datum stämde med passloggen i
databasen på 330 av 359 datum; resten var stavningsrättningar och de dagar
där passloggen 2025 själv låg fel (rättade efter PDF:en). Onsdagarnas
"stabiliseringsstyrka" och fredagarnas "cirkelstyrka" (skolans schema) hamnar
på rätt veckodag.

Körning (skriver colors.json bredvid skriptet):
    python3 scripts/import_diary_tone.py "Alice 25:26.pdf" "Alice sommar 26.pdf" "Träningsdagbok sommar 2026.pdf"
Överlappande filer: första filen som har ett datum vinner.
"""
import fitz, re, json, datetime, collections, sys
GREEN, PINK, BLACK = 0x00ff00, 0xff00ff, 0x000000

def year_for(fname, week):
    if '25:26' in fname: return 2025 if week >= 30 else 2026
    return 2026

def vsegs(p):
    """Lodräta linjer som (x, y0, y1). En sida kan ha två tabeller med olika
    kolumnbredd (sida 21 i skolårsfilen), så rutnätet väljs per textrad."""
    out = []
    for dr in p.get_drawings():
        for it in dr['items']:
            if it[0] == 'l' and abs(it[1].x - it[2].x) < 1 and abs(it[1].y - it[2].y) > 20:
                out.append((round(it[1].x), min(it[1].y, it[2].y), max(it[1].y, it[2].y)))
            if it[0] == 're' and it[1].width < 2 and it[1].height > 20:
                out.append((round(it[1].x0), it[1].y0, it[1].y1))
    return out

def grid_at(segs, y):
    xs = sorted({x for x, y0, y1 in segs if y0 - 2 <= y <= y1 + 2})
    return xs if len(xs) >= 9 else None

def extract(fname):
    d = fitz.open(fname)
    # 'note' = grön och rosa text i läsordning: anteckningen som den står i
    # dokumentet, för import av själva texten.
    out = collections.defaultdict(lambda: {'green': '', 'pink': '', 'black': '', 'note': ''})
    week = None
    grid = None
    for p in d:
        segs = vsegs(p)
        # Rutnätet väljs per textrad nedan; sidans eget (eller förra sidans)
        # används bara för veckonummerkolumnen.
        page_grid = grid_at(segs, p.rect.height / 2) or next(
            (g for g in (grid_at(segs, y) for y in range(0, int(p.rect.height), 20)) if g), None) or grid
        if page_grid: grid = page_grid
        if grid is None: continue
        # grid[0] vänsterkant, grid[1] slut på V.-kolumnen, grid[1+i]..grid[2+i] = dag i
        spans = []
        line_no = 0
        for b in p.get_text('dict')['blocks']:
            for l in b.get('lines', []):
                line_no += 1
                for s in l['spans']:
                    if s['text'].strip():
                        spans.append((s['bbox'][0], s['bbox'][1], s['text'], s['color'], line_no))
        hdr_y = max([y for x, y, t, c, ln in spans if t.strip().lower().rstrip('.') in ('måndag', 'v')] or [-1])
        wk = sorted((y, int(t.strip())) for x, y, t, c, ln in spans
                    if grid[0] - 2 <= x < grid[1] and re.fullmatch(r'\d{1,2}', t.strip()) and y > hdr_y)
        last_line = {}
        for x, y, t, c, ln in spans:
            g = grid_at(segs, y + 4) or grid
            if y <= hdr_y + 2 or x < g[1] - 1: continue
            col = None
            for i in range(7):
                if g[1 + i] - 1 <= x < g[2 + i] - 1: col = i
            if col is None: continue
            cur = week
            for wy, wn in wk:
                if y >= wy - 3: cur = wn
            if cur is None: continue
            date = datetime.date.fromisocalendar(year_for(fname, cur), cur, col + 1)
            kind = 'green' if c == GREEN else 'pink' if c == PINK else 'black' if c == BLACK else None
            key = date.isoformat()
            # Nytt radbyte = mellanslag; delar av samma rad (färgbyte mitt i
            # ett ord) sätts ihop utan.
            for field in ([kind] if kind else []) + (['note'] if kind in ('green', 'pink') else []):
                sep = ' ' if out[key][field] and last_line.get((key, field)) != ln else ''
                out[key][field] += sep + t
                last_line[(key, field)] = ln
        if wk: week = wk[-1][1]
    return out

res = {}
for f in sys.argv[1:]:
    got = extract(f)
    print(f, len(got), min(got) if got else '-', max(got) if got else '-')
    for k, v in got.items():
        if k in res: continue  # en källa per datum (sommarfilerna överlappar)
        res[k] = {**v, 'src': f}
import os
json.dump(res, open(os.path.join(os.path.dirname(os.path.abspath(sys.argv[0])), 'colors.json'), 'w'), ensure_ascii=False, indent=0)
for k in ['2025-11-13', '2025-11-14', '2025-11-15', '2026-06-02', '2026-06-05', '2026-09-17']:
    if k in res: print(k, 'G', len(res[k]['green']), 'P', len(res[k]['pink']), '|', res[k]['black'][:55])
