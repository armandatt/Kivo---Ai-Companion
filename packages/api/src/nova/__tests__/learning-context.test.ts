// What a learner says they are learning for: school, college, work, or
// something else, alone or together. It changes words, the order setup offers
// things in and one line of Nova's context. It changes no decision.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  LEARNING_CONTEXTS, LEARNING_CONTEXT_LABEL, learningContextLine, normalizeLearningContexts,
  setupVocabulary, vocabularyKind, type LearningContext,
} from "../product/learning-context";
import { nextSetupQuestion, setupGaps, type SetupFacts } from "../interaction/initialization";
import { STUDY_TEMPLATES, templatesFor } from "../product/templates";
import { learningContextsIn, LEARNING_CONTEXTS_KEY } from "../adapters/account-preferences-adapter";
import { buildDynamicLayer } from "../context/context-builder";
import type { NovaContext } from "../types/context.types";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const repo = (path: string) => readFileSync(join(__dirname, "../../../../..", path), "utf8");

// Every word a learner reads in setup, for one answer.
function everyWord(contexts: LearningContext[]): string {
  const v = setupVocabulary(contexts);
  const { questions, ...labels } = v;
  return [
    ...Object.values(labels),
    questions.subjects, questions.topics("Public speaking"), questions.exams, questions.daily_minutes, questions.study_time,
  ].join(" \n ").toLowerCase();
}

const ACADEMIC_WORDS = ["syllabus", "semester", "term", "exam", "subject", "chapter", "school", "class", "course", "homework", "tuition", "study"];
const wholeWord = (text: string, word: string) =>
  text.split(/[^a-z]+/).some(w => w === word || w === `${word}s`);

// ── The answer itself ─────────────────────────────────────────────────────────

describe("the answer", () => {
  it("is any of four contexts, more than one at once, in a fixed order with none twice", () => {
    expect(LEARNING_CONTEXTS).toEqual(["school", "college", "working", "other"]);
    expect(normalizeLearningContexts(["working", "college", "working"])).toEqual(["college", "working"]);
    expect(normalizeLearningContexts([])).toEqual([]);
    for (const c of LEARNING_CONTEXTS) expect(LEARNING_CONTEXT_LABEL[c].label.length).toBeGreaterThan(3);
  });

  it("is refused whole when it holds anything else: nothing is guessed from it", () => {
    for (const bad of [null, undefined, "college", 3, {}, ["college", "phd"], ["College"], [1], [["school"]], new Array(20).fill("school")]) {
      expect(normalizeLearningContexts(bad)).toBeNull();
    }
  });

  it("is read from the onboarding answers, and anything unreadable there is 'not said'", () => {
    expect(LEARNING_CONTEXTS_KEY).toBe("learningContexts");
    expect(learningContextsIn({ quizAnswers: { primaryGoal: "x" }, learningContexts: ["working", "school"] })).toEqual(["school", "working"]);
    for (const stored of [null, undefined, "x", [], {}, { learningContexts: "working" }, { learningContexts: ["working", "lawyer"] }, { reengagementSent: true }]) {
      expect(learningContextsIn(stored)).toEqual([]);
    }
  });
});

// ── Three audiences, one set of things asked ──────────────────────────────────

