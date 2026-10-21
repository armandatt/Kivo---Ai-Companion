// Web onboarding v2 (still accepted from a page loaded before v3): every
// question kept has a use, and each use is checked here. The audience comes first; the cosmetic questions are gone; the
// preference questions are deterministic and never outrank what the learner
// asks; the companion's name is a display name; finishing twice writes once.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  AUDIENCES, checkFirstFocus, firstFocusLine, firstFocusOptions, firstStepFor, focusTemplateIds, goalFromFirstFocus,
  normalizeFirstFocus, audienceOf, FIRST_FOCUS, FIRST_FOCUS_DETAIL_MAX,
} from "../product/first-focus";
import { checkCompanionName, checkOnboardingV2, DEFAULT_COMPANION_NAME, COMPANION_NAME_MAX } from "../product/onboarding-answers";
import { STUDY_TEMPLATES, templatesFor } from "../product/templates";
import { LEARNING_CONTEXTS } from "../product/learning-context";
import { firstFocusIn } from "../adapters/account-preferences-adapter";
import {
  describeStatedStyle, parseStatedStyle, STATED_STYLE_HEADER, statedStyle, STYLE_QUESTIONS, validateStyleAnswers,
} from "../../personality/style-items";
import { getCoachingStyleForChat, getOperatingStyleForChat, type PersonalityDb } from "../../personality/personality.service";
import { OPERATING_STYLE_HEADER } from "../../personality/signal-scoring";
import { buildDynamicLayer } from "../context/context-builder";
import type { NovaContext } from "../types/context.types";

const repo = (path: string) => readFileSync(join(__dirname, "../../../../..", path), "utf8");

const STYLE = { explanation: "step_by_step", feedback: "hint", pacing: "one_thing" };
const VALID = {
  version: 2, audience: "college", firstFocus: { id: "exam", detail: "OS midterm on the 14th" },
  accountabilityStyle: "soft", style: STYLE, companionName: "Kivi",
};

describe("the questions and what each answer is", () => {
  it("the audience is one of three, and each is a learning context every reader already understands", () => {
    expect([...AUDIENCES]).toEqual(["school", "college", "working"]);
    for (const a of AUDIENCES) expect((LEARNING_CONTEXTS as readonly string[]).includes(a)).toBe(true);
    expect(audienceOf(["college"])).toBe("college");
    expect(audienceOf(["college", "working"])).toBeNull();   // an older multi-answer names no single audience
    expect(audienceOf([])).toBeNull();
  });

  it("what to help with first: a fixed list, worded for the audience, the same ids for everyone", () => {
    for (const audience of [null, ...AUDIENCES]) {
      expect(firstFocusOptions(audience).map(o => o.id)).toEqual([...FIRST_FOCUS]);
    }
    expect(firstFocusOptions("working").find(o => o.id === "exam")!.label).toBe("Prepare for a certification or interview");
    expect(firstFocusOptions("school").find(o => o.id === "exam")!.label).toBe("Prepare for a test or exam");
  });

  it("checks a first focus: a known id; a sentence for 'other'; a detail too long is refused, not cut", () => {
    expect(checkFirstFocus({ id: "exam", detail: "  Boards   in March " })).toEqual({ ok: true, value: { id: "exam", detail: "Boards in March" } });
    expect(checkFirstFocus({ id: "exam" })).toEqual({ ok: true, value: { id: "exam", detail: null } });
    expect(checkFirstFocus({ id: "other", detail: "" })).toEqual({ ok: false, reason: "detail_required" });
    expect(checkFirstFocus({ id: "life_goal" })).toEqual({ ok: false, reason: "unknown" });
    expect(checkFirstFocus({ id: "skill", detail: "x".repeat(FIRST_FOCUS_DETAIL_MAX + 1) })).toEqual({ ok: false, reason: "detail_too_long" });
    expect(normalizeFirstFocus("exam")).toBeNull();
    expect(firstFocusIn({ firstFocus: { id: "habit", detail: null }, learningContexts: ["school"] })).toEqual({ id: "habit", detail: null });
    expect(firstFocusIn(null)).toBeNull();
  });

  it("the whole v2 answer is checked at once, and names the step to go back to", () => {
    const ok = checkOnboardingV2(VALID);
    expect(ok.ok && ok.answers).toEqual({ audience: "college", firstFocus: { id: "exam", detail: "OS midterm on the 14th" }, accountabilityStyle: "soft", style: STYLE, companionName: "Kivi" });
    expect(checkOnboardingV2({ ...VALID, audience: "retired" })).toMatchObject({ ok: false, field: "audience" });
    expect(checkOnboardingV2({ ...VALID, firstFocus: { id: "other" } })).toMatchObject({ ok: false, field: "firstFocus" });
    expect(checkOnboardingV2({ ...VALID, accountabilityStyle: "dynamic" })).toMatchObject({ ok: false, field: "accountabilityStyle" });
    expect(checkOnboardingV2({ ...VALID, style: { explanation: "step_by_step" } })).toMatchObject({ ok: false, field: "style" });
    expect(checkOnboardingV2({ ...VALID, companionName: "x".repeat(COMPANION_NAME_MAX + 1) })).toMatchObject({ ok: false, field: "companionName" });
  });

  it("the companion is Nova unless renamed; a name is one line and nothing else", () => {
    expect(checkCompanionName(undefined)).toEqual({ ok: true, name: DEFAULT_COMPANION_NAME });
    expect(checkCompanionName("   ")).toEqual({ ok: true, name: DEFAULT_COMPANION_NAME });
    expect(checkCompanionName("  Kivi\n the\towl ")).toEqual({ ok: true, name: "Kivi the owl" });
    expect(checkCompanionName(42)).toMatchObject({ ok: false });
  });
});

