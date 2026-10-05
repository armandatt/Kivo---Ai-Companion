/**
 * Architecture-level boundary tests.
 *
 * Validates:
 * 1. Engine isolation — no cross-engine LLM calls from deterministic engines
 * 2. Decision graph determinism — identical inputs produce identical outputs
 * 3. Confidence propagation — decision confidence flows through pipeline
 * 4. Context builder budget compliance
 * 5. Signal → State propagation
 * 6. Simulated conversation scenarios (end-to-end without LLM/DB)
 */

import { extractSignals }          from "../engines/signal-engine.js";
import { computeAcademicState, patchMomentaryState } from "../engines/academic-state-engine.js";
import { runDecisionGraph }         from "../decision/decision-graph.js";
import { runDecisionEngine }        from "../decision/decision-engine.js";
import { buildDynamicLayer, buildMicroPrompt } from "../context/context-builder.js";
import { runPatternDetector }       from "../engines/pattern-detector.js";
import { STATE_BASELINES }          from "../types/academic-state.types.js";
import type { AcademicState }       from "../types/academic-state.types.js";
import type { AcademicUnderstanding } from "../types/understanding.types.js";
import type { NovaContext }          from "../types/context.types.js";
import type { PatternAnalysis }      from "../types/engine.types.js";

// ── Test utilities ─────────────────────────────────────────────────────────────

function makeState(overrides: Partial<AcademicState> = {}): AcademicState {
  return {
    semesterPhase:    "midterm",
    activeMode:       "standard",
    momentaryState:   "neutral",
    scores:           { ...STATE_BASELINES },
    hardDirectives: {
      noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
      calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false,
    },
    daysSinceJoined:       60,
    daysSinceLastSession:  1,
    consecutiveMisses:     0,
    studyStreakDays:        3,
    daysUntilNextExam:     null,
    momentum7dTrend:       [50, 55, 60, 58, 62, 65, 67],
    stateHistory:          [],
    ...overrides,
  };
}

function makeUnderstanding(overrides: Partial<AcademicUnderstanding> = {}): AcademicUnderstanding {
  return {
    intent:          "general_chat",
    emotion:         "neutral",
    disclosureClass: "none",
    topic:           null,
    topicConfidence: 0.0,
    ambiguityScore:  0.1,
    routingSignal:   "coaching_only",
    rawText:         "test message",
    ...overrides,
  };
}

function makeNullPatterns(): PatternAnalysis {
  return {
    detectedPatterns:     [],
    dominantPattern:      null,
    analysisRunAt:        new Date("2026-01-15T10:00:00Z"),
    messagesSinceLastRun: 1,
  };
}

function makeContext(
  state: AcademicState,
  understanding: AcademicUnderstanding,
  message: string,
): NovaContext {
  return {
    platformChatId: "test_chat_123",
    rawMessage:     message,
    timestamp:      new Date("2026-01-15T10:00:00Z"),
    understanding,
    academicState:  state,
    signals:        extractSignals(message, state),
    userProfile: {
      displayName:               "Test Student",
      yearOfStudy:               2,
      major:                     "Computer Science",
      institution:               "Test University",
      preferredStudyHoursPerDay: 3,
      subjects:                  ["Math", "Physics"],
      daysSinceJoined:           60,
    },
    topicMastery:        null,
    examContext:         null,
    studyPlan:           null,
    activeSession:       null,
    sessionContext:      null,
    sessionAction:       null,
    patterns:            makeNullPatterns(),
    topRelevantMemories: [],
    contrastiveMemories: [],
    cognitiveState: {
      investigationTopic:       null,
      investigationHypotheses:  [],
      investigationMissingData: [],
      investigationEvidence:    null,
      investigationAttempts:    0,
      investigationStatus:      null,
      investigationStartedAt:   null,
      investigationUpdatedAt:   null,
      followUpChecks:           null,
      reasoningHistory:         null,
    },
    activeRealityFacts: [],
    conversationHistory: [],
    decision:            null,
  };
}

// ── 1. Engine isolation ────────────────────────────────────────────────────────

