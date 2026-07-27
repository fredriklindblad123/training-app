"""
Rättar diary_entries.day_type för dagar som beskriver sjukdom men blivit
märkta som träning.

Bakgrund: dagboken importerades från PDF med en språkmodell som satte
day_type per dag. Den missade återkommande sjukdagar — av 25 dagar där
texten nämner sjukdom var bara 4 märkta 'sick'. Det gör att sjukperioder
inte syns i kalendern och att skade-/sjukdomsanalysen (P2.4 i
docs/insikter-roadmap.md) saknar underlag.

Regeln bygger på TRÄNINGSLOGGEN, inte på om Garmin har data den dagen.
Att sakna Garmin-pass betyder inte att man vilat: styrkepass i gymmet och
tävlingar loggas ofta bara i dagboken. Omvänt beskriver en logg som börjar
med "Vila" eller "Sjuk" en dag utan träning oavsett vad klockan säger.

Körning:
    cd ~/traningsapp
    set -a; source web/.env.local; set +a
    .venv/bin/python3 scripts/fix_diary_day_types.py --user-id ... --dry-run
"""

from __future__ import annotations

import argparse
import os
import re
import sys

import requests

# Ord som beskriver sjukdom. "ont i halsen" tas med eftersom det är hennes
# vanligaste formulering och sällan betyder något annat.
SICK_WORD = re.compile(
    r"\b(sjuk|förkyl\w*|feber|halsont|influensa|magsjuk\w*|ont i halsen)", re.IGNORECASE
)

# Dåtid: "eftersom jag varit sjuk" beskriver en dag hon tränade igen, inte
# en sjukdag. Utan det här undantaget flaggas flera bra träningsdagar.
# Håll listan smal och konkret. Ett bredare mönster ("börjat kännas") uteslöt
# en dag där hon skrev "surt när det precis hade börjat kännas lite bra igen"
# — alltså mitt i ett återfall, inte efter tillfrisknandet.
PAST_TENSE = re.compile(
    r"\b(varit sjuk|var sjuk|efter sjukdom|blivit frisk)", re.IGNORECASE
)

# Loggen inleds med att dagen inte innehöll träning.
NO_TRAINING_LOG = re.compile(r"^\s*(sjuk|vila)\b", re.IGNORECASE)

# Explicit i idrottarens egna ord.
NO_TRAINING_NOTE = re.compile(
    r"(kan inte träna|kunde inte träna|ingen träning|ingen morgonträning|"
    r"så ingen träning)", re.IGNORECASE
)

# Egen deklaration först i anteckningen: "Sjuk, ont i halsen igen".
DECLARES_SICK = re.compile(r"^\s*sjuk\b", re.IGNORECASE)


def classify(session_log: str | None, notes: str | None, has_activity: bool) -> bool:
    """Ska dagen märkas som sjukdag?"""
    log = (session_log or "").strip()
    note = (notes or "").strip()
    blob = f"{log} {note}"

    if not SICK_WORD.search(blob):
        return False
    if PAST_TENSE.search(blob):
        return False

    # Loggen säger uttryckligen sjuk/vila — starkaste signalen, gäller även
    # när Garmin har data (t.ex. en promenad som råkat spelas in).
    if NO_TRAINING_LOG.match(log):
        return True

    # Dagar med registrerad träning kräver en tydlig egen deklaration; annars
    # flaggas pass där sjukdom bara nämns i förbifarten.
    if has_activity:
        return False

    # Utan Garmin-data: tom logg, eller idrottaren säger själv att hon inte
    # kunde träna, eller inleder anteckningen med "Sjuk".
    return not log or bool(NO_TRAINING_NOTE.search(note)) or bool(DECLARES_SICK.match(note))


def sb(url: str, key: str, path: str) -> list[dict]:
    r = requests.get(f"{url}/rest/v1/{path}", headers={"apikey": key, "Authorization": f"Bearer {key}"}, timeout=60)
    r.raise_for_status()
    return r.json()


def main() -> None:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--user-id", required=True)
    p.add_argument("--dry-run", action="store_true")
    args = p.parse_args()

    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("SUPABASE_URL och SUPABASE_SERVICE_ROLE_KEY måste vara satta.")

    entries = sb(url, key, f"diary_entries?user_id=eq.{args.user_id}&select=id,entry_date,day_type,session_log,notes&order=entry_date&limit=5000")
    activities = sb(url, key, f"activities?user_id=eq.{args.user_id}&select=start_time&limit=5000")
    days_with_activity = {a["start_time"][:10] for a in activities}

    changes = []
    for e in entries:
        should_be_sick = classify(e.get("session_log"), e.get("notes"), e["entry_date"] in days_with_activity)
        if should_be_sick and e.get("day_type") != "sick":
            changes.append(e)

    print(f"Dagboksdagar:            {len(entries)}")
    print(f"Redan märkta 'sick':     {sum(1 for e in entries if e.get('day_type') == 'sick')}")
    print(f"Föreslås ändras -> sick: {len(changes)}")
    print()
    for e in changes:
        log = (e.get("session_log") or "(tom logg)").replace("\n", " ")[:60]
        note = (e.get("notes") or "").replace("\n", " ")[:60]
        print(f"  {e['entry_date']}  [{e.get('day_type')}] -> sick")
        print(f"     logg:  {log}")
        if note:
            print(f"     notes: {note}")

    if args.dry_run:
        print("\n--dry-run: inget skrivet.")
        return
    if not changes:
        print("\nInget att ändra.")
        return

    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    for e in changes:
        r = requests.patch(
            f"{url}/rest/v1/diary_entries",
            headers=headers,
            params={"id": f"eq.{e['id']}"},
            json={"day_type": "sick"},
            timeout=30,
        )
        r.raise_for_status()

    print(f"\nKLART: {len(changes)} dagar satta till 'sick'.")


if __name__ == "__main__":
    main()
