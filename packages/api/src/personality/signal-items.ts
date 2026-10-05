// ─── Personality signal: items ────────────────────────────────────────────────
// Four statements shown at the end of web onboarding (questions 7–10).
//
// This is a lightweight mentor-matching signal, NOT a Big Five assessment. Each
// statement is a single item taken verbatim from the public-domain IPIP 50-item
// Big-Five factor markers (https://ipip.ori.org/New_IPIP-50-item-scale.htm).
// One item per dimension is not a validated scale, so nothing here may be
// presented to the user, or to the model, as a measured personality trait.
//
// Pure data: no I/O. Safe to import from the web app.

// Bump when the items, their order, the scale or the scoring change. Stored on
// every assessment row so old results stay interpretable.
export const SIGNAL_VERSION = "kivo-signal-v1";

// Kivo's own names for what each statement hints at. Deliberately not the
// psychological trait names.
export type SignalDimension = "routine" | "sociability" | "composure" | "reflection";

export const SIGNAL_DIMENSIONS: readonly SignalDimension[] = [
  "routine", "sociability", "composure", "reflection",
];

export interface SignalItem {
  id:        string;
  text:      string;
  dimension: SignalDimension;
  // "-" means agreeing with the statement lowers the dimension (reverse-scored).
  keyed:     "+" | "-";
  // Item number in the IPIP 50-item scale, for provenance.
  ipipItem:  number;
}

// Order is the order shown to the user.
export const SIGNAL_ITEMS: readonly SignalItem[] = [
  { id: "s1", text: "I follow a schedule.",               dimension: "routine",     keyed: "+", ipipItem: 43 },
  { id: "s2", text: "I start conversations.",             dimension: "sociability", keyed: "+", ipipItem: 21 },
  { id: "s3", text: "I get stressed out easily.",         dimension: "composure",   keyed: "-", ipipItem: 4  },
  { id: "s4", text: "I spend time reflecting on things.", dimension: "reflection",  keyed: "+", ipipItem: 45 },
];

export const SIGNAL_SCALE_MIN = 1;
export const SIGNAL_SCALE_MAX = 5;

// Same five points as the IPIP response scale, in plainer words.
export const SIGNAL_SCALE: readonly { value: number; label: string }[] = [
  { value: 1, label: "Not me at all" },
  { value: 2, label: "Mostly not me" },
  { value: 3, label: "In between" },
  { value: 4, label: "Mostly me" },
  { value: 5, label: "Very much me" },
];