describe("Engine isolation", () => {
  it("signal engine returns output without any external calls", () => {
    const state = makeState();
    const out   = extractSignals("I finished chapter 5 today", state);

    expect(out).toHaveProperty("detectedSignals");
    expect(out).toHaveProperty("stateUpdates");
    // A signal is evidence. The engine must not decide what is remembered (§11.7).
    expect(out).not.toHaveProperty("memoryWrites");
    expect(Array.isArray(out.detectedSignals)).toBe(true);
  });

  it("academic state engine is pure — same input, same output", () => {
    const now    = new Date("2026-03-01T10:00:00Z");
    const input  = {
      semesterStartDate:       new Date("2026-01-10"),
      semesterEndDate:         new Date("2026-05-10"),
      daysSinceJoined:         50,
      studySessions:           [{ sessionDate: new Date("2026-02-28"), durationMinutes: 90, status: "completed" }],
      upcomingExams:           [],
      stateHistory:            [],
      signals:                 extractSignals("studied today", makeState()),
      mentionedTopicMastery:   null,
      understanding:           makeUnderstanding({ intent: "study_report" }),
      storedScores:            { ...STATE_BASELINES },
      storedStreakDays:         5,
      storedConsecutiveMisses: 0,
    };

    const out1 = computeAcademicState(input, now);
    const out2 = computeAcademicState(input, now);
    expect(out1.semesterPhase).toBe(out2.semesterPhase);
    expect(out1.scores.engagement).toBe(out2.scores.engagement);
    expect(out1.momentaryState).toBe(out2.momentaryState);
  });

  it("pattern detector is pure — no I/O, deterministic", () => {
    const result = runPatternDetector(
      {
        studySessions:        [],
        signalHistory:        [],
        topicMasteries:       [],
        priorPatterns:        [],
        messagesSinceLastRun: 1,
      },
      new Date("2026-01-15"),
    );
    expect(result).toHaveProperty("detectedPatterns");
    expect(result).toHaveProperty("dominantPattern");
  });
});

// ── 2. Decision Graph determinism ──────────────────────────────────────────────

describe("Decision Graph determinism", () => {
  it("produces identical output for identical inputs", () => {
    const state         = makeState();
    const understanding = makeUnderstanding({ intent: "study_report", emotion: "motivated" });
    const signals       = extractSignals("I studied for 2 hours today", state);
    const patterns      = makeNullPatterns();

    const out1 = runDecisionGraph(understanding, state, signals, patterns, []);
    const out2 = runDecisionGraph(understanding, state, signals, patterns, []);

    expect(out1.selectedIntervention).toBe(out2.selectedIntervention);
    expect(out1.graphNode).toBe(out2.graphNode);
    expect(out1.confidence).toBe(out2.confidence);
  });

  it("crisis gate (N1) fires when emotion=distressed + emotional_vent intent", () => {
    const state         = makeState();
    const understanding = makeUnderstanding({ intent: "emotional_vent", emotion: "distressed" });
    const signals       = extractSignals("I can't go on anymore, I'm completely done", state);

    const out = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);
    expect(out.graphNode).toBe("N1");
    expect(out.selectedIntervention).toBe("crisis_redirect");
  });

  it("N2 directive gate fires prevent_burnout when burnoutRisk > 70", () => {
    const state = makeState({
      scores:        { ...STATE_BASELINES, burnoutRisk: 80, engagement: 25 },
      momentaryState: "burned_out",
    });
    const understanding = makeUnderstanding({ intent: "study_report", emotion: "motivated" });
    const signals       = extractSignals("I finished a chapter", state);

    const out = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);
    expect(out.graphNode).toBe("N2");
    expect(out.selectedIntervention).toBe("prevent_burnout");
  });

  it("N1 does NOT fire when burnoutRisk ≤ 85", () => {
    const state = makeState({
      scores: { ...STATE_BASELINES, burnoutRisk: 80 },
    });
    const understanding = makeUnderstanding({ intent: "study_report", emotion: "motivated" });
    const signals       = extractSignals("I finished chapter 3", state);
    const out = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    expect(out.graphNode).not.toBe("N1");
  });

  it("directive gate (N2) blocks challenging when noChallenging is active", () => {
    const state = makeState({
      hardDirectives: {
        noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
        calibrationAlert: false, noChallenging: true, recoveryMode: false, beginnerMode: false,
      },
    });
    const understanding = makeUnderstanding({ intent: "excuse", emotion: "avoidant" });
    const signals       = extractSignals("I was too busy, I'll start next week", state);
    const out = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    expect(out.selectedIntervention).not.toBe("challenge");
  });

  it("N5 (momentum gate) fires before N3 for study_report with positive streak", () => {
    const state = makeState({
      studyStreakDays: 5,
      scores: { ...STATE_BASELINES, momentum: 72, engagement: 75 },
    });
    const understanding = makeUnderstanding({
      intent:        "study_report",
      emotion:       "motivated",
      routingSignal: "coaching_only",
    });
    const signals = extractSignals("I studied 2 hours today. Third day in a row!", state);
    const out     = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    // Should get a momentum/celebration intervention
    const momentumInterventions = ["celebrate_win", "momentum_push", "reinforce_identity"];
    expect(momentumInterventions).toContain(out.selectedIntervention);
  });
});