describe("what each answer changes", () => {
  it("the first focus seeds the sign-up goal in the learner's words, or the option they picked", () => {
    expect(goalFromFirstFocus({ id: "exam", detail: "OS midterm" }, "college")).toBe("Prepare for an exam or assessment: OS midterm");
    expect(goalFromFirstFocus({ id: "exam", detail: null }, "working")).toBe("Prepare for a certification or interview");
    expect(goalFromFirstFocus({ id: "other", detail: "Read 12 books" }, null)).toBe("Read 12 books");
  });

  it("orders setup's templates: the focus's own first, then the audience's, and nobody loses one", () => {
    const ids = (focus: Parameters<typeof focusTemplateIds>[0], audience: Parameters<typeof focusTemplateIds>[1]) =>
      templatesFor(audience ? [audience] : [], focusTemplateIds(focus, audience)).map(t => t.id);
    expect(ids({ id: "exam", detail: null }, "working").slice(0, 2)).toEqual(["certification", "interview-preparation"]);
    expect(ids({ id: "exam", detail: null }, "school")[0]).toBe("exam-preparation");
    expect(ids({ id: "skill", detail: null }, "college")[0]).toBe("skill-building");
    expect(ids({ id: "assignments", detail: null }, null)[0]).toBe("project-sprint");
    // Without a focus, the order is the one it always was.
    expect(templatesFor(["college"], []).map(t => t.id)).toEqual(templatesFor(["college"]).map(t => t.id));
    for (const focus of FIRST_FOCUS) {
      expect(ids({ id: focus, detail: focus === "other" ? "x" : null }, "college").sort()).toEqual(STUDY_TEMPLATES.map(t => t.id).sort());
    }
  });

  it("names one place to start, and each place exists on the setup page or as a page", () => {
    const form = repo("apps/web/components/nova/setup-form.tsx");
    for (const focus of FIRST_FOCUS) {
      const step = firstStepFor({ id: focus, detail: focus === "other" ? "x" : null });
      if (!step) continue;
      if (step.href.startsWith("#")) expect([step.href, form.includes(`id="${step.href.slice(1)}"`)]).toEqual([step.href, true]);
      else expect(["/calendar", "/planner?view=board"]).toContain(step.href);
    }
    expect(firstStepFor(null)).toBeNull();
  });

  it("gives Nova one line, as the learner's answer, which what they ask now outranks", () => {
    expect(firstFocusLine(null)).toBeNull();
    expect(firstFocusLine({ id: "habit", detail: null })).toBe(
      "First asked Nova to help with: build a consistent study habit (their own answer at sign-up; what they ask now comes first).");
    // The learner's own sentence is not repeated here: it reaches Nova as a goal.
    expect(firstFocusLine({ id: "other", detail: "secret plan" })).not.toContain("secret plan");
  });
});

