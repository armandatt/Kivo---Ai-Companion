// ─── Multi-signal understanding ───────────────────────────────────────────────
// One message often says several things. The Understanding Brain reports all
// of them in ONE call (intent + secondaryIntents + emotion + reality +
// sessionIntent), and every one of them must survive to evidence.
//
// These tests supply the Understanding Brain's JSON as fixtures and run the
// real parser, signal resolution, evidence builder and consolidator. They
// prove the pipeline preserves multiple signals when the model reports them.
// Whether the real model reports them is checked by scripts/novaRealityProbe.mts.
import { parseUnderstandingResponse } from "../brains/understanding-parser.js";
import { resolveTurnSignals } from "../engines/turn-signals.js";
import { extractSignals } from "../engines/signal-engine.js";
import { buildTurnEvidence } from "../consolidation/evidence-builder.js";
import { consolidate } from "../consolidation/consolidator.js";
import { annotationTags } from "../adapters/conversation-adapter.js";
import { STATE_BASELINES } from "../types/academic-state.types.js";
import type { AcademicState } from "../types/academic-state.types.js";
import type { ConsolidationState } from "../types/consolidation.types.js";

const NOW = new Date("2026-03-10T10:00:00Z");
const STATE: AcademicState = {
  semesterPhase: "midterm", activeMode: "standard", momentaryState: "neutral",
  scores: { ...STATE_BASELINES },
  hardDirectives: {
    noStudyPressure: false, examCrisisMode: false, planFreezeMode: false,
    calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false,
  },
  daysSinceJoined: 30, daysSinceLastSession: 1, consecutiveMisses: 0, studyStreakDays: 2,
  daysUntilNextExam: null, momentum7dTrend: [0, 0, 0, 0, 0, 0, 0], stateHistory: [],
};

function turn(message: string, ub: Record<string, unknown>, state: Partial<ConsolidationState> = {}) {
  const understanding = parseUnderstandingResponse(JSON.stringify({
    topic: null, topicConfidence: 0, ambiguityScore: 0.1, routingSignal: "coaching_only",
    disclosureClass: "none", secondaryIntents: [], reality: [], sessionIntent: "none", ...ub,
  }), message);
  const signals = resolveTurnSignals({ text: message, command: null, understanding, state: STATE });
  const evidence = buildTurnEvidence({
    userId: "user_1", profileId: "profile_1", sourceMessageId: "msg_1", userText: message,
    observedAt: NOW, signals: signals.detectedSignals, understanding,
    patterns: { detectedPatterns: [], dominantPattern: null, analysisRunAt: NOW, messagesSinceLastRun: 1 },
    brainOutput: { reply: "ok", reasoningMode: "empathetic", confidence: 0.8 },
  });
  const decisions = consolidate({
    evidence, now: NOW, patternScanRan: false, hasActiveSession: false,
    state: { facts: [], realities: [], patterns: [], investigation: null, recentSessions: [], ...state },
  });
  return {
    understanding, signals, evidence, decisions,
    signalTypes: signals.detectedSignals.map(s => s.type),
    applied: decisions.filter(d => d.action !== "IGNORE").map(d =>
      d.write?.target === "academic_observation" ? `academic:${d.write.op}`
      : d.write?.target === "reality" ? `reality:${d.write.category}/${d.write.subtype}`
      : d.write?.target === "user_fact" ? `fact:${d.write.type}`
      : `${d.target}:${d.action}`),
  };
}

