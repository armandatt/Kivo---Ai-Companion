// ─── Engine contract types ────────────────────────────────────────────────────
// SKILL.md §8 — every engine has typed inputs, typed outputs, and stated
// prohibitions. Violating an engine's contract is an architecture violation.

import type { AcademicUnderstanding } from "./understanding.types";
import type { AcademicState } from "./academic-state.types";
import type { InterventionName } from "./intervention.types";
import type { NovaUserFact } from "./memory.types";

// ── Signal Engine ─────────────────────────────────────────────────────────────

export type SignalType =
  | "study_report"
  | "study_skip"
  | "session_start"      // student explicitly begins a study session right now
  | "break_request"      // student needs a break mid-session
  | "distraction"        // student reports difficulty focusing mid-session
  | "commitment"
  | "excuse"
  | "achievement"
  | "mastery_claim"
  | "avoidance"
  | "consistency"
  | "burnout_behavioral"
  | "comeback";

export interface DetectedSignal {
  type: SignalType;
  intensity: number;       // 0–1
  valence: "positive" | "negative" | "neutral";
  confidence: number;      // 0–1 — regex match certainty
  evidence: string;        // matched text snippet
}

export interface SignalStateUpdate {
  field: keyof import("./academic-state.types").AcademicScores;
  delta: number;
  reason: string;
  triggerSignal: SignalType;
}

export interface SignalEngineOutput {
  detectedSignals: DetectedSignal[];
  stateUpdates:   SignalStateUpdate[];
}

// ── Knowledge Engine ──────────────────────────────────────────────────────────

export interface TopicMasteryState {
  topicId:            string;
  topicName:          string;
  subjectName:        string;
  masteryProbability: number;      // 0–1, FSRS-computed
  lastStudied:        Date | null;
  retentionEstimate:  number;      // 0–1, predicted current retention
  confidenceReported: number;      // 0–1, last self-assessed
  calibrationGap:     number;      // masteryProbability - confidenceReported
  reviewDueAt:        Date | null;
  masteryTrend:       "rising" | "stable" | "falling";
  reviewCount:        number;
}

// ── Retention Engine ──────────────────────────────────────────────────────────

export interface RetentionSchedule {
  topicId:         string;
  topicName:       string;
  nextReviewAt:    Date;
  intervalDays:    number;
  efFactor:        number;   // FSRS stability factor
  retentionTarget: number;   // default 0.85
  urgencyScore:    number;   // 0–1: how overdue
}

export interface ReviewEvent {
  topicId:          string;
  performanceScore: number;   // 0–5 (FSRS grade scale)
  reviewedAt:       Date;
}

// ── Planning Engine ───────────────────────────────────────────────────────────

export interface StudyBlock {
  topicId:         string;
  topicName:       string;
  subjectName:     string;
  durationMinutes: number;
  activityType:    "review" | "practice" | "new_material" | "exam_prep";
  rationale:       string;   // for micro-prompt: why this block
  urgency:         "critical" | "high" | "normal" | "optional";
}

export interface StudyPlan {
  today:        StudyBlock[];
  thisWeek:     StudyBlock[];
  generatedAt:  Date;
  confidence:   number;      // 0–1: how achievable
  assumptions:  string[];    // what the plan assumes that might not be true
  totalMinutesToday: number;
}

// ── Exam Intelligence Engine ──────────────────────────────────────────────────

export type ExamMode = "normal" | "triage" | "crisis";

export interface ExamContext {
  examId:           string;
  examTitle:        string;
  subjectName:      string;
  daysUntil:        number;
  scheduledAt:      Date;
  mode:             ExamMode;
  topicWeights:     Record<string, number>;   // topicName → 0–1 importance
  riskMatrix: {
    critical: string[];   // low mastery + high weight
    risky:    string[];   // moderate mastery + moderate weight
    safe:     string[];   // high mastery
  };
  primaryFocus:           string;   // single highest-priority topic this turn
  recommendedDailyHours:  number;
}

// ── Pattern Detector ──────────────────────────────────────────────────────────

export type NovaPatternType =
  | "ghosting"
  | "motivation_crash"
  | "excuse_loop"
  | "overplanning"
  | "perfectionism"
  | "restart_cycle"
  | "avoidance_pattern"
  | "comparison_trap"
  | "calibration_delusion"   // Nova-specific: high confidence, low mastery, no review
  | "tutorial_hell";         // Nova-specific: consuming resources without practice

export interface DetectedPattern {
  type:         NovaPatternType;
  confidence:   number;    // 0–1
  severity:     "emerging" | "confirmed" | "critical";
  firstSeenAt:  Date;
  occurrences:  number;
  evidence:     string[];
  recommendation: string;
}

export interface PatternAnalysis {
  detectedPatterns:   DetectedPattern[];
  dominantPattern:    DetectedPattern | null;
  analysisRunAt:      Date;
  messagesSinceLastRun: number;
}

// ── Decision Engine ───────────────────────────────────────────────────────────

export interface DecisionEngineInput {
  understanding: AcademicUnderstanding;
  state:         AcademicState;
  memories:      NovaUserFact[];
  signals:       DetectedSignal[];
  patterns:      PatternAnalysis;
}

export interface InterventionScore {
  intervention: InterventionName;
  score:        number;   // 0–100
  confidence:   number;   // 0–1
  reason:       string;
}

export interface DecisionEngineOutput {
  intervention:          InterventionName;
  score:                 number;
  confidence:            number;
  evidence:              string;   // 1–2 sentence justification for micro-prompt
  candidates:            InterventionScore[];  // all scored candidates
  blockedInterventions:  InterventionName[];
}
