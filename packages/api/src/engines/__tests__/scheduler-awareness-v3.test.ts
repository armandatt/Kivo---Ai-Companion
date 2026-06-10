/**
 * Scheduler Awareness V3 — LLM Prompt Builder Unit Tests
 *
 * Tests the four new builder functions added in REX LLM Integration V3:
 *   - buildActiveSignalsBlock
 *   - buildTrainingStateBlock
 *   - buildParserSafetyBlock
 *   - buildV2DirectiveOverride
 *
 * These are pure unit tests — no LLM calls, no DB, no I/O.
 */

// Mock ESM-incompatible services before any imports from llm.ts
jest.mock("../../services/openai.service", () => ({
  generateOpenAIText: jest.fn(),
}));
jest.mock("../../services/personna.service", () => ({
  getPersona: jest.fn(() => ({ name: "rex", voice: "", toneModifiers: {} })),
}));
jest.mock("../../engines/planner-engine", () => ({
  summarizePlan: jest.fn(() => ""),
  generatePlan:  jest.fn(),
}));

import {
  buildActiveSignalsBlock,
  buildTrainingStateBlock,
  buildParserSafetyBlock,
  buildV2DirectiveOverride,
} from "../../services/llm";
import { TrainingState, TrainingWindow } from "../scheduler-intelligence-v2";
import type { SchedulerContextV2 } from "../scheduler-intelligence-v2";
import type { DetectedSignal } from "../signal-engine-v2";
import {
  MentorAction,
  DecisionUrgency,
  DecisionTone,
} from "../mentor-decision-engine";
import type { MentorDecision } from "../mentor-decision-engine";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeSchedulerCtx(overrides: Partial<SchedulerContextV2> = {}): SchedulerContextV2 {
  return {
    trainingState:         TrainingState.UNKNOWN,
    observedWindow:        TrainingWindow.FLEXIBLE,
    windowConfidence:      "low",
    pendingMuscles:        null,
    pendingSplitDayIndex:  null,
    completedTodayMuscles: null,
    consecutiveMisses:     0,
    lastSessionDate:       null,
    lastSessionMuscles:    null,
    daysSinceLastSession:  999,
    avgDurationMin:        60,
    completionRate7d:      0,
    daysPerWeek:           3,
    isFlexibleUser:        false,
    hasAnyHistory:         false,
    ...overrides,
  };
}

function makeDecision(overrides: Partial<MentorDecision> = {}): MentorDecision {
  return {
    action:           MentorAction.ACCOUNTABILITY,
    subAction:        "failure_with_excuse",
    urgency:          DecisionUrgency.MEDIUM,
    tone:             DecisionTone.FIRM,
    requiresLLM:      true,
    tokenBudget:      150,
    template:         null,
    ruleId:           "V1:some_rule",
    reason:           "test",
    confidence:       0.8,
    contextHints:     [],
    decisionPath:     [],
    blockedActions:   [],
    suppressFollowUp: false,
    ...overrides,
  };
}

function makeSignal(type: DetectedSignal["type"], intensity: number): DetectedSignal {
  return {
    type,
    intensity,
    valence:    "negative",
    confidence: 0.8,
    evidence:   [],
  };
}

// ─── buildTrainingStateBlock ──────────────────────────────────────────────────

