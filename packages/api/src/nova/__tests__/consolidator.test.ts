// ─── Consolidator unit tests ──────────────────────────────────────────────────
// SKILL.md §11.7 — evidence is not memory. These tests pin the boundary:
// what evidence may become durable state, and under which conditions.
import { consolidate, FACT_STALE_DAYS } from "../consolidation/consolidator.js";
import {
  ACTIVE_THRESHOLD,
  OBSERVATION_WINDOW_HOURS,
  QUIET_AFTER_DAYS,
  STALE_AFTER_DAYS,
} from "../consolidation/policies/pattern-policy.js";
import { STANDING_TTL_HOURS } from "../consolidation/policies/reality-policy.js";
import { buildTurnEvidence } from "../consolidation/evidence-builder.js";
import { extractSignals } from "../engines/signal-engine.js";
import { runPatternDetector } from "../engines/pattern-detector.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";
import type { AcademicState } from "../types/academic-state.types.js";
import type { AcademicUnderstanding } from "../types/understanding.types.js";
import type {
  ConsolidationInput,
  ConsolidationState,
  Evidence,
  PatternDetectionEvidence,
  RealityClaimEvidence,
  RealityResolutionEvidence,
  SignalEvidence,
  StoredPattern,
  StoredReality,
} from "../types/consolidation.types.js";

const NOW = new Date("2026-03-10T10:00:00Z");
const hoursAgo  = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const hoursFrom = (h: number) => hoursAgo(-h);
const daysAgo   = (d: number) => hoursAgo(d * 24);

const BASE = {
  companion: "nova" as const,
  userId: "user_1", profileId: "profile_1",
  observedAt: NOW, sourceMessageId: "msg_1",
};

function signal(overrides: Partial<SignalEvidence> = {}): SignalEvidence {
  return {
    ...BASE, kind: "signal", source: "signal_engine",
    signalType: "commitment", confidence: 0.9, intensity: 0.9,
    corroborated: true, topic: null,
    sourceText: "I'll study chapter 4 tonight",
    ...overrides,
  };
}

function realityClaim(overrides: Partial<RealityClaimEvidence> = {}): RealityClaimEvidence {
  return {
    ...BASE, kind: "reality_claim", source: "understanding_brain",
    confidence: 0.85, category: "health", subtype: "illness",
    description: "Student has the flu", persistence: "temporary", expectedDurationHours: null,
    sourceText: "I've got the flu this week",
    ...overrides,
  };
}

function realityResolution(overrides: Partial<RealityResolutionEvidence> = {}): RealityResolutionEvidence {
  return {
    ...BASE, kind: "reality_resolution", source: "understanding_brain",
    confidence: 0.85, category: "health", subtype: "illness",
    sourceText: "I was sick last week, I'm fine now",
    ...overrides,
  };
}

function storedReality(overrides: Partial<StoredReality> = {}): StoredReality {
  return {
    id: "r_1", category: "health", subtype: "illness", fact: "Student has the flu",
    confidence: 0.8, expiresAt: hoursFrom(24), sourceMessageIds: ["msg_0"],
    ...overrides,
  };
}

function patternDetection(overrides: Partial<PatternDetectionEvidence> = {}): PatternDetectionEvidence {
  return {
    ...BASE, kind: "pattern_detection", source: "pattern_detector",
    confidence: 0.7, patternType: "excuse_loop",
    description: "Do not accept the excuse.", supporting: ["3 excuse signals in last 15 messages"],
    sourceText: "I was too busy again",
    ...overrides,
  };
}

function storedPattern(overrides: Partial<StoredPattern> = {}): StoredPattern {
  return {
    id: "pat_1", patternType: "excuse_loop", status: "emerging", evidenceCount: 1,
    confidence: 0.42, firstObservedAt: daysAgo(2), lastObservedAt: daysAgo(2),
    lastChangedAt: daysAgo(2), sourceMessageIds: ["msg_0"],
    ...overrides,
  };
}

function emptyState(overrides: Partial<ConsolidationState> = {}): ConsolidationState {
  return { facts: [], realities: [], patterns: [], investigation: null, recentSessions: [], ...overrides };
}

