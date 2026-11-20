// ─── One name for one timezone ────────────────────────────────────────────────
// No imports, so the web app imports it directly. Browsers still report some
// zones under the name they had before a rename (Chrome: "Asia/Calcutta"),
// and Kivo stores the current name ("Asia/Kolkata"). Two names for the same
// zone are the same zone: comparing them with === told learners in India
// their device was in a different timezone (K-09). Every comparison of a
// stored zone with a device's goes through sameZone; every write stores
// canonicalZone (learner-calendar.ts currentZoneName, which also checks the
// name is a zone the runtime knows).

export const RENAMED_ZONES: Readonly<Record<string, string>> = {
  "Asia/Calcutta":                  "Asia/Kolkata",
  "Asia/Katmandu":                  "Asia/Kathmandu",
  "Asia/Rangoon":                   "Asia/Yangon",
  "Asia/Saigon":                    "Asia/Ho_Chi_Minh",
  "Asia/Dacca":                     "Asia/Dhaka",
  "Asia/Thimbu":                    "Asia/Thimphu",
  "Asia/Ulan_Bator":                "Asia/Ulaanbaatar",
  "Europe/Kiev":                    "Europe/Kyiv",
  "Atlantic/Faeroe":                "Atlantic/Faroe",
  "America/Buenos_Aires":           "America/Argentina/Buenos_Aires",
  "America/Indianapolis":           "America/Indiana/Indianapolis",
  "America/Louisville":             "America/Kentucky/Louisville",
  "America/Godthab":                "America/Nuuk",
  "Pacific/Enderbury":              "Pacific/Kanton",
};

// The current name of a zone; a name with no rename is returned as it is.
export function canonicalZone(name: string): string {
  return RENAMED_ZONES[name] ?? name;
}

export function sameZone(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  return canonicalZone(a) === canonicalZone(b);
}