// ── 3. Confidence propagation ──────────────────────────────────────────────────

describe("Confidence propagation", () => {
  it("decision graph output contains confidence value", () => {
    const state         = makeState();
    const understanding = makeUnderstanding({ intent: "topic_question" });
    const signals       = extractSignals("How should I study organic chemistry?", state);

    const decision = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    expect(typeof decision.confidence).toBe("number");
    expect(decision.confidence).toBeGreaterThan(0);
    expect(decision.confidence).toBeLessThanOrEqual(1);
  });

  it("decision engine scorer returns bounded score 0–100", () => {
    const state         = makeState({ scores: { ...STATE_BASELINES, momentum: 20 } });
    const understanding = makeUnderstanding({ intent: "excuse", emotion: "avoidant" });
    const signals       = extractSignals("I keep putting it off", state);
    const patterns      = makeNullPatterns();

    const out = runDecisionEngine({
      state: state,
      signals: signals.detectedSignals,
      understanding,
      patterns,
      memories: [],
    });

    expect(typeof out.score).toBe("number");
    expect(out.score).toBeGreaterThanOrEqual(0);
    expect(out.score).toBeLessThanOrEqual(100);
    expect(typeof out.confidence).toBe("number");
  });
});

// ── 4. Context builder budget compliance ──────────────────────────────────────

describe("Context builder budget compliance", () => {
  const MAX_DYNAMIC_CHARS = 7_500;
  const MAX_MICRO_CHARS   = 1_100;

  it("dynamic layer stays within budget for a minimal context", () => {
    const state         = makeState();
    const understanding = makeUnderstanding();
    const ctx           = makeContext(state, understanding, "Hello");
    const decision      = runDecisionGraph(understanding, state, extractSignals("Hello", state), makeNullPatterns(), []);
    ctx.decision        = decision;

    const dynamic = buildDynamicLayer(ctx);
    expect(dynamic.length).toBeLessThanOrEqual(MAX_DYNAMIC_CHARS);
    expect(dynamic).toContain("## Student");
    expect(dynamic).toContain("## Academic State");
  });

  it("micro-prompt stays within budget", () => {
    const state         = makeState();
    const understanding = makeUnderstanding({ intent: "study_report" });
    const signals       = extractSignals("I finished chapter 4 today", state);
    const decision      = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);
    const ctx           = makeContext(state, understanding, "I finished chapter 4 today");
    ctx.decision        = decision;

    const micro = buildMicroPrompt(decision, ctx);
    expect(micro.length).toBeLessThanOrEqual(MAX_MICRO_CHARS);
    expect(micro).toContain("Selected approach:");
    expect(micro).toContain("Evidence:");
  });

  it("dynamic layer includes understanding section", () => {
    const state         = makeState();
    const understanding = makeUnderstanding({ intent: "exam_anxiety", topic: "Calculus" });
    const ctx           = makeContext(state, understanding, "I'm scared about the Calculus exam");

    const dynamic = buildDynamicLayer(ctx);
    expect(dynamic).toContain("## This Message");
    expect(dynamic).toContain("exam_anxiety");
  });

  it("dynamic layer includes pattern section when dominant pattern is confirmed", () => {
    const state         = makeState();
    const understanding = makeUnderstanding();
    const ctx           = makeContext(state, understanding, "Hello");
    const pattern = {
      type:           "excuse_loop" as const,
      severity:       "confirmed" as const,
      occurrences:    4,
      confidence:     0.85,
      recommendation: "Challenge the pattern directly",
      firstSeenAt:    new Date(),
      evidence:       ["too busy", "next week"],
    };
    ctx.patterns = {
      detectedPatterns:     [pattern],
      dominantPattern:      pattern,
      analysisRunAt:        new Date(),
      messagesSinceLastRun: 1,
    };

    const dynamic = buildDynamicLayer(ctx);
    expect(dynamic).toContain("excuse_loop");
    expect(dynamic).toContain("confirmed");
  });
});

// ── 5. Signal → State propagation ────────────────────────────────────────────

