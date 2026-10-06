// ─── Consolidation contract ───────────────────────────────────────────────────
// SKILL.md §11.7 — evidence is not memory.
// Understanding, signals and engines PRODUCE evidence.
// The consolidator DECIDES durable state. Stores APPLY the decision.
// Nothing else may write UserFact, UserReality, BehavioralPattern or the
// investigation fields of NovaCognitiveState.

import type { NovaPatternType, SignalType } from "./engine.types";
import type { NovaRealityCategory, RealityCategory } from "./reality.types";

// ── Evidence ──────────────────────────────────────────────────────────────────
// One observation from one turn. Evidence is transient: it is not a database
// row. Its durable trace is the CompanionMessage it came from (sourceMessageId).

export type EvidenceSource =
  | "signal_engine"         // deterministic regex match
  | "understanding_brain"   // LLM classification
  | "response_brain"        // LLM output field
  | "pattern_detector"      // deterministic inference over history
  | "onboarding_extractor"; // LLM extraction, validated

interface EvidenceBase {
  companion:       "nova";
  userId:          string;        // MessengerUser.id
  profileId:       string | null; // NovaAcademicProfile.id
  source:          EvidenceSource;
  observedAt:      Date;
  confidence:      number;        // 0–1, as reported by the source
  sourceMessageId: string | null; // CompanionMessage.id of the user turn
  sourceText:      string | null; // what the user said, trimmed
}

export interface SignalEvidence extends EvidenceBase {
  kind:         "signal";
  signalType:   SignalType;
  intensity:    number;
  // True when the Understanding Brain's classification independently agrees
  // with the regex match. An uncorroborated match is weaker evidence.
  corroborated: boolean;
  topic:        string | null;
}

// A claim that some circumstance applies. The source describes it; it does
// not decide whether a UserReality row is created.
export interface RealityClaimEvidence extends EvidenceBase {
  kind:        "reality_claim";
  category:    NovaRealityCategory;
  subtype:     string;            // from the closed list for the category
  description: string;            // third person, present tense
  // "standing": true until the user says otherwise (a job, a commute).
  // "temporary": expected to pass on its own (flu, a trip, exam week).
  persistence: "temporary" | "standing";
  expectedDurationHours: number | null;   // the source's estimate, if any
}

// The user reports that a circumstance has ended.
export interface RealityResolutionEvidence extends EvidenceBase {
  kind:     "reality_resolution";
  category: NovaRealityCategory;
  subtype:  string | null;        // null: whatever is active in the category
}

export interface PatternDetectionEvidence extends EvidenceBase {
  kind:        "pattern_detection";
  patternType: NovaPatternType;
  description: string;
  supporting:  string[];
}

export interface InvestigationEvidence extends EvidenceBase {
  kind:       "investigation_update";
  topic:      string | null;
  status:     "open" | "resolved" | "abandoned" | null;
  hypotheses: string[] | null;
}

export type Evidence =
  | SignalEvidence
  | RealityClaimEvidence
  | RealityResolutionEvidence
  | PatternDetectionEvidence
  | InvestigationEvidence;

// ── Current durable state (what consolidation compares evidence against) ──────

export interface StoredFact {
  id:             string;
  type:           string;
  key:            string;
  value:          string;
  confidence:     number;
  evidenceCount:  number;
  lastObservedAt: Date;
  // Messages whose evidence this row already absorbed (idempotency).
  sourceMessageIds: string[];
}

export interface StoredReality {
  id:         string;
  category:   RealityCategory;   // normalized to the canonical vocabulary
  subtype:    string | null;
  fact:       string;
  confidence: number;
  expiresAt:  Date;
  sourceMessageIds: string[];
}

export type PatternStatus = "emerging" | "active" | "weakening" | "resolved" | "expired";

export interface StoredPattern {
  id:              string;
  patternType:     string;
  status:          PatternStatus;
  evidenceCount:   number;
  confidence:      number;       // accumulated strength, 0–1
  firstObservedAt: Date;
  lastObservedAt:  Date;         // last supporting detection
  lastChangedAt:   Date;         // last write of any kind
  sourceMessageIds: string[];
}

export interface StoredInvestigation {
  topic:     string | null;
  status:    string | null;
  updatedAt: Date | null;
}

export interface RecentSession {
  sessionDate: Date;
  status:      string;
}

export interface ConsolidationState {
  facts:          StoredFact[];
  realities:      StoredReality[];   // every row still flagged active
  patterns:       StoredPattern[];
  investigation:  StoredInvestigation | null;
  recentSessions: RecentSession[];
  // Topics that already received a conversation-based mastery observation
  // recently (lower-cased names). Absent is treated as none.
  recentlyObservedTopics?: string[];
}

export interface ConsolidationInput {
  evidence: Evidence[];
  state:    ConsolidationState;
  now:      Date;
  // True when the pattern detector ran this turn. Absence of a detection is
  // only meaningful (pattern may have resolved) if a scan actually happened.
  patternScanRan:   boolean;
  // An interactive session owns its own record; self-reports must not add one.
  hasActiveSession: boolean;
}

// ── Decisions ─────────────────────────────────────────────────────────────────

export type ConsolidationAction = "CREATE" | "UPDATE" | "IGNORE" | "RESOLVE" | "EXPIRE";

export type ConsolidationTarget =
  | "user_fact"
  | "reality"
  | "behavioral_pattern"
  | "cognitive_state"
  | "academic_observation";

export interface Provenance {
  source:          EvidenceSource;
  sourceMessageId: string | null;
  observedAt:      string;   // ISO
  confidence:      number;
}

export type ConsolidationWrite =
  | {
      target:        "user_fact";
      type:          string;
      key:           string;
      value:         string;
      confidence:    number;
      evidenceCount: number;
      // Set when a single-valued fact is replaced: the old value is kept in
      // provenance.history, never silently dropped.
      supersedes:    { value: string; confidence: number } | null;
    }
  | {
      // Set when a different description replaces the stored one.
      supersedes?: { value: string; confidence: number } | null;
      target:      "reality";
      category:    NovaRealityCategory;
      subtype:     string;
      description: string;
      confidence:  number;
      expiresAt:   Date;
      sourceText:  string | null;
    }
  | {
      target:        "behavioral_pattern";
      patternType:   NovaPatternType;
      description:   string | null;   // null: keep what is stored
      confidence:    number;   // new strength
      evidenceCount: number;
      severity:      "emerging" | "confirmed" | "critical";
      status:        PatternStatus;
      supporting:    string[] | null;   // null: keep what is stored
      observed:      boolean;           // true: a supporting detection (moves lastObservedAt)
    }
  | {
      target:     "cognitive_state";
      topic:      string | null;
      status:     "open" | "resolved" | "abandoned";
      hypotheses: string[] | null;
      isNew:      boolean;   // new investigation: attempt counter restarts
    }
  | {
      target:     "academic_observation";
      op:         "self_reported_session" | "skipped_session" | "mastery_observation";
      topic:      string | null;
      confidence: number;
    };

export interface ConsolidationDecision {
  action:     ConsolidationAction;
  target:     ConsolidationTarget;
  reason:     string;                  // machine-readable rule id
  targetId:   string | null;           // existing row this decision acts on
  write:      ConsolidationWrite | null; // null for IGNORE, and for RESOLVE / EXPIRE with no new values
  provenance: Provenance | null;       // null only for sweeps not triggered by evidence
}
