// ─── Decision Graph ───────────────────────────────────────────────────────────
// SKILL.md §6 — 7-node deterministic routing graph.
// Each node has one job. The graph is traversed top-down every turn.
// LLMs never modify the graph path. All routing is code.
// Owner: Decision Graph.
//
// Nodes:
//   N1: Crisis Gate       — life event? → crisis_redirect
//   N2: Directive Gate    — hard directive active? → constrained family
//   N3: Routing Gate      — routingSignal from Understanding Brain → family
//   N4: Pattern Gate      — pattern detected? → pattern-aware family 
//   N5: Momentum Gate     — streak/win signal? → celebrate/push
//   N6: Signal Gate       — study_report or skip? → report family
//   N7: Default Gate      — fallback to Decision Engine scorer

import type { AcademicUnderstanding } from "../types/understanding.types";
import type { AcademicState } from "../types/academic-state.types";
import type { SignalEngineOutput, PatternAnalysis, DecisionEngineInput } from "../types/engine.types";
import type { InterventionName } from "../types/intervention.types";
import type { DecisionGraphOutput } from "../types/response.types";
import type { NovaUserFact } from "../types/memory.types";
import { INTERVENTIONS, INTERVENTION_FAMILIES } from "../types/intervention.types";
import { runDecisionEngine } from "./decision-engine";

type GraphNode = (ctx: GraphContext) => GraphResult | null;

interface GraphContext {
  understanding: AcademicUnderstanding;
  state:         AcademicState;
  signals:       SignalEngineOutput;
  patterns:      PatternAnalysis;
  memories:      NovaUserFact[];
}

interface GraphResult {
  intervention: InterventionName;
  family:       string;
  node:         string;
  reason:       string;
}

// ── N1: Crisis Gate ───────────────────────────────────────────────────────────

const N1_CrisisGate: GraphNode = ({ understanding, state }) => {
  if (understanding.emotion === "distressed" && understanding.intent === "emotional_vent") {
    return {
      intervention: INTERVENTIONS.CRISIS_REDIRECT,
      family:       "crisis",
      node:         "N1",
      reason:       "Distress + emotional vent — crisis redirect before any academic discussion.",
    };
  }
  if (understanding.intent === "life_disclosure" && understanding.disclosureClass === "life_event") {
    return {
      intervention: INTERVENTIONS.EMPATHIZE,
      family:       "crisis",
      node:         "N1",
      reason:       "Life event disclosure — acknowledge first.",
    };
  }
  return null;
};

// ── N2: Directive Gate ────────────────────────────────────────────────────────

const N2_DirectiveGate: GraphNode = ({ understanding, state }) => {
  if (state.hardDirectives.examCrisisMode) {
    // Exam crisis → empathize, then reduce friction
    const exam = understanding.emotion === "anxious_exam" || understanding.emotion === "overwhelmed";
    return {
      intervention: exam ? INTERVENTIONS.EMPATHIZE : INTERVENTIONS.REDUCE_FRICTION,
      family:       "exam_prep",
      node:         "N2",
      reason:       `Exam crisis mode (${state.daysUntilNextExam}d until exam).`,
    };
  }

  if (state.hardDirectives.recoveryMode) {
    return {
      intervention: INTERVENTIONS.PREVENT_BURNOUT,
      family:       "burnout",
      node:         "N2",
      reason:       `Recovery mode — ${state.consecutiveMisses} consecutive misses.`,
    };
  }

  if (state.momentaryState === "burned_out" || state.scores.burnoutRisk > 70) {
    return {
      intervention: INTERVENTIONS.PREVENT_BURNOUT,
      family:       "burnout",
      node:         "N2",
      reason:       `Burnout risk ${state.scores.burnoutRisk}/100.`,
    };
  }

  return null;
};

// ── N3: Routing Gate ──────────────────────────────────────────────────────────
// Converts routingSignal → family → first family member (filtered by blocklist)