function run(evidence: Evidence[], state = emptyState(), extra: Partial<ConsolidationInput> = {}) {
  return consolidate({ evidence, state, now: NOW, patternScanRan: false, hasActiveSession: false, ...extra });
}

const NEUTRAL_STATE: AcademicState = {
  semesterPhase: "beginning", activeMode: "standard", momentaryState: "neutral",
  scores: { ...STATE_BASELINES },
  hardDirectives: {
    noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
    calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false,
  },
  daysSinceJoined: 30, daysSinceLastSession: 0, consecutiveMisses: 0, studyStreakDays: 3,
  daysUntilNextExam: null, momentum7dTrend: [0, 0, 0, 0, 0, 0, 0], stateHistory: [],
};

function understanding(overrides: Partial<AcademicUnderstanding> = {}): AcademicUnderstanding {
  return {
    intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
    disclosureClass: "none", ambiguityScore: 0.1, routingSignal: "coaching_only", rawText: "",
    ...overrides,
  };
}

// ═══ FACTS ════════════════════════════════════════════════════════════════════

describe("facts", () => {
  it("a corroborated commitment creates a commitment fact", () => {
    const [d] = run([signal()]);
    expect(d).toMatchObject({ action: "CREATE", target: "user_fact", reason: "new_fact" });
    expect(d?.write).toMatchObject({ type: "commitment", key: "latest_commitment", evidenceCount: 1 });
  });

  it("study reports and skips never become UserFacts", () => {
    const decisions = run([
      signal({ signalType: "study_report", sourceText: "I finished chapter 3" }),
      signal({ signalType: "study_skip",   sourceText: "I didn't study" }),
    ]);
    expect(decisions.some(d => d.target === "user_fact")).toBe(false);
    expect(decisions.every(d => d.target === "academic_observation")).toBe(true);
  });

  it("an excuse signal is ignored as transient, never stored as a fact", () => {
    const [d] = run([signal({ signalType: "excuse", sourceText: "I was too busy" })]);
    expect(d).toMatchObject({ action: "IGNORE", reason: "transient_signal" });
  });

  it("the same achievement from a later message reinforces instead of duplicating", () => {
    const created = run([signal({ signalType: "achievement", sourceText: "I aced the calculus midterm" })])[0]!.write!;
    if (created.target !== "user_fact") throw new Error("expected fact");

    const state = emptyState({
      facts: [{
        id: "fact_1", type: created.type, key: created.key, value: created.value,
        confidence: created.confidence, evidenceCount: 1, lastObservedAt: daysAgo(1),
        sourceMessageIds: ["msg_1"],
      }],
    });
    const [d] = run([signal({ signalType: "achievement", sourceText: "I aced the calculus midterm!", sourceMessageId: "msg_2" })], state);

    expect(d).toMatchObject({ action: "UPDATE", reason: "reinforced", targetId: "fact_1" });
    expect(d?.write).toMatchObject({ evidenceCount: 2 });
  });

  describe("contradiction", () => {
    const stored = {
      id: "fact_1", type: "commitment", key: "latest_commitment",
      value: "I'll study chapter 4 tonight", confidence: 0.9, evidenceCount: 2,
      lastObservedAt: daysAgo(1), sourceMessageIds: ["msg_0"],
    };

    it("a weaker contradicting observation is ignored", () => {
      const [d] = run([signal({ confidence: 0.75, sourceText: "I'm going to do nothing this week" })], emptyState({ facts: [stored] }));
      expect(d).toMatchObject({ action: "IGNORE", reason: "contradiction_weaker_than_existing" });
    });

    it("a replacement keeps the superseded value", () => {
      const [d] = run([signal({ sourceText: "I'll do two hours of physics tomorrow" })], emptyState({ facts: [stored] }));
      expect(d).toMatchObject({ action: "UPDATE", reason: "superseded", targetId: "fact_1" });
      expect(d?.write).toMatchObject({ supersedes: { value: "I'll study chapter 4 tonight", confidence: 0.9 } });
    });

    it("a stale stored value yields even to weaker evidence", () => {
      const [d] = run(
        [signal({ confidence: 0.75, sourceText: "I'll do two hours of physics tomorrow" })],
        emptyState({ facts: [{ ...stored, lastObservedAt: daysAgo(FACT_STALE_DAYS + 1) }] }),
      );
      expect(d).toMatchObject({ action: "UPDATE", reason: "superseded_stale" });
    });
  });

  describe("confidence", () => {
    it("an uncorroborated low-confidence regex match does not create a fact", () => {
      const [d] = run([signal({ confidence: 0.75, corroborated: false })]);
      expect(d).toMatchObject({ action: "IGNORE", reason: "insufficient_confidence" });
    });

    it("the same match corroborated by the Understanding Brain does", () => {
      const [d] = run([signal({ confidence: 0.75, corroborated: true })]);
      expect(d).toMatchObject({ action: "CREATE", target: "user_fact" });
    });
  });
});