describe("the words setup uses", () => {
  it("picks a vocabulary from the answer, and words that assume neither side for a mixed one", () => {
    expect(vocabularyKind([])).toBe("general");
    expect(vocabularyKind(["school"])).toBe("school");
    expect(vocabularyKind(["college"])).toBe("college");
    expect(vocabularyKind(["school", "college"])).toBe("college");
    expect(vocabularyKind(["working"])).toBe("outcome");
    expect(vocabularyKind(["other"])).toBe("outcome");
    expect(vocabularyKind(["working", "other"])).toBe("outcome");
    expect(vocabularyKind(["college", "working"])).toBe("general");
    expect(vocabularyKind(["school", "other"])).toBe("general");
  });

  it("a professional is never asked about school: no syllabus, term, semester, exam, subject or chapter", () => {
    for (const contexts of [["working"], ["other"], ["working", "other"]] as LearningContext[][]) {
      const text = everyWord(contexts);
      for (const word of ACADEMIC_WORDS) expect([contexts.join("+"), word, wholeWord(text, word)]).toEqual([contexts.join("+"), word, false]);
    }
  });

  it("a professional starts from an outcome, a target date and the time they have", () => {
    const v = setupVocabulary(["working"]);
    expect(v.questions.subjects).toBe("What do you want to learn or get done? Name the skill or the project.");
    expect(v.questions.topics("System design")).toBe("What does System design involve? List the parts you want to cover, in any order.");
    expect(v.questions.exams).toBe("Is there a date you are working toward? Tell me what it is for and the day.");
    expect(v.questions.daily_minutes).toBe("How long can you usually give it on a normal day?");
    expect(v.dateTitleSuffix).toBe("target date");
  });

  it("a school learner is asked for subjects and chapters, in plain words", () => {
    const v = setupVocabulary(["school"]);
    expect(v.areasHeading).toBe("Your subjects, and the chapters in each");
    expect(v.questions.topics("Science")).toBe("Which chapters does Science cover? List them in any order.");
    expect(v.questions.exams).toBe("Any test or exam dates yet? Tell me the subject and the day.");
    expect(everyWord(["school"])).not.toContain("semester");
    expect(everyWord(["school"])).not.toContain("placement");
  });

  it("a college learner can put a career goal beside their courses", () => {
    const v = setupVocabulary(["college"]);
    expect(v.questions.subjects).toContain("Which subjects are you taking this term?");
    expect(v.questions.subjects).toContain("placements or a project");
    expect(v.areaPlaceholder).toContain("Placement prep");
  });

  it("a learner who has not said keeps the questions setup always asked", () => {
    const v = setupVocabulary([]);
    expect(v.questions.subjects).toBe("Which subjects are you taking this term?");
    expect(v.questions.topics("Operating Systems")).toBe("What does Operating Systems cover this term? List the topics or chapters, in any order.");
    expect(v.questions.exams).toBe("Any exam or deadline dates yet? Tell me the subject and the day.");
  });

  it("every vocabulary has every word, and none is empty", () => {
    const answers: LearningContext[][] = [[], ["school"], ["college"], ["working"], ["college", "working"]];
    const keys = Object.keys(setupVocabulary([])).sort();
    for (const contexts of answers) {
      const v = setupVocabulary(contexts);
      expect(Object.keys(v).sort()).toEqual(keys);
      for (const [key, value] of Object.entries(v)) if (typeof value === "string") expect([key, value.length > 0]).toEqual([key, true]);
    }
  });
});

describe("what setup asks for is the same for everyone", () => {
  const facts = (over: Partial<SetupFacts> = {}): SetupFacts => ({ subjects: [], upcomingExams: 0, studyTime: null, dailyMinutes: null, ...over });

  it("the gaps, and their order, do not depend on the answer", () => {
    const some = facts({ subjects: [{ name: "System design", topicCount: 0 }] });
    for (const contexts of [[], ["school"], ["college"], ["working"], ["college", "working"]] as LearningContext[][]) {
      expect(setupGaps({ ...facts(), learningContexts: contexts })).toEqual(["subjects"]);
      expect(setupGaps({ ...some, learningContexts: contexts })).toEqual(["topics", "exams", "daily_minutes", "study_time"]);
    }
  });

  it("only the wording of the question does", () => {
    expect(nextSetupQuestion(facts())).toEqual({ gap: "subjects", question: "Which subjects are you taking this term?" });
    expect(nextSetupQuestion(facts({ learningContexts: ["working"] }))).toEqual({ gap: "subjects", question: "What do you want to learn or get done? Name the skill or the project." });
    expect(nextSetupQuestion(facts({ learningContexts: ["school"], subjects: [{ name: "Science", topicCount: 0 }] })))
      .toEqual({ gap: "topics", question: "Which chapters does Science cover? List them in any order." });
    expect(nextSetupQuestion(facts({ learningContexts: ["working"], subjects: [{ name: "SQL", topicCount: 3 }], upcomingExams: 1, dailyMinutes: 30, studyTime: "evening" }))).toBeNull();
  });

  it("no engine, decision or planning input reads it", () => {
    for (const file of [
      "engines/planning-engine.ts", "engines/exam-engine.ts", "engines/academic-state-engine.ts", "engines/retention-engine.ts",
      "engines/topic-mastery-engine.ts", "engines/study-session-engine.ts", "product/planning-inputs.ts",
      "decision/proactive-decision.ts", "decision/action-decision.ts", "product/today.ts", "product/planner.ts",
    ]) {
      const source = read(file);
      expect([file, source.includes("learning-context")]).toEqual([file, false]);
      expect([file, source.includes("learningContexts")]).toEqual([file, false]);
    }
  });
});