describe("how the learner likes to be helped (kivo-style-v2)", () => {
  it("at most four behavioural questions: accountability plus three, each answer distinct in what Nova does", () => {
    expect(STYLE_QUESTIONS.length + 1).toBeLessThanOrEqual(4);
    for (const q of STYLE_QUESTIONS) {
      const lines = q.options.map(o => o.line);
      expect(new Set(lines).size).toBe(lines.length);
      expect(new Set(q.options.map(o => o.value)).size).toBe(q.options.length);
    }
    // No two questions ask the same thing.
    expect(new Set(STYLE_QUESTIONS.map(q => q.question)).size).toBe(STYLE_QUESTIONS.length);
  });

  it("is deterministic: the same answers give the same lines, in the order asked", () => {
    const a = describeStatedStyle(statedStyle(STYLE));
    expect(a).toEqual(describeStatedStyle(statedStyle({ ...STYLE })));
    expect(a).toEqual([
      "Asked for explanations step by step: one small piece at a time, in order.",
      "When they get something wrong, give a hint first and let them try again before giving the answer.",
      "Give one next step at a time rather than a list.",
    ]);
  });

  it("names no trait, score, diagnosis or ability, and never how hard to push", () => {
    const all = STYLE_QUESTIONS.flatMap(q => q.options.flatMap(o => [o.line, o.label, o.hint])).join(" ").toLowerCase();
    for (const word of ["introvert", "extravert", "anxious", "neurotic", "personality", "type", "iq", "smart", "intelligen", "adhd", "score", "push", "strict", "gentle"]) {
      expect([word, all.includes(word)]).toEqual([word, false]);
    }
    expect(STATED_STYLE_HEADER).toContain("if a message asks for something different, do what the message asks");
    expect(STATED_STYLE_HEADER).toContain("never what to recommend or how hard to push");
  });

  it("accepts only a complete set of known answers", () => {
    expect(validateStyleAnswers(STYLE)).toEqual({ ok: true, answers: STYLE });
    expect(validateStyleAnswers({ ...STYLE, pacing: "chaos" }).ok).toBe(false);
    expect(validateStyleAnswers({ explanation: "step_by_step" }).ok).toBe(false);
    expect(validateStyleAnswers({ ...STYLE, mood: "x" }).ok).toBe(false);
    expect(parseStatedStyle({ version: "kivo-signal-v1", scores: {} })).toBeNull();
  });

  // A fake store: one profile, assessments newest first.
  const db = (rows: Array<{ scores: unknown }>): PersonalityDb => ({
    personalityAssessment: { create: async () => ({}), findFirst: async () => rows[0] ?? null },
    userProfile: { findUnique: async () => null, findFirst: async () => ({ userId: "u1" }), update: async () => ({}) },
  });
  const V1 = { version: "kivo-signal-v1", scores: { routine: 0, sociability: 50, composure: 50, reflection: 50 }, bands: { routine: "low", sociability: "mid", composure: "mid", reflection: "mid" } };

  it("stated preferences reach Nova whatever the signal flag says; the v1 signal still needs it", async () => {
    const before = process.env.PERSONALITY_SIGNAL_ENABLED;
    try {
      delete process.env.PERSONALITY_SIGNAL_ENABLED;
      expect(await getCoachingStyleForChat("web:u1", db([{ scores: statedStyle(STYLE) }]))).toEqual({ lines: describeStatedStyle(statedStyle(STYLE)), stated: true });
      expect(await getCoachingStyleForChat("web:u1", db([{ scores: V1 }]))).toEqual({ lines: [], stated: false });
      process.env.PERSONALITY_SIGNAL_ENABLED = "true";
      const v1 = await getCoachingStyleForChat("web:u1", db([{ scores: V1 }]));
      expect(v1.stated).toBe(false);
      expect(v1.lines.length).toBeGreaterThan(0);
      // Rex reads only the v1 signal; v2 answers are not misread as one.
      expect(await getOperatingStyleForChat("web:u1", db([{ scores: statedStyle(STYLE) }]))).toEqual([]);
    } finally {
      if (before === undefined) delete process.env.PERSONALITY_SIGNAL_ENABLED; else process.env.PERSONALITY_SIGNAL_ENABLED = before;
    }
  });
});

