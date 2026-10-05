// ─── Decision Engine ──────────────────────────────────────────────────────────
// SKILL.md §7 — 100% deterministic intervention selection.
// LLM never selects interventions. LLM only expresses the selected one.
// Owner: Decision Engine. All scorers are pure functions.

import type { AcademicUnderstanding } from "../types/understanding.types";
import type { AcademicState } from "../types/academic-state.types";
import type { PatternAnalysis, DecisionEngineInput, DecisionEngineOutput, InterventionScore } from "../types/engine.types";
import type { InterventionName } from "../types/intervention.types";
import { INTERVENTIONS, INTERVENTION_FAMILIES } from "../types/intervention.types";
import type { NovaUserFact } from "../types/memory.types";

// ── Blocklist: hard rules that prevent certain interventions ───────────────────
// SKILL.md §7.2: Decision Engine enforces directives structurally.

function computeBlockedInterventions(state: AcademicState): InterventionName[] {
  const blocked: InterventionName[] = [];

  if (state.hardDirectives.noStudyPressure) {
    blocked.push(INTERVENTIONS.ACCOUNTABILITY, INTERVENTIONS.CHALLENGE, INTERVENTIONS.CONSISTENCY_CHECK);
  }
  if (state.hardDirectives.noChallenging) {
    blocked.push(INTERVENTIONS.CHALLENGE, INTERVENTIONS.ACCOUNTABILITY);
  }
  if (state.hardDirectives.examCrisisMode) {
    blocked.push(INTERVENTIONS.GOAL_ALIGNMENT, INTERVENTIONS.MOMENTUM_PUSH, INTERVENTIONS.CONSISTENCY_CHECK);
  }
  if (state.hardDirectives.planFreezeMode) {
    blocked.push(INTERVENTIONS.PROBLEM_SOLVE);  // no new plans when exam is tomorrow
  }
  if (state.hardDirectives.beginnerMode) {
    blocked.push(INTERVENTIONS.CHALLENGE, INTERVENTIONS.CALIBRATION_CHECK);
  }

  return [...new Set(blocked)];
}

// ── Scorer helpers ─────────────────────────────────────────────────────────────

type Scorer = (
  understanding: AcademicUnderstanding,
  state:         AcademicState,
  memories:      NovaUserFact[],
  patterns:      PatternAnalysis,
) => number;  // 0–100

