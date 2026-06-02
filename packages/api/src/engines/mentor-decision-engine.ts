import type { ConversationAnalysis, MessageIntent, RequestedOutcome } from "../types/mentor.types";
import type { PatternAnalysis, PatternType, PatternSeverity } from "../types/pattern.types";
import type { MemoryContext } from "../types/memory.types";
import type { MentorState, StateFlag } from "./user-state-engine";

// ═══════════════════════════════════════════════════════════════════════════════
// ENUMS
// ═══════════════════════════════════════════════════════════════════════════════

export enum MentorAction {
  ASK            = "ASK",
  TEACH          = "TEACH",
  PLAN           = "PLAN",
  CHALLENGE      = "CHALLENGE",
  ACCOUNTABILITY = "ACCOUNTABILITY",
  ENCOURAGE      = "ENCOURAGE",
  REFLECT        = "REFLECT",
  REVIEW         = "REVIEW",
  REDUCE_SCOPE   = "REDUCE_SCOPE",
}

export enum DecisionPriority {
  CRITICAL   = 0,
  URGENT     = 1,
  IMPORTANT  = 2,
  STANDARD   = 3,
  SUPPORTIVE = 4,
  LOW        = 5,
}

export enum DecisionUrgency {
  CRITICAL = "CRITICAL",
  HIGH     = "HIGH",
  STANDARD = "STANDARD",
  LOW      = "LOW",
}

export enum DecisionTone {
  HARD       = "HARD",       // direct confrontation — no softening
  FIRM       = "FIRM",       // clear and direct
  STANDARD   = "STANDARD",   // balanced
  SUPPORTIVE = "SUPPORTIVE", // warm, affirming
  GENTLE     = "GENTLE",     // soft, careful — for high stress/burnout
}

// ═══════════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════════

export interface DecisionInput {
  analysis:        ConversationAnalysis;
  state:           MentorState;
  patterns:        PatternAnalysis;
  memory:          MemoryContext;
  persona:         string;
  tonePreference:  "hard" | "soft" | "dynamic";
  isFirstSession:  boolean;
  messageCountToday: number;
}

export interface BlockedAction {
  action: MentorAction;
  ruleId: string;
  reason: string;
}

export interface RuleMatch {
  ruleId:     string;
  action:     MentorAction;
  subAction:  string;
  priority:   DecisionPriority;
  urgency:    DecisionUrgency;
  confidence: number;
  reason:     string;
}

export interface MentorDecision {
  action:           MentorAction;
  subAction:        string;
  urgency:          DecisionUrgency;
  tone:             DecisionTone;
  requiresLLM:      boolean;
  tokenBudget:      number;
  template:         string | null;
  ruleId:           string;
  reason:           string;
  confidence:       number;
  contextHints:     string[];
  decisionPath:     string[];
  blockedActions:   BlockedAction[];
  suppressFollowUp: boolean;
}

// ── Decision rule contract ────────────────────────────────────────────────────

