"""
Testskript för det inofficiella biblioteket python-garminconnect.

Loggar in med dina Garmin-kontouppgifter (via dolt lösenordsprompt, aldrig
sparat i klartext) och hämtar dina 5 senaste aktiviteter, för att verifiera
att åtkomsten fungerar.

Kör i egen terminal (inte via Claude), så att lösenordet aldrig hamnar i
någon chatlogg:

    source .venv/bin/activate
    python scripts/test_garmin.py

Vid lyckad inloggning sparas en sessions-token i ~/.garminconnect så du
slipper logga in varje gång.
"""

import getpass
import json

from garminconnect import Garmin, GarminConnectAuthenticationError


def main():
    email = input("Garmin-e-post: ")
    password = getpass.getpass("Garmin-lösenord: ")

    client = Garmin(email, password)

    try:
        client.login()
    except GarminConnectAuthenticationError as e:
        print(f"Inloggning misslyckades: {e}")
        return

    print("Inloggning lyckades.\n")

    activities = client.get_activities(0, 5)
    print(f"Hittade {len(activities)} senaste aktiviteter:\n")
    for a in activities:
        print(f"- {a.get('activityName')} | {a.get('startTimeLocal')} | "
              f"{a.get('distance')} m | {a.get('duration')} s")

    with open("garmin_sample_activity.json", "w") as f:
        json.dump(activities[0] if activities else {}, f, indent=2)
    print("\nFullt exempel på ett aktivitetsobjekt sparat i "
          "garmin_sample_activity.json (för att se vilka fält som finns).")


if __name__ == "__main__":
    main()
