// ─── Shared Reality Layer vocabulary ──────────────────────────────────────────
// SKILL.md §9.2 — UserReality is shared by every companion and has ONE
// category vocabulary. This file is that vocabulary. Rex and Nova both import
// it; neither defines its own.

export const REALITY_CATEGORIES = [
  "health",              // illness, sleep, a chronic condition
  "injury",              // physical injury
  "emotional",           // grief, burnout, sustained stress or anxiety
  "life_constraint",     // travel, work, family, schedule, money
  "academic_constraint", // exam week, deadline cluster, heavy course load
  "training_context",    // gym domain: rest day, deload, active recovery
] as const;

export type RealityCategory = typeof REALITY_CATEGORIES[number];

// Small closed subtype vocabulary per category. A closed list keeps
// (category, subtype) usable as the identity of a constraint: free text
// would turn "flu" and "illness" into two records.
export const REALITY_SUBTYPES: Record<RealityCategory, readonly string[]> = {
  health:              ["illness", "sleep", "chronic", "other"],
  injury:              ["injury"],
  emotional:           ["grief", "burnout", "stress", "anxiety", "other"],
  life_constraint:     ["travel", "work", "family", "schedule", "financial", "other"],
  academic_constraint: ["exam", "deadline", "workload", "other"],
  training_context:    ["other"],
};

// Used when a writer or a stored row gives no subtype.
export const DEFAULT_REALITY_SUBTYPE: Record<RealityCategory, string> = {
  health:              "illness",
  injury:              "injury",
  emotional:           "other",
  life_constraint:     "other",
  academic_constraint: "other",
  training_context:    "other",
};

export function isRealityCategory(c: string): c is RealityCategory {
  return (REALITY_CATEGORIES as readonly string[]).includes(c);
}

export function normalizeSubtype(category: RealityCategory, raw: string | null | undefined): string {
  const s = (raw ?? "").toLowerCase().trim();
  const allowed = REALITY_SUBTYPES[category];
  if (allowed.includes(s)) return s;
  // Named but unlisted: "other" where the category has it, else its default.
  return s && allowed.includes("other") ? "other" : DEFAULT_REALITY_SUBTYPE[category];
}

// Category names Nova used before the vocabulary was unified.
const LEGACY_CATEGORY_MAP: Record<string, { category: RealityCategory; subtype: string }> = {
  health_constraint: { category: "health",          subtype: "other"    },
  time_constraint:   { category: "life_constraint", subtype: "schedule" },
  work_constraint:   { category: "life_constraint", subtype: "work"     },
  other:             { category: "life_constraint", subtype: "other"    },
};

// The single read boundary for stored rows. Legacy category names and rows
// written without a subtype come out canonical; nothing is rewritten in place.
export function normalizeStoredReality(
  category: string | null,
  subtype:  string | null,
): { category: RealityCategory; subtype: string } {
  const legacy = category ? LEGACY_CATEGORY_MAP[category] : undefined;
  if (legacy) return { category: legacy.category, subtype: subtype ?? legacy.subtype };
  if (category && isRealityCategory(category)) {
    return { category, subtype: normalizeSubtype(category, subtype) };
  }
  return { category: "life_constraint", subtype: "other" };
}

// ── Provenance ────────────────────────────────────────────────────────────────
// Every writer records where a row came from, in the same shape.

export type RealityProvenanceEntry = {
  source:          string;        // e.g. "understanding_brain", "rex_parser"
  sourceMessageId: string | null;
  observedAt:      string;        // ISO
  confidence:      number;
};

export function realityProvenance(entry: RealityProvenanceEntry): { sources: RealityProvenanceEntry[] } {
  return { sources: [entry] };
}

// ── Lifecycle ─────────────────────────────────────────────────────────────────
// ACTIVE → RESOLVED (the user said it ended) | EXPIRED (TTL elapsed).

export type RealityStatus = "active" | "resolved" | "expired";

export function realityStatus(
  row: { isActive: boolean; expiresAt: Date; resolvedAt: Date | null },
  now: Date,
): RealityStatus {
  if (row.resolvedAt) return "resolved";   // explicit resolution wins over expiry
  if (!row.isActive || row.expiresAt <= now) return "expired";
  return "active";
}
