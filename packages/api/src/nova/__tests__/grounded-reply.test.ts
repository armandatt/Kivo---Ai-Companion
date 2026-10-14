// The model words; it does not decide how long anyone studies or what they
// study next. Held here: a length of time it was not given is taken out of
// its reply, and when nothing recommends what to study, it is told so.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { groundDurations, groundTopics, statedDurations, UNGROUNDED_REPLY_FALLBACK } from "../brains/grounded-reply";
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

describe("topics a reply recommends", () => {
  const told = "## Today's plan\nRecommended now: Deadlocks (Operating Systems), Light, 25 min\nAfter that: Paging";

  it("keeps a reply whose recommendations are in what Nova gave it, in any case", () => {
    const reply = "Start with deadlocks. Then paging.";
    expect(groundTopics(reply, ["Deadlocks", "paging"], told)).toEqual({ reply, removed: [], ungrounded: [] });
  });

  it("takes out each sentence naming a topic Nova was not given", () => {
    const out = groundTopics("Start with Deadlocks. After that, hit the TLB. You've got this.", ["Deadlocks", "TLB"], told);
    expect(out.ungrounded).toEqual(["tlb"]);
    expect(out.removed).toEqual(["After that, hit the TLB."]);
    expect(out.reply).toBe("Start with Deadlocks. You've got this.");
  });

  it("matches whole words only, and a name at the end of a sentence", () => {
    // "page" is not "paging", and "TLB." is the TLB.
    expect(groundTopics("Read the page.", ["page"], "paging").removed).toEqual(["Read the page."]);
    expect(groundTopics("Next do TLB.", ["tlb"], told).reply).toBe(UNGROUNDED_REPLY_FALLBACK);
  });

  it("a plural or singular of a given name is the same name", () => {
    expect(groundTopics("Do one deadlock problem.", ["deadlock"], told).removed).toEqual([]);
  });

  it("a name from the learner's own message is given", () => {
    expect(groundTopics("Do Node.js streams first.", ["node.js streams"], "can I do node.js streams?").removed).toEqual([]);
  });

  it("nothing declared, or a declared name the reply never states, changes nothing", () => {
    expect(groundTopics("Take a break.", undefined, told).reply).toBe("Take a break.");
    expect(groundTopics("Take a break.", ["Graph theory"], told)).toEqual({ reply: "Take a break.", removed: [], ungrounded: ["graph theory"] });
  });

  it("when nothing is recommended, a topic of theirs on record is still not a recommendation", () => {
    // The orchestrator grounds against the learner's message alone then.
    expect(groundTopics("Open your regression notes for a bit.", ["Regression"], "honestly I just feel behind").reply).toBe(UNGROUNDED_REPLY_FALLBACK);
    expect(groundTopics("Start with regression, as you said.", ["Regression"], "should I do regression?").removed).toEqual([]);
  });

  it("when nothing is recommended, a topic of theirs the model did not declare is still caught", () => {
    // Seen with the real model: "recommends": [] and the reply named a topic.
    const reply = "Carrying that weight is exhausting. Let's just look at deadlocks and leave the rest for later.";
    const out = groundTopics(reply, [...[], "Deadlocks", "Paging"], "honestly I just feel behind on everything");
    expect(out.reply).toBe("Carrying that weight is exhausting.");
  });

  it("the orchestrator runs it on every worded reply, after the length check", () => {
    const src = readFileSync(join(__dirname, "..", "nova-orchestrator.ts"), "utf8");
    expect(src).toContain("groundTopics(brainOutput.reply, [...(brainOutput.recommends ?? []), ...topicNames], text)");
    expect(src).toContain("groundTopics(brainOutput.reply, brainOutput.recommends, told)");
    expect(src.indexOf("groundDurations(")).toBeLessThan(src.indexOf("groundTopics("));
  });
});