const SCORERS: Record<InterventionName, Scorer> = {

  empathize: (u, s) => {
    let score = 20;
    if (u.emotion === "overwhelmed")    score += 35;
    if (u.emotion === "distressed")     score += 40;
    if (u.emotion === "anxious_exam")   score += 30;
    if (u.emotion === "discouraged")    score += 25;
    if (u.emotion === "self_doubt")     score += 30;
    if (u.intent === "emotional_vent")  score += 40;
    if (u.intent === "life_disclosure") score += 35;
    if (u.disclosureClass !== "none")   score += 15;
    if (s.hardDirectives.noStudyPressure) score += 20;
    return Math.min(100, score);
  },

  challenge: (u, s) => {
    let score = 20;
    if (u.emotion === "neutral" || u.emotion === "determined") score += 20;
    if (u.intent === "excuse")           score += 30;
    if (s.scores.engagement > 60 && s.scores.momentum > 60) score += 15;
    if (s.momentaryState === "excuse_active") score += 20;
    if (s.hardDirectives.noChallenging) return 0;  // hard block
    if (s.hardDirectives.noStudyPressure) return 0;
    return Math.min(100, score);
  },

  accountability: (u, s, _, patterns) => {
    let score = 25;
    if (u.intent === "study_skip_report")  score += 30;
    if (u.intent === "commitment_made")    score += 20;
    if (s.scores.planAdherence < 40)      score += 20;
    if (patterns.dominantPattern?.type === "overplanning") score += 15;
    if (s.hardDirectives.noStudyPressure) return 0;
    if (s.hardDirectives.noChallenging)   return 0;
    return Math.min(100, score);
  },

  refocus: (u, s) => {
    let score = 20;
    if (u.intent === "topic_question" && u.ambiguityScore > 0.5) score += 30;
    if (u.intent === "general_chat")   score += 20;
    if (s.momentaryState === "disengaged") score += 25;
    if (s.momentaryState === "returning")  score += 20;
    return Math.min(100, score);
  },

  clarify: (u) => {
    let score = 20;
    if (u.ambiguityScore > 0.75) score += 40;
    if (u.intent === "topic_question" && !u.topic) score += 25;
    return Math.min(100, score);
  },

  problem_solve: (u, s) => {
    let score = 20;
    if (u.intent === "topic_question")  score += 30;
    if (u.intent === "plan_request")    score += 35;
    if (u.intent === "progress_check")  score += 20;
    if (s.hardDirectives.planFreezeMode) return 0;
    return Math.min(100, score);
  },

  reduce_friction: (u, s, _, patterns) => {
    let score = 20;
    if (s.momentaryState === "disengaged")       score += 30;
    if (s.momentaryState === "burned_out")        score += 35;
    if (patterns.dominantPattern?.type === "avoidance_pattern") score += 25;
    if (patterns.dominantPattern?.type === "perfectionism")     score += 25;
    if (s.scores.burnoutRisk > 50) score += 20;
    return Math.min(100, score);
  },

  reinforce_identity: (u, s) => {
    let score = 20;
    if (u.intent === "identity_doubt")        score += 45;
    if (u.emotion === "identity_threat")      score += 45;
    if (s.momentaryState === "self_doubt")    score += 35;
    if (s.hardDirectives.noChallenging)       score += 20;
    return Math.min(100, score);
  },

  surface_breakthrough: (u, s) => {
    let score = 15;
    if (u.intent === "reflection")             score += 25;
    if (u.intent === "mastery_claim")          score += 20;
    if (s.scores.confidence > 70 && s.scores.engagement > 65) score += 20;
    return Math.min(100, score);
  },

  surface_commitment: (u, s) => {
    let score = 15;
    if (u.intent === "reflection")             score += 20;
    if (u.intent === "general_chat" && s.scores.momentum < 50) score += 20;
    if (s.scores.engagement < 40)             score += 25;
    return Math.min(100, score);
  },

  anchor_commitment: (u, s) => {
    let score = 20;
    if (u.intent === "commitment_made")        score += 40;
    if (u.intent === "study_report")           score += 25;
    if (s.scores.planAdherence < 50)          score += 15;
    return Math.min(100, score);
  },

  celebrate_win: (u, s) => {
    let score = 10;
    if (u.intent === "study_report")           score += 30;
    if (u.intent === "progress_check" && s.scores.momentum > 60) score += 25;
    if (s.studyStreakDays >= 7)               score += 30;
    if (s.studyStreakDays >= 3)               score += 15;
    return Math.min(100, score);
  },

  reframe_failure: (u, s) => {
    let score = 15;
    if (u.intent === "study_skip_report")       score += 35;
    if (u.emotion === "discouraged")            score += 30;
    if (u.emotion === "frustrated")             score += 25;
    if (s.momentaryState === "returning")       score += 20;
    if (s.consecutiveMisses > 2)              score += 15;
    return Math.min(100, score);
  },

  prevent_spiral: (u, s) => {
    let score = 10;
    if (u.emotion === "distressed")             score += 45;
    if (u.emotion === "overwhelmed" && s.scores.burnoutRisk > 50) score += 35;
    if (u.intent === "identity_doubt" && u.emotion === "anxious_general") score += 30;
    return Math.min(100, score);
  },

  prevent_burnout: (u, s) => {
    let score = 10;
    if (s.scores.burnoutRisk > 60)             score += 40;
    if (s.momentaryState === "burned_out")      score += 45;
    if (s.hardDirectives.noStudyPressure)       score += 25;
    return Math.min(100, score);
  },

  momentum_push: (u, s, _, patterns) => {
    let score = 15;
    if (u.intent === "study_report")           score += 20;
    if (s.studyStreakDays >= 3)               score += 25;
    if (s.momentaryState === "momentum")      score += 30;
    if (patterns.dominantPattern?.type === "restart_cycle") score += 20;
    if (s.hardDirectives.examCrisisMode)       return 0;  // crisis → not the time
    return Math.min(100, score);
  },

  consistency_check: (u, s) => {
    let score = 15;
    if (u.intent === "progress_check")         score += 30;
    if (s.consecutiveMisses > 1)             score += 20;
    if (s.scores.planAdherence < 50)         score += 20;
    if (s.hardDirectives.noStudyPressure)      return 0;
    return Math.min(100, score);
  },

  goal_alignment: (u, s) => {
    let score = 15;
    if (u.intent === "accountability_request") score += 25;
    if (u.intent === "reflection")            score += 20;
    if (s.semesterPhase === "beginning")      score += 15;
    if (s.hardDirectives.examCrisisMode)       return 0;
    return Math.min(100, score);
  },

  calibration_check: (u, s, _, patterns) => {
    let score = 10;
    if (s.hardDirectives.calibrationAlert)                              score += 50;
    if (patterns.dominantPattern?.type === "calibration_delusion")      score += 40;
    if (u.intent === "mastery_claim")                                   score += 25;
    if (s.hardDirectives.beginnerMode)                                   return 0;
    return Math.min(100, score);
  },

  crisis_redirect: (u, s) => {
    let score = 5;
    if (u.emotion === "distressed" && u.intent === "emotional_vent")    score += 60;
    if (u.intent === "life_disclosure" && u.emotion === "distressed")   score += 50;
    return Math.min(100, score);
  },

  re_engagement: (u, s) => {
    let score = 10;
    if (s.momentaryState === "disengaged")    score += 40;
    if (s.daysSinceLastSession > 14)         score += 30;
    if (u.intent === "general_chat" && s.daysSinceLastSession > 7) score += 20;
    return Math.min(100, score);
  },
};

