"""
Importerar dagbokstext från "Alice sommar 26.pdf" (2026-06-01 till 2026-08-10)
till diary_entries. Manuell PDF-import sedan PDF-import-funktionen togs bort ur
appen 2026-07-26 (se commit d295b5e) — görs nu några gånger per år direkt mot
Supabase istället.

Fortsätter där "Alice 25:26.pdf" slutade (senaste dagboksinlägg med text var
2026-05-31). Vissa datum i intervallet har redan tomma diary_entries-rader
(skapade av Garmin-autosynken, rpe=6, session_log null) — de UPDATEas.
Övriga datum saknar rad helt och INSERTas.

Körning:
    cd ~/traningsapp
    set -a; source web/.env.local; set +a
    .venv/bin/python3 scripts/import_diary_sommar26.py --user-id ... --dry-run
"""

from __future__ import annotations

import argparse
import os
import sys

import requests

# (entry_date, session_log, notes, day_type)
ENTRIES = [
    ("2026-06-01", "Distans: 31min 6 km/5.15 tempo, stretch", "okej känsla men lite seg i benen från igår, foten kändes ok men lite stel", "training"),
    ("2026-06-02", "Uppvärmning 3km pendlingar rörlighet löpskolning stegringar Intervaller: 1200m tröskel /3min vila + 4x400m/1min vila 4min vila 300m + 200m + 100m /3min vila 3.45tempo på tröskel 77-78 på 400ingarna 48.7 på 300 31.5 på 200 15 på 100 nerjogg 2km. Lite lugnare för att jag tävlar på fredag, blev inte jätte trött, utan spikskor", "Kändes ändå bra även om benen känts lite sega sedan loppet. 400ingarna skulle vara lite lugnar och sen lite snabbare på de sista, men de var inte så jobbiga efterson vi hade så lång vila. Var lite halt på banan så man fick spänna sig lite i kurvan. Foten kändes lite stel fortfarande men inget som påverkade", "training"),
    ("2026-06-03", "Distans: 34min 6.6km/5.06tempo", "lite seg känsla och ganska hög puls", "training"),
    ("2026-06-04", "Vila", None, "rest"),
    ("2026-06-05", "Uppvärmning 2km pendlingar, rörlighet, löpskolning, stegringar Jessheim 1500m elit: 4.51.88 sb nerjogg 2km", "Inte nöjd med utförande eller tiden. Snabbt första varv på typ 71-72 sek men släpper sedan de framför och tappar fart, vågar inte gå med och hamnar då själv och får ta all vind och blev då svårt att hålla uppe tempot. Dog aldrig totalt och var inte jätte trött i mål. Ändå okej känsla inför och så men kanske lite segt sen under loppet. Irriterande att inte få ut något bra på tävling.", "training"),
    ("2026-06-06", "Distans: 49min 10.2km/4.48 tempo, bålstyrka", "benen kändes lätta och råkade springa lite fort, men saktade ner lite på vägen hem men ville samtidigt bara komma hem för hade ganska ont i magen", "training"),
    ("2026-06-07", "Distans: 35min 7km/4.59 tempo + fartökningar 3x45sek + 2x25 sek i 3.45/3.38 tempo", "lite segare känsla idag men ändå okej, fartöknningarna kändes ändå bra", "training"),

    ("2026-06-08", "Vila. Slog i tån, helt blå.", None, "rest"),
    ("2026-06-09", "Uppvärmning 3.2km Tröskelintervaller: 1200m/3min vila + 4x400m/45sek vila nerjogg 1.7km", "gör ont i tån, går att springa långsamt och tröskel men kunde inte köra löpskolning eller springa snabbare. Hoppas det blir bättre fort", "training"),
    ("2026-06-10", "Vila för att låta tån läka", None, "rest"),
    ("2026-06-11", "Jogg: 15min 3km/5.10tempo + 3 stegringar", "känslan va bra och gick ju att springa snabbare med tån men kändes ju lite", "training"),
    ("2026-06-12", "Uppvärmning 2km SAYO 2000mh: bröt efter 1000m nerjogg 1km", "tån påverkade tyvärr idag, tog fel ben på vattengravarna för att inte landa på den som gör ont. Kändes extra vid varje hinder och de hindret där ja bröt landade jag typ på den på något sätt. Gör liksom ont när den trycks ut. Kunde inte ens köra löpskolning på uppvärmningen men gick ändå okej när jag sprang utan hinder. Höll ändå tempot den kilometerna jag körde och hade väl runt 3.27-3.28 vilket är tempo för kvalgränsen. Så jag känner ändå att det finns något positivt att ta med sig trots att jag bröt. Var inte riktigt med i huvudet och tvekade vid hindrerna så om jag får till det på VU så kommer det förhoppningsvis bli bättre.", "training"),
    ("2026-06-13", "Vila och håller tummarna för att kunna springa imorgon", None, "rest"),
    ("2026-06-14", "Jogg 10min 1.9km/5.20tempo på förmiddagen. Uppvärmning 2km, pendlingar, rörlighet, löpskolning, stegringar. Sollentuna GP 800m: 2.15.47 pb, 3a i C-heatet. Nerjogg 2km", "Jippi så kul med ett bra lopp!! Väldigt nöjd med tiden och pb med nästan 2 sek. Blev ett jämnt lopp där jag la mig ganska långt fram i klungan, hade 1.41 på 600m så tappade inte fart sista 200 utan hade en bra spurt även om jag inte tog mig förbi Moa. Kände mig stark och tån påverka mig inte under loppet. Va me i huvudet hela vägen och tog verkligen ut mig vilket var en skön känsla. Även under senior SM-kvalgränsen med 3 hundradelars marginal. Så skönt att få till ett bra lopp efter en sämre inledning av säsongen.", "training"),

    ("2026-06-15", "Distans: 45min 9km/4.58tempo", "Kändes väldigt lätt och bra hela vägen", "training"),
    ("2026-06-16", "Uppvärmning 3.2km Tröskelintervaller: 1600m/3min vila + 10x400m/45sek vila i 3.50/3.45 tempo nerjogg 2km", "helt ok känsla. lite tungt men blev typ aldrig värre, kändes typ lika jobbigt på alla intervaller", "training"),
    ("2026-06-17", "Uppvärmning 3.2km, pendlingar, rörlighet, löpskolning, stegringar Intervaller: 1000m tröskel/3min vila + 600m/5min vila + 400m/3min vila + 6x200m/2min vila nerjogg 2km. 3.45 på tröskeln, 600: 1.43.5, 400: 66sek, 200: 32.5-31.6", "kändes ändå bra idag, speciellt på de längre, kände mig kanske inte jättesnabb på 200ingarna. Återhämtade mig väldigt snabbt efter 600ingen, blåste ganska mycket men försökte få de flesta i medvind. Hårt pass och tog ut mig mycket.", "training"),
    ("2026-06-18", "Distans: 46min 9km/5.07 tempo", "lite tungt men ändå okej känsla", "training"),
    ("2026-06-19", "Vila", None, "rest"),
    ("2026-06-20", "Kort distans: 21min 4km/5.14 tempo, 2 stegringar 15 sek", "kändes helt ok men inga toppen ben", "training"),
    ("2026-06-21", "Jogg 10min 1.8km/5.27 tempo. Uppvärmning 2km, pendlingar, rörlighet, löpskolning, stegringar. Bannister summer night 1500m: 4.47.41sb, 9a. Nerjogg 2km", "känns bra men benen är inte topp. börjar bra men med snabb inledning 52 på 300 och ca 71 på 400 men håller mig i klungan, sedan 2.27 på 800 så tappat fart men fortfarande under 4.37 fart. Börjar ta emot på 3e varvet men håller fortfarande ihop det och har kontakt med klungan men blir några onödiga taktiska missar när jag försöker gå förbi en tjej flera gånger men inte riktigt lyckas. När det är ett varv kvar har jag chans att gå under 4.40 men orkar inte alls hålla ihop det och stumnar totalt och tappar jättemycket. Den snabba öppningen straffar mig lite men tycker ändå att jag borde kunna hålla ihop det bättre än vad jag gör. Tråkigt med en tid jag inte är nöjd med men iallafall bättre än Norge. Men benen kändes inte toppen under dagen och på uppvärmningen, glömde även astmaspray men vet inte om det påverkade.", "training"),

    ("2026-06-22", "Distans: 45min 9km/5.06 tempo", "ingen toppen känsla", "training"),
    ("2026-06-23", "Uppvärmning 3km pendlingar, rörlighet, löpskolning, stegringar. Tröskelintervaller: 10x400m/1min vila med 3 häckar, 5x100m/gåvila tillbaka, vattengravar, nerjogg 2km, 3.45tempo/16.5sek", "kändes bra och kontrollerat", "training"),
    ("2026-06-24", "Distans: 30min 6km/4.59 tempo", "Kändes bra och försökte verkligen tänka på att ta det lugnt i backar och så", "training"),
    ("2026-06-25", "Vila", None, "rest"),
    ("2026-06-26", "Uppvärmning 2km Världsungdomsspelen 2000mh: bröt efter ca 1300 nerjogg 2.4km", "de va ju väldigt varmt, kändes segt, andningen funkade inte, dålig tanke. vattengravarna var bra men annars bara katastrof", "training"),
    ("2026-06-27", "Uppvärmning 2km Världsungdomsspelen 1500m: 4.44.51sb, 3a i F17. Nerjogg 2km", "mycket bättre lopp trotts värmen, var nästan 30 grader och stekande sol. kändes inte bra under loppet och hade ont i magen så blev ändå positivt överraskad av tiden. Gick om Julia med typ 200 kvar men tappade då också på Freja och Klara. Påverkades mycket av värmen och magen så snabbare tider finns", "training"),
    ("2026-06-28", "Jogg: 20min 4km/5.08 tempo", "lite segt", "training"),

    ("2026-06-29", "Distans: 40min 8km/4.56 tempo, bålstyrka", "benen kändes bra men fick väldigt ont i magen", "training"),
    ("2026-06-30", "Uppvärmning 3km intervaller: 1200m tröskel, 10x150m/1min vila. Nerjogg 2km", None, "training"),
    ("2026-07-01", "Vila", None, "rest"),
    ("2026-07-02", "Uppvärmning 3km Tröskelintervaller 2x4min + 3x(3+2+1min)/1min vila 3.52-4.09 Nerjogg 2km Plyometrics Bålstyrka", "Ingen bra känsla, fick köra själv på någon väg i Umeå och blåste och va varmt. Kändes iallafall bättre i slutet", "training"),
    ("2026-07-03", "Distans: 52min 10km/5.16 tempo", None, "training"),
    ("2026-07-04", "Uppvärmning 3km intervaller 4x400m + 4x300m + 4x200m /1min vila 3min serievila Nerjogg 2km. 75sek, 54sek, 34sek", "Tyvärr ingen superkänsla idag heller, fick verkligen kämpa för det idag men höll ändå ihop det bra även om ja hade velat springa någon sekund snabbare men var även jobbigt att hålla", "training"),
    ("2026-07-05", "Återhämtningspass: Jogg ca 1km, rörlighet, löpskolning, lätta stegringar, fotstyrka, lätt bål/rygg, stretch", None, "training"),

    ("2026-07-06", "Distans: 35min 7km/5.02 tempo, stretch", "Kändes lätt och bra idag", "training"),
    ("2026-07-07", "Jogg: 22min 4km/5.20 tempo + 3 stegringar", "ändå bra känsla inför imorgon", "training"),
    ("2026-07-08", "Uppvärmning 2km Karlstad GP 1500m: 4.50 /6a i heatet. Nerjogg 2km", "Blir lite som typ alla andra 1500-lopp i år att jag orkar tills det är ett varv kvar och sen dör jag sista varvet. Kände mig ändå starka vid 800m men sedan kändes det som att de ökade pytte lite och då är det som att jag stumnade från ingenstans, hade ändå typ 3.06 på tusen så tappade ju mycket sista varvet", "training"),
    ("2026-07-09", "Distans: 36min 7km/5.13 tempo, stretch", "okej känsla men en stel punkt i foten", "training"),
    ("2026-07-10", "Distans cykel: 55min medelpuls 135", "Kunde inte springa, gjorde för ont i foten så fick cykla men det kändes ändå bra", "training"),
    ("2026-07-11", "Cykelintervaller: 10min uppvärmning intervaller 4x4min/90sek vila + 4x2min/75sek vila + 5x45sek/90sek vila. Maxpuls 186. 10min nedvarvning", "Blev väldigt jobbigt och lyckades verkligen ta ut mig", "training"),
    ("2026-07-12", "Vattenlöpning: 5min uppvärmning, intervaller: 5x90/30 väst + 5x70/20 väst + 5x60/30 väst + 5x45/15 + 5x30/15 + 10x10/10 utan armar. Maxpuls 186. 5min nedvarvning. Bålstyrka", "Ändå ett bra alternativt pass och kom ändå upp i hög puls och blev jobbigt och känns som att jag ändå fick ut mycket av passet", "training"),

    ("2026-07-13", "Distans cykel: 65 min + 5x30/30, medelpuls 134, maxpuls 170. Rehab fot", "kollade upp foten idag men fortsatt cykel men nu med rehab", "training"),
    ("2026-07-14", "Cykel. Uppvärmning 13min. Intervaller: 6min \"tröskel\" + 2x4x1min/45sek + 10x2,5min/1min \"tröskel\" 3min serievila. Medelpuls 143, maxpuls 183. Nedvarvning 15min. Rehab fot. Styrka pilatesboll. Stretch", "ett bra pass, fick köra lite på känsla när jag skulle ha tröskelintensitet men känns ändå som att jag fick ut det jag ville av passet", "training"),
    ("2026-07-15", "Kort distans: 26min 5km/5.12 tempo", "test för foten, kändes av lite men gick absolut att springa, känslan var kanske inte toppen men aja nu är jag igång", "training"),
    ("2026-07-16", "Uppvärmning 3km Tröskelintervaller: 2x5min/90sek vila + 9x1min/40sek vila nerjogg 2km. ca 4.00? mellan 3.46-3.58", "ändå okej känsla för att typ inte sprungit på en vecka. farten på 5-minutrarna är oklar för klockan balla ur i skogen, råkade köra en för lite för tappade räkningen", "training"),
    ("2026-07-17", "Distans: 48min 9km/5.21 tempo", "helt ok känsla, gick typ i backen för att inte slita", "training"),
    ("2026-07-18", "Uppvärmning 3km Intervaller: 2x1000m + 4x600m/2min vila nerjogg 2km. 3.32, ca 2.08", "inget stämde idag, var tufft att springa själv speciellt då det var en vägg på bortre lång, hade nog ätit för lite under dagen för hade ingen energi, körde inte alla intervaller och gick mycket långsammare än det skulle", "training"),
    ("2026-07-19", "Distans: 60min 12km/5.03 tempo", "kändes faktiskt ganska bra idag", "training"),

    ("2026-07-20", "Vila", None, "rest"),
    ("2026-07-21", "Uppvärmning 3km Tröskelintervaller: 2000m/3min vila + 8x600m/1min vila nerjogg 2km. 3.48 tempo på 2000m, 2.15 på 600ingarna", "ett bra pass, kändes kontrollerat och benen kändes lätta, lite tuffare med andningen och blev kanske lite över tröskel men oavsett ett bra pass med en bra känsla", "training"),
    ("2026-07-22", "Distans 38min 7.3km/5.13 tempo", "tungt idag, hann inte smälta maten och bara allmänt segt", "training"),
    ("2026-07-23", "Uppvärmning 3km Intervaller: tröskel 1200m/3min + 2x600m/2.5min + 4x300m/90sek nerjogg 2km. 3.45 fart, 4.06, 2.01+1.58, 53-55sek", "inget jätte bra pass och fick korta ner det lite. känner att det framförallt är andningen som inte fungerar för benen känns ändå bra. men fick liksom inte andnöd förrän på 300ingarna. höll väl ändå ok fart på 1200ingen men ingen bra känsla och fick släppa mycket på Nike på alla intervaller", "training"),
    ("2026-07-24", "Distans: 35min 6.45km/5.27 tempo + explosiv benstyrka/hopp + lite helkropp", "joggade med Ingrid och Vilma i början och gick typ i backen för att inte höja pulsen, helt okej känsla", "training"),
    ("2026-07-25", "Uppvärmning 3km Tröskelintervaller: (strax under) 15x400m/1min vila ca 87-88sek nerjogg 2km", "kändes bra och kontrollerat även om det skulle vara lite under tröskel, körde även med pulsband och pulsen var betydligt lägre än va klockan brukar visa. blev typ aldrig jobbigare och gick bra att bara rulla på i samma fart", "training"),
    ("2026-07-26", "Distans: 45min 9km/5.03 tempo", "väldigt bra känsla men pulsen var kanske inte jätte låg, men det blåste även mycket på vägen hem", "training"),

    ("2026-07-27", "Vila", None, "rest"),
    ("2026-07-28", "Uppvärmning 3km intervaller: 600m tröskel + 300m/4min + 4x200m + 4x150m/2min serievila 6.5min nerjogg 2km. 600: 3.45 fart, 300m: 44.3, 200m: 30.5/31.8/31.5/33.2, 150m: 22.1/22.8/23.1/21.3", None, "training"),
    ("2026-07-29", "Distans: 31min 6km/5.09 tempo", None, "training"),
    ("2026-07-30", "Vila", None, "rest"),
    ("2026-07-31", "Uppvärmning 2km USM 2000mh: 7.13.91 sb och en 2a plats! Nerjogg 2km", None, "training"),
    ("2026-08-01", "Jogg: 17min 3.3km/5.14 tempo, 4x100m stegringslopp", None, "training"),
    ("2026-08-02", "Uppvärmning 2km USM 800m: 2.18.53, 4e plats. Nerjogg 1.1km", None, "training"),

    ("2026-08-03", "Vila", None, "rest"),
    ("2026-08-04", "Vila", None, "rest"),
    ("2026-08-05", "Distans: 40min 8km/5.00 tempo", "kändes väldigt lätt och bra i början men lite segare i motvinden på vägen hem", "training"),
    ("2026-08-06", "Uppvärmning 3km Tröskelintervaller: 7x3min/1min vila. medvind-3.55, motvind-4.02-4.08. Nerjogg 2km. Bålstyrka med medicinboll", "kändes ändå bra och väldigt kontrollerat, till och med mer än vanligtvis på tröskel men blåste väldigt mycket och 2a intervallen var en vägg men sänkte istället farten så att det verkligen skulle vara tröskel", "training"),
    ("2026-08-07", "Distans: 35min 7.2km/4.53tempo, rehab", "kändes bra!", "training"),
    ("2026-08-08", "Uppvärmning 3km Intervaller: 10x400m/90sek vila med 3 häckar nerjogg 2km. 7 första: 84-83sek, sen 82, 81, 79sek", "Kändes riktigt bra idag, skulle ha 84 men det kändes väldigt lätt så ökade till och med i slutet men var ändå inte jätte trött efter, kändes liksom ganska kontrollerat för att vara ett hårt pass och känns som att jag hade kunnat göra fler trots att sista intervallen gick mycket snabbare än det skulle. Häckarna kändes också bra, sprang på utan att trippa så mycket", "training"),
    ("2026-08-09", "Distans: 60min 11.7km/5.08 tempo", "kändes inte jätte bra, ganska hög puls", "training"),

    ("2026-08-10", "Distans: 40min 8km/5.02 tempo", "kändes helt okej", "training"),
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

    existing = sb_get(
        url, key,
        f"diary_entries?user_id=eq.{args.user_id}&entry_date=gte.2026-06-01&entry_date=lte.2026-08-10"
        "&select=id,entry_date",
    )
    existing_by_date = {e["entry_date"]: e["id"] for e in existing}

    headers = {"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"}
    n_insert = n_update = 0

    for entry_date, session_log, notes, day_type in ENTRIES:
        payload = {
            "entry_date": entry_date,
            "session_log": session_log,
            "notes": notes,
            "day_type": day_type,
        }
        if entry_date in existing_by_date:
            n_update += 1
            action = f"UPDATE {entry_date}"
        else:
            n_insert += 1
            action = f"INSERT {entry_date}"

        if args.dry_run:
            print(f"{action}: [{day_type}] {(session_log or '')[:70]}")
            continue

        if entry_date in existing_by_date:
            r = requests.patch(
                f"{url}/rest/v1/diary_entries",
                headers=headers,
                params={"id": f"eq.{existing_by_date[entry_date]}"},
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

    print(f"\n{'(dry-run) ' if args.dry_run else ''}Klart: {n_insert} nya rader, {n_update} uppdaterade. "
          f"Totalt {len(ENTRIES)} dagar ({ENTRIES[0][0]} - {ENTRIES[-1][0]}).")


if __name__ == "__main__":
    main()
