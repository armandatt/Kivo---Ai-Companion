// The time a learner has is a hard limit. An exam changes what a day holds,
// never how long it is. When the work for an exam does not fit the time
// before it, the plan says so and offers choices; only the learner can give
// a day more time.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { computeAcademicState } from "../engines/academic-state-engine";
import { selectActiveExam } from "../engines/exam-engine";
import { EXAM_TOPIC_MINUTES, EXAM_WINDOW_DAYS, examShortfall, generateStudyPlan } from "../engines/planning-engine";
import { buildPlannerView } from "../product/planner";
import type { PlanningInputs } from "../product/planning-inputs";
import { shortfallView } from "../product/shortfall";
import { buildTodayView } from "../product/today";
import type { StudySnapshotResult } from "../engines/study-snapshot";
import type { AcademicState } from "../types/academic-state.types";
import type { TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

// A fixed hour of today, so "in N days" (calendar days) does not depend on
// the time of day the suite runs at.
const NOW = (() => { const d = new Date(); d.setUTCHours(20, 0, 0, 0); return d; })();
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

const NO_MESSAGE: AcademicUnderstanding = {
  intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
  disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "",
};

// A topic on the syllabus that has not been started.
const unstarted = (i: number, subjectName = "Physics"): TopicMasteryState => ({
  topicId: `t${i}`, topicName: `Chapter ${i}`, subjectName,
  masteryProbability: 0, lastStudied: null, retentionEstimate: 0,
  confidenceReported: 0, calibrationGap: 0, reviewDueAt: null,
  masteryTrend: "stable", reviewCount: 0,
});
const solid = (i: number): TopicMasteryState => ({
  ...unstarted(i), masteryProbability: 0.85, lastStudied: daysFromNow(-1), retentionEstimate: 0.95,
  reviewDueAt: daysFromNow(10), reviewCount: 3,
});
const chapters = (n: number) => Array.from({ length: n }, (_, i) => unstarted(i + 1));

type Setup = {
  topics:            TopicMasteryState[];
  examInDays?:       number | null;      // null: no exam on record
  dailyMinutes?:     number | null;      // null: the learner has not said
  availableMinutes?: number | null;      // what they said they have today
  state?:            (s: AcademicState) => AcademicState;
  reentry?:          boolean;            // a first day back after a gap
  overrides?:        { skip: string[]; pin: string[]; order: Array<{ topicId: string; position: number }> };
};

function inputs(setup: Setup): PlanningInputs {
  const stated = setup.dailyMinutes === undefined ? 60 : setup.dailyMinutes;
  const snapshot: StudySnapshotResult = {
    profileId: "p1", yearOfStudy: null, major: null, institution: null,
    semesterStartDate: null, semesterEndDate: null,
    preferredStudyHoursPerDay: stated !== null ? stated / 60 : 3, dailyMinutesStated: stated, daysSinceJoined: 30,
    activeSession: null,
    subjects: [{ id: "s1", name: "Physics", code: null }],
    studySessions: [],
    upcomingExams: setup.examInDays === null || setup.examInDays === undefined ? [] : [{
      id: "e1", title: "Physics exam", examType: "exam", scheduledAt: daysFromNow(setup.examInDays - 0.5),
      subjectId: "s1", subjectName: "Physics",
    }],
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
    stateHistory: [], cognitiveState: null, learningDNA: null,
  };
  let academicState = computeAcademicState({
    semesterStartDate: null, semesterEndDate: null, daysSinceJoined: snapshot.daysSinceJoined,
    studySessions: snapshot.studySessions, upcomingExams: snapshot.upcomingExams, stateHistory: [],
    signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding: NO_MESSAGE,
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
  }, NOW);
  if (setup.state) academicState = setup.state(academicState);
  const examContext = selectActiveExam(
    snapshot.upcomingExams.map(e => ({ id: e.id, title: e.title, subjectName: e.subjectName, scheduledAt: e.scheduledAt, examType: e.examType })),
    {}, NOW,
  );
  const availableMinutes = setup.availableMinutes ?? null;
  const plan = generateStudyPlan(academicState, setup.topics, snapshot.preferredStudyHoursPerDay, examContext, { availableMinutes, now: NOW, reentry: setup.reentry, overrides: setup.overrides });
  return {
    snapshot, academicState, topics: setup.topics, examContext, plan, constraints: [], goals: [],
    timezone: "UTC", preferredStudyTime: null, now: NOW, availableMinutes,
    daysSinceStudy: setup.reentry ? 5 : null,
  };
}

const planned = (i: PlanningInputs) => i.plan.today.reduce((sum, b) => sum + b.durationMinutes, 0);

// ── A normal day ──────────────────────────────────────────────────────────────

describe("a normal day", () => {
  it("is the learner's usual time, with nothing said about a shortfall", () => {
    const i = inputs({ topics: chapters(4), examInDays: null });
    expect(i.plan).toMatchObject({ budgetMinutes: 60, budgetBasis: "preferred", shortfall: null });
    expect(planned(i)).toBeLessThanOrEqual(60);
  });

  it("says nothing when an exam is close and the work fits", () => {
    // 4 topics at 30 min is 120 min; 10 days at 60 min is 600.
    const i = inputs({ topics: chapters(4), examInDays: 10 });
    expect(i.plan).toMatchObject({ budgetMinutes: 60, budgetBasis: "preferred", shortfall: null });
    expect(buildPlannerView(i).reasoning.shortfall).toBeNull();
    expect(buildTodayView(i).plan.shortfall).toBeNull();
  });

  it("says nothing about an exam that is still outside the window", () => {
    expect(examShortfall({
      examContext: { examId: "e1", examTitle: "Physics exam", subjectName: "Physics", daysUntil: EXAM_WINDOW_DAYS, scheduledAt: daysFromNow(14), mode: "normal", topicWeights: {}, riskMatrix: { critical: [], risky: [], safe: [] }, primaryFocus: "" },
      examTopics: chapters(60), budget: { minutes: 60, basis: "preferred" }, dailyMinutes: 60,
    })).toBeNull();
  });

  it("counts study days on the learner's calendar when it is known, never the day of the exam itself", () => {
    // An exam the day after tomorrow, read early in the day: elapsed time
    // rounds up to 3 days, but the learner has today and tomorrow.
    const context = { examId: "e1", examTitle: "Physics exam", subjectName: "Physics", daysUntil: 3, scheduledAt: daysFromNow(3), mode: "normal" as const, topicWeights: {}, riskMatrix: { critical: [], risky: [], safe: [] }, primaryFocus: "" };
    const base = { examContext: context, examTopics: chapters(8), budget: { minutes: 30, basis: "preferred" as const }, dailyMinutes: 30 };
    expect(examShortfall(base)).toMatchObject({ studyDays: 3, minutesAvailable: 90, topicsThatFit: 3 });
    expect(examShortfall({ ...base, calendarDays: 2 })).toMatchObject({ daysUntil: 2, studyDays: 2, minutesAvailable: 60, topicsThatFit: 2 });
    // Tomorrow, and today: there is only today.
    expect(examShortfall({ ...base, calendarDays: 1 })).toMatchObject({ studyDays: 1, minutesAvailable: 30, topicsThatFit: 1 });
    expect(examShortfall({ ...base, calendarDays: 0 })).toMatchObject({ studyDays: 1, minutesAvailable: 30 });
    // What the pages say is left always matches the days they name.
    const s = examShortfall({ ...base, calendarDays: 2 })!;
    expect(s.minutesAvailable).toBe(base.budget.minutes + base.dailyMinutes * (s.daysUntil - 1));
  });

  it("an exam-prep block's own reason names the date and states no day count or weight of its own", () => {
    const i = inputs({ topics: chapters(6), examInDays: 2 });
    const prep = i.plan.today.filter(b => b.activityType === "exam_prep");
    expect(prep.length).toBeGreaterThan(0);
    for (const b of prep) {
      // The count is said once, in calendar days, by the page; nothing on
      // record says how much a topic weighs.
      expect([..."0123456789"].some(d => b.rationale.includes(d))).toBe(false);
      expect(b.rationale.toLowerCase()).not.toContain("weight");
      expect(b.rationale.toLowerCase()).not.toContain("low mastery");
    }
  });

  it("does not count topics already at a solid level", () => {
    const i = inputs({ topics: [solid(1), solid(2), solid(3), unstarted(4)], examInDays: 2 });
    // One topic left: 30 min against 120.
    expect(i.plan.shortfall).toBeNull();
  });
});

// ── Near a deadline ───────────────────────────────────────────────────────────

describe("near a deadline", () => {
  it.each([13, 9, 6, 3, 2, 1])("an exam %i days away never lengthens the day", days => {
    const i = inputs({ topics: chapters(6), examInDays: days });
    expect(i.plan.budgetMinutes).toBe(60);
    expect(i.plan.budgetBasis).toBe("preferred");
    expect(planned(i)).toBeLessThanOrEqual(60);
  });

  it("the audit's case: 60 min a day, exam in 2 days, the plan stays at 60 with a shortfall", () => {
    const i = inputs({ topics: chapters(6), examInDays: 2 });
    expect(i.academicState.hardDirectives.examCrisisMode).toBe(true);
    expect(i.plan.budgetMinutes).toBe(60);
    expect(planned(i)).toBeLessThanOrEqual(60);
    expect(i.plan.today.every(b => b.activityType === "exam_prep")).toBe(true);
    // 6 topics at 30 min is 180; today and tomorrow at 60 is 120, which covers 4.
    expect(i.plan.shortfall).toMatchObject({
      examTitle: "Physics exam", daysUntil: 2, studyDays: 2, dailyMinutes: 60,
      topicsRemaining: 6, topicsThatFit: 4, minutesPerTopic: EXAM_TOPIC_MINUTES,
      minutesNeeded: 180, minutesAvailable: 120,
    });
  });

  it("an exam inside the next day counts today only", () => {
    const i = inputs({ topics: chapters(3), examInDays: 1 });
    expect(i.plan.shortfall).toMatchObject({ studyDays: 1, minutesAvailable: 60, minutesNeeded: 90, topicsThatFit: 2 });
  });

  it("the three-hour-a-day learner near an exam is not handed four and a half", () => {
    // Before this rule: 180 * 1.5 = 270 min inside three days.
    const i = inputs({ topics: chapters(20), examInDays: 2, dailyMinutes: 180 });
    expect(i.plan.budgetMinutes).toBe(180);
    expect(planned(i)).toBeLessThanOrEqual(180);
  });

  it("the Planner explains exam mode without claiming more time", () => {
    const view = buildPlannerView(inputs({ topics: chapters(6), examInDays: 2 }));
    expect(view.reasoning.budget).toMatchObject({ basis: "preferred", minutes: 60, usualMinutes: 60 });
    expect(view.reasoning.adjustments).toEqual([
      { kind: "exam_crisis", text: "Physics exam is in 2 days: every block today is exam prep, inside your usual time." },
    ]);
  });
});

// ── Overloaded ────────────────────────────────────────────────────────────────

describe("overloaded: the work does not fit", () => {
  const overloaded = () => inputs({ topics: chapters(40), examInDays: 5 });

  it("states the shortfall with every figure on record", () => {
    // 40 topics at 30 min is 1200; five days at 60 is 300, which covers 10.
    const view = buildPlannerView(overloaded()).reasoning.shortfall!;
    expect(view).toMatchObject({ topicsRemaining: 40, topicsThatFit: 10, minutesNeeded: 1200, minutesAvailable: 300, dailyMinutes: 60 });
    expect(view.summary).toBe(
      "Physics exam is in 5 days. 40 topics for it are not at a solid level yet: about 1200 min of work, " +
      "and you have about 300 min before it. That covers 10 of them. Nova has not added time to your day.",
    );
  });

  it("offers choices, and takes none of them itself", () => {
    const i    = overloaded();
    const view = buildPlannerView(i).reasoning.shortfall!;
    expect(view.choices.map(c => c.kind)).toEqual(["keep_time", "add_time_today", "change_usual_time"]);
    expect(view.choices[0]!.detail).toBe("Today's plan already puts the weakest topics for this exam first. 30 topics will not be reached before it.");
    // Nothing was chosen for them: the day is still theirs.
    expect(i.plan.budgetMinutes).toBe(60);
  });

  it("says what the count assumes", () => {
    const view = buildPlannerView(overloaded()).reasoning.shortfall!;
    expect(view.assumptions).toEqual([
      "Counts 30 min for each topic. Nova has no record of how large each one is, so it treats them as equal.",
    ]);
  });

  it("says the daily figure is a guess when the learner never gave one", () => {
    const i = inputs({ topics: chapters(60), examInDays: 3, dailyMinutes: null });
    expect(i.plan.budgetMinutes).toBe(180);
    const view = buildTodayView(i).plan.shortfall!;
    expect(view.assumptions).toContain("Uses 180 min a day as a guess: you haven't said what you usually have.");
  });

  it("Today and the Planner give the same statement", () => {
    const i = overloaded();
    expect(buildTodayView(i).plan.shortfall).toEqual(buildPlannerView(i).reasoning.shortfall);
  });

  it("is not stated on a day held short for the learner's wellbeing", () => {
    const burntOut = (s: AcademicState): AcademicState =>
      ({ ...s, hardDirectives: { ...s.hardDirectives, noStudyPressure: true, examCrisisMode: false } });
    const i = inputs({ topics: chapters(40), examInDays: 5, state: burntOut });
    expect(i.plan).toMatchObject({ budgetMinutes: 30, budgetBasis: "no_pressure", shortfall: null });
  });

  it("a single topic is worded as one", () => {
    const view = shortfallView(
      { examId: "e1", examTitle: "Physics exam", daysUntil: 1, studyDays: 1, dailyMinutes: 20, topicsRemaining: 1, topicsThatFit: 0, minutesPerTopic: 30, minutesNeeded: 30, minutesAvailable: 20 },
      { dailyMinutesStated: true, availableMinutes: null },
    )!;
    expect(view.summary).toContain("Physics exam is tomorrow. 1 topic for it is not at a solid level yet");
    expect(view.choices[0]!.detail).toContain("1 topic will not be reached before it.");
  });
});

// ── Changed availability ──────────────────────────────────────────────────────

describe("changed availability", () => {
  it("less time today shortens the day and widens the shortfall", () => {
    const usual = inputs({ topics: chapters(6), examInDays: 2 });
    const short = inputs({ topics: chapters(6), examInDays: 2, availableMinutes: 20 });
    expect(short.plan).toMatchObject({ budgetMinutes: 20, budgetBasis: "stated_time" });
    expect(planned(short)).toBeLessThanOrEqual(20);
    // Today 20, tomorrow the usual 60.
    expect(short.plan.shortfall).toMatchObject({ minutesAvailable: 80, topicsThatFit: 2 });
    expect(short.plan.shortfall!.minutesAvailable).toBeLessThan(usual.plan.shortfall!.minutesAvailable);
    expect(buildPlannerView(short).reasoning.shortfall!.assumptions).toContain(
      "Counts today as the 20 min you said you have, and each day after it as 60 min.",
    );
  });

  it("more time today is the learner's to give, and the plan uses it", () => {
    const more = inputs({ topics: chapters(6), examInDays: 2, availableMinutes: 150 });
    expect(more.plan).toMatchObject({ budgetMinutes: 150, budgetBasis: "stated_time" });
    expect(planned(more)).toBeGreaterThan(60);
    // 150 today and 60 tomorrow covers the 180 needed: nothing is short now.
    expect(more.plan.shortfall).toBeNull();
  });

  it("a larger usual daily time closes the shortfall without any rule adding to it", () => {
    const before = inputs({ topics: chapters(6), examInDays: 2, dailyMinutes: 60 });
    const after  = inputs({ topics: chapters(6), examInDays: 2, dailyMinutes: 90 });
    expect(before.plan.shortfall).not.toBeNull();
    expect(after.plan).toMatchObject({ budgetMinutes: 90, budgetBasis: "preferred", shortfall: null });
  });

  it("a smaller usual daily time is honoured the same way", () => {
    const i = inputs({ topics: chapters(6), examInDays: 6, dailyMinutes: 20 });
    expect(i.plan.budgetMinutes).toBe(20);
    expect(planned(i)).toBeLessThanOrEqual(20);
    expect(i.plan.shortfall).toMatchObject({ minutesAvailable: 120, topicsThatFit: 4 });
  });

  it("stated time cannot lift a wellbeing cap", () => {
    const burntOut = (s: AcademicState): AcademicState =>
      ({ ...s, hardDirectives: { ...s.hardDirectives, noStudyPressure: true } });
    const i = inputs({ topics: chapters(6), examInDays: null, availableMinutes: 120, state: burntOut });
    expect(i.plan).toMatchObject({ budgetMinutes: 30, budgetBasis: "no_pressure" });
  });
});

// ── Recovery is untouched ─────────────────────────────────────────────────────

describe("missed-session recovery still works", () => {
  it("cuts the day and plans one light review at most", () => {
    const recovering = (s: AcademicState): AcademicState =>
      ({ ...s, consecutiveMisses: 6, hardDirectives: { ...s.hardDirectives, recoveryMode: true } });
    const i = inputs({ topics: [solid(1), unstarted(2)], examInDays: null, dailyMinutes: 120, state: recovering });
    expect(i.plan).toMatchObject({ budgetMinutes: 60, budgetBasis: "recovery", shortfall: null });
    expect(i.plan.today.length).toBeLessThanOrEqual(1);
    expect(buildPlannerView(i).reasoning.adjustments[0]).toEqual({
      kind: "recovery", text: "Cut from 120 to 60 min: 6 planned days were missed in a row.",
    });
  });
});

// ── The rule cannot quietly come back ─────────────────────────────────────────

describe("no rule raises the day", () => {
  const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");

  it("the budget function multiplies the learner's time only to cut it", () => {
    const engine = read("engines/planning-engine.ts");
    const budget = engine.slice(engine.indexOf("function computeDailyBudget"), engine.indexOf("function fitBudgetToAvailableTime"));
    expect(budget).not.toContain("examCrisisMode");
    expect(budget).not.toContain("daysUntilNextExam");
    expect(budget).not.toContain("1.5");
    expect(budget).toContain('return { minutes: base, basis: "preferred" };');
  });

  it("no basis for a raised day exists in either contract", () => {
    for (const file of ["types/engine.types.ts", "product/today.types.ts", "product/planner.types.ts"]) {
      expect(read(file)).not.toContain("exam_ramp");
    }
    expect(read("types/engine.types.ts")).not.toContain('| "exam_crisis"   // raised');
  });

  it("the model is not told to recommend hours a day", () => {
    expect(read("context/context-builder.ts")).not.toContain("h/day");
    expect(read("engines/exam-engine.ts")).not.toContain("recommendedDailyHours");
  });
});

// ── A first day back (recovery-engine.ts, plan-change-policy.ts) ──────────────

describe("a first day back after a gap", () => {
  it("is planned shorter by itself, and says why and that nothing was saved", () => {
    const i = inputs({ topics: chapters(4), examInDays: null, dailyMinutes: 60, reentry: true });
    expect(i.plan).toMatchObject({ budgetMinutes: 30, budgetBasis: "reentry" });
    expect(planned(i)).toBeLessThanOrEqual(30);
    expect(buildPlannerView(i).reasoning.adjustments).toContainEqual({
      kind: "reentry",
      text: "A shorter first day back: 30 of your usual 60 min. Your last session was 5 days ago. It changes back after your next session; nothing was saved.",
    });
    expect(buildTodayView(i).plan.budgetBasis).toBe("reentry");
  });

  it("a time they said they have today is the answer, not the re-entry rule", () => {
    const i = inputs({ topics: chapters(4), examInDays: null, availableMinutes: 45, reentry: true });
    expect(i.plan).toMatchObject({ budgetMinutes: 45, budgetBasis: "stated_time" });
  });

  it("an exam taking over the day is not cut", () => {
    const i = inputs({ topics: chapters(4), examInDays: 1, reentry: true });
    expect(i.plan.budgetBasis).not.toBe("reentry");
    expect(i.plan.budgetMinutes).toBe(60);
  });

  it("a day already cut for recovery or wellbeing is not cut twice", () => {
    const recovering = (s: AcademicState): AcademicState =>
      ({ ...s, consecutiveMisses: 6, hardDirectives: { ...s.hardDirectives, recoveryMode: true } });
    expect(inputs({ topics: [solid(1)], examInDays: null, dailyMinutes: 120, state: recovering, reentry: true }).plan)
      .toMatchObject({ budgetMinutes: 60, budgetBasis: "recovery" });
  });

  it("an exam inside the window still shapes what the shorter day holds, and the shortfall counts the shorter today", () => {
    const usual = inputs({ topics: chapters(6), examInDays: 5 });
    const back  = inputs({ topics: chapters(6), examInDays: 5, reentry: true });
    expect(back.plan.budgetBasis).toBe("reentry");
    expect(back.plan.today.some(b => b.activityType === "exam_prep")).toBe(true);
    if (usual.plan.shortfall && back.plan.shortfall) expect(back.plan.shortfall.minutesAvailable).toBeLessThan(usual.plan.shortfall.minutesAvailable);
  });

  it("no basis raises the day: re-entry only ever shortens", () => {
    for (const daily of [10, 25, 60, 240]) {
      const i = inputs({ topics: chapters(4), examInDays: null, dailyMinutes: daily, reentry: true });
      expect(i.plan.budgetMinutes).toBeLessThanOrEqual(daily);
    }
  });
});

// ── The learner's changes to today (plan-overrides.ts) ────────────────────────

describe("the learner's changes to today's plan", () => {
  const none = { skip: [] as string[], pin: [] as string[], order: [] as Array<{ topicId: string; position: number }> };
  const ids = (i: PlanningInputs) => i.plan.today.map(b => b.topicId);

  it("a skipped topic is left out and the day is filled from the next ones", () => {
    const usual = inputs({ topics: chapters(6), examInDays: null });
    const first = ids(usual)[0]!;
    const skipped = inputs({ topics: chapters(6), examInDays: null, overrides: { ...none, skip: [first] } });
    expect(ids(skipped)).not.toContain(first);
    expect(skipped.plan.today.length).toBe(usual.plan.today.length);
    expect(planned(skipped)).toBeLessThanOrEqual(skipped.plan.budgetMinutes);
  });

  it("skipping an exam topic today does not shrink what is short before the exam", () => {
    const usual = inputs({ topics: chapters(6), examInDays: 2 });
    const skipped = inputs({ topics: chapters(6), examInDays: 2, overrides: { ...none, skip: ["t1", "t2"] } });
    expect(skipped.plan.shortfall).toEqual(usual.plan.shortfall);
    expect(ids(skipped)).not.toEqual(expect.arrayContaining(["t1"]));
  });

  it("an added topic comes first, inside the day's time, and is said to be the learner's choice", () => {
    const i = inputs({ topics: [...chapters(4), solid(9)], examInDays: null, overrides: { ...none, pin: ["t9"] } });
    expect(i.plan.today[0]).toMatchObject({ topicId: "t9", rationale: "You added this to today's plan." });
    expect(i.plan.today.filter(b => b.topicId === "t9")).toHaveLength(1);
    expect(planned(i)).toBeLessThanOrEqual(i.plan.budgetMinutes);
  });

  it("an added topic that does not fit is not squeezed in: the plan says so", () => {
    const i = inputs({ topics: chapters(3), examInDays: null, availableMinutes: 5, overrides: { ...none, pin: ["t2"] } });
    expect(ids(i)).not.toContain("t2");
    expect(i.plan.assumptions).toContain("You added Chapter 2 to today, but it doesn't fit in the time you have.");
  });

  it("the learner's order is the order, so their first block is the recommendation; the rest keep the engine's", () => {
    const usual = inputs({ topics: chapters(6), examInDays: null });
    const last = ids(usual).at(-1)!;
    const i = inputs({ topics: chapters(6), examInDays: null, overrides: { ...none, order: [{ topicId: last, position: 0 }] } });
    expect(ids(i)[0]).toBe(last);
    expect(ids(i).slice(1)).toEqual(ids(usual).filter(id => id !== last));
    expect(buildTodayView(i).recommendation?.topicId).toBe(last);
  });

  it("skip wins over add for the same topic; nothing raises the day", () => {
    const i = inputs({ topics: chapters(4), examInDays: null, overrides: { skip: ["t1"], pin: ["t1"], order: [] } });
    expect(ids(i)).not.toContain("t1");
    for (const pin of [["t1"], ["t1", "t2", "t3", "t4"]]) {
      const j = inputs({ topics: chapters(4), examInDays: null, dailyMinutes: 30, overrides: { ...none, pin } });
      expect(planned(j)).toBeLessThanOrEqual(30);
    }
  });
});