describe("buildTrainingStateBlock", () => {
  it("returns empty string for null context", () => {
    expect(buildTrainingStateBlock(null)).toBe("");
  });

  it("COMPLETED state includes correct guidance and never mentions encouraging training", () => {
    const ctx = makeSchedulerCtx({
      trainingState:    TrainingState.COMPLETED,
      completionRate7d: 0.85,
      consecutiveMisses: 0,
      observedWindow:   TrainingWindow.EVENING,
      windowConfidence: "high",
      completedTodayMuscles: "chest, triceps",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).toContain("TRAINING STATE");
    expect(block).toContain("COMPLETED");
    expect(block).toContain("Do NOT encourage training again");
    expect(block).toContain("Completed today: chest, triceps");
    expect(block).toContain("85%");
  });

  it("DUE state includes session-focused guidance", () => {
    const ctx = makeSchedulerCtx({
      trainingState:    TrainingState.DUE,
      pendingMuscles:   "back, biceps",
      completionRate7d: 0.60,
      consecutiveMisses: 1,
      observedWindow:   TrainingWindow.MORNING,
      windowConfidence: "medium",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).toContain("DUE");
    expect(block).toContain("session-focused");
    expect(block).toContain("Pending muscle group: back, biceps");
    expect(block).toContain("Consecutive misses: 1");
    expect(block).toContain("60%");
  });

  it("PENDING_CONFIRMATION state asks to verify before assuming", () => {
    const ctx = makeSchedulerCtx({
      trainingState:    TrainingState.PENDING_CONFIRMATION,
      completionRate7d: 0.50,
      consecutiveMisses: 0,
      observedWindow:   TrainingWindow.AFTERNOON,
      windowConfidence: "medium",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).toContain("PENDING_CONFIRMATION");
    expect(block).toContain("Verify whether they trained");
  });

  it("SKIPPED state includes skip acknowledgment without shame", () => {
    const ctx = makeSchedulerCtx({
      trainingState:    TrainingState.SKIPPED,
      completionRate7d: 0.40,
      consecutiveMisses: 2,
      observedWindow:   TrainingWindow.EVENING,
      windowConfidence: "low",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).toContain("SKIPPED");
    expect(block).toContain("without shame");
    expect(block).toContain("Consecutive misses: 2");
  });

  it("UPCOMING state instructs preparation only, no session push", () => {
    const ctx = makeSchedulerCtx({
      trainingState:    TrainingState.UPCOMING,
      completionRate7d: 0.70,
      consecutiveMisses: 0,
      observedWindow:   TrainingWindow.MORNING,
      windowConfidence: "high",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).toContain("UPCOMING");
    expect(block).toContain("preparation");
  });

  it("omits pendingMuscles line when null", () => {
    const ctx = makeSchedulerCtx({
      trainingState:  TrainingState.DUE,
      pendingMuscles: null,
      completionRate7d: 0.5,
      observedWindow:   TrainingWindow.FLEXIBLE,
      windowConfidence: "low",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).not.toContain("Pending muscle group");
  });

  it("includes completedTodayMuscles when set", () => {
    const ctx = makeSchedulerCtx({
      trainingState:         TrainingState.COMPLETED,
      completedTodayMuscles: "legs",
      completionRate7d:      1.0,
      observedWindow:        TrainingWindow.MORNING,
      windowConfidence:      "high",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).toContain("Completed today: legs");
  });
});

// ─── buildParserSafetyBlock ───────────────────────────────────────────────────

describe("buildParserSafetyBlock", () => {
  it("returns empty string when no safety signals present", () => {
    expect(buildParserSafetyBlock([])).toBe("");
    expect(buildParserSafetyBlock(["SOME_OTHER_SIGNAL"])).toBe("");
  });

  it("PAIN_MENTIONED alone shows safety flag", () => {
    const block = buildParserSafetyBlock(["PAIN_MENTIONED"]);
    expect(block).toContain("SAFETY FLAGS");
    expect(block).toContain("Pain mentioned.");
    expect(block).not.toContain("RECOMMENDATION_BLOCKED");
  });

  it("PAIN_MENTIONED + RECOMMENDATION_BLOCKED shows both flags", () => {
    const block = buildParserSafetyBlock(["PAIN_MENTIONED", "RECOMMENDATION_BLOCKED"]);
    expect(block).toContain("SAFETY FLAGS");
    expect(block).toContain("Pain mentioned.");
    expect(block).toContain("RECOMMENDATION_BLOCKED = TRUE");
    expect(block).toContain("No explicit recommendation requested.");
  });

  it("INJURY_CONTEXT alone shows injury flag", () => {
    const block = buildParserSafetyBlock(["INJURY_CONTEXT"]);
    expect(block).toContain("SAFETY FLAGS");
    expect(block).toContain("Injury context detected.");
    expect(block).not.toContain("Pain mentioned.");
  });

  it("all three signals combined shows all flags", () => {
    const block = buildParserSafetyBlock(["PAIN_MENTIONED", "RECOMMENDATION_BLOCKED", "INJURY_CONTEXT"]);
    expect(block).toContain("Pain mentioned.");
    expect(block).toContain("Injury context detected.");
    expect(block).toContain("RECOMMENDATION_BLOCKED = TRUE");
  });
});

// ─── buildActiveSignalsBlock ──────────────────────────────────────────────────

describe("buildActiveSignalsBlock", () => {
  it("returns empty string for empty array", () => {
    expect(buildActiveSignalsBlock([])).toBe("");
  });

  it("returns empty string when all signals below threshold (0.35)", () => {
    const signals = [
      makeSignal("burnout",    0.30),
      makeSignal("self_doubt", 0.20),
    ];
    expect(buildActiveSignalsBlock(signals)).toBe("");
  });

  it("shows burnout signal at 0.81 intensity", () => {
    const signals = [makeSignal("burnout", 0.81)];
    const block = buildActiveSignalsBlock(signals);
    expect(block).toContain("ACTIVE SIGNALS");
    expect(block).toContain("burnout");
    expect(block).toContain("0.81");
  });

  it("filters signals below 0.35 threshold", () => {
    const signals = [
      makeSignal("burnout",    0.81),
      makeSignal("self_doubt", 0.20),  // below threshold — should be excluded
      makeSignal("overwhelm",  0.60),
    ];
    const block = buildActiveSignalsBlock(signals);
    expect(block).toContain("burnout");
    expect(block).toContain("overwhelm");
    expect(block).not.toContain("self_doubt");
  });

  it("caps output at 5 signals", () => {
    const signals = [
      makeSignal("burnout",          0.90),
      makeSignal("overwhelm",        0.80),
      makeSignal("stress",           0.75),
      makeSignal("self_doubt",       0.70),
      makeSignal("fear",             0.65),
      makeSignal("motivation",       0.60),  // 6th — should be excluded
    ];
    const block = buildActiveSignalsBlock(signals);
    // Count bullet points
    const bullets = (block.match(/•/g) ?? []).length;
    expect(bullets).toBe(5);
  });

  it("formats intensity to 2 decimal places", () => {
    const signals = [makeSignal("burnout", 0.9)];
    const block = buildActiveSignalsBlock(signals);
    expect(block).toContain("0.90");
  });
});

// ─── buildV2DirectiveOverride ─────────────────────────────────────────────────

describe("buildV2DirectiveOverride", () => {
  it("returns null for non-V2 ruleId", () => {
    const decision = makeDecision({ ruleId: "V1:some_rule" });
    expect(buildV2DirectiveOverride(decision)).toBeNull();
  });

  it("returns null for ruleId without V2: prefix", () => {
    const decision = makeDecision({ ruleId: "ACCOUNTABILITY/failure_with_excuse" });
    expect(buildV2DirectiveOverride(decision)).toBeNull();
  });

  it("SURFACE_PROMISE returns promise-surfacing directive, not generic failure_with_excuse text", () => {
    const decision = makeDecision({
      ruleId:    "V2:SURFACE_PROMISE",
      action:    MentorAction.ACCOUNTABILITY,
      subAction: "failure_with_excuse",
    });
    const directive = buildV2DirectiveOverride(decision);
    expect(directive).not.toBeNull();
    expect(directive).toContain("promise");
    expect(directive).toContain("commitment");
    // Must NOT contain the generic failure_with_excuse language
    expect(directive).not.toContain("Hold the standard");
    expect(directive).not.toContain("acknowledge the failure");
  });

  it("SURFACE_BREAKTHROUGH returns breakthrough-surfacing directive", () => {
    const decision = makeDecision({ ruleId: "V2:SURFACE_BREAKTHROUGH" });
    const directive = buildV2DirectiveOverride(decision);
    expect(directive).not.toBeNull();
    expect(directive).toContain("breakthrough");
    expect(directive).toContain("self-doubt");
  });

  it("SURFACE_COMMITMENT returns commitment-surfacing directive", () => {
    const decision = makeDecision({ ruleId: "V2:SURFACE_COMMITMENT" });
    const directive = buildV2DirectiveOverride(decision);
    expect(directive).not.toBeNull();
    expect(directive).toContain("commitment");
  });

  it("REDUCE_FRICTION returns friction-reduction directive", () => {
    const decision = makeDecision({ ruleId: "V2:REDUCE_FRICTION" });
    const directive = buildV2DirectiveOverride(decision);
    expect(directive).not.toBeNull();
    expect(directive).toContain("smallest action");
  });

  it("PREVENT_SPIRAL returns spiral-prevention directive", () => {
    const decision = makeDecision({ ruleId: "V2:PREVENT_SPIRAL" });
    const directive = buildV2DirectiveOverride(decision);
    expect(directive).not.toBeNull();
    expect(directive).toContain("Spiral risk");
  });

  it("PRIORITY_RESET returns priority-reset directive", () => {
    const decision = makeDecision({ ruleId: "V2:PRIORITY_RESET" });
    const directive = buildV2DirectiveOverride(decision);
    expect(directive).not.toBeNull();
    expect(directive).toContain("ONE commitment");
  });

  it("PREVENT_BURNOUT returns burnout-prevention directive with zero pressure", () => {
    const decision = makeDecision({ ruleId: "V2:PREVENT_BURNOUT" });
    const directive = buildV2DirectiveOverride(decision);
    expect(directive).not.toBeNull();
    expect(directive).toContain("Zero pressure");
  });

  it("unknown V2 intervention returns null gracefully", () => {
    const decision = makeDecision({ ruleId: "V2:NONEXISTENT_INTERVENTION" });
    expect(buildV2DirectiveOverride(decision)).toBeNull();
  });
});
