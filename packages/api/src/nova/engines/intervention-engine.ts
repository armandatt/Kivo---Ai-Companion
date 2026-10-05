// ─── Intervention Engine ──────────────────────────────────────────────────────
// Adds confidence, constraints, and the shouldFire flag on top of a raw
// SchedulingDecision. Consumes Reality to enforce overrides.
// NEVER makes LLM calls. Deterministic.
// Owner: Phase 5 Proactive Mentor System.

import type { InterventionDecision, SchedulingDecision, MomentumState } from "../types/proactive.types";
import { INTERVENTION_COOLDOWN_HOURS } from "../types/proactive.types";
import type { AcademicState } from "../types/academic-state.types";
import type { NovaRealityFact } from "../types/reality.types";

export interface InterventionInput {
  scheduling:    SchedulingDecision;
  momentum:      MomentumState;
  academicState: AcademicState;
  realityFacts:  NovaRealityFact[];
}

// ── Public export ─────────────────────────────────────────────────────────────

export function computeIntervention(input: InterventionInput): InterventionDecision {
  const { scheduling, momentum, academicState, realityFacts } = input;

  if (scheduling.eventType === "none") {
    return noIntervention("no event scheduled");
  }

  const constraints = buildConstraints(academicState, realityFacts, momentum);
  const confidence  = computeConfidence(scheduling, momentum, academicState);

  // Reality always overrides scheduling — check here before shouldFire.
  const realityBlock = checkRealityBlock(scheduling.eventType, realityFacts);
  if (realityBlock) {
    return {
      type:          scheduling.eventType,
      reason:        scheduling.reason,
      priority:      scheduling.priority,
      confidence,
      constraints,
      cooldownHours: INTERVENTION_COOLDOWN_HOURS[scheduling.eventType],
      shouldFire:    false,
    };
  }

  return {
    type:          scheduling.eventType,
    reason:        scheduling.reason,
    priority:      scheduling.priority,
    confidence,
    constraints,
    cooldownHours: INTERVENTION_COOLDOWN_HOURS[scheduling.eventType],
    shouldFire:    confidence >= 0.35 && scheduling.priority >= 1,
  };
}

// ── Constraint builder ────────────────────────────────────────────────────────
// Constraints are informational strings passed to the Response Brain context.
// They do NOT gate firing — that's the Decision Graph's job.

// Illness and injury both mean: no study pressure.
function isHealthReality(r: NovaRealityFact): boolean {
  return r.category === "health" || r.category === "injury";
}

function buildConstraints(
  state:        AcademicState,
  realityFacts: NovaRealityFact[],
  momentum:     MomentumState,
): string[] {
  const c: string[] = [];

  if (state.hardDirectives.examCrisisMode)    c.push("exam_mode");
  if (state.hardDirectives.noStudyPressure)   c.push("no_pressure");
  if (state.hardDirectives.recoveryMode)      c.push("recovery_mode");
  if (state.scores.burnoutRisk >= 70)         c.push("burnout_risk");
  if (momentum.currentMomentum === "critical") c.push("critical_momentum");
  if (momentum.weeklyConsistency === "poor")   c.push("low_consistency");

  // All loaded reality facts are already active (adapter pre-filters by isActive)
  const hasHealth   = realityFacts.some(isHealthReality);
  const hasWorkload = realityFacts.some(r => r.category === "life_constraint" && r.subtype === "work");
  const hasTravel   = realityFacts.some(r =>
    r.category === "life_constraint" &&
    (r.subtype === "travel" || r.description.toLowerCase().includes("travel"))
  );

  if (hasHealth)   c.push("health_constraint");
  if (hasTravel)   c.push("travel_mode");
  if (hasWorkload) c.push("heavy_workload");

  return c;
}

// ── Reality block ─────────────────────────────────────────────────────────────
// Certain reality facts unconditionally suppress study-pressure interventions.
// exam_countdown and burnout_prevention are never blocked.

const PRESSURE_INTERVENTIONS = new Set([
  "study_reminder",
  "missed_session",
  "consistency_recovery",
  "revision_reminder",
]);

function checkRealityBlock(
  eventType:    string,
  realityFacts: NovaRealityFact[],
): string | null {
  // Never block these — they exist precisely to help during hard times
  if (eventType === "exam_countdown")    return null;
  if (eventType === "burnout_prevention") return null;
  if (eventType === "morning_brief")      return null;

  // All loaded facts are already active (adapter pre-filters by isActive=true)
  const hasActiveHealth = realityFacts.some(isHealthReality);
  if (hasActiveHealth && PRESSURE_INTERVENTIONS.has(eventType)) {
    return "health constraint active";
  }

  return null;
}

// ── Confidence ────────────────────────────────────────────────────────────────
// 0–1 estimate of how sure we are this intervention is appropriate right now.

function computeConfidence(
  scheduling:    SchedulingDecision,
  momentum:      MomentumState,
  academicState: AcademicState,
): number {
  let conf = 0.5;  // base

  // Priority boosts confidence
  conf += scheduling.priority * 0.03;

  // Urgency boost
  if (scheduling.isUrgent) conf += 0.15;

  // Momentum signals
  if (momentum.currentMomentum === "critical" || momentum.consecutiveMisses >= 3) conf += 0.10;
  if (momentum.currentMomentum === "high" && scheduling.eventType === "study_reminder") conf += 0.10;

  // Academic state boosts
  if (academicState.hardDirectives.examCrisisMode && scheduling.eventType === "exam_countdown") conf += 0.20;
  if (academicState.scores.burnoutRisk >= 70 && scheduling.eventType === "burnout_prevention") conf += 0.15;

  return Math.min(1, Math.round(conf * 100) / 100);
}

// ── No-intervention shortcut ──────────────────────────────────────────────────

function noIntervention(reason: string): InterventionDecision {
  return {
    type:          "none",
    reason,
    priority:      0,
    confidence:    1.0,
    constraints:   [],
    cooldownHours: 0,
    shouldFire:    false,
  };
}