// ── Templates ─────────────────────────────────────────────────────────────────

describe("starting points", () => {
  it("each is written for someone, and every audience has more than one", () => {
    for (const t of STUDY_TEMPLATES) expect([t.id, t.audiences.length > 0]).toEqual([t.id, true]);
    for (const c of ["school", "college", "working"] as LearningContext[]) {
      expect([c, STUDY_TEMPLATES.filter(t => t.audiences.includes(c)).length >= 2]).toEqual([c, true]);
    }
  });

  it("are offered with the fitting ones first, and nobody loses one", () => {
    const first = (contexts: LearningContext[]) => templatesFor(contexts).slice(0, 3).map(t => t.id);
    expect(first(["school"])).toEqual(["exam-preparation", "school-subjects", "engineering-semester"]);
    expect(first(["working"])).toEqual(["skill-building", "project-sprint", "interview-preparation"]);
    expect(first(["college"]).slice(0, 2)).toEqual(["engineering-semester", "exam-preparation"]);
    expect(templatesFor([]).map(t => t.id)).toEqual(STUDY_TEMPLATES.map(t => t.id));
    for (const contexts of [[], ["school"], ["working"], ["college", "working"]] as LearningContext[][]) {
      expect(templatesFor(contexts).map(t => t.id).sort()).toEqual(STUDY_TEMPLATES.map(t => t.id).sort());
    }
  });

  it("the first three offered to a professional name no school, term, syllabus or exam", () => {
    const text = JSON.stringify(templatesFor(["working"]).slice(0, 3)).toLowerCase();
    for (const word of ["syllabus", "semester", "term", "exam", "school", "chapter", "homework"]) expect([word, wholeWord(text, word)]).toEqual([word, false]);
  });

  it("the one that is about computer science says so in its name", () => {
    expect(STUDY_TEMPLATES.find(t => t.id === "engineering-semester")!.name).toBe("Computer science semester");
    expect(STUDY_TEMPLATES.some(t => t.id === "semester-subjects" && t.subjects.every(s => s.name === ""))).toBe(true);
  });
});

// ── What Nova's model is told ─────────────────────────────────────────────────