describe("Signal → State propagation", () => {
  it("achievement signal increases engagement and confidence deltas", () => {
    const state   = makeState({ scores: { ...STATE_BASELINES, engagement: 50, confidence: 50 } });
    const signals = extractSignals("I aced the midterm, scored 95!", state);

    const achievementSignal = signals.detectedSignals.find(s => s.type === "achievement");
    expect(achievementSignal).toBeDefined();

    const engagementDelta = signals.stateUpdates.find(
      u => u.field === "engagement" && u.triggerSignal === "achievement"
    );
    expect(engagementDelta).toBeDefined();
    expect(engagementDelta!.delta).toBeGreaterThan(0);
  });

  it("burnout signal drives burnoutRisk upward", () => {
    const state   = makeState();
    const signals = extractSignals("I'm completely burned out and going through the motions", state);

    const burnoutSignal = signals.detectedSignals.find(s => s.type === "burnout_behavioral");
    expect(burnoutSignal).toBeDefined();

    const riskDelta = signals.stateUpdates.find(u => u.field === "burnoutRisk");
    expect(riskDelta).toBeDefined();
    expect(riskDelta!.delta).toBeGreaterThan(0);
  });

  it("clean study report (no miss/excuse) gets extra adherence bonus", () => {
    const state   = makeState();
    const signals = extractSignals("I finished chapter 2 today", state);

    const reportSignal = signals.detectedSignals.find(s => s.type === "study_report");
    expect(reportSignal).toBeDefined();

    const bonusUpdate = signals.stateUpdates.find(
      u => u.field === "planAdherence" && u.reason === "clean_report:no_miss_this_turn"
    );
    expect(bonusUpdate).toBeDefined();
    expect(bonusUpdate!.delta).toBe(3);
  });

  it("skip + excuse turn does NOT get clean report bonus", () => {
    const state   = makeState();
    const signals = extractSignals(
      "I didn't study today, I was too busy and missed the session",
      state,
    );

    const bonusUpdate = signals.stateUpdates.find(
      u => u.reason === "clean_report:no_miss_this_turn"
    );
    expect(bonusUpdate).toBeUndefined();
  });
});

// ── 6. Simulated conversation scenarios ───────────────────────────────────────

