// ─── Nova Proactive Mentor System — Types ─────────────────────────────────────
// SKILL.md §1.6 — Proactive system types.
// Owner: Phase 5 engines. No LLM types here.

// ── Intervention types ────────────────────────────────────────────────────────
// Exactly the events from the spec — no additions.

export type InterventionType =
  | "morning_brief"
  | "study_reminder"
  | "session_check_in"
  | "mid_session_support"
  | "missed_session"
  | "reflection_reminder"
  | "revision_reminder"
  | "exam_countdown"
  | "weekly_review"
  | "milestone_celebration"
  | "consistency_recovery"
  | "burnout_prevention"
  | "none";

// ── Cooldowns per intervention type ───────────────────────────────────────────
// After one fires, suppress the same type until cooldown expires.

export const INTERVENTION_COOLDOWN_HOURS: Record<InterventionType, number> = {
  morning_brief:          22,    // once per day
  study_reminder:          4,    // max ~twice per awake window
  session_check_in:        2,    // brief in-session only
  mid_session_support:     1,    // light-touch during session
  missed_session:          8,    // follow up once after a miss
  reflection_reminder:    12,    // once per evening
  revision_reminder:      12,    // once per afternoon cycle
  exam_countdown:          6,    // max twice on exam day
  weekly_review:         168,    // once per week (7 * 24)
  milestone_celebration:  24,    // once per achievement
  consistency_recovery:   48,    // twice a week max
  burnout_prevention:     24,    // once per day
  none:                    0,
};

// ── Priority weights ──────────────────────────────────────────────────────────
// 1 = lowest, 10 = highest. Higher always wins in merge conflicts.

export const INTERVENTION_BASE_PRIORITY: Record<InterventionType, number> = {
  exam_countdown:         9,
  burnout_prevention:     8,
  consistency_recovery:   7,
  missed_session:         6,
  morning_brief:          5,
  study_reminder:         5,
  revision_reminder:      4,
  reflection_reminder:    3,
  milestone_celebration:  3,
  weekly_review:          2,
  session_check_in:       2,
  mid_session_support:    1,
  none:                   0,
};

// ── Momentum ──────────────────────────────────────────────────────────────────

export type MomentumLevel   = "high" | "moderate" | "low" | "critical";
export type ConsistencyLevel = "excellent" | "good" | "fair" | "poor";
export type StudyRhythm     = "morning" | "afternoon" | "evening" | "night" | "irregular";
export type RecoveryTrend   = "recovering" | "stable" | "declining";
export type MotivationTrend = "rising" | "stable" | "falling";

export interface MomentumState {
  currentMomentum:      MomentumLevel;
  weeklyConsistency:    ConsistencyLevel;
  currentStreak:        number;    // consecutive days with at least one session
  lastSessionDaysAgo:   number;    // 0 = today, 1 = yesterday, etc.
  consecutiveMisses:    number;
  recoveryTrend:        RecoveryTrend;
  motivationTrend:      MotivationTrend;
  studyRhythm:          StudyRhythm;
  averageSessionMinutes: number;
  sessionsLast7Days:    number;
}

// ── Scheduling ────────────────────────────────────────────────────────────────

export interface SchedulingDecision {
  eventType:      InterventionType;
  reason:         string;
  priority:       number;       // 1–10 (may exceed base if urgent override)
  scheduledFor:   Date;
  isUrgent:       boolean;
  triggeringFact: string | null;
}

// ── Intervention ──────────────────────────────────────────────────────────────

export interface InterventionDecision {
  type:          InterventionType;
  reason:        string;
  priority:      number;
  confidence:    number;         // 0–1
  constraints:   string[];       // active flags: "no_pressure", "exam_mode", etc.
  cooldownHours: number;
  shouldFire:    boolean;
}

// ── Adaptive planning ─────────────────────────────────────────────────────────

export type PlanChangeType =
  | "add"
  | "remove"
  | "reprioritize"
  | "reduce_duration"
  | "increase_challenge";

export interface PlanChange {
  type:      PlanChangeType;
  topicName: string;
  reason:    string;
  priority?: number;
}

export interface AdaptedPlan {
  changes:             PlanChange[];
  totalReducedMinutes: number;
  totalAddedMinutes:   number;
  adaptationReason:    string;
  isSignificantChange: boolean;
}

// ── Proactive decision ────────────────────────────────────────────────────────

export interface ProactiveDecision {
  approved:              boolean;
  finalInterventionType: InterventionType;
  suppressReason:        string | null;
  overrideReason:        string | null;
  priority:              number;
  confidence:            number;
}

// ── Proactive message (output for send layer) ─────────────────────────────────

export interface ProactiveMessage {
  chatId:           string;
  text:             string;
  intent:           InterventionType;
  profileId:        string;
  priority:         number;
  confidence:       number;
}