describe("Nova's context", () => {
  const ctx = (learningContexts?: string[]): NovaContext => ({
    platformChatId: "c1", rawMessage: "hi", timestamp: new Date(),
    understanding: { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "hi" },
    academicState: {
      semesterPhase: "midterm", activeMode: "standard", momentaryState: "neutral",
      scores: { engagement: 50, confidence: 50, momentum: 50, burnoutRisk: 20, planAdherence: 60 },
      hardDirectives: { noStudyPressure: false, examCrisisMode: false, planFreezeMode: false, calibrationAlert: false, noChallenging: false, recoveryMode: false, beginnerMode: false },
      daysSinceJoined: 10, daysSinceLastSession: 1, consecutiveMisses: 0, studyStreakDays: 2, daysUntilNextExam: null, momentum7dTrend: [0, 0, 0, 0, 0, 0, 0], stateHistory: [],
    },
    signals: { detectedSignals: [], stateUpdates: [] },
    userProfile: { displayName: "Asha", goals: [], yearOfStudy: null, major: null, institution: null, learningContexts, preferredStudyHoursPerDay: 1, subjects: ["System design"], daysSinceJoined: 10 },
    topicMastery: null, examContext: null, studyPlan: null, activeSession: null, sessionContext: null, sessionAction: null,
    patterns: { detectedPatterns: [], dominantPattern: null, analysisRunAt: new Date(), messagesSinceLastRun: 1 },
    topRelevantMemories: [], contrastiveMemories: [], conversationHistory: [], realityFacts: [],
    cognitiveState: { investigationTopic: null, investigationHypotheses: [], investigationMissingData: [], followUpChecks: null, reasoningHistory: null },
  } as unknown as NovaContext);

  it("says what they answered, as their answer, and tells the model not to assume school of a professional", () => {
    expect(learningContextLine(["working"])).toBe(
      "Learning for: work or their career (their own answer). They have not said they are at school or college: do not assume classes, a syllabus, a term or exams.",
    );
    expect(learningContextLine(["school"])).toBe("Learning for: school (their own answer).");
    expect(learningContextLine(["college", "working"])).toBe("Learning for: college or university and work or their career (their own answer).");
    expect(buildDynamicLayer(ctx(["working"]))).toContain("Learning for: work or their career (their own answer).");
  });

  it("says nothing when they have not said, or when what is stored is not an answer", () => {
    expect(learningContextLine([])).toBeNull();
    for (const stored of [undefined, [], ["manager"], ["working", "x"]]) expect(buildDynamicLayer(ctx(stored as string[]))).not.toContain("Learning for");
  });
});

// ── Where it is kept, asked and changed (read from source) ────────────────────

describe("asked once, kept in one place, changed in Settings", () => {
  it("the quiz asks it after the goal, lets more than one be picked, and it can be skipped", () => {
    const quiz = repo("apps/web/components/PersonalityQuiz.tsx");
    expect(quiz.indexOf("'What are you working toward right now?'")).toBeLessThan(quiz.indexOf("'What are you learning for?'"));
    expect(quiz).toContain("type: 'contexts',");
    expect(quiz).toContain("LEARNING_CONTEXTS.map((context) =>");
    expect(quiz).toContain("aria-pressed={selected}");
    // Only the two answer-by-tapping kinds hide "skip this one".
    expect(quiz).toContain("{question.type !== 'cards' && question.type !== 'likert' && (");
  });

  it("onboarding keeps only a list of known contexts, beside the other answers", () => {
    const route = repo("apps/api/onboarding/route.ts");
    expect(route).toContain("normalizeLearningContexts((quizAnswers as Record<string, unknown>).learningContexts");
    expect(route).toContain("...(learningContexts && learningContexts.length > 0 ? { learningContexts } : {}),");
    expect(route).toContain("onboardingAnswers: payload,");
  });

  it("Settings changes it without touching the other answers, and refuses anything else", () => {
    const route = repo("apps/api/settings/route.ts");
    expect(route).toContain('if (contexts === null) return NextResponse.json({ error: "Unknown learning context" }, { status: 400 })');
    expect(route).toContain("profileUpdates.onboardingAnswers = { ...answers, [LEARNING_CONTEXTS_KEY]: contexts }");
  });

  it("Nova reads it only through the account preferences adapter", () => {
    const adapter = read("adapters/account-preferences-adapter.ts");
    expect(adapter).toContain("learningContexts: learningContextsIn(account.onboardingAnswers),");
    for (const file of ["product/setup.ts", "nova-orchestrator.ts"]) {
      const source = read(file);
      expect([file, source.includes("loadLearningContexts(platformChatId)")]).toEqual([file, true]);
      expect([file, source.includes("onboardingAnswers")]).toEqual([file, false]);
    }
  });

  it("the setup page takes its words and its template order from the same module, and saves a change at once", () => {
    const form = repo("apps/web/components/nova/setup-form.tsx");
    expect(form).toContain("const words     = setupVocabulary(contexts)");
    expect(form).toContain("const templates = templatesFor(contexts)");
    expect(form).toContain("body: JSON.stringify({ learningContexts: next })");
    for (const fixed of ["Paste your syllabus if you have it", "Add an exam date", "Your subjects, and what each covers", "Subject, e.g. Operating Systems"]) {
      expect([fixed, form.includes(fixed)]).toEqual([fixed, false]);
    }
  });
});
