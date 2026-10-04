// ─── Reality Layer types ──────────────────────────────────────────────────────
// SKILL.md §9 — Phase 1 deterministic, Phase 2 async LLM extraction.

export type RealityCategory =
  | "health_constraint"
  | "time_constraint"
  | "work_constraint"
  | "academic_constraint"  // exam week, deadline cluster, etc.
  | "other";

export interface NovaRealityFact {
  id:          string;
  category:    RealityCategory;
  description: string;       // what the constraint is
  confidence:  number;       // 0–1
  relevance:   number;       // 0–1, computed per-turn
  expiresAt:   Date | null;
  sourceText:  string | null;
}

// TTL bounds per category (days)
export const REALITY_TTL_MAX_DAYS: Record<RealityCategory, number> = {
  health_constraint:    14,
  time_constraint:       7,
  work_constraint:      14,
  academic_constraint:   7,
  other:                 3,
};

// Thresholds for Reality Adapter reads
export const REALITY_MIN_CONFIDENCE = 0.50;
export const REALITY_MIN_RELEVANCE  = 0.35;
