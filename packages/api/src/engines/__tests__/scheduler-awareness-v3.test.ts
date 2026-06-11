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
    expect(block).toContain("Current state: COMPLETED");
    expect(block).toContain("Do NOT encourage training again");
    expect(block).toContain("Completed today: chest, triceps");
    expect(block).toContain("85%");
  });

  it("DUE state includes session-focused guidance", () => {
    const ctx = makeSchedulerCtx({
      trainingState:       TrainingState.DUE,
      pendingMuscles:      "back, biceps",
      pendingSplitDayIndex: 1,
      completionRate7d:    0.60,
      consecutiveMisses:   1,
      observedWindow:      TrainingWindow.MORNING,
      windowConfidence:    "medium",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).toContain("Current state: DUE");
    expect(block).toContain("session-focused");
    expect(block).toContain("Current muscle group: back, biceps");
    expect(block).toContain("Cycle day: 2");
    expect(block).toContain("Consecutive misses: 1");
    expect(block).toContain("60%");
  });

  it("includes cycle day when pendingSplitDayIndex is 0 (first day)", () => {
    const ctx = makeSchedulerCtx({
      trainingState:       TrainingState.DUE,
      pendingMuscles:      "chest, triceps",
      pendingSplitDayIndex: 0,
      completionRate7d:    0.80,
      observedWindow:      TrainingWindow.EVENING,
      windowConfidence:    "high",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).toContain("Cycle day: 1");
    expect(block).toContain("Current muscle group: chest, triceps");
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

  it("omits muscle group line when null", () => {
    const ctx = makeSchedulerCtx({
      trainingState:  TrainingState.DUE,
      pendingMuscles: null,
      completionRate7d: 0.5,
      observedWindow:   TrainingWindow.FLEXIBLE,
      windowConfidence: "low",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).not.toContain("Current muscle group");
    expect(block).not.toContain("Pending muscle group");
  });

  it("omits cycle day when pendingSplitDayIndex is null", () => {
    const ctx = makeSchedulerCtx({
      trainingState:       TrainingState.DUE,
      pendingSplitDayIndex: null,
      completionRate7d:    0.5,
      observedWindow:      TrainingWindow.FLEXIBLE,
      windowConfidence:    "low",
    });
    const block = buildTrainingStateBlock(ctx);
    expect(block).not.toContain("Cycle day");
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

  it("shows consistency_negative when valence is negative", () => {
    const signal: DetectedSignal = {
      type:       "consistency",
      intensity:  0.73,
      valence:    "negative",
      confidence: 0.85,
      evidence:   ["keep missing sessions"],
    };
    const block = buildActiveSignalsBlock([signal]);
    expect(block).toContain("consistency_negative");
    expect(block).not.toContain("• consistency (");
  });

  it("shows plain consistency when valence is positive", () => {
    const signal: DetectedSignal = {
      type:       "consistency",
      intensity:  0.80,
      valence:    "positive",
      confidence: 0.85,
      evidence:   ["been consistent"],
    };
    const block = buildActiveSignalsBlock([signal]);
    expect(block).toContain("• consistency (0.80)");
    expect(block).not.toContain("consistency_negative");
  });

  it("shows non-bipolar signals without valence suffix regardless of valence field", () => {
    const signal: DetectedSignal = {
      type:       "burnout",
      intensity:  0.85,
      valence:    "negative",
      confidence: 0.90,
      evidence:   [],
    };
    const block = buildActiveSignalsBlock([signal]);
    expect(block).toContain("• burnout (0.85)");
    expect(block).not.toContain("burnout_negative");
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

// ═══════════════════════════════════════════════════════════════════════════════
// PART 7 — VALIDATION AUDIT
// Special-focus scenarios that must produce the correct safety/state blocks.
// Each scenario is named after the real failure mode it prevents.
// ═══════════════════════════════════════════════════════════════════════════════

interface AuditScore {
  scenario:  string;
  safety:    boolean;
  scheduler: boolean;
  signals:   boolean;
}

describe("Part 7 — Special Scenario Integration Audit", () => {
  const SCORES: AuditScore[] = [];

  afterAll(() => {
    const total   = SCORES.length;
    const passed  = (key: keyof Omit<AuditScore, "scenario">) =>
      SCORES.filter(s => s[key]).length;

    console.log("\n════════════════════════════════════════════════════");
    console.log("PART 7 — INTEGRATION AUDIT SCORES");
    console.log("════════════════════════════════════════════════════");
    console.log(`Safety block accuracy  : ${passed("safety")}/${total}`);
    console.log(`Scheduler awareness    : ${passed("scheduler")}/${total}`);
    console.log(`Signal accuracy        : ${passed("signals")}/${total}`);
    const overallPct = Math.round(
      (passed("safety") + passed("scheduler") + passed("signals")) / (total * 3) * 100,
    );
    console.log(`Overall score          : ${overallPct}%`);
    console.log("════════════════════════════════════════════════════\n");
    for (const s of SCORES) {
      const marks = [
        s.safety    ? "✓ safety" : "✗ safety",
        s.scheduler ? "✓ scheduler" : "✗ scheduler",
        s.signals   ? "✓ signals" : "✗ signals",
      ].join("  ");
      console.log(`  ${s.scenario.padEnd(45)} ${marks}`);
    }
    console.log("");
  });

  // ── "sore chest" — RECOMMENDATION must be blocked ────────────────────────

  it("sore chest → RECOMMENDATION_BLOCKED + no training push", () => {
    const safetyBlock = buildParserSafetyBlock(["PAIN_MENTIONED", "RECOMMENDATION_BLOCKED"]);
    const schedulerBlock = buildTrainingStateBlock(makeSchedulerCtx({
      trainingState:    TrainingState.DUE,
      pendingMuscles:   "chest, triceps",
      completionRate7d: 0.60,
      observedWindow:   TrainingWindow.EVENING,
      windowConfidence: "medium",
    }));
    const safety    = safetyBlock.includes("RECOMMENDATION_BLOCKED = TRUE") && safetyBlock.includes("Pain mentioned.");
    const scheduler = schedulerBlock.includes("DUE") && schedulerBlock.includes("session-focused");
    const signals   = true; // no active signals in this scenario

    SCORES.push({ scenario: "sore chest (pain context, no request)", safety, scheduler, signals });
    expect(safety).toBe(true);
  });

  // ── "knee pain" — INJURY_CONTEXT must be emitted and surfaced ────────────

  it("knee pain → INJURY_CONTEXT signal in safety block", () => {
    const safetyBlock = buildParserSafetyBlock(["PAIN_MENTIONED", "INJURY_CONTEXT", "RECOMMENDATION_BLOCKED"]);
    const safety    = safetyBlock.includes("Injury context detected.") && safetyBlock.includes("RECOMMENDATION_BLOCKED = TRUE");
    const scheduler = true; // not scheduler-dependent
    const signals   = true;

    SCORES.push({ scenario: "knee pain (injury context)", safety, scheduler, signals });
    expect(safety).toBe(true);
  });

  // ── "completed workout today" — must NOT push training ────────────────────

  it("completed workout → Do NOT encourage training again", () => {
    const schedulerBlock = buildTrainingStateBlock(makeSchedulerCtx({
      trainingState:         TrainingState.COMPLETED,
      completedTodayMuscles: "back, biceps",
      completionRate7d:      0.80,
      observedWindow:        TrainingWindow.EVENING,
      windowConfidence:      "high",
    }));
    const safetyBlock = buildParserSafetyBlock([]);
    const safety    = !safetyBlock.includes("SAFETY FLAGS");
    const scheduler = schedulerBlock.includes("Do NOT encourage training again") &&
                      schedulerBlock.includes("Current state: COMPLETED") &&
                      schedulerBlock.includes("Completed today: back, biceps");
    const signals   = true;

    SCORES.push({ scenario: "completed workout (COMPLETED state)", safety, scheduler, signals });
    expect(scheduler).toBe(true);
  });

  // ── "skipped workout today" — must acknowledge without shame ─────────────

  it("skipped workout → acknowledge without shame + SKIPPED state", () => {
    const schedulerBlock = buildTrainingStateBlock(makeSchedulerCtx({
      trainingState:    TrainingState.SKIPPED,
      consecutiveMisses: 1,
      completionRate7d: 0.50,
      observedWindow:   TrainingWindow.MORNING,
      windowConfidence: "medium",
    }));
    const safety    = true;
    const scheduler = schedulerBlock.includes("Current state: SKIPPED") &&
                      schedulerBlock.includes("without shame");
    const signals   = true;

    SCORES.push({ scenario: "skipped workout (SKIPPED state)", safety, scheduler, signals });
    expect(scheduler).toBe(true);
  });

  // ── "burnout + overwhelm" — active signals must both surface ─────────────

  it("burnout + overwhelm → both signals visible above threshold", () => {
    const burnoutSig: DetectedSignal = { type: "burnout",   intensity: 0.81, valence: "negative", confidence: 0.90, evidence: [] };
    const overwhelmSig: DetectedSignal = { type: "overwhelm", intensity: 0.73, valence: "negative", confidence: 0.85, evidence: [] };
    const block = buildActiveSignalsBlock([burnoutSig, overwhelmSig]);

    const safety    = true;
    const scheduler = true;
    const signals   = block.includes("burnout (0.81)") && block.includes("overwhelm (0.73)");

    SCORES.push({ scenario: "burnout + overwhelm (active signals)", safety, scheduler, signals });
    expect(signals).toBe(true);
  });

  // ── "I want to quit" — self_doubt signal must surface ────────────────────

  it("quit message → self_doubt signal above threshold", () => {
    const quitSig: DetectedSignal = { type: "self_doubt", intensity: 0.62, valence: "negative", confidence: 0.80, evidence: ["want to quit"] };
    const block = buildActiveSignalsBlock([quitSig]);

    const safety    = true;
    const scheduler = true;
    const signals   = block.includes("self_doubt (0.62)");

    SCORES.push({ scenario: "quit message (self_doubt signal)", safety, scheduler, signals });
    expect(signals).toBe(true);
  });

  // ── "coming back after gap" — PENDING_CONFIRMATION must verify ────────────

  it("comeback after gap → PENDING_CONFIRMATION verifies before assuming", () => {
    const schedulerBlock = buildTrainingStateBlock(makeSchedulerCtx({
      trainingState:    TrainingState.PENDING_CONFIRMATION,
      consecutiveMisses: 3,
      completionRate7d: 0.30,
      observedWindow:   TrainingWindow.MORNING,
      windowConfidence: "low",
    }));
    const safety    = true;
    const scheduler = schedulerBlock.includes("Current state: PENDING_CONFIRMATION") &&
                      schedulerBlock.includes("Verify whether they trained");
    const signals   = true;

    SCORES.push({ scenario: "comeback after gap (PENDING_CONFIRMATION)", safety, scheduler, signals });
    expect(scheduler).toBe(true);
  });

  // ── "consistent streak" — positive consistency signal correct ────────────

  it("consistent streak → plain 'consistency' signal (not _negative)", () => {
    const posSig: DetectedSignal = { type: "consistency", intensity: 0.72, valence: "positive", confidence: 0.85, evidence: ["been consistent"] };
    const block = buildActiveSignalsBlock([posSig]);

    const safety    = true;
    const scheduler = true;
    const signals   = block.includes("• consistency (0.72)") && !block.includes("consistency_negative");

    SCORES.push({ scenario: "consistent streak (positive consistency)", safety, scheduler, signals });
    expect(signals).toBe(true);
  });

  // ── "inconsistent pattern" — negative consistency labelled correctly ──────

  it("inconsistent pattern → consistency_negative signal shown", () => {
    const negSig: DetectedSignal = { type: "consistency", intensity: 0.68, valence: "negative", confidence: 0.82, evidence: ["keep skipping"] };
    const block = buildActiveSignalsBlock([negSig]);

    const safety    = true;
    const scheduler = true;
    const signals   = block.includes("consistency_negative (0.68)");

    SCORES.push({ scenario: "inconsistent pattern (consistency_negative)", safety, scheduler, signals });
    expect(signals).toBe(true);
  });

  // ── "DUE + cycle day visible" — LLM sees which day of split is pending ───

  it("DUE state shows cycle day in prompt block", () => {
    const schedulerBlock = buildTrainingStateBlock(makeSchedulerCtx({
      trainingState:       TrainingState.DUE,
      pendingMuscles:      "legs",
      pendingSplitDayIndex: 2,
      completionRate7d:    0.70,
      observedWindow:      TrainingWindow.AFTERNOON,
      windowConfidence:    "high",
    }));
    const safety    = true;
    const scheduler = schedulerBlock.includes("Cycle day: 3") &&
                      schedulerBlock.includes("Current muscle group: legs");
    const signals   = true;

    SCORES.push({ scenario: "DUE state with cycle day", safety, scheduler, signals });
    expect(scheduler).toBe(true);
  });

  // ── Ensure all 10 scenarios ran ───────────────────────────────────────────

  it("AUDIT COMPLETE — all 10 special scenarios captured", () => {
    expect(SCORES).toHaveLength(10);
  });
});