// ═══ REALITY ══════════════════════════════════════════════════════════════════

describe("reality", () => {
  it("an illness claim becomes an active reality record", () => {
    const [d] = run([realityClaim()]);
    expect(d).toMatchObject({ action: "CREATE", target: "reality", reason: "new_constraint" });
    expect(d?.write).toMatchObject({ category: "health", subtype: "illness", description: "Student has the flu" });
  });

  it("explicit recovery resolves the record", () => {
    const [d] = run([realityResolution()], emptyState({ realities: [storedReality()] }));
    expect(d).toMatchObject({ action: "RESOLVE", target: "reality", targetId: "r_1" });
  });

  it("explicit resolution wins over expiry for a record already past its TTL", () => {
    const decisions = run([realityResolution()], emptyState({ realities: [storedReality({ expiresAt: hoursAgo(5) })] }));
    expect(decisions).toEqual([expect.objectContaining({ action: "RESOLVE", targetId: "r_1" })]);
  });

  it("a resolution with nothing active is ignored", () => {
    const [d] = run([realityResolution()]);
    expect(d).toMatchObject({ action: "IGNORE", reason: "nothing_to_resolve" });
  });

  it("a resolution that could mean two different records resolves neither", () => {
    const state = emptyState({ realities: [
      storedReality({ id: "r_work",   category: "life_constraint", subtype: "work",   fact: "Works night shifts" }),
      storedReality({ id: "r_travel", category: "life_constraint", subtype: "travel", fact: "Travelling this week" }),
    ] });
    const [d] = run([realityResolution({ category: "life_constraint", subtype: null })], state);
    expect(d).toMatchObject({ action: "IGNORE", reason: "ambiguous_resolution" });

    const [named] = run([realityResolution({ category: "life_constraint", subtype: "travel" })], state);
    expect(named).toMatchObject({ action: "RESOLVE", targetId: "r_travel" });
  });

  it("repeating the same condition updates the record instead of duplicating it", () => {
    const [d] = run([realityClaim()], emptyState({ realities: [storedReality()] }));
    expect(d).toMatchObject({ action: "UPDATE", reason: "reinforced", targetId: "r_1" });
    if (d?.write?.target !== "reality") throw new Error("expected reality");
    expect(d.write.expiresAt.getTime()).toBeGreaterThan(hoursFrom(24).getTime());
  });

  it("different circumstances in one category coexist", () => {
    const state = emptyState({ realities: [storedReality({ category: "life_constraint", subtype: "work", fact: "Works night shifts" })] });
    const [d] = run([realityClaim({ category: "life_constraint", subtype: "travel", description: "Student is travelling this week" })], state);
    expect(d).toMatchObject({ action: "CREATE", reason: "new_constraint" });
  });

  it("a weaker conflicting claim does not overwrite the record", () => {
    const [d] = run(
      [realityClaim({ confidence: 0.66, description: "Student has a mild cold" })],
      emptyState({ realities: [storedReality({ confidence: 0.9 })] }),
    );
    expect(d).toMatchObject({ action: "IGNORE", reason: "contradiction_weaker_than_existing" });
  });

  it("a conflicting claim that does replace it keeps the old description", () => {
    const [d] = run(
      [realityClaim({ confidence: 0.9, description: "Student has pneumonia" })],
      emptyState({ realities: [storedReality()] }),
    );
    expect(d).toMatchObject({ action: "UPDATE", reason: "superseded", targetId: "r_1" });
    expect(d?.write).toMatchObject({ supersedes: { value: "Student has the flu", confidence: 0.8 } });
  });

  it("a record past its TTL is expired, and is not treated as active", () => {
    const expired = storedReality({ id: "r_old", expiresAt: hoursAgo(5) });
    expect(run([], emptyState({ realities: [expired] })))
      .toEqual([expect.objectContaining({ action: "EXPIRE", target: "reality", targetId: "r_old" })]);

    // A new mention is a new episode: it does not revive the expired row.
    const decisions = run([realityClaim()], emptyState({ realities: [expired] }));
    expect(decisions.map(d => d.action)).toEqual(["CREATE", "EXPIRE"]);
  });

  it("a standing constraint outlives the short category TTL", () => {
    const [d] = run([realityClaim({
      category: "life_constraint", subtype: "work", persistence: "standing",
      description: "Student has a part-time job",
    })]);
    if (d?.write?.target !== "reality") throw new Error("expected reality");
    expect(d.write.expiresAt.getTime()).toBe(hoursFrom(STANDING_TTL_HOURS).getTime());
  });

  it("re-mentioning a standing constraint as temporary does not shorten it", () => {
    const standing = storedReality({
      category: "life_constraint", subtype: "work", fact: "Student has a part-time job",
      expiresAt: hoursFrom(STANDING_TTL_HOURS - 24),
    });
    const [d] = run([realityClaim({
      category: "life_constraint", subtype: "work", persistence: "temporary",
      description: "Student has a part-time job",
    })], emptyState({ realities: [standing] }));
    if (d?.write?.target !== "reality") throw new Error("expected reality");
    expect(d.write.expiresAt).toEqual(standing.expiresAt);
  });

  it("a temporary claim's duration is taken from the evidence, within category bounds", () => {
    const ttlHours = (hours: number | null) => {
      const [d] = run([realityClaim({ expectedDurationHours: hours })]);
      if (d?.write?.target !== "reality") throw new Error("expected reality");
      return (d.write.expiresAt.getTime() - NOW.getTime()) / 3_600_000;
    };
    expect(ttlHours(24)).toBe(24);
    expect(ttlHours(24 * 30)).toBe(72);   // health is capped at 72h
    expect(ttlHours(1)).toBe(4);
  });

  it("a low-confidence claim is not written", () => {
    const [d] = run([realityClaim({ confidence: 0.4 })]);
    expect(d).toMatchObject({ action: "IGNORE", reason: "insufficient_confidence" });
  });
});