describe("one message, several signals", () => {
  it('CASE 1 — "I finished chapter 3 but I\'m exhausted": study evidence AND the emotional signal', () => {
    const t = turn("I finished chapter 3 but I'm exhausted", {
      intent: "emotional_vent", secondaryIntents: ["study_report"], emotion: "overwhelmed",
      disclosureClass: "emotional_disclosure",
    });

    // The reply is driven by the dominant intent…
    expect(t.understanding.intent).toBe("emotional_vent");
    expect(t.understanding.emotion).toBe("overwhelmed");
    // …and the study report is not lost.
    expect(t.signalTypes).toContain("study_report");
    expect(t.applied).toContain("academic:self_reported_session");
    expect(t.signals.stateUpdates.some(u => u.triggerSignal === "study_report" && u.field === "engagement")).toBe(true);
    // The exhaustion wording is corroborated by the emotion, so burnout risk moves too.
    expect(t.signals.stateUpdates.some(u => u.field === "burnoutRisk" && u.delta > 0)).toBe(true);
  });

  it("CASE 1 without secondaryIntents would lose the study report (the gap this field closes)", () => {
    const t = turn("I finished chapter 3 but I'm exhausted", {
      intent: "emotional_vent", emotion: "overwhelmed", disclosureClass: "emotional_disclosure",
    });
    expect(t.signalTypes).not.toContain("study_report");
    expect(t.applied).not.toContain("academic:self_reported_session");
  });

  it("CASE 2 — studied, understood one thing better, still confused about another", () => {
    // Fixture is what the live model returned for this message.
    const t = turn(
      "I studied OS for an hour, understood deadlocks better, but I'm still really confused about Banker's algorithm.",
      {
        intent: "study_report", secondaryIntents: ["topic_question"],
        emotion: "confused", topic: "Banker's algorithm", topicConfidence: 0.9,
        disclosureClass: "study_context", routingSignal: "knowledge_engine",
      },
    );
    expect(t.understanding.emotion).toBe("confused");                          // confusion
    expect(t.understanding.secondaryIntents).toEqual(["topic_question"]);     // …and a question about it
    expect(t.understanding.topic).toBe("Banker's algorithm");                 // the weak topic is the one carried
    expect(t.signalTypes).toEqual(expect.arrayContaining(["study_report", "achievement"]));   // studied + understood
    expect(t.applied).toEqual(expect.arrayContaining(["academic:self_reported_session", "fact:achievement"]));
  });

  it("CASE 3 — skipping tonight because the exam moved: reality change AND the skip", () => {
    const t = turn(
      "I was supposed to study DBMS tonight but my exam got moved to next week, so I'm taking tonight off.",
      {
        intent: "study_skip_report", secondaryIntents: ["life_disclosure"], emotion: "relieved",
        topic: "DBMS", topicConfidence: 0.8, disclosureClass: "study_context", routingSignal: "planning_engine",
        reality: [{ category: "academic_constraint", subtype: "exam", claim: "Student's DBMS exam has been moved to next week", status: "active", persistence: "temporary", expectedDurationHours: 168, confidence: 0.9 }],
      },
    );
    // No regex matches "taking tonight off": the skip exists only because the
    // Understanding Brain read it.
    expect(extractSignals("I was supposed to study DBMS tonight but my exam got moved to next week, so I'm taking tonight off.", STATE)
      .detectedSignals.map(s => s.type)).not.toContain("study_skip");
    expect(t.signalTypes).toContain("study_skip");
    expect(t.applied).toEqual(expect.arrayContaining([
      "academic:skipped_session",          // study-plan impact
      "reality:academic_constraint/exam",  // the deadline change
    ]));
    expect(t.understanding.routingSignal).toBe("planning_engine");   // planning relevance
  });

  it("CASE 4 — completed the session, could not focus, barely slept", () => {
    const t = turn("I completed today's session, but I couldn't focus because I barely slept.", {
      intent: "study_report", secondaryIntents: ["reflection"], emotion: "frustrated",
      disclosureClass: "life_event",
      reality: [{ category: "health", subtype: "sleep", claim: "Student barely slept last night", status: "active", persistence: "temporary", expectedDurationHours: 24, confidence: 0.85 }],
    });
    expect(t.signalTypes).toContain("study_report");               // session completion
    expect(t.understanding.emotion).toBe("frustrated");            // how it went
    // Known gap: "couldn't focus", reported after the fact, is not a signal of
    // its own. Focus quality is measured by an interactive session, not
    // inferred from a sentence. It survives here as emotion + the sleep reality.
    expect(t.signalTypes).not.toContain("distraction");
    expect(t.applied).toEqual(expect.arrayContaining([
      "academic:self_reported_session",
      "reality:health/sleep",
    ]));
    const reality = t.decisions.find(d => d.write?.target === "reality")!.write as { expiresAt: Date };
    expect((reality.expiresAt.getTime() - NOW.getTime()) / 3_600_000).toBe(24);
  });

  it("every stated signal reaches the conversation log, so pattern history sees it", () => {
    const t = turn("I finished chapter 3 but I'm exhausted", {
      intent: "emotional_vent", secondaryIntents: ["study_report"], emotion: "overwhelmed",
    });
    const tags = annotationTags({
      intent: t.understanding.intent, emotion: t.understanding.emotion,
      signals: t.signalTypes, secondaryIntents: t.understanding.secondaryIntents,
    });
    expect(tags).toEqual(expect.arrayContaining(["emotional_vent", "study_report", "overwhelmed"]));
  });

  // ── Found by the live probe: the model sometimes invents a secondary intent ──

  it("a secondary intent the wording does not support establishes nothing", () => {
    // Real model output for this message included secondaryIntents ["study_report"].
    const t = turn("finals week starts tomorrow, three exams in five days", {
      intent: "exam_anxiety", secondaryIntents: ["study_report"], emotion: "anxious_exam",
      disclosureClass: "study_context",
    });
    expect(t.signalTypes).not.toContain("study_report");
    expect(t.applied).not.toContain("academic:self_reported_session");
  });

  it("'can't focus' is not a skipped session, even if the model says so", () => {
    const t = turn("I've had the flu since Monday, can't focus at all", {
      intent: "emotional_vent", secondaryIntents: ["study_skip_report"], emotion: "overwhelmed",
      disclosureClass: "life_event",
      reality: [{ about: "self", category: "health", subtype: "illness", claim: "Student has had the flu since Monday", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 1 }],
    });
    expect(t.signalTypes).not.toContain("study_skip");
    expect(t.applied).toEqual(["reality:health/illness"]);
  });

  it("someone else's circumstance is not the student's reality", () => {
    const t = turn("my roommate has the flu lol", {
      intent: "life_disclosure", emotion: "neutral", disclosureClass: "life_event",
      reality: [{ about: "other", category: "health", subtype: "illness", claim: "Student's roommate has the flu.", status: "active", persistence: "temporary", expectedDurationHours: null, confidence: 1 }],
    });
    expect(t.understanding.realityObservations).toEqual([]);
    expect(t.applied).toEqual([]);
  });
});