interface DecisionRule {
  id:           string;
  action:       MentorAction;
  subAction:    string;
  priority:     DecisionPriority;
  urgency:      DecisionUrgency;
  description:  string;
  condition:    (i: DecisionInput) => boolean;
  confidence:   (i: DecisionInput) => number;
  requiresLLM:  boolean;
  tokenBudget:  number;
  template:     string | null;
  contextHints: string[];
  suppressFollowUp: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════════
// HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

function hasFlag(state: MentorState, ...flags: StateFlag[]): boolean {
  return flags.some((f) => state.flags.includes(f));
}

function hasPattern(patterns: PatternAnalysis, ...types: PatternType[]): boolean {
  return patterns.patterns.some((p) => types.includes(p.type));
}

function patternSeverity(patterns: PatternAnalysis, ...types: PatternType[]): PatternSeverity | null {
  const match = patterns.patterns.find((p) => types.includes(p.type));
  return match?.severity ?? null;
}

function patternConfidence(patterns: PatternAnalysis, ...types: PatternType[]): number {
  const match = patterns.patterns.find((p) => types.includes(p.type));
  return match?.confidenceScore ?? 0;
}

function intentIs(analysis: ConversationAnalysis, ...intents: MessageIntent[]): boolean {
  return intents.includes(analysis.intent) || analysis.secondaryIntents.some((i) => intents.includes(i));
}

function outcomeIs(analysis: ConversationAnalysis, ...outcomes: RequestedOutcome[]): boolean {
  return outcomes.includes(analysis.requestedOutcome);
}

function capacityUnknown(input: DecisionInput): boolean {
  return (
    input.isFirstSession ||
    (input.state.totalCommitmentsMade === 0 && input.memory.sessionCount <= 2) ||
    input.analysis.goal !== null && input.analysis.goal.isVague
  );
}

function isToneHardBlocked(input: DecisionInput): boolean {
  return (
    input.state.burnoutRisk >= 55 ||
    input.state.stress >= 65 ||
    hasFlag(input.state, "burnout_risk_high", "burnout_risk_critical") ||
    input.analysis.emotion.primary === "overwhelmed" ||
    input.analysis.emotion.primary === "anxious"
  );
}

function isToneGentleForced(input: DecisionInput): boolean {
  return (
    input.state.burnoutRisk >= 70 ||
    hasFlag(input.state, "burnout_risk_critical") ||
    input.analysis.emotion.primary === "overwhelmed" ||
    (input.state.consecutiveMisses >= 4 && input.state.stress >= 60)
  );
}

function scaledConfidence(value: number, min: number, max: number): number {
  return Math.min(Math.max((value - min) / (max - min), 0), 1);
}

function daysSilent(memory: MemoryContext, now = new Date()): number {
  if (!memory.lastUserMessage) return 999;
  const lastMsg = memory.shortTerm
    .filter((m) => m.role === "user")
    .sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime())[0];
  if (!lastMsg) return 999;
  return Math.floor((now.getTime() - lastMsg.timestamp.getTime()) / 86_400_000);
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECISION RULES
// ═══════════════════════════════════════════════════════════════════════════════

const RULES: DecisionRule[] = [

  // ── PRIORITY 0 — REDUCE_SCOPE (critical safety) ─────────────────────────────

  {
    id: "RS01",
    action: MentorAction.REDUCE_SCOPE,
    subAction: "burnout_critical",
    priority: DecisionPriority.CRITICAL,
    urgency: DecisionUrgency.CRITICAL,
    description: "BurnoutRisk above 80 — load reduction is non-negotiable",
    condition: (i) => i.state.burnoutRisk >= 80,
    confidence: (i) => scaledConfidence(i.state.burnoutRisk, 80, 100),
    requiresLLM: true,
    tokenBudget: 120,
    template: null,
    contextHints: ["pattern:burnout_critical", "acknowledge_exhaustion_first", "single_small_task_only", "do_not_push"],
    suppressFollowUp: false,
  },

  {
    id: "RS02",
    action: MentorAction.REDUCE_SCOPE,
    subAction: "stress_capacity_collapse",
    priority: DecisionPriority.CRITICAL,
    urgency: DecisionUrgency.HIGH,
    description: "Stress > 75 and capacity < 25 — user is saturated",
    condition: (i) => i.state.stress >= 75 && i.state.capacity <= 25,
    confidence: (i) => scaledConfidence(i.state.stress, 75, 100) * 0.9,
    requiresLLM: false,
    tokenBudget: 80,
    template: "Before anything else — what's the one thing that actually cannot wait this week? Drop everything else for now.",
    contextHints: [],
    suppressFollowUp: false,
  },

  {
    id: "RS03",
    action: MentorAction.REDUCE_SCOPE,
    subAction: "burnout_pattern_confirmed",
    priority: DecisionPriority.CRITICAL,
    urgency: DecisionUrgency.HIGH,
    description: "Burnout pattern detected at confirmed/critical severity",
    condition: (i) =>
      hasPattern(i.patterns, "consistency_collapse") &&
      (patternSeverity(i.patterns, "consistency_collapse") === "critical" || patternSeverity(i.patterns, "consistency_collapse") === "entrenched") &&
      i.state.burnoutRisk >= 60,
    confidence: (i) => patternConfidence(i.patterns, "consistency_collapse") * 0.9,
    requiresLLM: true,
    tokenBudget: 130,
    template: null,
    contextHints: ["pattern:burnout", "do_not_add_tasks", "acknowledge_before_directing"],
    suppressFollowUp: false,
  },

  // ── PRIORITY 1 — ACCOUNTABILITY (urgent) ────────────────────────────────────

  {
    id: "AC01",
    action: MentorAction.ACCOUNTABILITY,
    subAction: "ghosting_response",
    priority: DecisionPriority.URGENT,
    urgency: DecisionUrgency.HIGH,
    description: "User went silent after active engagement — address the absence",
    condition: (i) =>
      hasPattern(i.patterns, "weekend_ghosting") &&
      patternConfidence(i.patterns, "weekend_ghosting") >= 0.55 &&
      i.state.consecutiveMisses >= 1,
    confidence: (i) => patternConfidence(i.patterns, "weekend_ghosting"),
    requiresLLM: true,
    tokenBudget: 160,
    template: null,
    contextHints: ["address_silence_directly", "do_not_shame", "ask_what_happened", "reference_last_commitment"],
    suppressFollowUp: false,
  },

  {
    id: "AC02",
    action: MentorAction.ACCOUNTABILITY,
    subAction: "excuse_loop_confrontation",
    priority: DecisionPriority.URGENT,
    urgency: DecisionUrgency.HIGH,
    description: "Excuse loop pattern active — name the cycle without shaming",
    condition: (i) =>
      hasPattern(i.patterns, "excuse_cycling") &&
      patternConfidence(i.patterns, "excuse_cycling") >= 0.60 &&
      i.analysis.hasExcuse,
    confidence: (i) => patternConfidence(i.patterns, "excuse_cycling"),
    requiresLLM: true,
    tokenBudget: 180,
    template: null,
    contextHints: ["name_the_pattern", "do_not_accept_excuse_at_face_value", "ask_real_blocker"],
    suppressFollowUp: false,
  },

  {
    id: "AC03",
    action: MentorAction.ACCOUNTABILITY,
    subAction: "consecutive_miss_escalation",
    priority: DecisionPriority.URGENT,
    urgency: DecisionUrgency.HIGH,
    description: "3+ consecutive misses — missed commitments need direct address",
    condition: (i) =>
      i.state.consecutiveMisses >= 3 &&
      !hasFlag(i.state, "burnout_risk_high", "burnout_risk_critical") &&
      i.analysis.intent !== "emotional_vent",
    confidence: (i) => scaledConfidence(i.state.consecutiveMisses, 3, 7),
    requiresLLM: true,
    tokenBudget: 170,
    template: null,
    contextHints: ["reference_missed_count", "ask_specific_blocker", "do_not_lecture"],
    suppressFollowUp: false,
  },

  {
    id: "AC04",
    action: MentorAction.ACCOUNTABILITY,
    subAction: "failure_with_excuse",
    priority: DecisionPriority.URGENT,
    urgency: DecisionUrgency.STANDARD,
    description: "Failure report accompanied by an excuse — hold the standard",
    condition: (i) =>
      i.analysis.hasFailureReport &&
      i.analysis.hasExcuse &&
      i.state.consecutiveMisses >= 2 &&
      !hasFlag(i.state, "burnout_risk_high"),
    confidence: (i) => Math.min(i.analysis.confidence + scaledConfidence(i.state.consecutiveMisses, 2, 5) * 0.3, 1),
    requiresLLM: true,
    tokenBudget: 160,
    template: null,
    contextHints: ["acknowledge_then_redirect", "ask_what_will_be_different", "do_not_validate_excuse"],
    suppressFollowUp: false,
  },

  // ── PRIORITY 2 — CHALLENGE (pattern confrontation) ──────────────────────────

  {
    id: "CH01",
    action: MentorAction.CHALLENGE,
    subAction: "overplanning_intervention",
    priority: DecisionPriority.IMPORTANT,
    urgency: DecisionUrgency.HIGH,
    description: "Overplanning pattern confirmed — stop the planning loop, demand execution",
    condition: (i) =>
      hasPattern(i.patterns, "overplanning_underexecuting") &&
      patternConfidence(i.patterns, "overplanning_underexecuting") >= 0.55 &&
      (intentIs(i.analysis, "plan_request") || outcomeIs(i.analysis, "planning")),
    confidence: (i) => patternConfidence(i.patterns, "overplanning_underexecuting"),
    requiresLLM: true,
    tokenBudget: 180,
    template: null,
    contextHints: ["refuse_new_plan", "point_to_existing_plan", "ask_for_one_action_instead"],
    suppressFollowUp: false,
  },

  {
    id: "CH02",
    action: MentorAction.CHALLENGE,
    subAction: "tutorial_hell_intervention",
    priority: DecisionPriority.IMPORTANT,
    urgency: DecisionUrgency.HIGH,
    description: "Tutorial hell confirmed — stop the consumption, force output",
    condition: (i) =>
      hasPattern(i.patterns, "overplanning_underexecuting") &&
      patternConfidence(i.patterns, "overplanning_underexecuting") >= 0.55 &&
      (i.analysis.domain === "study" || i.analysis.domain === "career") &&
      i.memory.longTerm.goals.length > 0,
    confidence: (i) => patternConfidence(i.patterns, "overplanning_underexecuting") * 0.85,
    requiresLLM: true,
    tokenBudget: 190,
    template: null,
    contextHints: ["name_tutorial_loop", "assign_specific_output", "block_next_course_question"],
    suppressFollowUp: false,
  },

  {
    id: "CH03",
    action: MentorAction.CHALLENGE,
    subAction: "all_or_nothing_reframe",
    priority: DecisionPriority.IMPORTANT,
    urgency: DecisionUrgency.STANDARD,
    description: "All-or-nothing thinking active — challenge the binary frame",
    condition: (i) =>
      hasPattern(i.patterns, "procrastination_spiral") &&
      patternConfidence(i.patterns, "procrastination_spiral") >= 0.55 &&
      i.analysis.hasFailureReport,
    confidence: (i) => patternConfidence(i.patterns, "procrastination_spiral"),
    requiresLLM: true,
    tokenBudget: 170,
    template: null,
    contextHints: ["reject_all_or_nothing_framing", "ask_what_partial_progress_looks_like", "reference_streak_if_exists"],
    suppressFollowUp: false,
  },

  {
    id: "CH04",
    action: MentorAction.CHALLENGE,
    subAction: "perfectionism_start_now",
    priority: DecisionPriority.IMPORTANT,
    urgency: DecisionUrgency.STANDARD,
    description: "Perfectionism pattern — not ready is never ready; force the start",
    condition: (i) =>
      hasPattern(i.patterns, "procrastination_spiral") &&
      patternConfidence(i.patterns, "procrastination_spiral") >= 0.50 &&
      i.analysis.commitmentLevel !== "very_high" &&
      !i.analysis.hasFailureReport,
    confidence: (i) => patternConfidence(i.patterns, "procrastination_spiral") * 0.85,
    requiresLLM: true,
    tokenBudget: 160,
    template: null,
    contextHints: ["reject_wait_until_ready", "assign_minimum_viable_action", "30_minutes_today"],
    suppressFollowUp: false,
  },

  {
    id: "CH05",
    action: MentorAction.CHALLENGE,
    subAction: "restart_cycle_break",
    priority: DecisionPriority.IMPORTANT,
    urgency: DecisionUrgency.HIGH,
    description: "Restart cycle confirmed — name the pattern, refuse to plan again from zero",
    condition: (i) =>
      hasPattern(i.patterns, "goal_abandonment_cycle") &&
      patternConfidence(i.patterns, "goal_abandonment_cycle") >= 0.60 &&
      intentIs(i.analysis, "goal_set"),
    confidence: (i) => patternConfidence(i.patterns, "goal_abandonment_cycle"),
    requiresLLM: true,
    tokenBudget: 190,
    template: null,
    contextHints: ["name_restart_cycle", "count_previous_attempts", "ask_what_is_different_this_time"],
    suppressFollowUp: false,
  },

  {
    id: "CH06",
    action: MentorAction.CHALLENGE,
    subAction: "momentum_push",
    priority: DecisionPriority.IMPORTANT,
    urgency: DecisionUrgency.STANDARD,
    description: "User is performing well — push harder while they have momentum",
    condition: (i) =>
      hasFlag(i.state, "momentum_building", "peak_performance") &&
      i.state.consistency >= 65 &&
      i.state.capacity >= 55 &&
      !i.analysis.hasFailureReport &&
      !hasFlag(i.state, "high_stress", "low_capacity"),
    confidence: (i) => scaledConfidence(i.state.momentum, 65, 90) * scaledConfidence(i.state.consistency, 65, 90),
    requiresLLM: true,
    tokenBudget: 150,
    template: null,
    contextHints: ["acknowledge_progress_briefly", "raise_the_bar", "next_level_challenge"],
    suppressFollowUp: false,
  },

  // ── PRIORITY 3 — PLAN (direction needed) ────────────────────────────────────

  {
    id: "PL01",
    action: MentorAction.PLAN,
    subAction: "user_requested_plan",
    priority: DecisionPriority.STANDARD,
    urgency: DecisionUrgency.STANDARD,
    description: "User explicitly requested a plan",
    condition: (i) =>
      outcomeIs(i.analysis, "planning") &&
      intentIs(i.analysis, "plan_request") &&
      !hasPattern(i.patterns, "overplanning_underexecuting"),
    confidence: (i) => i.analysis.confidence,
    requiresLLM: false,
    tokenBudget: 350,
    template: null,
    contextHints: ["check_feasibility_first", "use_capacity_score", "reference_active_goal"],
    suppressFollowUp: false,
  },

  {
    id: "PL02",
    action: MentorAction.PLAN,
    subAction: "new_goal_needs_structure",
    priority: DecisionPriority.STANDARD,
    urgency: DecisionUrgency.STANDARD,
    description: "Goal just set — create a realistic plan before user loses momentum",
    condition: (i) =>
      intentIs(i.analysis, "goal_set") &&
      i.analysis.goal !== null &&
      !i.analysis.goal.isVague &&
      i.memory.longTerm.goals.length <= 2 &&
      !hasPattern(i.patterns, "overplanning_underexecuting"),
    confidence: (i) => i.analysis.goal?.confidence ?? 0.6,
    requiresLLM: false,
    tokenBudget: 300,
    template: null,
    contextHints: ["use_capacity_score", "start_small", "anchor_to_creature_name_if_exists"],
    suppressFollowUp: false,
  },

  {
    id: "PL03",
    action: MentorAction.PLAN,
    subAction: "recovery_plan_after_accountability",
    priority: DecisionPriority.STANDARD,
    urgency: DecisionUrgency.STANDARD,
    description: "After accountability exchange — build a concrete recovery plan",
    condition: (i) =>
      i.state.consecutiveMisses >= 2 &&
      i.analysis.commitmentLevel !== "none" &&
      intentIs(i.analysis, "commitment_made") &&
      !hasFlag(i.state, "burnout_risk_high"),
    confidence: (i) => i.analysis.commitmentScore * 0.85,
    requiresLLM: false,
    tokenBudget: 280,
    template: null,
    contextHints: ["smaller_scope_than_before", "one_week_only", "daily_minimum_action"],
    suppressFollowUp: false,
  },

  // ── PRIORITY 3 — TEACH (knowledge gap) ──────────────────────────────────────

  {
    id: "TE01",
    action: MentorAction.TEACH,
    subAction: "concept_explanation",
    priority: DecisionPriority.STANDARD,
    urgency: DecisionUrgency.STANDARD,
    description: "User asked a direct question — provide targeted teaching",
    condition: (i) =>
      outcomeIs(i.analysis, "learning") &&
      intentIs(i.analysis, "question") &&
      i.analysis.domain !== "unknown",
    confidence: (i) => i.analysis.confidence,
    requiresLLM: true,
    tokenBudget: 350,
    template: null,
    contextHints: ["match_knowledge_level", "use_examples", "end_with_application_question"],
    suppressFollowUp: false,
  },

  {
    id: "TE02",
    action: MentorAction.TEACH,
    subAction: "stuck_on_approach",
    priority: DecisionPriority.STANDARD,
    urgency: DecisionUrgency.STANDARD,
    description: "User is stuck and confused — teach the approach, not just the answer",
    condition: (i) =>
      i.analysis.emotion.primary === "confused" &&
      intentIs(i.analysis, "question") &&
      i.analysis.constraints.length === 0,
    confidence: (i) => i.analysis.emotion.confidence,
    requiresLLM: true,
    tokenBudget: 320,
    template: null,
    contextHints: ["diagnose_confusion_source", "break_into_steps", "confirm_understanding"],
    suppressFollowUp: false,
  },

  {
    id: "TE03",
    action: MentorAction.TEACH,
    subAction: "domain_foundation",
    priority: DecisionPriority.STANDARD,
    urgency: DecisionUrgency.LOW,
    description: "User has a study/career goal but no apparent direction — teach a framework",
    condition: (i) =>
      (i.analysis.domain === "study" || i.analysis.domain === "career") &&
      i.memory.longTerm.goals.length > 0 &&
      i.memory.longTerm.preferences.length === 0 &&
      i.state.totalCommitmentsMade < 3,
    confidence: (_i) => 0.65,
    requiresLLM: true,
    tokenBudget: 300,
    template: null,
    contextHints: ["ask_current_knowledge_level", "map_to_domain_framework", "do_not_overwhelm"],
    suppressFollowUp: false,
  },

  // ── PRIORITY 4 — REFLECT (self-awareness) ───────────────────────────────────

  {
    id: "RF01",
    action: MentorAction.REFLECT,
    subAction: "user_initiated_reflection",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.STANDARD,
    description: "User is already reflecting — deepen it",
    condition: (i) =>
      intentIs(i.analysis, "reflection") || outcomeIs(i.analysis, "reflection"),
    confidence: (i) => i.analysis.confidence,
    requiresLLM: true,
    tokenBudget: 240,
    template: null,
    contextHints: ["probe_deeper_not_wider", "ask_one_honest_question", "do_not_give_solutions"],
    suppressFollowUp: false,
  },

  {
    id: "RF02",
    action: MentorAction.REFLECT,
    subAction: "comparison_trap_identity",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.STANDARD,
    description: "Comparison trap active — redirect from external comparison to personal baseline",
    condition: (i) =>
      hasPattern(i.patterns, "commitment_inflation") &&
      patternConfidence(i.patterns, "commitment_inflation") >= 0.50,
    confidence: (i) => patternConfidence(i.patterns, "commitment_inflation"),
    requiresLLM: true,
    tokenBudget: 220,
    template: null,
    contextHints: ["reject_external_comparison", "anchor_to_personal_trajectory", "ask_what_their_own_pace_looks_like"],
    suppressFollowUp: false,
  },

  {
    id: "RF03",
    action: MentorAction.REFLECT,
    subAction: "pattern_awareness_after_misses",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.STANDARD,
    description: "3+ misses without clear reason — prompt self-awareness before another plan",
    condition: (i) =>
      i.state.consecutiveMisses >= 3 &&
      !i.analysis.hasExcuse &&
      !intentIs(i.analysis, "plan_request") &&
      !hasFlag(i.state, "burnout_risk_high"),
    confidence: (_i) => 0.75,
    requiresLLM: true,
    tokenBudget: 220,
    template: null,
    contextHints: ["ask_what_is_actually_blocking", "do_not_give_another_plan_yet", "surface_the_real_reason"],
    suppressFollowUp: false,
  },

  {
    id: "RF04",
    action: MentorAction.REFLECT,
    subAction: "post_failure_self_inquiry",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.LOW,
    description: "After failure report — ask the honest question, not just move on",
    condition: (i) =>
      i.analysis.hasFailureReport &&
      !i.analysis.hasExcuse &&
      i.state.consecutiveMisses === 1 &&
      i.analysis.emotion.primary !== "defensive",
    confidence: (i) => 0.65 + (i.analysis.emotion.primary === "guilty" ? 0.15 : 0),
    requiresLLM: true,
    tokenBudget: 160,
    template: null,
    contextHints: ["one_honest_question_only", "no_plan_yet", "acknowledge_before_asking"],
    suppressFollowUp: false,
  },

  // ── PRIORITY 4 — REVIEW (progress) ──────────────────────────────────────────

  {
    id: "RV01",
    action: MentorAction.REVIEW,
    subAction: "weekly_review",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.STANDARD,
    description: "User requested or triggered weekly review",
    condition: (i) => intentIs(i.analysis, "progress_report") && i.analysis.urgency < 0.4,
    confidence: (i) => i.analysis.confidence,
    requiresLLM: true,
    tokenBudget: 250,
    template: null,
    contextHints: ["reference_goals", "note_consistency_score", "identify_one_win_and_one_gap"],
    suppressFollowUp: false,
  },

  {
    id: "RV02",
    action: MentorAction.REVIEW,
    subAction: "status_update_acknowledged",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.LOW,
    description: "User gave a status update — acknowledge and redirect",
    condition: (i) =>
      intentIs(i.analysis, "status_update", "check_in_response") &&
      i.analysis.emotion.valence !== "negative",
    confidence: (_i) => 0.70,
    requiresLLM: false,
    tokenBudget: 80,
    template: "Good. What's next on your list for today?",
    contextHints: [],
    suppressFollowUp: false,
  },

  {
    id: "RV03",
    action: MentorAction.REVIEW,
    subAction: "goal_completion_debrief",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.STANDARD,
    description: "User completed something — review before moving to the next goal",
    condition: (i) =>
      (i.analysis.emotion.primary === "proud" || intentIs(i.analysis, "status_update")) &&
      /\b(done|finished|completed|submitted|deployed|shipped|passed)\b/i.test(i.analysis.rawText),
    confidence: (_i) => 0.72,
    requiresLLM: false,
    tokenBudget: 100,
    template: null,
    contextHints: ["acknowledge_completion", "extract_what_worked", "set_next_target"],
    suppressFollowUp: false,
  },

  // ── PRIORITY 4 — ENCOURAGE (positive reinforcement) ─────────────────────────

  {
    id: "EN01",
    action: MentorAction.ENCOURAGE,
    subAction: "streak_milestone",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.STANDARD,
    description: "Streak milestone reached — acknowledge with weight, not noise",
    condition: (i) => hasFlag(i.state, "momentum_building") && i.state.streakDays > 0 && i.state.streakDays % 7 === 0,
    confidence: (_i) => 0.90,
    requiresLLM: false,
    tokenBudget: 80,
    template: null,
    contextHints: ["mention_streak_count", "reference_creature_if_exists", "one_sentence_max"],
    suppressFollowUp: false,
  },

  {
    id: "EN02",
    action: MentorAction.ENCOURAGE,
    subAction: "comeback_acknowledgment",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.STANDARD,
    description: "User returning after gap or collapse — acknowledge the return",
    condition: (i) => hasFlag(i.state, "comeback", "returning_after_gap"),
    confidence: (_i) => 0.85,
    requiresLLM: true,
    tokenBudget: 110,
    template: null,
    contextHints: ["acknowledge_return_not_gap", "do_not_mention_how_long_gone", "start_from_today"],
    suppressFollowUp: false,
  },

  {
    id: "EN03",
    action: MentorAction.ENCOURAGE,
    subAction: "confidence_rebuild",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.STANDARD,
    description: "Low confidence + recent kept commitment — reinforce self-belief with evidence",
    condition: (i) =>
      hasFlag(i.state, "low_confidence") &&
      i.state.streakDays >= 1 &&
      i.analysis.emotion.primary !== "defensive",
    confidence: (i) => scaledConfidence(100 - i.state.confidence, 60, 100),
    requiresLLM: true,
    tokenBudget: 120,
    template: null,
    contextHints: ["use_evidence_not_affirmation", "reference_streak", "reference_creature_if_exists"],
    suppressFollowUp: false,
  },

  {
    id: "EN04",
    action: MentorAction.ENCOURAGE,
    subAction: "emotional_support",
    priority: DecisionPriority.SUPPORTIVE,
    urgency: DecisionUrgency.STANDARD,
    description: "User venting or deeply discouraged — hold space before directing",
    condition: (i) =>
      intentIs(i.analysis, "emotional_vent") ||
      (i.analysis.emotion.primary === "discouraged" && i.analysis.emotion.intensity >= 0.7) ||
      outcomeIs(i.analysis, "venting"),
    confidence: (i) => i.analysis.emotion.intensity,
    requiresLLM: true,
    tokenBudget: 130,
    template: null,
    contextHints: ["acknowledge_feeling_first", "do_not_immediately_fix", "one_grounding_question"],
    suppressFollowUp: false,
  },

  // ── PRIORITY 5 — ASK (gather information) ───────────────────────────────────

  {
    id: "AS01",
    action: MentorAction.ASK,
    subAction: "first_session_capacity",
    priority: DecisionPriority.LOW,
    urgency: DecisionUrgency.STANDARD,
    description: "First session or capacity unknown — understand the user before acting",
    condition: (i) => capacityUnknown(i) && i.state.totalCommitmentsMade < 2,
    confidence: (_i) => 0.90,
    requiresLLM: false,
    tokenBudget: 70,
    template: "Before we build anything — what does your week actually look like right now? Not the ideal version, the real one.",
    contextHints: [],
    suppressFollowUp: false,
  },

  {
    id: "AS02",
    action: MentorAction.ASK,
    subAction: "vague_goal_clarification",
    priority: DecisionPriority.LOW,
    urgency: DecisionUrgency.STANDARD,
    description: "Goal is vague — clarify before planning",
    condition: (i) =>
      i.analysis.goal !== null &&
      i.analysis.goal.isVague &&
      intentIs(i.analysis, "goal_set", "plan_request"),
    confidence: (_i) => 0.85,
    requiresLLM: false,
    tokenBudget: 65,
    template: "What specifically does that look like? Give me the most concrete version of what you want.",
    contextHints: [],
    suppressFollowUp: false,
  },

  {
    id: "AS03",
    action: MentorAction.ASK,
    subAction: "unknown_domain_context",
    priority: DecisionPriority.LOW,
    urgency: DecisionUrgency.LOW,
    description: "Domain is unknown and message is ambiguous — ask before assuming",
    condition: (i) =>
      i.analysis.domain === "unknown" &&
      i.analysis.confidence < 0.55 &&
      !intentIs(i.analysis, "emotional_vent", "general_chat"),
    confidence: (_i) => 0.80,
    requiresLLM: false,
    tokenBudget: 60,
    template: "What area of your life are we talking about here?",
    contextHints: [],
    suppressFollowUp: false,
  },

  {
    id: "AS04",
    action: MentorAction.ASK,
    subAction: "general_checkin",
    priority: DecisionPriority.LOW,
    urgency: DecisionUrgency.LOW,
    description: "General chat with no clear intent — open the space with a question",
    condition: (i) =>
      i.analysis.intent === "general_chat" &&
      i.analysis.confidence < 0.5 &&
      i.memory.longTerm.goals.length > 0,
    confidence: (_i) => 0.60,
    requiresLLM: false,
    tokenBudget: 60,
    template: null,
    contextHints: ["reference_active_goal", "one_direct_question"],
    suppressFollowUp: false,
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// BLOCKING MATRIX
// Actions that are blocked under certain state conditions.
// ═══════════════════════════════════════════════════════════════════════════════

const BLOCK_RULES: Array<{
  blocks: MentorAction[];
  condition: (i: DecisionInput) => boolean;
  reason: string;
}> = [
  {
    blocks: [MentorAction.CHALLENGE, MentorAction.ACCOUNTABILITY],
    condition: (i) => hasFlag(i.state, "burnout_risk_critical") || i.state.burnoutRisk >= 80,
    reason: "burnout_critical: confrontation would cause complete disengagement",
  },
  {
    blocks: [MentorAction.CHALLENGE],
    condition: (i) =>
      hasFlag(i.state, "burnout_risk_high") ||
      i.state.stress >= 70 ||
      i.analysis.emotion.primary === "overwhelmed",
    reason: "high_stress: challenging during overwhelm increases dropout risk",
  },
  {
    blocks: [MentorAction.PLAN],
    condition: (i) =>
      hasPattern(i.patterns, "overplanning_underexecuting") &&
      patternConfidence(i.patterns, "overplanning_underexecuting") >= 0.60,
    reason: "overplanning_pattern: adding more planning reinforces the pattern",
  },
  {
    blocks: [MentorAction.ACCOUNTABILITY],
    condition: (i) =>
      intentIs(i.analysis, "emotional_vent") &&
      i.analysis.emotion.intensity >= 0.7,
    reason: "high_emotion_vent: accountability during emotional peak backfires",
  },
  {
    blocks: [MentorAction.CHALLENGE],
    condition: (i) => i.isFirstSession,
    reason: "first_session: earn trust before challenging",
  },
  {
    blocks: [MentorAction.REDUCE_SCOPE],
    condition: (i) =>
      i.state.burnoutRisk < 50 &&
      i.state.stress < 55 &&
      i.state.consecutiveMisses < 3,
    reason: "low_risk: no signal for scope reduction",
  },
];

// ═══════════════════════════════════════════════════════════════════════════════
// TONE RESOLVER
// ═══════════════════════════════════════════════════════════════════════════════

function resolveTone(input: DecisionInput, action: MentorAction, ruleUrgency: DecisionUrgency): DecisionTone {
  if (isToneGentleForced(input))  return DecisionTone.GENTLE;
  if (isToneHardBlocked(input))   return DecisionTone.SUPPORTIVE;

  const toneBase: Record<MentorAction, DecisionTone> = {
    [MentorAction.REDUCE_SCOPE]:   DecisionTone.GENTLE,
    [MentorAction.ACCOUNTABILITY]: DecisionTone.FIRM,
    [MentorAction.CHALLENGE]:      DecisionTone.FIRM,
    [MentorAction.PLAN]:           DecisionTone.STANDARD,
    [MentorAction.TEACH]:          DecisionTone.STANDARD,
    [MentorAction.REFLECT]:        DecisionTone.SUPPORTIVE,
    [MentorAction.REVIEW]:         DecisionTone.STANDARD,
    [MentorAction.ENCOURAGE]:      DecisionTone.SUPPORTIVE,
    [MentorAction.ASK]:            DecisionTone.STANDARD,
  };

  let tone = toneBase[action];

  // Tone preference modifier
  if (input.tonePreference === "hard") {
    if (tone === DecisionTone.SUPPORTIVE) tone = DecisionTone.STANDARD;
    if (tone === DecisionTone.STANDARD && action === MentorAction.ACCOUNTABILITY) tone = DecisionTone.HARD;
  }
  if (input.tonePreference === "soft") {
    if (tone === DecisionTone.FIRM)  tone = DecisionTone.STANDARD;
    if (tone === DecisionTone.HARD)  tone = DecisionTone.FIRM;
  }

  // Emotion overrides
  if (input.analysis.emotion.primary === "defensive") {
    if (tone === DecisionTone.HARD) tone = DecisionTone.FIRM; // escalating a defensive user backfires
  }
  if (input.analysis.emotion.primary === "determined" && action === MentorAction.CHALLENGE) {
    tone = DecisionTone.FIRM; // they're ready to hear the truth
  }
  if (input.analysis.emotion.valence === "negative" && input.analysis.emotion.intensity >= 0.7) {
    if (tone === DecisionTone.FIRM || tone === DecisionTone.HARD) tone = DecisionTone.STANDARD;
  }

  // Urgency modifier
  if (ruleUrgency === DecisionUrgency.CRITICAL && tone !== DecisionTone.GENTLE) {
    if (action === MentorAction.ACCOUNTABILITY || action === MentorAction.CHALLENGE) {
      tone = DecisionTone.FIRM;
    }
  }

  return tone;
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECISION ENGINE
// ═══════════════════════════════════════════════════════════════════════════════

export function makeMentorDecision(input: DecisionInput): MentorDecision {
  const decisionPath: string[] = [];
  const blockedActions: BlockedAction[] = [];

  // 1. Compute blocked actions
  const blockedSet = new Set<MentorAction>();
  for (const rule of BLOCK_RULES) {
    if (rule.condition(input)) {
      for (const action of rule.blocks) {
        if (!blockedSet.has(action)) {
          blockedSet.add(action);
          blockedActions.push({ action, ruleId: `BLOCK_${action}`, reason: rule.reason });
        }
      }
    }
  }

  // 2. Evaluate all decision rules
  const matches: RuleMatch[] = [];

  for (const rule of RULES) {
    if (blockedSet.has(rule.action)) {
      decisionPath.push(`${rule.id} [${rule.action}] → BLOCKED`);
      continue;
    }

    const conditionMet = (() => {
      try { return rule.condition(input); }
      catch { return false; }
    })();

    if (!conditionMet) {
      decisionPath.push(`${rule.id} [${rule.action}/${rule.subAction}] → condition:false`);
      continue;
    }

    const confidence = (() => {
      try { return Math.min(Math.max(rule.confidence(input), 0), 1); }
      catch { return 0.5; }
    })();

    matches.push({
      ruleId:     rule.id,
      action:     rule.action,
      subAction:  rule.subAction,
      priority:   rule.priority,
      urgency:    rule.urgency,
      confidence,
      reason:     rule.description,
    });

    decisionPath.push(`${rule.id} [${rule.action}/${rule.subAction}] → MATCH conf:${confidence.toFixed(2)}`);
  }

  // 3. If nothing matched, fallback to ASK
  if (matches.length === 0) {
    const fallbackRule = RULES.find((r) => r.id === "AS04") ?? RULES[RULES.length - 1]!;
    decisionPath.push("FALLBACK → AS04 [ASK/general_checkin]");

    return {
      action:           MentorAction.ASK,
      subAction:        "general_checkin",
      urgency:          DecisionUrgency.LOW,
      tone:             resolveTone(input, MentorAction.ASK, DecisionUrgency.LOW),
      requiresLLM:      fallbackRule.requiresLLM,
      tokenBudget:      fallbackRule.tokenBudget,
      template:         fallbackRule.template,
      ruleId:           "FALLBACK",
      reason:           "No rule matched — defaulting to open question",
      confidence:       0.4,
      contextHints:     fallbackRule.contextHints,
      decisionPath,
      blockedActions,
      suppressFollowUp: false,
    };
  }

  // 4. Sort by priority (lowest number = highest priority), then by confidence
  matches.sort((a, b) =>
    a.priority !== b.priority
      ? a.priority - b.priority
      : b.confidence - a.confidence
  );

  const winner = matches[0]!;
  const winningRule = RULES.find((r) => r.id === winner.ruleId)!;

  decisionPath.push(`WINNER: ${winner.ruleId} [${winner.action}/${winner.subAction}] conf:${winner.confidence.toFixed(2)}`);

  // 5. Build final decision
  const tone = resolveTone(input, winner.action, winner.urgency);

  const template = resolveTemplate(winningRule, input, tone);

  return {
    action:           winner.action,
    subAction:        winner.subAction,
    urgency:          winner.urgency,
    tone,
    requiresLLM:      winningRule.requiresLLM && template === null,
    tokenBudget:      winningRule.tokenBudget,
    template,
    ruleId:           winner.ruleId,
    reason:           winner.reason,
    confidence:       winner.confidence,
    contextHints:     buildContextHints(winningRule, input),
    decisionPath,
    blockedActions,
    suppressFollowUp: winningRule.suppressFollowUp,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEMPLATE RESOLVER
// Fills template placeholders from DecisionInput context.
// ═══════════════════════════════════════════════════════════════════════════════

function resolveTemplate(rule: DecisionRule, input: DecisionInput, tone: DecisionTone): string | null {
  if (!rule.requiresLLM && rule.template) return rule.template;

  const creature = input.memory.longTerm.creatureName;
  const name     = input.memory.shortTerm.find((m) => m.role === "user")?.text
    ? (input.memory.longTerm.anchors.find((a) => a.startsWith("name:"))?.split(":")[1]?.trim() ?? null)
    : null;

  switch (rule.id) {
    case "EN01": {
      const streakDays = input.state.streakDays;
      if (creature) return `${streakDays} days. ${creature} is growing.`;
      return `${streakDays} days straight. That's a real number now.`;
    }
    case "RV02": {
      return tone === DecisionTone.FIRM
        ? "Good. What's next?"
        : "Good. Log that. What's next on your list?";
    }
    case "RS02":
      return `Before anything else — what's the one thing that cannot wait this week? Drop everything else for now.`;
    case "AS01":
      return `Before we build anything — what does your week actually look like right now? Not the ideal version. The real one.`;
    case "AS02":
      return `What specifically does that look like? Give me the most concrete version of what you want.`;
    case "AS03":
      return `What area of your life are we talking about here?`;
    default:
      return rule.template;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONTEXT HINTS BUILDER
// Adds dynamic hints to base hints from rule definition.
// ═══════════════════════════════════════════════════════════════════════════════

function buildContextHints(rule: DecisionRule, input: DecisionInput): string[] {
  const hints = [...rule.contextHints];

  if (input.memory.longTerm.creatureName) {
    hints.push(`creature_name:${input.memory.longTerm.creatureName}`);
  }
  if (input.state.streakDays >= 3) {
    hints.push(`current_streak:${input.state.streakDays}`);
  }
  if (input.memory.longTerm.goals[0]) {
    hints.push(`active_goal:${input.memory.longTerm.goals[0].slice(0, 60)}`);
  }
  if (input.patterns.dominantPattern) {
    hints.push(`dominant_pattern:${input.patterns.dominantPattern.type}`);
  }
  if (input.state.consecutiveMisses >= 2) {
    hints.push(`consecutive_misses:${input.state.consecutiveMisses}`);
  }
  if (input.memory.lastUserMessage) {
    hints.push(`last_user_line:${input.memory.lastUserMessage.slice(0, 80)}`);
  }

  return hints;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Returns all rules that matched for a given input — useful for debugging
 * and building a "alternatives considered" audit log.
 */
export function getAllMatches(input: DecisionInput): RuleMatch[] {
  const blockedSet = new Set<MentorAction>(
    BLOCK_RULES.filter((b) => b.condition(input)).flatMap((b) => b.blocks)
  );

  return RULES.filter((rule) => {
    if (blockedSet.has(rule.action)) return false;
    try { return rule.condition(input); }
    catch { return false; }
  }).map((rule) => ({
    ruleId:     rule.id,
    action:     rule.action,
    subAction:  rule.subAction,
    priority:   rule.priority,
    urgency:    rule.urgency,
    confidence: (() => { try { return Math.min(Math.max(rule.confidence(input), 0), 1); } catch { return 0; } })(),
    reason:     rule.description,
  })).sort((a, b) => a.priority !== b.priority ? a.priority - b.priority : b.confidence - a.confidence);
}

/**
 * Returns a human-readable summary of what the engine decided and why.
 * Used for logging and LLM system prompt injection.
 */
export function summarizeDecision(d: MentorDecision): string {
  return [
    `action:${d.action}/${d.subAction}`,
    `tone:${d.tone}`,
    `urgency:${d.urgency}`,
    `rule:${d.ruleId}`,
    `confidence:${(d.confidence * 100).toFixed(0)}%`,
    d.blockedActions.length > 0 ? `blocked:[${d.blockedActions.map((b) => b.action).join(",")}]` : null,
  ].filter(Boolean).join(" | ");
}
