// ─── Reality Layer types (Nova view) ──────────────────────────────────────────
// The vocabulary itself is shared infrastructure: src/types/reality.types.ts.
// This file adds only what is specific to how Nova uses it.

import type { RealityCategory } from "../../types/reality.types";
import { isRealityCategory } from "../../types/reality.types";

export {
  REALITY_CATEGORIES,
  REALITY_SUBTYPES,
  DEFAULT_REALITY_SUBTYPE,
  normalizeStoredReality,
  normalizeSubtype,
  realityStatus,
} from "../../types/reality.types";
export type { RealityCategory, RealityStatus } from "../../types/reality.types";

// What Nova's own evidence may claim. training_context is the gym domain:
// Nova reads it and never writes it.
export type NovaRealityCategory = Exclude<RealityCategory, "training_context">;

export function isNovaRealityCategory(c: string): c is NovaRealityCategory {
  return isRealityCategory(c) && c !== "training_context";
}

export interface NovaRealityFact {
  id:          string;
  category:    RealityCategory;
  subtype:     string | null;
  description: string;       // what the constraint is
  confidence:  number;       // 0–1
  relevance:   number;       // 0–1, computed per-turn
  expiresAt:   Date | null;
  sourceText:  string | null;
}

// Thresholds for Reality Adapter reads
export const REALITY_MIN_CONFIDENCE = 0.50;
export const REALITY_MIN_RELEVANCE  = 0.35;