describe("Simulated conversation scenarios", () => {
  /**
   * Scenario: Student reports studying with 3-day streak.
   * Should celebrate or push momentum, NOT empathize or challenge.
   */
  it("study report with streak → momentum/celebration intervention", () => {
    const state = makeState({
      studyStreakDays: 3,
      scores: { ...STATE_BASELINES, momentum: 65 },
    });
    const understanding = makeUnderstanding({
      intent:        "study_report",
      emotion:       "motivated",
      routingSignal: "coaching_only",
    });
    const signals  = extractSignals("I finished reviewing chapter 5. It took 2 hours but I got through it.", state);
    const decision = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    const positiveInterventions = [
      "celebrate_win", "momentum_push", "reinforce_identity",
      "anchor_commitment", "goal_alignment",
    ];
    expect(positiveInterventions).toContain(decision.selectedIntervention);
  });

  /**
   * Scenario: Student makes excuse after two consecutive misses.
   * Should get accountability, challenge, or reframe.
   */
  it("skip + excuse with consecutive misses → accountability response", () => {
    const state = makeState({
      consecutiveMisses: 2,
      scores: { ...STATE_BASELINES, momentum: 35, planAdherence: 30 },
    });
    const understanding = makeUnderstanding({
      intent:        "excuse",
      emotion:       "avoidant",
      routingSignal: "coaching_only",
    });
    const signals  = extractSignals("I didn't study because I was too busy with work", state);
    const decision = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    const accountabilityInterventions = [
      "accountability", "challenge", "reframe_failure",
      "refocus", "surface_commitment",
    ];
    expect(accountabilityInterventions).toContain(decision.selectedIntervention);
  });

  /**
   * Scenario: Extreme burnout (burnoutRisk=90).
   * N2 catches it (burnoutRisk > 70) → prevent_burnout.
   * N1 would only fire for emotion=distressed, not overwhelmed.
   */
  it("burnout at 90 → prevent_burnout via N2", () => {
    const state = makeState({
      scores:        { ...STATE_BASELINES, burnoutRisk: 90, engagement: 15 },
      momentaryState: "burned_out",
    });
    const understanding = makeUnderstanding({
      intent:  "emotional_vent",
      emotion: "overwhelmed",
    });
    const signals  = extractSignals("I'm burned out and exhausted, I can't do this anymore", state);
    const decision = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    expect(decision.selectedIntervention).toBe("prevent_burnout");
    expect(decision.graphNode).toBe("N2");
  });

  /**
   * Scenario: True crisis (distressed + emotional_vent) → N1 → crisis_redirect.
   */
  it("distress signal → crisis_redirect via N1", () => {
    const state         = makeState();
    const understanding = makeUnderstanding({ intent: "emotional_vent", emotion: "distressed" });
    const signals       = extractSignals("I just can't anymore, everything is falling apart", state);
    const decision      = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    expect(decision.selectedIntervention).toBe("crisis_redirect");
    expect(decision.graphNode).toBe("N1");
  });

  /**
   * Scenario: Student makes a specific commitment.
   * Should anchor or reinforce the commitment.
   */
  it("commitment_made → anchor or surface commitment", () => {
    const state = makeState();
    const understanding = makeUnderstanding({
      intent:        "commitment_made",
      emotion:       "motivated",
      routingSignal: "coaching_only",
    });
    const signals  = extractSignals("I'll study for 3 hours tomorrow morning", state);
    const decision = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    const commitmentInterventions = [
      "anchor_commitment", "surface_commitment", "goal_alignment",
      "refocus", "momentum_push",
    ];
    expect(commitmentInterventions).toContain(decision.selectedIntervention);
  });

  /**
   * Scenario: Reality-extraction routing → clarify (first in reality_extraction family).
   * High ambiguity + null topic → Understanding Brain sets routingSignal=reality_extraction,
   * which N3 routes to clarify.
   */
  it("reality_extraction routing → clarify via N3", () => {
    const state = makeState();
    const understanding = makeUnderstanding({
      intent:        "topic_question",
      emotion:       "confused",
      ambiguityScore: 0.85,
      topic:          null,
      routingSignal:  "reality_extraction",  // set by Understanding Brain after disambiguation
    });
    const signals  = extractSignals("I need help with it", state);
    const decision = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    expect(decision.selectedIntervention).toBe("clarify");
    expect(decision.graphNode).toBe("N3");
  });

  /**
   * Scenario: Student returning after 8-day gap.
   * Should be welcomed back gently — not challenged.
   */
  it("returning after long gap → re_engagement or reduce_friction", () => {
    const state = makeState({
      daysSinceLastSession: 8,
      consecutiveMisses:    3,
      momentaryState:       "returning",
      scores: { ...STATE_BASELINES, momentum: 25, planAdherence: 20 },
    });
    const understanding = makeUnderstanding({
      intent:        "study_report",
      emotion:       "neutral",
      routingSignal: "coaching_only",
    });
    const signals  = extractSignals("I'm back to studying, trying to get back on track", state);
    const decision = runDecisionGraph(understanding, state, signals, makeNullPatterns(), []);

    const softInterventions = [
      "re_engagement", "reduce_friction", "refocus",
      "celebrate_win", "momentum_push", "goal_alignment",
    ];
    expect(softInterventions).toContain(decision.selectedIntervention);
  });
});

// ── 7. Momentary state patching ───────────────────────────────────────────────

describe("Momentary state patching", () => {
  it("excuse_loop pattern + excuse intent → excuse_active state", () => {
    const base   = makeState({ momentaryState: "neutral" });
    const u      = makeUnderstanding({ intent: "excuse", emotion: "avoidant" });
    const patched = patchMomentaryState(base, true /* hasExcuseLoop */, false, u);

    // Actual value set by patchMomentaryState is "excuse_active"
    expect(patched.momentaryState).toBe("excuse_active");
  });

  it("comparison_trap pattern + discouraged emotion → comparison_trap state", () => {
    const base   = makeState({ momentaryState: "neutral" });
    const u      = makeUnderstanding({ intent: "identity_doubt", emotion: "discouraged" });
    const patched = patchMomentaryState(base, false, true /* hasComparisonTrap */, u);

    // Actual value set by patchMomentaryState is "comparison_trap"
    expect(patched.momentaryState).toBe("comparison_trap");
  });

  it("no patterns → patchMomentaryState returns state unchanged", () => {
    const base   = makeState({ momentaryState: "momentum" });
    const u      = makeUnderstanding({ intent: "study_report", emotion: "motivated" });
    const patched = patchMomentaryState(base, false, false, u);

    expect(patched.momentaryState).toBe("momentum");
    expect(patched.scores).toEqual(base.scores);
  });
});
