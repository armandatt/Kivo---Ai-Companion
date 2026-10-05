// ─── Reality policy ───────────────────────────────────────────────────────────
// How long a reality constraint is believed. Policy only: no persistence, no
// I/O. Tune numbers here without touching the consolidator or the stores.

import type { NovaRealityCategory } from "../../types/reality.types";

export const REALITY_MIN_WRITE_CONFIDENCE = 0.65;   // SKILL.md §9.2

// A weaker contradicting claim may not replace a stronger active one.
export const REALITY_CONTRADICTION_MARGIN = 0.1;

// The Understanding Brain flags a disclosure class alongside any reality it
// reports. A reality claim on a message it classed as "no disclosure" is
// internally inconsistent output and is trusted less.
export const UNFLAGGED_DISCLOSURE_PENALTY = 0.8;

const HOUR_MS = 3_600_000;

// Temporary conditions: hours, bounded per category (SKILL.md §9.3).
const TEMPORARY_TTL_HOURS: Record<NovaRealityCategory, { min: number; default: number; max: number }> = {
  health:              { min: 4,  default: 72,  max: 72  },
  injury:              { min: 12, default: 336, max: 336 },
  emotional:           { min: 12, default: 48,  max: 120 },
  life_constraint:     { min: 12, default: 168, max: 240 },
  academic_constraint: { min: 4,  default: 168, max: 168 },
};

// Standing constraints (a part-time job, a long commute, a chronic condition)
// are true until the user says otherwise. They get a long horizon that every
// re-mention renews, so a short category TTL never destroys them.
export const STANDING_TTL_HOURS = 180 * 24;

export type RealityPersistence = "temporary" | "standing";

export function realityExpiry(input: {
  category:              NovaRealityCategory;
  persistence:           RealityPersistence;
  expectedDurationHours: number | null;   // the source's own estimate, if it gave one
  now:                   Date;
}): Date {
  if (input.persistence === "standing") {
    return new Date(input.now.getTime() + STANDING_TTL_HOURS * HOUR_MS);
  }
  const bounds = TEMPORARY_TTL_HOURS[input.category];
  const hours  = input.expectedDurationHours === null
    ? bounds.default
    : Math.max(bounds.min, Math.min(bounds.max, input.expectedDurationHours));
  return new Date(input.now.getTime() + hours * HOUR_MS);
}
