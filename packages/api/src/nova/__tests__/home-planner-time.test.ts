// One interpretation of "I have N minutes".
// Home and Planner must ask the Planning Engine the same question and show
// the same answer: Home's recommendation is the Planner's first block, and
// Home's "after that" list is the Planner's next blocks.

jest.mock("../product/planning-inputs", () => {
  const actual = jest.requireActual("../product/planning-inputs");
  return { ...actual, loadPlanningInputs: jest.fn() };
});

import { loadNovaToday, buildTodayView } from "../product/today";
import { loadNovaPlanner, buildPlannerView } from "../product/planner";
import { loadPlanningInputs, normalizeAvailableMinutes, planEmptyReason, type PlanningInputs } from "../product/planning-inputs";
import { computeAcademicState } from "../engines/academic-state-engine";
import { generateStudyPlan, MIN_BLOCK_MINUTES } from "../engines/planning-engine";
import { selectActiveExam } from "../engines/exam-engine";
import type { StudySnapshotResult } from "../engines/study-snapshot";
import type { AcademicState } from "../types/academic-state.types";
import type { TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";
import type { NovaPlannerReady } from "../product/planner.types";
import type { NovaTodayReady } from "../product/today.types";

const NOW = new Date();
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

const NO_MESSAGE: AcademicUnderstanding = {
  intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
  disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "",
};

const topic = (over: Partial<TopicMasteryState>): TopicMasteryState => ({
  topicId: "t1", topicName: "Deadlocks", subjectName: "Operating Systems",
  masteryProbability: 0.32, lastStudied: daysFromNow(-4), retentionEstimate: 0.4,
  confidenceReported: 0.4, calibrationGap: 0, reviewDueAt: daysFromNow(-2),
  masteryTrend: "stable", reviewCount: 2,
  ...over,
});

const TOPICS = [
  topic({}),
  topic({ topicId: "t5", topicName: "Semaphores", masteryProbability: 0.45, retentionEstimate: 0.5, reviewDueAt: daysFromNow(-1) }),
  topic({ topicId: "t2", topicName: "Paging", masteryProbability: 0.6, retentionEstimate: 0.9, reviewDueAt: daysFromNow(9) }),
  topic({ topicId: "t3", topicName: "Normalization", subjectName: "DBMS", masteryProbability: 0.55, retentionEstimate: 0.9, reviewDueAt: daysFromNow(9) }),
];

const SNAPSHOT: StudySnapshotResult = {
  profileId: "p1", yearOfStudy: 2, major: "CS", institution: null,
  semesterStartDate: null, semesterEndDate: null,
  preferredStudyHoursPerDay: 3, dailyMinutesStated: null, daysSinceJoined: 60, activeSession: null,
  subjects: [{ id: "s1", name: "Operating Systems", code: null }, { id: "s2", name: "DBMS", code: null }],
  studySessions: [],
  upcomingExams: [{ id: "e1", title: "OS midterm", examType: "midterm", scheduledAt: daysFromNow(6), subjectId: "s1", subjectName: "Operating Systems" }],
  storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
  stateHistory: [], cognitiveState: null, learningDNA: null,
};

// What the real loader does with a stated time, without the database.
function planningInputs(
  availableMinutes: number | null | undefined,
  opts: { state?: (s: AcademicState) => AcademicState; topics?: TopicMasteryState[] } = {},
): PlanningInputs {
  const topics = opts.topics ?? TOPICS;
  let academicState = computeAcademicState({
    semesterStartDate: null, semesterEndDate: null, daysSinceJoined: SNAPSHOT.daysSinceJoined,
    studySessions: [], upcomingExams: SNAPSHOT.upcomingExams, stateHistory: [],
    signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding: NO_MESSAGE,
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
  }, NOW);
  if (opts.state) academicState = opts.state(academicState);
  const examContext = selectActiveExam(
    SNAPSHOT.upcomingExams.map(e => ({ id: e.id, title: e.title, subjectName: e.subjectName, scheduledAt: e.scheduledAt, examType: e.examType })),
    {}, NOW,
  );
  const minutes = normalizeAvailableMinutes(availableMinutes);
  const plan = generateStudyPlan(academicState, topics, SNAPSHOT.preferredStudyHoursPerDay, examContext, { availableMinutes: minutes });
  return {
    availableMinutes: minutes, snapshot: SNAPSHOT, academicState, topics, examContext, plan,
    constraints: [], goals: [], timezone: "UTC", preferredStudyTime: null, now: NOW,
  };
}

const loader = loadPlanningInputs as jest.MockedFunction<typeof loadPlanningInputs>;

beforeEach(() => {
  loader.mockReset();
  loader.mockImplementation(async (_chat, options = {}) =>
    ({ status: "ready", inputs: planningInputs(options.availableMinutes) }));
});

async function bothPages(minutes: number | null) {
  const home    = await loadNovaToday("chat1", { availableMinutes: minutes }) as NovaTodayReady;
  const planner = await loadNovaPlanner("chat1", { availableMinutes: minutes }) as NovaPlannerReady;
  return { home, planner };
}

const core = (a: { topicName: string; subjectName: string; durationMinutes: number; activityType: string; urgency: string; reasons: string[]; rationale: string }) =>
  ({ topicName: a.topicName, subjectName: a.subjectName, durationMinutes: a.durationMinutes, activityType: a.activityType, urgency: a.urgency, reasons: a.reasons, rationale: a.rationale });

describe("Home and Planner ask the same planning question", () => {
  it.each([[25], [60], [45], [null]])("with %p minutes, both pass the same time to the one loader", async minutes => {
    await bothPages(minutes);
    expect(loader).toHaveBeenCalledTimes(2);
    const [homeCall, plannerCall] = loader.mock.calls;
    expect(homeCall![0]).toBe("chat1");
    expect(plannerCall![0]).toBe("chat1");
    expect(homeCall![1]!.availableMinutes).toBe(minutes);
    expect(plannerCall![1]!.availableMinutes).toBe(minutes);
  });
});

describe("Home and Planner show the same plan", () => {
  it.each([[25], [60], [45], [120], [null]])("with %p minutes", async minutes => {
    const { home, planner } = await bothPages(minutes);
    const blocks = planner.today.blocks;

    // Home's recommendation is the Planner's first block, field for field.
    expect(blocks.length).toBeGreaterThan(0);
    expect(core(home.recommendation!)).toEqual(core(blocks[0]!));
    // Home's "after that" is the Planner's next two blocks, in order.
    expect(home.alternatives.map(core)).toEqual(blocks.slice(1, 3).map(core));

    // The same day, the same budget, the same rule behind it.
    expect(home.availableMinutes).toBe(planner.availableMinutes);
    expect(home.plan.blockCount).toBe(blocks.length);
    expect(home.plan.totalMinutesToday).toBe(planner.reasoning.budget.plannedMinutes);
    expect(home.plan.budgetMinutes).toBe(planner.reasoning.budget.minutes);
    expect(home.plan.budgetBasis).toBe(planner.reasoning.budget.basis);
    expect(home.plan.mode).toBe(planner.reasoning.mode);
    expect(home.emptyReason).toBe(planner.today.emptyReason);
  });

  it("25 minutes: one block that fits, on both pages", async () => {
    const { home, planner } = await bothPages(25);
    expect(planner.reasoning.budget).toMatchObject({ minutes: 25, basis: "stated_time" });
    expect(planner.today.blocks.reduce((sum, b) => sum + b.durationMinutes, 0)).toBeLessThanOrEqual(25);
    expect(home.recommendation!.durationMinutes).toBeLessThanOrEqual(25);
    expect(home.plan.totalMinutesToday).toBeLessThanOrEqual(25);
  });

  it("60 minutes: the day fits in 60, on both pages", async () => {
    const { home, planner } = await bothPages(60);
    expect(planner.reasoning.budget).toMatchObject({ minutes: 60, basis: "stated_time" });
    expect(planner.today.blocks.length).toBeGreaterThan(1);
    expect(planner.reasoning.budget.plannedMinutes).toBeLessThanOrEqual(60);
    const homeTotal = home.recommendation!.durationMinutes + home.alternatives.reduce((sum, a) => sum + a.durationMinutes, 0);
    expect(homeTotal).toBeLessThanOrEqual(60);
  });

  it("the same priorities whatever the time: less time means fewer blocks, not different ones", async () => {
    const open  = (await bothPages(null)).planner.today.blocks.map(b => b.topicName);
    const short = (await bothPages(25)).planner.today.blocks.map(b => b.topicName);
    expect(open.slice(0, short.length)).toEqual(short);
    expect(short.length).toBeLessThan(open.length);
  });
});

describe("too little time", () => {
  it("is said the same way on both pages, and nothing is recommended", async () => {
    const { home, planner } = await bothPages(MIN_BLOCK_MINUTES - 4);
    expect(home.recommendation).toBeNull();
    expect(planner.today.blocks).toEqual([]);
    expect(home.emptyReason).toBe("too_little_time");
    expect(planner.today.emptyReason).toBe("too_little_time");
  });

  it("is not confused with having nothing due", () => {
    const calm = [topic({ reviewDueAt: daysFromNow(5), retentionEstimate: 0.95, masteryProbability: 0.95 })];
    const inputs = planningInputs(null, { topics: calm });
    if (inputs.plan.today.length === 0) expect(planEmptyReason(inputs)).toBe("nothing_due");
    expect(planEmptyReason(planningInputs(null, { topics: [] }))).toBe("no_topics");
  });

  it("a recovery day respects the time the student has", () => {
    const recovering = (s: AcademicState): AcademicState =>
      ({ ...s, consecutiveMisses: 6, hardDirectives: { ...s.hardDirectives, recoveryMode: true } });
    const easy = [topic({ masteryProbability: 0.8, retentionEstimate: 0.9, reviewDueAt: daysFromNow(3) })];
    const blocks = (m: number | null) => planningInputs(m, { state: recovering, topics: easy }).plan.today;
    expect(blocks(null).map(b => b.durationMinutes)).toEqual([20]);
    expect(blocks(15).map(b => b.durationMinutes)).toEqual([15]);
    expect(blocks(5)).toEqual([]);
  });
});

describe("the pure builders agree when handed the same plan", () => {
  it.each([[25], [60]])("with %p minutes", minutes => {
    const inputs  = planningInputs(minutes);
    const home    = buildTodayView(inputs);
    const planner = buildPlannerView(inputs);
    expect(core(home.recommendation!)).toEqual(core(planner.today.blocks[0]!));
    expect(home.plan.budgetBasis).toBe("stated_time");
  });
});