describe("secondaryIntents validation", () => {
  const parse = (fields: Record<string, unknown>) =>
    parseUnderstandingResponse(JSON.stringify({ intent: "emotional_vent", emotion: "neutral", ...fields }), "x");

  it("is empty when absent or malformed", () => {
    expect(parse({}).secondaryIntents).toEqual([]);
    expect(parse({ secondaryIntents: "study_report" }).secondaryIntents).toEqual([]);
  });

  it("keeps only known intents, drops the primary and duplicates, caps at two", () => {
    expect(parse({
      secondaryIntents: ["study_report", "emotional_vent", "made_up", "study_report", "excuse", "mastery_claim", "general_chat"],
    }).secondaryIntents).toEqual(["study_report", "excuse"]);
  });

  it("a single-intent message is unchanged", () => {
    const t = turn("I finished chapter 3", { intent: "study_report", emotion: "motivated" });
    expect(t.understanding.secondaryIntents).toEqual([]);
    expect(t.signalTypes).toEqual(["study_report"]);
  });

  it("an intent established by the Understanding Brain does not also need the regex", () => {
    const t = turn("did the whole OS problem set, done", { intent: "study_report", emotion: "proud" });
    expect(extractSignals("did the whole OS problem set, done", STATE).detectedSignals.map(s => s.type)).not.toContain("study_report");
    expect(t.signals.detectedSignals).toContainEqual(expect.objectContaining({ type: "study_report", evidence: "understanding" }));
  });
});
