// ─── Memory types ─────────────────────────────────────────────────────────────
// SKILL.md §11 — two tables, never one.
// UserFacts: scored by relevance. CognitiveState: queried by type.

// ── UserFact types (stored in MemoryFact, Nova-specific subset) ───────────────

export type NovaUserFactType =
  | "achievement"           // completed goal, good performance
  | "promise"               // commitment made
  | "commitment"            // study commitment with time
  | "commitment_breach"     // broken commitment
  | "excuse_pattern"        // pattern of avoidance
  | "life_event"            // death, illness, family event
  | "mastery_claim"         // "I think I know X"
  | "study_session"         // logged study event
  | "missed_session"        // logged miss
  | "study_preference"      // how they like to study
  | "exam_result"           // outcome of exam
  | "adherence_report"      // diet/habit adherence self-report
  | "identity_statement"    // "I'm not good at math"
  | "concern";              // expressed worry or fear

export interface NovaUserFact {
  factType:     NovaUserFactType;
  key:          string;
  value:        string;
  confidence:   number;    // 0–1
  relevance:    number;    // 0–1, computed per-turn by memory adapter
  lastUpdated:  Date;
  evidenceCount: number;   // how many signals support this fact
}

// Contrastive signal map — used to select facts that contrast with current state
export const CONTRASTIVE_SIGNAL_MAP: Record<string, NovaUserFactType[]> = {
  self_doubt:      ["achievement", "mastery_claim", "exam_result"],
  excuse:          ["promise", "commitment"],
  burned_out:      ["achievement", "identity_statement"],
  overwhelmed:     ["achievement", "study_session"],
  calibration_gap: ["exam_result", "mastery_claim"],
  identity_doubt:  ["achievement", "identity_statement"],
};

// ── Cognitive State (separate table: NovaCognitiveState) ──────────────────────
// SKILL.md §11.3 — LLM-authored, typed retrieval, not scored.

export interface ActiveInvestigation {
  topic:             string;
  hypotheses:        string[];
  missingData:       string[];
  evidenceCollected: Record<string, string>;
  attemptCount:      number;
  status:            "open" | "resolved" | "abandoned";
  startedAt:         string;
  updatedAt:         string;
}

export interface FollowUpCheck {
  topic:          string;
  checkAfterDays: number;
  context:        string;
  diagnosedAt:    string;
  surfaced:       boolean;
}

export interface ReasoningHistoryEntry {
  mode:         string;
  confidence:   number;
  intervention: string;
  timestamp:    string;
}

export interface NovaCognitiveState {
  // Raw DB fields (from NovaCognitiveState table)
  investigationTopic:       string | null;
  investigationHypotheses:  string[];
  investigationMissingData: string[];
  investigationEvidence:    Record<string, string> | null;
  investigationAttempts:    number;
  investigationStatus:      string | null;
  investigationStartedAt:   Date | null;
  investigationUpdatedAt:   Date | null;
  followUpChecks:           unknown;
  reasoningHistory:         unknown;
}

// ── Memory relevance scoring weights ──────────────────────────────────────────

export const MEMORY_SCORE_WEIGHTS = {
  intentOverlap:    0.25,
  emotionOverlap:   0.20,
  topicOverlap:     0.25,
  temporalWeight:   0.15,
  relevanceBoost:   0.15,
} as const;

export const MEMORY_INTENT_OVERLAP: Partial<Record<string, NovaUserFactType[]>> = {
  study_report:     ["study_session", "achievement", "commitment"],
  study_skip_report:["missed_session", "excuse_pattern", "promise"],
  topic_question:   ["mastery_claim", "study_session", "study_preference"],
  mastery_claim:    ["mastery_claim", "exam_result", "achievement"],
  exam_anxiety:     ["exam_result", "concern", "identity_statement"],
  identity_doubt:   ["identity_statement", "achievement"],
  excuse:           ["excuse_pattern", "promise", "commitment"],
  plan_request:     ["commitment", "study_preference", "study_session"],
};
