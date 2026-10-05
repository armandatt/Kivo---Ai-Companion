// ─── Proactive Decision Graph ─────────────────────────────────────────────────
// The final gate before any proactive message fires.
// Decides IF an intervention should happen and which final type.
// The scheduler decides WHEN. The Decision Graph decides IF.
// The Response Brain decides HOW.
//
// Rules applied in strict priority order — first match wins.
// NEVER makes LLM calls. Deterministic.
// Owner: Phase 5 Proactive Mentor System.

import type {
  InterventionDecision,
  MomentumState,
  ProactiveDecision,
  InterventionType,
} from "../types/proactive.types";
import type { AcademicState } from "../types/academic-state.types";
import type { NovaRealityFact } from "../types/reality.types";

export interface ProactiveDecisionInput {
  intervention:    InterventionDecision;
  academicState:   AcademicState;
  momentum:        MomentumState;
  realityFacts:    NovaRealityFact[];
  hasActiveSession: boolean;
  studiedToday:    boolean;
  // cooldown check: caller passes true if this eventType is still in cooldown
  isInCooldown:    boolean;
  // whether the student sent a message in the last N minutes
  messagedRecently: boolean;
  // whether local time is in quiet hours
  isQuietHours:    boolean;
}

// ── Public export ─────────────────────────────────────────────────────────────

export function runProactiveDecisionGraph(input: ProactiveDecisionInput): ProactiveDecision {
  const { intervention, academicState, momentum, realityFacts,
          hasActiveSession, studiedToday, isInCooldown,
          messagedRecently, isQuietHours } = input;

  // ── Gate 0: No event scheduled ────────────────────────────────────────────
  if (intervention.type === "none" || !intervention.shouldFire) {
    return suppress(intervention.type, "no event scheduled or intervention opted out", 0, 0);
  }

  // ── Gate 1: Quiet hours — suppress all ───────────────────────────────────
  if (isQuietHours) {
    return suppress(intervention.type, "quiet hours", intervention.priority, intervention.confidence);
  }

  // ── Gate 2: Student messaged very recently — suppress all ─────────────────
  if (messagedRecently) {
    return suppress(intervention.type, "student active in conversation", intervention.priority, intervention.confidence);
  }

  // ── Gate 3: Cooldown active for this intervention type ───────────────────
  if (isInCooldown) {
    return suppress(intervention.type, "cooldown active", intervention.priority, intervention.confidence);
  }

  // ── Gate 4: Active health reality — block all pressure interventions ──────
  // Loaded reality facts are already filtered to isActive=true by the adapter.
  const hasActiveHealth = realityFacts.some(r => r.category === "health" || r.category === "injury");
  if (hasActiveHealth) {
    const isPressure = PRESSURE_INTERVENTION_TYPES.has(intervention.type);
    if (isPressure) {
      return suppress(intervention.type, "health constraint blocks study pressure", intervention.priority, intervention.confidence);
    }
  }

  // ── Gate 5: High burnout score — convert study pressure to prevention ─────
  // Burnout from academic state scores is the canonical burnout signal.
  const hasBurnoutFlag = academicState.scores.burnoutRisk >= 75;
  if (hasBurnoutFlag && PRESSURE_INTERVENTION_TYPES.has(intervention.type)) {
    return approve("burnout_prevention", "high burnout risk overrides study pressure",
      null, `burnoutRisk=${academicState.scores.burnoutRisk}`, 8, intervention.confidence);
  }

  // ── Gate 6: Burnout risk score high — convert reminder to prevention ──────
  if (academicState.scores.burnoutRisk >= 75 && intervention.type === "study_reminder") {
    return approve("burnout_prevention", "high burnout risk score overrides study reminder",
      null, `burnout_risk=${academicState.scores.burnoutRisk}`, 8, intervention.confidence);
  }

  // ── Gate 7: Exam tomorrow — override normal schedule ─────────────────────
  if (academicState.daysUntilNextExam === 1 && intervention.type !== "exam_countdown") {
    return approve("exam_countdown", "exam tomorrow overrides normal schedule",
      null, "daysUntilNextExam=1", 10, 0.95);
  }

  // ── Gate 8: In active session — only allow session-specific interventions ─
  if (hasActiveSession) {
    const isSessionType = SESSION_INTERVENTION_TYPES.has(intervention.type);
    if (!isSessionType) {
      return suppress(intervention.type, "student in active session — non-session interventions suppressed",
        intervention.priority, intervention.confidence);
    }
  }

  // ── Gate 9: Already studied today — suppress morning brief + reminder ──────
  if (studiedToday) {
    if (intervention.type === "study_reminder" || intervention.type === "morning_brief") {
      return suppress(intervention.type, "student already studied today",
        intervention.priority, intervention.confidence);
    }
  }

  // ── Gate 10: Consecutive misses override milestone celebration ────────────
  if (momentum.consecutiveMisses >= 3 && intervention.type === "milestone_celebration") {
    return suppress(intervention.type, "ongoing misses — delay celebration until streak resumes",
      intervention.priority, intervention.confidence);
  }

  // ── Gate 11: No active session but session_check_in requested ────────────
  if (!hasActiveSession && intervention.type === "session_check_in") {
    return suppress(intervention.type, "no active session to check in on",
      intervention.priority, intervention.confidence);
  }

  // ── Approved ──────────────────────────────────────────────────────────────
  return approve(
    intervention.type,
    intervention.reason,
    null,
    null,
    intervention.priority,
    intervention.confidence,
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const PRESSURE_INTERVENTION_TYPES = new Set<InterventionType>([
  "study_reminder",
  "missed_session",
  "consistency_recovery",
  "revision_reminder",
]);

const SESSION_INTERVENTION_TYPES = new Set<InterventionType>([
  "mid_session_support",
  "session_check_in",
]);

function suppress(
  type:           InterventionType,
  reason:         string,
  priority:       number,
  confidence:     number,
): ProactiveDecision {
  return {
    approved:              false,
    finalInterventionType: type,
    suppressReason:        reason,
    overrideReason:        null,
    priority,
    confidence,
  };
}

function approve(
  type:           InterventionType,
  reason:         string,
  suppressReason: string | null,
  overrideReason: string | null,
  priority:       number,
  confidence:     number,
): ProactiveDecision {
  return {
    approved:              true,
    finalInterventionType: type,
    suppressReason,
    overrideReason,
    priority,
    confidence,
  };
}
