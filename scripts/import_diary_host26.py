"""
Importerar dagbokstext för Alice ur "Träningsdagbok sommar 2026.pdf",
2026-08-11 till 2026-09-18 (vecka 33-38).

Fortsätter där import_diary_sommar26.py slutade. Den täckte 2026-06-01 till
2026-08-10, och PDF:en överlappar alltså fram till och med vecka 32 plus
måndagen i vecka 33 — de dagarna rörs inte här. Kontrollerat mot databasen
innan skriptet skrevs: senaste dagboksrad med text var 2026-08-10.

Vissa datum har redan TOMMA diary_entries-rader (skapade av Garmin-autosynken,
session_log null) — de UPDATEas. Övriga INSERTas.

VECKODAGARNA ÄR VERIFIERADE mot Garmin-datan, inte antagna. PDF:en är ett
rutnät med en kolumn per veckodag, och textutvinningen plattar ut det till en
ström där kolumnordningen är det enda som säger vilken dag en text hör till.
Kontroll: dagboken säger "Tröskelintervaller 6x3min/90sek joggvila" på tisdagen
i vecka 38 och "15x90sek/45sek vila + 5x20sek i backe" på torsdagen. Alices
aktiviteter heter exakt så, daterade 2026-09-15 (tisdag) och 2026-09-17
(torsdag). Kolumn­ordningen stämmer alltså.

PDF:ens celler spiller dessutom över: när en text är för lång för sin ruta
hamnar slutet sist i veckans block, efter alla sju cellerna. De styckena är
hopfogade med rätt dag här utifrån vad meningen fortsätter på — t.ex. "...fick
gå" + "ner på 300 och efter dem...".

Körning:
    cd ~/traningsapp
    set -a; source web/.env.local; set +a
    .venv/bin/python3 scripts/import_diary_host26.py --user-id <alice> --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys

import requests

# (entry_date, session_log, notes, day_type)
ENTRIES = [
    # --- Vecka 33 (måndagen 2026-08-10 finns redan) ---
    ("2026-08-11", "Uppvärmning 2.6km Intervaller: 500m tröskel + 2x600m/3min vila + 2x400m + 2x300m/90sek vila, 3min vila + 2x200m/60sek vila. Nerjogg 2km. 1.49.5 - 1.47.5, 1.12.6 - 1.10.4, 53.8 - 54.4, 35.3 - 37.1", "ett okej pass, blir väldigt stum efter 400ingarna så fick gå ner på 300 och efter dem så blev jag så stum att ja inte hann återhämta mig till 200ingarna men jag håller ändå bra fart och det är absolut inget dåligt pass", "training"),
    ("2026-08-12", "Vila", None, "rest"),
    ("2026-08-13", "Uppvärmning 3km Tröskelintervaller: 3x(3+2+1min)/1min vila + 4x30sek snabbt/1min vila. Nerjogg 2km. 3.45 fart, 2.55 - 2.46", "kändes kontrollerat och bra trots bra fart, de snabbare kändes också bra", "training"),
    ("2026-08-14", "Distans: 40min 8km/5.02 tempo", "lätt i början men tyngre i slutet", "training"),
    ("2026-08-15", "Uppvärmning 3km Intervaller: 800m tröskel + 300m/7.5min vila + 3x300m/3min vila + 4x150m/1min vila. Nerjogg 2km. 46.4, höga 47, 23.3-22.5", "drog första och höll farten jag skulle, var inte så trött efter, 300ingarna va jobbiga men orkade ändå hålla samma fart, mycket syra på 150ingarna men håller ihop det bra, kändes bra men kanske inte super bra", "training"),
    ("2026-08-16", "Distans: 46min 9km/5.05 tempo", "kändes bra förutom att jag fick ganska ont i magen", "training"),

    # --- Vecka 34 ---
    ("2026-08-17", "Uppvärmning 3.3km Intervaller: 10x400m/90sek vila med tre häckar. Nedjogg 2km. Mellan 1.23 och 1.18, flesta på 1.21, gick snabbare och snabbare", "kändes bra! skulle ha lite snabbare än sist jag körde detta pass och det hade jag ändå. Skulle kanske kunnat springa lite snabbare från början idag också för hade mycket energi kvar i slutet. Men det kändes som att de skulle bli jobbigare än efter typ 5. Fick draghjälp av Nike från tredje intervallen. Fick ha häckarna på bana två så blev lite orytmiskt men tycker ändå jag tog de allra flesta häckarna bra!", "training"),
    ("2026-08-18", "Distans: 32min 6.5km/4.51tempo", "kändes lätt och bra!", "training"),
    ("2026-08-19", "Vila", None, "rest"),
    ("2026-08-20", "Uppvärmning 3km Intervaller: 3x400m + 3x300m + 5x200m/2min vila. Nerjogg 2km. 74sek, 54sek, låga 34 - höga 32", "kändes väldigt bra! Skulle ha 1500-fart på de längre och trycka lite på 200ingarna, kändes som att jag bara flöt på de längre och kändes lätt även på 200ingarna även om ja tryckte på lite", "training"),
    ("2026-08-21", "Vila", None, "rest"),
    ("2026-08-22", "Distans: 35min 6.8km/5.10 tempo + 4x100, stegring", "okej känsla", "training"),
    ("2026-08-23", "Jogg: 15min 2.8km/5.27tempo", "helt ok", "training"),

    # --- Vecka 35 ---
    ("2026-08-24", "Uppvärmning 2.2km Folksam GP Göteborg 1500m: 4.42.72 sb. Nerjogg 2km", "Ändå nöjd med loppet idag! Öppnar perfekt idag men andra varvet går alldeles för långsamt för snabbare tider (78 sek) men vågade inte riktigt gå om. Men med ca 600 går jag om och drar på farten och får göra jobbet själv, har ändå 72 sista varvet trots att jag blir omspurtad på slutet. Men överlag en bra känsla och kände mig stark och helt klart bästa 1500-loppet i år! Känns även som att det finns mer med tanke på att andra varvet var så långsamt!", "training"),
    ("2026-08-25", "Distans: 36min 7km/5.06tempo", "lite tungt men inte så konstigt", "training"),
    ("2026-08-26", "Uppvärmning 3km Intervaller: 10x200m/90sek vila. Nerjogg 2km. 35-32, snabbare och snabbare", "de första var sega men sen kom jag in i det och då kändes det ändå bra! Var ju inget maxpass men var skönt att köra igenom benen", "training"),
    ("2026-08-27", "Vila", None, "rest"),
    ("2026-08-28", "Jogg: 19min 3.9km/5.00tempo. Rörlighet, löpskolning, stegringar, foamroller", "Kändes lätt och bra!", "training"),
    ("2026-08-29", "Uppvärmning 2km U-finnkampen 2000mh: 7.18. Nerjogg 5min", "Så tråkigt att de inte funka idag. Seg känsla hela loppet trots att det gick långsamt från start. Vattengravarna fungerade dock bra. Men hade liksom ingen kraft i benen vilket känns synd eftersom träningen känts väldigt bra de senaste så trodde verkligen att jag hade något bra i mig. Men det var en superrolig tävling! Började få ont i halsen på kvällen", "training"),
    # Förkylningen börjar. day_type "sick" och inte "rest": kontinuiteten (K6)
    # räknar sjukdagar som avbrott, och en vilodag av sjukdom är inte samma sak
    # som en planerad vilodag.
    ("2026-08-30", "Vila, förkyld", None, "sick"),

    # --- Vecka 36: sjuk hela veckan ---
    ("2026-08-31", "Vila, förkyld", None, "sick"),
    ("2026-09-01", "Vila, förkyld", None, "sick"),
    ("2026-09-02", "Vila, förkyld", None, "sick"),
    ("2026-09-03", "Vila", None, "rest"),
    ("2026-09-04", "Morgonträningar: tävlingar, inget jobbigt", None, "training"),
    ("2026-09-05", "Vila", None, "rest"),
    ("2026-09-06", "Vila", None, "rest"),

    # --- Vecka 37: försiktig återstart ---
    ("2026-09-07", "Vila", None, "rest"),
    ("2026-09-08", "Vila", None, "rest"),
    ("2026-09-09", "Vila", None, "rest"),
    ("2026-09-10", "Distans: 31min 6km/5.10 tempo, stretch", "kändes ändå bra men tog det väldigt lugnt. Skönt att vara igång lite igen", "training"),
    ("2026-09-11", "Vila", None, "rest"),
    ("2026-09-12", "Distans: 55min 10km/5.32 tempo i Änggårdsbergen, stretch", "de kändes lätt och bra hela vägen trots att det är väldigt kuperat!", "training"),
    ("2026-09-13", "Rörlighet/styrka: 5min cykel uppvärmning, rörlighet, styrka ben, stretch, foamroller", None, "training"),

    # --- Vecka 38 (till och med fredag 2026-09-18) ---
    ("2026-09-14", "Distans: 40min 8km/4.57 tempo + bålstyrka", "lite sämre känsla, kändes som att jag hade hög puls men benen kändes fräscha", "training"),
    ("2026-09-15", "Uppvärmning 3km Tröskelintervaller: 6x3min/90sek joggvila, 3.54-3.59 tempo. Nerjogg 2km. Styrka med gummiband", "skönt att vara igång, kändes väl ok men lite segt och fick väldigt ont i magen i slutet men det var mest på nerjoggningen och sista intervallen. Kändes även som jag hade hög puls", "training"),
    ("2026-09-16", "Distans: 35min 7.1km/4.56 tempo. Helkropp med medicinboll", "kändes ändå ganska bra", "training"),
    ("2026-09-17", "Uppvärmning 3km Tröskelintervaller: 15x90sek/45sek vila + 5x20sek i backe, gå/jogg ner. Ca 3.45 fart, ca 3.20 i backen. Nerjogg 2km. Styrka med gummiband", "bättre känsla idag, flöt på bra och kändes ganska lätt, kändes även som att jag kunde trycka på bra i backen utan att det blev jättejobbigt", "training"),
    ("2026-09-18", "Morgonträning: cirkelstyrka blandat: medicinboll, bål, ben, häckgång", None, "training"),
]


def sb_get(url: str, key: str, path: str) -> list[dict]:
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

    first, last = ENTRIES[0][0], ENTRIES[-1][0]

    # Hämtas bara för skriptets EGET spann. En bredare hämtning hade kunnat
    # matcha rader utanför och riskerat att skriva över den tidigare importen.
    existing = sb_get(
        url, key,
        f"diary_entries?user_id=eq.{args.user_id}"
        f"&entry_date=gte.{first}&entry_date=lte.{last}&select=id,entry_date,session_log",
    )
    existing_by_date = {e["entry_date"]: e for e in existing}

    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    n_insert = n_update = n_skip = 0

    for entry_date, session_log, notes, day_type in ENTRIES:
        row = existing_by_date.get(entry_date)

        # En rad som REDAN har text rörs inte. Autosynken skapar tomma rader,
        # och dem fyller vi på; men fanns det text där är den skriven av någon
        # och ska inte skrivas över av en import.
        if row and (row.get("session_log") or "").strip():
            n_skip += 1
            print(f"HOPPAR  {entry_date}: har redan text")
            continue

        payload = {
            "entry_date": entry_date,
            "session_log": session_log,
            "notes": notes,
            "day_type": day_type,
        }

        if row:
            n_update += 1
            action = f"UPDATE  {entry_date}"
        else:
            n_insert += 1
            action = f"INSERT  {entry_date}"

        if args.dry_run:
            print(f"{action}: [{day_type}] {(session_log or '')[:70]}")
            continue

        if row:
            r = requests.patch(
                f"{url}/rest/v1/diary_entries",
                headers=headers,
                params={"id": f"eq.{row['id']}"},
                json=payload,
                timeout=30,
            )
        else:
            payload["user_id"] = args.user_id
            r = requests.post(
                f"{url}/rest/v1/diary_entries",
                headers=headers,
                json=payload,
                timeout=30,
            )
        r.raise_for_status()

    print(
        f"\n{'(dry-run) ' if args.dry_run else ''}Klart: {n_insert} nya, {n_update} uppdaterade, "
        f"{n_skip} hoppade. Spann {first} - {last} ({len(ENTRIES)} dagar)."
    )


if __name__ == "__main__":
    main()
