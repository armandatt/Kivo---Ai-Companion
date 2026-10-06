// ─── Nova Proactive Mentor System — Types ─────────────────────────────────────
// SKILL.md §1.6 — Proactive system types.
// Owner: Phase 5 engines. No LLM types here.

// ── What Nova may say first ───────────────────────────────────────────────────
// Four reasons to message a learner who has not written. Each one names a
// fact on record; none of them is a mood or a score. Anything else Nova could
// say first (a morning brief, a streak, a weekly reflection, a check-in in
// the middle of a session) is deliberately not here.
// Decision: decision/proactive-decision.ts.

export type ProactiveType =
  | "exam_countdown"        // an exam is within three days
  | "review_due"            // the retention schedule has topics due
  | "missed_plan_recovery"  // no session for a few days, said once per lapse
  | "daily_nudge";          // the usual study time, nothing done yet today

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

