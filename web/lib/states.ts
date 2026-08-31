/**
 * Nigerian states and the Federal Capital Territory.
 *
 * Mirrors mobile/lib/states.ts. This is where a branch sits, and a
 * practitioner's practice state is derived from their branch rather than
 * chosen — so this list is the only place a state is picked in the whole
 * system.
 *
 * It records geography, not fee bands: the Scale 4 rates have no state
 * dimension, and nothing here should ever feed a calculation.
 */
export const states = [
  "Abia",
  "Adamawa",
  "Akwa Ibom",
  "Anambra",
  "Bauchi",
  "Bayelsa",
  "Benue",
  "Borno",
  "Cross River",
  "Delta",
  "Ebonyi",
  "Edo",
  "Ekiti",
  "Enugu",
  "FCT",
  "Gombe",
  "Imo",
  "Jigawa",
  "Kaduna",
  "Kano",
  "Katsina",
  "Kebbi",
  "Kogi",
  "Kwara",
  "Lagos",
  "Nasarawa",
  "Niger",
  "Ogun",
  "Ondo",
  "Osun",
  "Oyo",
  "Plateau",
  "Rivers",
  "Sokoto",
  "Taraba",
  "Yobe",
  "Zamfara",
] as const;

export type NigerianState = (typeof states)[number];
