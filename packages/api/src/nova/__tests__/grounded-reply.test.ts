// The model words; it does not decide how long anyone studies or what they
// study next. Held here: a length of time it was not given is taken out of
// its reply, and when nothing recommends what to study, it is told so.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groundDurations, statedDurations, UNGROUNDED_REPLY_FALLBACK } from "../brains/grounded-reply";
import { buildDynamicLayer, buildFocusedLayer, NOTHING_RECOMMENDED } from "../context/context-builder";
import { contextNeeds } from "../interaction/semantics";
import type { NovaContext } from "../types/context.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

describe("lengths of time in a reply", () => {
  it("reads digits, words and hours", () => {
    expect(statedDurations("Spend twenty minutes on it, then a 25-minute review and half an hour of practice.")).toEqual([20, 25, 30]);
    expect(statedDurations("Give it 2 hours, or 1 h 30 min, or forty-five mins.")).toEqual([120, 60, 30, 45]);
    expect(statedDurations("Exams are in two days and you have 3 topics.")).toEqual([]);
  });

  it("takes out a sentence stating a length Nova did not give, and keeps the rest", () => {
    const told = "Exam in: 2 days\nText: \"what should I focus on this week?\"";
    const reply = "Exams are in two days. Pick the topic you understand least. Spend twenty minutes mapping out its core definitions.";
    const out = groundDurations(reply, told);
    expect(out.removed).toEqual(["Spend twenty minutes mapping out its core definitions."]);
    expect(out.reply).toBe("Exams are in two days. Pick the topic you understand least.");
  });

  it("keeps a length that is in the plan, the prompt or the learner's own words", () => {
    expect(groundDurations("Open Deadlocks for twenty-five minutes now.", "  - Deadlocks (25min, review, high)").removed).toEqual([]);
    expect(groundDurations("Ninety minutes is plenty for one topic.", 'Text: "I have 1 h 30 min tonight"').removed).toEqual([]);
    expect(groundDurations("Use the 45 minutes you said you have.", 'Text: "I get about 45 minutes most evenings"').removed).toEqual([]);
  });

  it("a number that is not a length of time grounds nothing", () => {
    const told = "Scores — Engagement:25 Confidence:30\nMastery: 25% | 3 topics";
    expect(groundDurations("Focus on caching for twenty-five minutes right now.", told).removed).toHaveLength(1);
  });

  it("says something true when every sentence was made up", () => {
    expect(groundDurations("Do 20 minutes now.", "Exam in: 2 days").reply).toBe(UNGROUNDED_REPLY_FALLBACK);
  });

  it("is applied to every worded reply, after the model and before it is sent", () => {
    const src = readFileSync(join(__dirname, "..", "nova-orchestrator.ts"), "utf8");
    const call = src.indexOf("groundDurations(brainOutput.reply");
    expect(call).toBeGreaterThan(src.indexOf("(input.respond ?? runResponseBrain)(dynamicLayer, prompt)"));
    expect(call).toBeLessThan(src.indexOf("input.hooks?.reply"));
  });
});

describe("what the model is told when nothing recommends what to study", () => {
  const ctx = (studyPlan: unknown = null): NovaContext => ({
    platformChatId: "c1", rawMessage: "what should I focus on?", timestamp: new Date(),
    understanding: { intent: "plan_request", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0, routingSignal: "planning_engine", rawText: "x" },
    academicState: {
      semesterPhase: "midterm", activeMode: "standard", momentaryState: "neutral",
      scores: { engagement: 50, confidence: 50, momentum: 50, burnoutRisk: 20, planAdherence: 60 },
      hardDirectives: { noStudyPressure: false, examCrisisMode: false, planFreezeMode: false, calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false },
      daysSinceJoined: 10, daysSinceLastSession: 1, consecutiveMisses: 0, studyStreakDays: 2, daysUntilNextExam: null, momentum7dTrend: [0, 0, 0, 0, 0, 0, 0], stateHistory: [],
    },
    signals: { detectedSignals: [], stateUpdates: [] },
    userProfile: { displayName: "Asha", goals: [], yearOfStudy: null, major: null, institution: null, learningContexts: [], preferredStudyHoursPerDay: 1, subjects: ["Science"], daysSinceJoined: 10 },
    topicMastery: null, examContext: null, studyPlan, activeSession: null, sessionContext: null, sessionAction: null,
    patterns: { detectedPatterns: [], dominantPattern: null, analysisRunAt: new Date(), messagesSinceLastRun: 1 },
    topRelevantMemories: [], contrastiveMemories: [], conversationHistory: [], realityFacts: [], activeRealityFacts: [],
    cognitiveState: { investigationTopic: null, investigationHypotheses: [], investigationMissingData: [], followUpChecks: null, reasoningHistory: null },
  } as unknown as NovaContext);
  const plan = { today: [{ topicName: "Light", subjectName: "Science", durationMinutes: 25, activityType: "review", urgency: "high" }], totalMinutesToday: 25, confidence: 0.8 };

  it("a conversation about what to study is given the plan", () => {
    const u = { intent: "plan_request", emotion: "neutral", topic: null, request: { action: "none", asks: "none" } } as unknown as AcademicUnderstanding;
    expect(contextNeeds(u, "conversation")).toEqual(expect.arrayContaining(["plan", "exams", "time"]));
    expect(buildFocusedLayer(ctx(plan), contextNeeds(u, "conversation"))).toContain("Light (25min");
    expect(buildFocusedLayer(ctx(plan), contextNeeds(u, "conversation"))).not.toContain(NOTHING_RECOMMENDED);
  });

  it("with no plan, the model is told nothing is recommended and to give no length", () => {
    expect(buildFocusedLayer(ctx(), ["profile", "goals", "recent"])).toContain(NOTHING_RECOMMENDED);
    expect(buildDynamicLayer(ctx())).toContain(NOTHING_RECOMMENDED);
    expect(buildDynamicLayer(ctx(plan))).not.toContain(NOTHING_RECOMMENDED);
    expect(NOTHING_RECOMMENDED).toContain("give no number of minutes or hours");
  });

  it("a question about the subject matter is still answered, with no such line", () => {
    expect(buildFocusedLayer(ctx(), ["recent"])).not.toContain(NOTHING_RECOMMENDED);
  });

  it("facts a surface gave (an advice verdict) count as what is recommended", () => {
    expect(buildFocusedLayer(ctx(), ["session", "plan"], ["Recommended now: Light, 25 min"])).not.toContain(NOTHING_RECOMMENDED);
  });
});