const N3_RoutingGate: GraphNode = ({ understanding, state }) => {
  const blockedDirectives = new Set<string>();
  if (state.hardDirectives.noStudyPressure) {
    blockedDirectives.add(INTERVENTIONS.ACCOUNTABILITY);
    blockedDirectives.add(INTERVENTIONS.CHALLENGE);
  }
  if (state.hardDirectives.noChallenging) {
    blockedDirectives.add(INTERVENTIONS.CHALLENGE);
  }

  const ROUTING_MAP: Record<string, InterventionName[]> = {
    knowledge_engine:  INTERVENTION_FAMILIES.topic_help,
    planning_engine:   INTERVENTION_FAMILIES.planning,
    exam_engine:       INTERVENTION_FAMILIES.exam_prep,
    retention_engine:  INTERVENTION_FAMILIES.topic_help,
    coaching_only:     [INTERVENTIONS.EMPATHIZE, INTERVENTIONS.SURFACE_COMMITMENT],
    reality_extraction:[INTERVENTIONS.CLARIFY, INTERVENTIONS.EMPATHIZE],
  };

  const candidates = ROUTING_MAP[understanding.routingSignal] ?? [];
  const allowed    = candidates.filter(i => !blockedDirectives.has(i));

  if (allowed.length === 0) return null;

  // Intent-aware pick within family
  if (understanding.intent === "identity_doubt") {
    return {
      intervention: INTERVENTIONS.REINFORCE_IDENTITY,
      family:       "identity",
      node:         "N3",
      reason:       `Identity doubt intent → identity family.`,
    };
  }
  if (understanding.intent === "emotional_vent" || understanding.disclosureClass === "emotional_disclosure") {
    return {
      intervention: INTERVENTIONS.EMPATHIZE,
      family:       "emotional",
      node:         "N3",
      reason:       `Emotional content — empathize before routing.`,
    };
  }

  return {
    intervention: allowed[0]!,
    family:       understanding.routingSignal,
    node:         "N3",
    reason:       `routingSignal=${understanding.routingSignal} → family=${understanding.routingSignal}.`,
  };
};

// ── N4: Pattern Gate ──────────────────────────────────────────────────────────

const N4_PatternGate: GraphNode = ({ patterns, state }) => {
  const dom = patterns.dominantPattern;
  if (!dom || dom.severity === "emerging" || dom.confidence < 0.7) return null;

  const PATTERN_INTERVENTION: Partial<Record<string, InterventionName>> = {
    ghosting:             INTERVENTIONS.RE_ENGAGEMENT,
    motivation_crash:     INTERVENTIONS.SURFACE_BREAKTHROUGH,
    excuse_loop:          INTERVENTIONS.CHALLENGE,
    overplanning:         INTERVENTIONS.REDUCE_FRICTION,
    perfectionism:        INTERVENTIONS.REFRAME_FAILURE,
    restart_cycle:        INTERVENTIONS.ANCHOR_COMMITMENT,
    avoidance_pattern:    INTERVENTIONS.REDUCE_FRICTION,
    comparison_trap:      INTERVENTIONS.REINFORCE_IDENTITY,
    calibration_delusion: INTERVENTIONS.CALIBRATION_CHECK,
    tutorial_hell:        INTERVENTIONS.PROBLEM_SOLVE,
  };

  const intervention = PATTERN_INTERVENTION[dom.type];
  if (!intervention) return null;

  // Block if hard directive prevents it
  if (state.hardDirectives.noChallenging && intervention === INTERVENTIONS.CHALLENGE) return null;
  if (state.hardDirectives.noStudyPressure && intervention === INTERVENTIONS.ACCOUNTABILITY) return null;

  return {
    intervention,
    family:  "pattern",
    node:    "N4",
    reason:  `Pattern ${dom.type} (${dom.severity}, ${(dom.confidence * 100).toFixed(0)}%) — addressing directly.`,
  };
};

// ── N5: Momentum Gate ─────────────────────────────────────────────────────────

const N5_MomentumGate: GraphNode = ({ signals, state }) => {
  const hasAchievement = signals.detectedSignals.some(s => s.type === "achievement");
  const hasConsistency = signals.detectedSignals.some(s => s.type === "consistency");

  if (state.momentaryState === "momentum" || state.studyStreakDays >= 5 || hasAchievement) {
    return {
      intervention: INTERVENTIONS.CELEBRATE_WIN,
      family:       "momentum",
      node:         "N5",
      reason:       `Momentum state — ${state.studyStreakDays}-day streak${hasAchievement ? " + achievement signal" : ""}.`,
    };
  }

  if (state.momentaryState === "returning" || state.daysSinceLastSession > 5) {
    return {
      intervention: INTERVENTIONS.RE_ENGAGEMENT,
      family:       "reengagement",
      node:         "N5",
      reason:       `Returning after ${state.daysSinceLastSession} days — gentle re-entry.`,
    };
  }

  return null;
};