// ── Main selection ─────────────────────────────────────────────────────────────

export function runDecisionEngine(input: DecisionEngineInput): DecisionEngineOutput {
  const { understanding, state, memories, signals, patterns } = input;

  const blockedInterventions = computeBlockedInterventions(state);
  const blockedSet           = new Set<InterventionName>(blockedInterventions);

  const candidates: InterventionScore[] = [];

  for (const [name, scorer] of Object.entries(SCORERS) as Array<[InterventionName, Scorer]>) {
    if (blockedSet.has(name)) continue;

    const rawScore = scorer(understanding, state, memories, patterns);
    if (rawScore <= 0) continue;

    // Compute reason summary
    const reason = buildReason(name, understanding, state, patterns);

    candidates.push({
      intervention: name,
      score:        rawScore,
      confidence:   Math.min(1, rawScore / 100),
      reason,
    });
  }

  candidates.sort((a, b) => b.score - a.score);

  const winner = candidates[0] ?? {
    intervention: INTERVENTIONS.EMPATHIZE as InterventionName,
    score:        30,
    confidence:   0.3,
    reason:       "Fallback: no other intervention scored above threshold.",
  };

  return {
    intervention:         winner.intervention,
    score:                winner.score,
    confidence:           winner.confidence,
    evidence:             winner.reason,
    candidates:           candidates.slice(0, 5),  // top 5 for debugging
    blockedInterventions,
  };
}

// ── Reason builder (for micro-prompt evidence text) ───────────────────────────

function buildReason(
  name:          InterventionName,
  understanding: AcademicUnderstanding,
  state:         AcademicState,
  patterns:      PatternAnalysis,
): string {
  switch (name) {
    case "empathize":
      return `User is ${understanding.emotion}, intent=${understanding.intent}. Emotional needs first.`;
    case "challenge":
      return `Excuse detected (${understanding.intent}). Direct challenge appropriate.`;
    case "accountability":
      return `Plan adherence at ${state.scores.planAdherence}. Session skipped.`;
    case "refocus":
      return `Ambiguity score ${(understanding.ambiguityScore * 100).toFixed(0)}% — redirecting to study focus.`;
    case "clarify":
      return `Topic unclear (ambiguity ${(understanding.ambiguityScore * 100).toFixed(0)}%) — need more info.`;
    case "problem_solve":
      return `User asked about ${understanding.topic ?? "study"} — provide practical steps.`;
    case "reduce_friction":
      return `${state.momentaryState} state — lower barrier, don't add pressure.`;
    case "reinforce_identity":
      return `Identity threat / self-doubt (${understanding.emotion}) — reinforce who they are.`;
    case "surface_breakthrough":
      return `Reflection intent — explore insight moment.`;
    case "surface_commitment":
      return `Low engagement (${state.scores.engagement}) — elicit commitment.`;
    case "anchor_commitment":
      return `Commitment just made — anchor it with specifics.`;
    case "celebrate_win":
      return `Study session reported${state.studyStreakDays > 0 ? ` — ${state.studyStreakDays}-day streak` : ""}.`;
    case "reframe_failure":
      return `Session skipped or missed${state.consecutiveMisses > 1 ? ` — ${state.consecutiveMisses} consecutive misses` : ""}.`;
    case "prevent_spiral":
      return `Distress / overwhelm at critical level — prevent emotional spiral.`;
    case "prevent_burnout":
      return `Burnout risk ${state.scores.burnoutRisk}/100 — protect capacity.`;
    case "momentum_push":
      return `${state.studyStreakDays}-day streak — amplify momentum.`;
    case "consistency_check":
      return `Plan adherence at ${state.scores.planAdherence} — check in on commitment.`;
    case "goal_alignment":
      return `Reflection turn — reconnect actions to long-term goal.`;
    case "calibration_check":
      return `Mastery vs confidence gap detected — surface calibration.`;
    case "crisis_redirect":
      return `Distress + life disclosure — redirect to support if needed.`;
    case "re_engagement":
      return `${state.daysSinceLastSession} days inactive — gentle re-entry.`;
    default:
      return `Selected based on current state.`;
  }
}
