/* Fas 0: träningsfaktor-taxonomin ur Årsplan-fliken i
 * "Träningsplanering Friidrottstränare steg 3" (Svensk Friidrott). Cellerna
 * i originalmallen blandar betoningsord ("Stor betoning") och fri text
 * ("3 pass/vecka (från 30min - 1h)") för samma sorts rad — därför är värdet
 * per faktor bara text (`season_blocks.training_factors`, en jsonb-karta
 * nyckel→text, samma värde för varje vecka i blocket — se
 * supabase/migrations/20260815100000_block_period_redesign.sql), inte ett
 * fast enum. Nycklarna nedan är den enda platsen ordningen och etiketterna
 * är definierade, så att blockformuläret och Excel-exporten (samma
 * radordning som originalmallen) aldrig kan glida isär.
 *
 * Originalmallens Grenteknik-grupp (Sprint/Häck, Hopp, Kast, Specifik,
 * Häck/Löpkoordination, Hoppkoordination, Kastkoordination) och
 * Styrka/Allmän-Lyftteknik är bortplockade 2026-08-15 — irrelevanta för
 * medeldistans, som är den enda grenen den här appen används för. */

export type TrainingFactorGroup =
  | "snabbhet"
  | "uthallighet"
  | "ovrigt"
  | "styrka"
  | "rorlighet";

export const TRAINING_FACTOR_GROUP_LABELS: Record<TrainingFactorGroup, string> = {
  snabbhet: "Snabbhet",
  uthallighet: "Uthållighet",
  ovrigt: "Övrigt",
  styrka: "Styrka",
  rorlighet: "Rörlighet",
};

/** Undergrupp inom en TrainingFactorGroup — bara "uthallighet" har en i
 * dagens taxonomi (den aeroba klustret Distans/Tröskel/Intervall/Backe/
 * Tempo, som i originalmallen står under en egen fetstilt "Aerob"-rubrik
 * skild från de anaeroba/snabbhetsuthållighets-posterna ovanför). Valfri —
 * de flesta faktorer hör direkt till sin grupp utan mellanled. */
export type TrainingFactorSubgroup = "aerob";

export const TRAINING_FACTOR_SUBGROUP_LABELS: Record<TrainingFactorSubgroup, string> = {
  aerob: "Aerob",
};

export type TrainingFactor = {
  key: string;
  label: string;
  group: TrainingFactorGroup;
  subgroup?: TrainingFactorSubgroup;
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
  { key: "endurance_aerob_distans", label: "Distans", group: "uthallighet", subgroup: "aerob" },
  { key: "endurance_aerob_troskel", label: "Tröskel", group: "uthallighet", subgroup: "aerob" },
  { key: "endurance_aerob_intervall", label: "Intervall", group: "uthallighet", subgroup: "aerob" },
  { key: "endurance_aerob_backe", label: "Backe", group: "uthallighet", subgroup: "aerob" },
  { key: "endurance_aerob_tempo", label: "Tempo", group: "uthallighet", subgroup: "aerob" },

  { key: "alternativ_traning", label: "Alternativ träning", group: "ovrigt" },
  { key: "koordination", label: "Koordination (inkl stödövningar)", group: "ovrigt" },

  { key: "styrka_grund", label: "Grund", group: "styrka" },
  { key: "styrka_max", label: "Max", group: "styrka" },
  { key: "styrka_snabb", label: "Snabb", group: "styrka" },
  { key: "styrka_uthallig", label: "Uthållig", group: "styrka" },

  { key: "rorlighet_specifik", label: "Specifik", group: "rorlighet" },
  { key: "rorlighet_allman", label: "Allmän", group: "rorlighet" },
] as const;

export type TrainingFactorValues = Record<string, string>;
