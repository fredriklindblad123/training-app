/* Fas 0: träningsfaktor-taxonomin ur Årsplan-fliken i
 * "Träningsplanering Friidrottstränare steg 3" (Svensk Friidrott). Cellerna
 * i originalmallen blandar betoningsord ("Stor betoning") och fri text
 * ("3 pass/vecka (från 30min - 1h)") för samma sorts rad — därför är värdet
 * per faktor och vecka bara text (`season_week_plans.training_factors`,
 * en jsonb-karta nyckel→text), inte ett fast enum. Nycklarna nedan är den
 * enda platsen ordningen och etiketterna är definierade, så att
 * Årsplan-vyn och Excel-exporten (samma radordning som originalmallen)
 * aldrig kan glida isär. */

export type TrainingFactorGroup =
  | "snabbhet"
  | "uthallighet"
  | "ovrigt"
  | "grenteknik"
  | "styrka"
  | "rorlighet";

export const TRAINING_FACTOR_GROUP_LABELS: Record<TrainingFactorGroup, string> = {
  snabbhet: "Snabbhet",
  uthallighet: "Uthållighet",
  ovrigt: "Övrigt",
  grenteknik: "Grenteknik",
  styrka: "Styrka",
  rorlighet: "Rörlighet",
};

export type TrainingFactor = {
  key: string;
  label: string;
  group: TrainingFactorGroup;
};

export const TRAINING_FACTORS: readonly TrainingFactor[] = [
  { key: "speed_max", label: "Maximal", group: "snabbhet" },
  { key: "speed_acceleration", label: "Acceleration", group: "snabbhet" },
  { key: "speed_frekvens", label: "Frekvens", group: "snabbhet" },

  { key: "endurance_anaerob", label: "Anaerob alaktisk & laktisk", group: "uthallighet" },
  { key: "endurance_sprint", label: "Sprintuthållighet (95%)", group: "uthallighet" },
  { key: "endurance_snabbhet", label: "Snabbhetsuthållighet (90-95%)", group: "uthallighet" },
  {
    key: "endurance_forberedande",
    label: "Förberedande snabbhetsuthållighet (80-85%)",
    group: "uthallighet",
  },
  { key: "endurance_aerob_distans", label: "Distans", group: "uthallighet" },
  { key: "endurance_aerob_troskel", label: "Tröskel", group: "uthallighet" },
  { key: "endurance_aerob_intervall", label: "Intervall", group: "uthallighet" },
  { key: "endurance_aerob_backe", label: "Backe", group: "uthallighet" },
  { key: "endurance_aerob_tempo", label: "Tempo", group: "uthallighet" },

  { key: "alternativ_traning", label: "Alternativ träning", group: "ovrigt" },
  { key: "koordination", label: "Koordination (inkl stödövningar)", group: "ovrigt" },

  { key: "teknik_sprint_hack", label: "Sprint/Häck", group: "grenteknik" },
  { key: "teknik_hopp", label: "Hopp", group: "grenteknik" },
  { key: "teknik_kast", label: "Kast", group: "grenteknik" },
  { key: "teknik_specifik", label: "Specifik", group: "grenteknik" },
  { key: "teknik_hack_lopkoordination", label: "Häck / Löpkoordination", group: "grenteknik" },
  { key: "teknik_hoppkoordination", label: "Hoppkoordination", group: "grenteknik" },
  { key: "teknik_kastkoordination", label: "Kastkoordination", group: "grenteknik" },

  { key: "styrka_allman_lyftteknik", label: "Allmän / Lyftteknik", group: "styrka" },
  { key: "styrka_grund", label: "Grund", group: "styrka" },
  { key: "styrka_max", label: "Max", group: "styrka" },
  { key: "styrka_snabb", label: "Snabb", group: "styrka" },
  { key: "styrka_uthallig", label: "Uthållig", group: "styrka" },

  { key: "rorlighet_specifik", label: "Specifik", group: "rorlighet" },
  { key: "rorlighet_allman", label: "Allmän", group: "rorlighet" },
] as const;

export type TrainingFactorValues = Record<string, string>;
