// What Nova has learned about a learner changing what it plans for them.
// One loop, end to end and without a database: sessions on record → Learning
// DNA (the evidence levels it already keeps) → the Planning Engine.
//
// The rule being held: a conclusion needs repeated, agreeing evidence before
// it changes anything, and what the learner says outright always wins.

jest.mock("@repo/db/client", () => ({ prisma: {} }));

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeLearningDna, type DnaEvidence, type DnaSession } from "../engines/learning-dna-engine";
import { generateStudyPlan, sessionCap, MIN_BLOCK_MINUTES, REVIEW_BLOCK_MINUTES } from "../engines/planning-engine";
import { computeAcademicState } from "../engines/academic-state-engine";
import { usualSessionMinutes } from "../product/planning-inputs";
import type { TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

const NOVA = join(__dirname, "..");
const read = (path: string) => readFileSync(join(NOVA, path), "utf8");

const NOW  = new Date("2026-10-06T12:00:00Z");
const days = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

// `lengths[i]` minutes, one session a day, the last one yesterday.
const sessions = (lengths: number[]): DnaSession[] => lengths.map((minutes, i) => ({
  id: `s${i}`, startedAt: days(i - lengths.length), minutes, plannedMinutes: 25, subjectId: "sub1", topicName: "Deadlocks", outcome: null,
}));
const evidence = (lengths: number[]): DnaEvidence => ({
  sessions: sessions(lengths), topics: [], subjects: [{ id: "sub1", name: "Operating Systems" }], timezone: "Asia/Kolkata",
  firstCountedAt: lengths.length ? days(-lengths.length) : null, now: NOW,
});
const usual = (lengths: number[]) => usualSessionMinutes(computeLearningDna(evidence(lengths)));

const topic = (over: Partial<TopicMasteryState>): TopicMasteryState => ({
  topicId: "t1", topicName: "Deadlocks", subjectName: "Operating Systems",
  masteryProbability: 0.5, lastStudied: days(-4), retentionEstimate: 0.4, confidenceReported: 0.4, calibrationGap: 0,
  reviewDueAt: days(-1), masteryTrend: "stable", reviewCount: 2, ...over,
});
const TOPICS = [
  topic({}),
  topic({ topicId: "t2", topicName: "Paging", masteryProbability: 0.6, retentionEstimate: 0.9, reviewDueAt: days(9) }),
  topic({ topicId: "t3", topicName: "Scheduling", masteryProbability: 0, lastStudied: null, reviewCount: 0, reviewDueAt: null }),
];
const NO_MESSAGE: AcademicUnderstanding = { intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0, disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "" };
const STATE = computeAcademicState({
  semesterStartDate: null, semesterEndDate: null, daysSinceJoined: 60, studySessions: [], upcomingExams: [], stateHistory: [],
  signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding: NO_MESSAGE,
  storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
}, NOW);
const plan = (options: Parameters<typeof generateStudyPlan>[4] = {}) => generateStudyPlan(STATE, TOPICS, 3, null, { now: NOW, ...options });
const lengths = (p: ReturnType<typeof plan>) => p.today.map(b => b.durationMinutes);

describe("what counts as knowing how long a learner's sessions run", () => {
  it("one short session concludes nothing", () => {
    expect(usual([12])).toBeNull();
  });

  it("a handful is still not enough to act on", () => {
    expect(usual([12, 14, 15, 13, 15, 14, 12])).toBeNull();
  });

  it("ten or more sessions that agree are", () => {
    expect(usual([12, 14, 15, 13, 15, 14, 12, 15, 16, 14, 15, 13])).toBe(14);
  });

  it("many sessions all over the place are not a habit", () => {
    expect(usual([10, 90, 15, 80, 12, 75, 10, 95, 14, 85, 11, 70])).toBeNull();
  });

  it("a habit their latest sessions are pulling away from is not acted on", () => {
    // Sixteen sessions: eight around 15 minutes, then eight around 45.
    const drifting = [15, 14, 16, 15, 15, 14, 16, 15, 45, 44, 46, 45, 45, 44, 46, 45];
    const typical = computeLearningDna(evidence(drifting)).find(s => s.key === "typical_session")!;
    expect(typical.weakening).toBe(true);
    expect(usual(drifting)).toBeNull();
  });

  it("no sessions at all is not a short habit: nothing recorded is not evidence", () => {
    expect(usual([])).toBeNull();
  });
});

describe("the plan fits the learner it is for", () => {
  it("without evidence, blocks are the engine's ordinary sizes", () => {
    expect(lengths(plan())).toEqual(lengths(plan({ usualSessionMinutes: null })));
    expect(Math.max(...lengths(plan()))).toBeGreaterThanOrEqual(REVIEW_BLOCK_MINUTES);
  });

  it("a learner whose sessions run about 15 minutes is planned 15-minute blocks, not 25 and 30", () => {
    const fitted = plan({ usualSessionMinutes: 14 });
    expect(fitted.today.length).toBeGreaterThan(0);
    expect(Math.max(...lengths(fitted))).toBe(15);
    expect(fitted.assumptions.join(" ")).toContain("kept to about 15 minutes, the length your own sessions usually run");
    // The same topics, in the same order: only the sizes changed.
    expect(fitted.today.map(b => b.topicName)).toEqual(plan().today.slice(0, fitted.today.length).map(b => b.topicName));
  });

  it("only ever shortens: a learner with long sessions is not handed longer blocks", () => {
    expect(lengths(plan({ usualSessionMinutes: 70 }))).toEqual(lengths(plan()));
    expect(plan({ usualSessionMinutes: 70 }).assumptions.join(" ")).not.toContain("kept to about");
  });

  it("never goes under the shortest block worth planning", () => {
    expect(sessionCap({ usualSessionMinutes: 3 })).toBe(MIN_BLOCK_MINUTES);
    expect(Math.min(...lengths(plan({ usualSessionMinutes: 3 })))).toBeGreaterThanOrEqual(MIN_BLOCK_MINUTES);
  });

  it("what the learner says they have today wins over their habit", () => {
    expect(sessionCap({ usualSessionMinutes: 14, availableMinutes: 45 })).toBeNull();
    const stated = plan({ usualSessionMinutes: 14, availableMinutes: 45 });
    expect(lengths(stated)).toEqual(lengths(plan({ availableMinutes: 45 })));
    expect(Math.max(...lengths(stated))).toBeGreaterThan(15);
  });

  it("ignores a value that is not a length", () => {
    for (const bad of [0, -5, NaN, Infinity, undefined, null]) expect(sessionCap({ usualSessionMinutes: bad as number })).toBeNull();
  });
});

describe("the loop is wired, and stays inside the existing engines", () => {
  const inputs = read("product/planning-inputs.ts");

  it("the planner is given the learner's own record on every surface that plans", () => {
    expect(inputs).toContain("usualSessionMinutes: usualSessionMinutes(dna?.signals ?? [])");
    // Home, the Planner, Telegram's /today and the proactive tick all plan through this one loader.
    for (const reader of ["product/today.ts", "product/planner.ts"]) expect(read(reader)).toContain("loadPlanningInputs");
    expect(read("proactive/nova-proactive-cron.ts")).toContain("loadNovaToday(");
    expect(read("telegram/telegram-actions.ts")).toContain("loadNovaToday(");
  });

  it("a plan never fails because the record could not be read", () => {
    expect(inputs).toContain("loadLearningDna(snapshot.profileId, now).catch(() => null)");
  });

  it("reads Learning DNA as it is kept, and stores nothing new about the learner", () => {
    // Reading recomputes from the sessions; only a finished session refreshes the stored copy.
    expect(inputs).not.toContain("refreshLearningDna");
    expect(inputs).not.toMatch(/novaLearningDNA|learningDNA\.(create|update|upsert)/);
    expect(read("engines/planning-engine.ts")).not.toMatch(/prisma|@repo\/db/);
  });

  it("the wording layer is not what adapts: no reply prompt carries the session length rule", () => {
    for (const file of ["brains/prompts/nova-static-layer.prompt.ts", "decision/register.ts"]) expect(read(file)).not.toContain("usualSessionMinutes");
  });
});