// ═══ PATTERNS ═════════════════════════════════════════════════════════════════

describe("behavioral patterns", () => {
  it("one 'I didn't study today' produces no fact and no pattern", () => {
    const text    = "I didn't study today, I was too busy";
    const signals = extractSignals(text, NEUTRAL_STATE).detectedSignals;
    const patterns = runPatternDetector({
      studySessions: [{ sessionDate: hoursAgo(20), status: "completed", durationMinutes: 60 }],
      signalHistory: [{ timestamp: NOW, signals: signals.map(s => s.type) }],
      topicMasteries: [], priorPatterns: [], messagesSinceLastRun: 1,
    }, NOW);

    const evidence = buildTurnEvidence({
      userId: "user_1", profileId: "profile_1", sourceMessageId: "msg_1",
      userText: text, observedAt: NOW, signals,
      understanding: understanding({ intent: "study_skip_report" }), patterns,
      brainOutput: { reply: "ok", reasoningMode: "direct", confidence: 0.8 },
    });
    const decisions = run(evidence, emptyState(), { patternScanRan: true });

    expect(decisions.filter(d => d.target === "behavioral_pattern" && d.action !== "IGNORE")).toHaveLength(0);
    expect(decisions.filter(d => d.target === "user_fact" && d.action !== "IGNORE")).toHaveLength(0);
    expect(decisions.filter(d => d.write?.target === "academic_observation" && d.write.op === "skipped_session")).toHaveLength(1);
  });

  it("real history reaches the detector and produces pattern evidence", () => {
    // Three excuse messages over three days, as loadSignalHistory returns them.
    const history = [3, 2, 1].map(d => ({ timestamp: daysAgo(d), signals: ["excuse", "study_skip"] }));
    const patterns = runPatternDetector({
      studySessions: [], signalHistory: history, topicMasteries: [], priorPatterns: [], messagesSinceLastRun: 1,
    }, NOW);
    expect(patterns.detectedPatterns.map(p => p.type)).toContain("excuse_loop");

    // The same detector with no history finds nothing: the pattern comes from
    // the evidence, not from the current message.
    const none = runPatternDetector({
      studySessions: [{ sessionDate: hoursAgo(5), status: "completed", durationMinutes: 60 }],
      signalHistory: [], topicMasteries: [], priorPatterns: [], messagesSinceLastRun: 1,
    }, NOW);
    expect(none.detectedPatterns.map(p => p.type)).not.toContain("excuse_loop");
  });

  it("a weak first detection is only emerging", () => {
    const [d] = run([patternDetection({ confidence: 0.7 })]);
    expect(d).toMatchObject({ action: "CREATE", reason: "first_sighting" });
    expect(d?.write).toMatchObject({ status: "emerging", evidenceCount: 1 });
    if (d?.write?.target !== "behavioral_pattern") throw new Error("expected pattern");
    expect(d.write.confidence).toBeLessThan(ACTIVE_THRESHOLD);
  });

  it("a second detection in a later window strengthens it to active", () => {
    const [d] = run([patternDetection({ sourceMessageId: "msg_2" })], emptyState({ patterns: [storedPattern()] }));
    expect(d).toMatchObject({ action: "UPDATE", reason: "promoted_on_evidence", targetId: "pat_1" });
    expect(d?.write).toMatchObject({ status: "active", evidenceCount: 2 });
    if (d?.write?.target !== "behavioral_pattern") throw new Error("expected pattern");
    expect(d.write.confidence).toBeGreaterThan(0.42);
  });

  it("one very strong observation outweighs two weak ones: strength, not a fixed count, decides", () => {
    const [strong] = run([patternDetection({ confidence: 0.95 })]);
    expect(strong).toMatchObject({ action: "CREATE", reason: "strong_single_observation" });
    expect(strong?.write).toMatchObject({ status: "active", evidenceCount: 1 });

    // Two weak detections do not reach active.
    const weak = storedPattern({ confidence: 0.3 });
    const [second] = run([patternDetection({ confidence: 0.5, sourceMessageId: "msg_2" })], emptyState({ patterns: [weak] }));
    expect(second?.write).toMatchObject({ status: "emerging", evidenceCount: 2 });
  });

  it("a brand-new student with no sessions produces no ghosting evidence at all", () => {
    // Fixed at the source: the detector does not emit the pattern, so there is
    // nothing for consolidation to suppress.
    const patterns = runPatternDetector({
      studySessions: [], signalHistory: [], topicMasteries: [], priorPatterns: [], messagesSinceLastRun: 1,
    }, NOW);
    expect(patterns.detectedPatterns.map(p => p.type)).not.toContain("ghosting");

    const evidence = buildTurnEvidence({
      userId: "user_1", profileId: "profile_1", sourceMessageId: "msg_1",
      userText: "hi", observedAt: NOW, signals: [], understanding: understanding(), patterns,
      brainOutput: { reply: "ok", reasoningMode: "direct", confidence: 0.8 },
    });
    expect(run(evidence, emptyState(), { patternScanRan: true })).toEqual([]);
  });

  it("ghosting with real history behind it: strong evidence, valid pattern", () => {
    const patterns = runPatternDetector({
      studySessions: [{ sessionDate: daysAgo(20), status: "completed", durationMinutes: 60 }],
      signalHistory: [], topicMasteries: [], priorPatterns: [], messagesSinceLastRun: 1,
    }, NOW);
    const ghosting = patterns.detectedPatterns.find(p => p.type === "ghosting")!;
    expect(ghosting.confidence).toBeGreaterThan(0.9);

    const [d] = run([patternDetection({ patternType: "ghosting", confidence: ghosting.confidence })]);
    expect(d).toMatchObject({ action: "CREATE", reason: "strong_single_observation" });
    expect(d?.write).toMatchObject({ status: "active" });
  });

  it("ghosting just past the threshold is weak evidence: emerging, not active", () => {
    const patterns = runPatternDetector({
      studySessions: [{ sessionDate: daysAgo(6), status: "completed", durationMinutes: 60 }],
      signalHistory: [], topicMasteries: [], priorPatterns: [], messagesSinceLastRun: 1,
    }, NOW);
    const ghosting = patterns.detectedPatterns.find(p => p.type === "ghosting")!;
    const [d] = run([patternDetection({ patternType: "ghosting", confidence: ghosting.confidence })]);
    expect(d?.write).toMatchObject({ status: "emerging" });
  });

  it("detections inside one observation window are counted once", () => {
    const state = emptyState({ patterns: [storedPattern({ lastObservedAt: hoursAgo(OBSERVATION_WINDOW_HOURS - 1) })] });
    const [d] = run([patternDetection({ sourceMessageId: "msg_2" })], state);
    expect(d).toMatchObject({ action: "IGNORE", reason: "same_observation_window" });
  });

  it("contradicting behavior weakens an active pattern", () => {
    const active = storedPattern({ status: "active", confidence: 0.7, evidenceCount: 3 });
    const decisions = run(
      [signal({ signalType: "study_report", sourceText: "I finished chapter 3", sourceMessageId: "msg_9" })],
      emptyState({ patterns: [active] }), { patternScanRan: true },
    );
    const d = decisions.find(x => x.target === "behavioral_pattern");
    expect(d).toMatchObject({ action: "UPDATE", reason: "weakened_by_contradicting_evidence", targetId: "pat_1" });
    expect(d?.write).toMatchObject({ status: "weakening", evidenceCount: 3 });
    if (d?.write?.target !== "behavioral_pattern") throw new Error("expected pattern");
    expect(d.write.confidence).toBeLessThan(0.7);
  });

  it("enough contradicting evidence resolves it", () => {
    const fading = storedPattern({ status: "weakening", confidence: 0.25, evidenceCount: 3 });
    const decisions = run(
      [signal({ signalType: "study_report", sourceText: "I finished chapter 3", sourceMessageId: "msg_9" })],
      emptyState({ patterns: [fading] }), { patternScanRan: true },
    );
    expect(decisions.find(x => x.target === "behavioral_pattern"))
      .toMatchObject({ action: "RESOLVE", reason: "contradicted_until_resolved" });
  });

  it("an uncorroborated contradicting signal does not weaken a pattern", () => {
    const active = storedPattern({ status: "active", confidence: 0.7 });
    const decisions = run(
      [signal({ signalType: "study_report", corroborated: false, sourceText: "read a page" })],
      emptyState({ patterns: [active] }), { patternScanRan: true },
    );
    expect(decisions.filter(x => x.target === "behavioral_pattern")).toEqual([]);
  });

  it("time without observation weakens, then resolves", () => {
    const quiet = storedPattern({ status: "active", confidence: 0.7, lastObservedAt: daysAgo(QUIET_AFTER_DAYS + 1) });
    expect(run([], emptyState({ patterns: [quiet] }), { patternScanRan: true }))
      .toEqual([expect.objectContaining({ action: "UPDATE", reason: "quiet_weakening" })]);

    const stale = storedPattern({ status: "active", confidence: 0.7, lastObservedAt: daysAgo(STALE_AFTER_DAYS + 1) });
    expect(run([], emptyState({ patterns: [stale] }), { patternScanRan: true }))
      .toEqual([expect.objectContaining({ action: "RESOLVE", reason: "not_observed_recently" })]);

    // Without a scan, absence of a detection means nothing.
    expect(run([], emptyState({ patterns: [stale] }), { patternScanRan: false })).toEqual([]);
  });

  it("a pattern decision carries provenance back to the message", () => {
    const [d] = run([patternDetection({ sourceMessageId: "msg_42" })]);
    expect(d?.provenance).toMatchObject({ source: "pattern_detector", sourceMessageId: "msg_42", observedAt: NOW.toISOString() });
    expect(d?.write).toMatchObject({ supporting: ["3 excuse signals in last 15 messages"] });
  });
});