describe("what Nova's prompt carries", () => {
  const ctx = (extra: Record<string, unknown> & { firstFocus?: { id: string; detail: string | null } | null }): NovaContext => ({
    platformChatId: "c1", rawMessage: "hi", timestamp: new Date(),
    understanding: { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "hi" },
    academicState: {
      semesterPhase: "midterm", activeMode: "standard", momentaryState: "neutral",
      scores: { engagement: 50, confidence: 50, momentum: 50, burnoutRisk: 20, planAdherence: 60 },
      hardDirectives: { noStudyPressure: false, examCrisisMode: false, planFreezeMode: false, calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false },
      daysSinceJoined: 10, daysSinceLastSession: 1, consecutiveMisses: 0, studyStreakDays: 2, daysUntilNextExam: null, momentum7dTrend: [0, 0, 0, 0, 0, 0, 0], stateHistory: [],
    },
    signals: { detectedSignals: [], stateUpdates: [] },
    userProfile: { displayName: "Asha", goals: [], yearOfStudy: null, major: null, institution: null, learningContexts: ["college"], firstFocus: extra.firstFocus ?? null, preferredStudyHoursPerDay: 1, subjects: ["OS"], daysSinceJoined: 10 },
    topicMastery: null, examContext: null, studyPlan: null, activeSession: null, sessionContext: null, sessionAction: null,
    patterns: { detectedPatterns: [], dominantPattern: null, analysisRunAt: new Date(), messagesSinceLastRun: 1 },
    topRelevantMemories: [], contrastiveMemories: [], conversationHistory: [], realityFacts: [],
    cognitiveState: { investigationTopic: null, investigationHypotheses: [], investigationMissingData: [], followUpChecks: null, reasoningHistory: null },
    ...extra,
  } as unknown as NovaContext);

  it("the first focus is one line; the stated preferences sit under their own header, not the hypothesis's", () => {
    const layer = (c: NovaContext) => buildDynamicLayer(c);
    const withFocus = layer(ctx({ firstFocus: { id: "organize", detail: null } }));
    expect(withFocus).toContain("First asked Nova to help with: organize my workload and deadlines");
    const stated = layer(ctx({ operatingStyle: ["Give one next step at a time rather than a list."], operatingStyleStated: true }));
    expect(stated).toContain(STATED_STYLE_HEADER);
    expect(stated).not.toContain(OPERATING_STYLE_HEADER);
    const hypothesis = layer(ctx({ operatingStyle: ["x"], operatingStyleStated: false }));
    expect(hypothesis).toContain(OPERATING_STYLE_HEADER);
  });
});

// The page, the route and Settings for the current flow (v3) are held by
// onboarding-v3.test.ts. v2 answers are still accepted from a page loaded
// before v3 shipped, so the checks above stay.
