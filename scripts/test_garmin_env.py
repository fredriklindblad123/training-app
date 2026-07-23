"""
Icke-interaktiv variant av test_garmin.py, läser uppgifter från miljövariabler
GARMIN_EMAIL och GARMIN_PASSWORD istället för prompt.
"""

import json
import os

from garminconnect import Garmin, GarminConnectAuthenticationError


def main():
    email = os.environ["GARMIN_EMAIL"]
    password = os.environ["GARMIN_PASSWORD"]

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
          "garmin_sample_activity.json.")


if __name__ == "__main__":
    main()