// ═══ IDEMPOTENCY ══════════════════════════════════════════════════════════════

describe("idempotency", () => {
  it("replaying a message's evidence does not inflate a fact", () => {
    const first = run([signal({ signalType: "achievement", sourceText: "I aced the midterm" })])[0]!.write!;
    if (first.target !== "user_fact") throw new Error("expected fact");
    const state = emptyState({ facts: [{
      id: "fact_1", type: first.type, key: first.key, value: first.value, confidence: first.confidence,
      evidenceCount: 1, lastObservedAt: NOW, sourceMessageIds: ["msg_1"],
    }] });
    const [d] = run([signal({ signalType: "achievement", sourceText: "I aced the midterm" })], state);
    expect(d).toMatchObject({ action: "IGNORE", reason: "duplicate_evidence" });
  });

  it("replaying a message's evidence does not inflate a pattern", () => {
    const state = emptyState({ patterns: [storedPattern({ sourceMessageIds: ["msg_1"] })] });
    const [d] = run([patternDetection()], state);
    expect(d).toMatchObject({ action: "IGNORE", reason: "duplicate_evidence" });
  });

  it("replaying a message's evidence does not re-extend a reality record", () => {
    const state = emptyState({ realities: [storedReality({ sourceMessageIds: ["msg_1"] })] });
    const [d] = run([realityClaim()], state);
    expect(d).toMatchObject({ action: "IGNORE", reason: "duplicate_evidence" });
  });

  it("the same evidence twice in one batch is applied once", () => {
    const decisions = run([realityClaim(), realityClaim(), signal(), signal(), patternDetection(), patternDetection()]);
    expect(decisions.map(d => d.action)).toEqual(["CREATE", "IGNORE", "CREATE", "IGNORE", "CREATE", "IGNORE"]);
    expect(decisions.filter(d => d.action === "IGNORE").every(d => d.reason === "duplicate_evidence")).toBe(true);
  });

  it("a duplicate study report does not add a second session", () => {
    const state = emptyState({ recentSessions: [{ sessionDate: hoursAgo(1), status: "completed" }] });
    const [d] = run([signal({ signalType: "study_report", sourceText: "yeah I studied chapter 3" })], state);
    expect(d).toMatchObject({ action: "IGNORE", reason: "duplicate_report_in_window" });
  });
});

// ═══ PROVENANCE / DETERMINISM ═════════════════════════════════════════════════

describe("provenance", () => {
  it("every evidence-driven decision names its source, message and time", () => {
    const decisions = run([
      signal({ sourceMessageId: "msg_42" }),
      realityClaim({ sourceMessageId: "msg_42" }),
      patternDetection({ sourceMessageId: "msg_42" }),
      signal({ signalType: "excuse", sourceMessageId: "msg_42" }),
    ]);
    expect(decisions).toHaveLength(4);
    for (const d of decisions) {
      expect(d.provenance).toMatchObject({ sourceMessageId: "msg_42", observedAt: NOW.toISOString() });
    }
    expect(decisions.map(d => d.provenance?.source)).toEqual(
      ["signal_engine", "understanding_brain", "pattern_detector", "signal_engine"],
    );
  });
});

describe("determinism", () => {
  it("same evidence and state produce the same decisions", () => {
    const evidence = [signal(), realityClaim(), patternDetection()];
    expect(run(evidence)).toEqual(run(evidence));
  });
});