// ── N6: Signal Gate ───────────────────────────────────────────────────────────

const N6_SignalGate: GraphNode = ({ signals, state, understanding }) => {
  const hasReport = signals.detectedSignals.some(s => s.type === "study_report");
  const hasSkip   = signals.detectedSignals.some(s => s.type === "study_skip");
  const hasCommit = signals.detectedSignals.some(s => s.type === "commitment");

  if (hasReport) {
    const family = INTERVENTION_FAMILIES.study_report;
    // Celebrate unless already celebrated in same week
    return {
      intervention: family[0]!,
      family:       "study_report",
      node:         "N6",
      reason:       "Study session reported — acknowledge and reinforce.",
    };
  }

  if (hasSkip) {
    const emotion = understanding.emotion;
    const isEmotional = ["discouraged", "self_doubt", "overwhelmed", "anxious_general"].includes(emotion);
    const chosen = isEmotional ? INTERVENTIONS.EMPATHIZE : INTERVENTIONS.ACCOUNTABILITY;
    if (state.hardDirectives.noStudyPressure && chosen === INTERVENTIONS.ACCOUNTABILITY) {
      return {
        intervention: INTERVENTIONS.EMPATHIZE,
        family:       "skip_report",
        node:         "N6",
        reason:       "Session skipped + burnout mode — empathize, not accountability.",
      };
    }
    return {
      intervention: chosen,
      family:       "skip_report",
      node:         "N6",
      reason:       `Session skipped — ${isEmotional ? "emotional context → empathize" : "direct accountability"}.`,
    };
  }

  if (hasCommit) {
    return {
      intervention: INTERVENTIONS.ANCHOR_COMMITMENT,
      family:       "accountability",
      node:         "N6",
      reason:       "Commitment made — anchor with specifics.",
    };
  }

  return null;
};

// ── N7: Default — full Decision Engine ───────────────────────────────────────

const N7_Default: GraphNode = ({ understanding, state, memories, patterns, signals }) => {
  const input: DecisionEngineInput = { understanding, state, memories, signals: signals.detectedSignals, patterns };
  const result = runDecisionEngine(input);
  return {
    intervention: result.intervention,
    family:       "scored",
    node:         "N7",
    reason:       result.evidence,
  };
};

// ── Traversal ─────────────────────────────────────────────────────────────────
// Priority order:
//   N1 Crisis → N2 Directive → N5 Momentum → N6 Signal → N4 Pattern → N3 Routing → N7 Default
// Celebration and re-engagement are checked BEFORE generic routing because they
// are the most context-specific and highest-value responses.

const NODES: GraphNode[] = [
  N1_CrisisGate,
  N2_DirectiveGate,
  N5_MomentumGate,    // celebrate/re-engage before routing
  N6_SignalGate,      // study_report/skip before generic routing
  N4_PatternGate,     // pattern override before routing
  N3_RoutingGate,     // topic/plan/exam routing
  N7_Default,
];

export function runDecisionGraph(
  understanding: AcademicUnderstanding,
  state:         AcademicState,
  signals:       SignalEngineOutput,
  patterns:      PatternAnalysis,
  memories:      NovaUserFact[],
): DecisionGraphOutput {
  const ctx: GraphContext = { understanding, state, signals, patterns, memories };

  for (const node of NODES) {
    const result = node(ctx);
    if (result) {
      return {
        selectedIntervention: result.intervention,
        interventionFamily:   result.family,
        graphNode:            result.node,
        reason:               result.reason,
        confidence:           result.node === "N7" ? 0.6 : 0.85,
      };
    }
  }

  // Should never reach here (N7 always returns)
  return {
    selectedIntervention: INTERVENTIONS.EMPATHIZE,
    interventionFamily:   "fallback",
    graphNode:            "N7",
    reason:               "Graph traversal fallback.",
    confidence:           0.3,
  };
}
