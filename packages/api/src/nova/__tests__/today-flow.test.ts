// Today's plan is the rest of the day. A topic studied today is not handed
// back as the next block, the minutes already done count against the day,
// and a day the learner gives to one subject carries on through that
// subject from where they left off.
//
// Found on 20 October: after a 35-minute session on the first block the
// plan kept recommending the same topic (now "practice", because the session
// moved its mastery into the practice band), and the second and third
// blocks never came forward.

import { computeAcademicState } from "../engines/academic-state-engine";
import { selectActiveExam } from "../engines/exam-engine";
import { FOCUS_NEW_TOPICS, generateStudyPlan } from "../engines/planning-engine";
import { studiedToday } from "../engines/recovery-engine";
import { focusSubjectOf, planEmptyReason, type PlanningInputs } from "../product/planning-inputs";
import { buildTodayView, subjectProgress } from "../product/today";
import { buildPlannerView } from "../product/planner";
import type { StudySnapshotResult } from "../engines/study-snapshot";
import type { TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

const NOW = (() => { const d = new Date(); d.setUTCHours(15, 0, 0, 0); return d; })();
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3_600_000);
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

const NO_MESSAGE: AcademicUnderstanding = {
  intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
  disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "",
};

const topic = (id: string, name: string, subjectName: string, over: Partial<TopicMasteryState> = {}): TopicMasteryState => ({
  topicId: id, topicName: name, subjectName,
  masteryProbability: 0, lastStudied: null, retentionEstimate: 0,
  confidenceReported: 0, calibrationGap: 0, reviewDueAt: null,
  masteryTrend: "stable", reviewCount: 0, ...over,
});

// DSA's syllabus in the order it was given, and an OS one.
const ARRAYS = topic("dsa1", "Arrays", "DSA");
const DSA = [ARRAYS, topic("dsa2", "Linked lists", "DSA"), topic("dsa3", "Stacks", "DSA"), topic("dsa4", "Queues", "DSA"), topic("dsa5", "Trees", "DSA")];
const OS  = [topic("os1", "Processes", "Operating Systems"), topic("os2", "Threads", "Operating Systems"), topic("os3", "Scheduling", "Operating Systems")];

// Arrays after a 35-minute session today that went "okay": studied, in the
// practice band, review tomorrow.
const ARRAYS_AFTER = topic("dsa1", "Arrays", "DSA", {
  masteryProbability: 0.55, lastStudied: hoursAgo(1), retentionEstimate: 0.9, reviewDueAt: daysFromNow(1), reviewCount: 1,
});

type Session = StudySnapshotResult["studySessions"][number];
// As sessions are recorded: subject and topic name, no topic id.
const session = (topicId: string, topicName: string, minutes: number, at: Date, over: Partial<Session> = {}): Session => ({
  id: `s-${topicId}-${at.getTime()}`, sessionDate: at, status: "completed", durationMinutes: minutes,
  topicId: null, topicName, subjectName: topicId.startsWith("os") ? "Operating Systems" : "DSA", activityType: "focus", ...over,
});

function inputs(setup: {
  topics:            TopicMasteryState[];
  sessions?:         Session[];
  dailyMinutes?:     number;
  availableMinutes?: number | null;
  focus?:            string | null;
  examSubject?:      string | null;   // an exam two days away, in this subject
}): PlanningInputs {
  const daily = setup.dailyMinutes ?? 120;
  const snapshot: StudySnapshotResult = {
    profileId: "p1", yearOfStudy: null, major: null, institution: null,
    semesterStartDate: null, semesterEndDate: null,
    preferredStudyHoursPerDay: daily / 60, dailyMinutesStated: daily, daysSinceJoined: 30,
    activeSession: null,
    subjects: [{ id: "s1", name: "DSA", code: null }, { id: "s2", name: "Operating Systems", code: null }],
    studySessions: setup.sessions ?? [],
    upcomingExams: setup.examSubject ? [{
      id: "e1", title: `${setup.examSubject} exam`, examType: "exam", scheduledAt: daysFromNow(1.5),
      subjectId: setup.examSubject === "DSA" ? "s1" : "s2", subjectName: setup.examSubject,
    }] : [],
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
    stateHistory: [], cognitiveState: null, learningDNA: null,
  };
  const academicState = computeAcademicState({
    semesterStartDate: null, semesterEndDate: null, daysSinceJoined: 30,
    studySessions: snapshot.studySessions, upcomingExams: snapshot.upcomingExams, stateHistory: [],
    signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding: NO_MESSAGE,
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
  }, NOW);
  const examContext = selectActiveExam(
    snapshot.upcomingExams.map(e => ({ id: e.id, title: e.title, subjectName: e.subjectName, scheduledAt: e.scheduledAt, examType: e.examType })),
    {}, NOW,
  );
  const doneToday = studiedToday(snapshot.studySessions, "UTC", NOW, setup.topics);
  const focusSubject = focusSubjectOf(setup.focus ?? null, snapshot.subjects);
  const availableMinutes = setup.availableMinutes ?? null;
  const plan = generateStudyPlan(academicState, setup.topics, snapshot.preferredStudyHoursPerDay, examContext,
    { availableMinutes, now: NOW, doneToday, focusSubject });
  return {
    snapshot, academicState, topics: setup.topics, examContext, plan, constraints: [], goals: [],
    timezone: "UTC", preferredStudyTime: null, now: NOW, availableMinutes, doneToday, focusSubject,
  };
}

const names = (i: PlanningInputs) => i.plan.today.map(b => b.topicName);

describe("after a session, the plan moves on", () => {
  it("starts with the first topic before anything is done", () => {
    const i = inputs({ topics: [...DSA] });
    expect(names(i)[0]).toBe("Arrays");
  });

  it("does not hand back the topic just studied: the next block comes forward", () => {
    const before = inputs({ topics: [...DSA] });
    const after  = inputs({ topics: [ARRAYS_AFTER, ...DSA.slice(1)], sessions: [session("dsa1", "Arrays", 35, hoursAgo(1))] });
    expect(names(after)).not.toContain("Arrays");
    // What was second is now first.
    expect(names(after)[0]).toBe(before.plan.today[1]!.topicName);
    expect(buildTodayView(after).recommendation?.topicName).toBe("Linked lists");
  });

  it("would have kept Arrays without knowing what was done today (the reported bug)", () => {
    const blind = generateStudyPlan(inputs({ topics: [] }).academicState, [ARRAYS_AFTER, ...DSA.slice(1)], 2, null, { now: NOW });
    expect(blind.today[0]!.topicName).toBe("Arrays");
  });

  it("counts the minutes done against the day", () => {
    const after = inputs({ topics: [ARRAYS_AFTER, ...DSA.slice(1)], sessions: [session("dsa1", "Arrays", 35, hoursAgo(1))] });
    expect(after.plan.budgetMinutes).toBe(120);
    expect(after.plan.totalMinutesToday).toBeLessThanOrEqual(120 - 35);
  });

  it("is done for the day once the day's time is used", () => {
    const i = inputs({
      topics: [ARRAYS_AFTER, ...DSA.slice(1)], dailyMinutes: 60,
      sessions: [session("dsa1", "Arrays", 55, hoursAgo(1))],
    });
    expect(i.plan.today).toEqual([]);
    expect(planEmptyReason(i)).toBe("done_today");
    expect(buildTodayView(i)).toMatchObject({ emptyReason: "done_today", doneToday: { minutes: 55, topics: [{ topicName: "Arrays", subjectName: "DSA" }] } });
  });

  it("plans a time the learner gives now in full, done minutes or not", () => {
    const i = inputs({
      topics: [ARRAYS_AFTER, ...DSA.slice(1)], availableMinutes: 50,
      sessions: [session("dsa1", "Arrays", 55, hoursAgo(1))],
    });
    expect(i.plan.budgetBasis).toBe("stated_time");
    expect(i.plan.totalMinutesToday).toBeGreaterThan(0);
    expect(names(i)).not.toContain("Arrays");
  });

  it("the Planner's first block agrees with Today's recommendation", () => {
    const after = inputs({ topics: [ARRAYS_AFTER, ...DSA.slice(1)], sessions: [session("dsa1", "Arrays", 35, hoursAgo(1))] });
    expect(buildPlannerView(after).today.blocks[0]?.topicName).toBe(buildTodayView(after).recommendation?.topicName);
  });
});

describe("what counts as done today", () => {
  it("is today's finished, timed sessions of ten minutes or more", () => {
    const done = studiedToday([
      session("a", "A", 35, hoursAgo(1)),
      session("b", "B", 5, hoursAgo(2)),                                  // under ten minutes
      session("c", "C", 30, hoursAgo(3), { activityType: "self_reported" }),
      session("d", "D", 30, hoursAgo(1), { status: "in_progress" }),
      session("e", "E", 30, daysFromNow(-1)),                              // yesterday
    ], "UTC", NOW, [topic("a", "A", "DSA")]);
    expect(done).toEqual({ topicIds: ["a"], minutes: 35 });
  });

  it("finds the topic by its subject and name, as a session records it", () => {
    const topics = [topic("x1", "Recursion", "DSA"), topic("x2", "Recursion", "Maths"), topic("x3", "Graphs", "DSA")];
    const at = hoursAgo(1);
    const done = (over: Partial<Session>) => studiedToday([session("z", "", 30, at, over)], "UTC", NOW, topics).topicIds;
    expect(done({ topicName: "recursion", subjectName: "Maths" })).toEqual(["x2"]);
    expect(done({ topicName: "Graphs", subjectName: null })).toEqual(["x3"]);      // one topic has that name
    expect(done({ topicName: "Recursion", subjectName: null })).toEqual([]);      // two do: not guessed
    expect(done({ topicName: "Heaps", subjectName: "DSA" })).toEqual([]);
    expect(done({ topicId: "x3", topicName: "anything" })).toEqual(["x3"]);
  });

  it("is counted on the learner's calendar", () => {
    // 15:00 UTC is 20:30 in Kolkata; an hour earlier is the same day there.
    expect(studiedToday([session("a", "A", 30, hoursAgo(1))], "Asia/Kolkata", NOW, []).minutes).toBe(30);
    // In Auckland 15:00 UTC is early the next morning: sixteen hours earlier
    // was the day before there.
    expect(studiedToday([session("a", "A", 30, hoursAgo(16))], "Pacific/Auckland", NOW, []).minutes).toBe(0);
  });
});

describe("a day given to one subject", () => {
  it("plans only that subject, from where they left off", () => {
    const i = inputs({ topics: [...DSA, ...OS], focus: "Operating Systems" });
    expect(i.plan.today.length).toBeGreaterThan(0);
    expect(i.plan.today.every(b => b.subjectName === "Operating Systems")).toBe(true);
    expect(names(i)[0]).toBe("Processes");
    expect(buildTodayView(i).focusSubject).toBe("Operating Systems");
  });

  it("carries on through the syllabus, up to a few new topics while there is time", () => {
    const i = inputs({ topics: [...DSA, ...OS], focus: "DSA", dailyMinutes: 180 });
    expect(names(i)).toEqual(["Arrays", "Linked lists", "Stacks"].slice(0, FOCUS_NEW_TOPICS));
  });

  it("picks up after what was studied today", () => {
    const i = inputs({ topics: [ARRAYS_AFTER, ...DSA.slice(1), ...OS], focus: "DSA", sessions: [session("dsa1", "Arrays", 35, hoursAgo(1))] });
    expect(names(i)[0]).toBe("Linked lists");
  });

  it("is named the way the record names it, and ignores a subject that is not theirs", () => {
    const subjects = [{ name: "DSA" }, { name: "Operating Systems" }];
    expect(focusSubjectOf("operating systems", subjects)).toBe("Operating Systems");
    expect(focusSubjectOf("Chemistry", subjects)).toBeNull();
    expect(focusSubjectOf("", subjects)).toBeNull();
    expect(focusSubjectOf(null, subjects)).toBeNull();
    const i = inputs({ topics: [...DSA, ...OS], focus: "Chemistry" });
    expect(i.focusSubject).toBeNull();
    expect(new Set(i.plan.today.map(b => b.subjectName)).size).toBeGreaterThanOrEqual(1);
  });

  it("is not taken over by an exam in another subject", () => {
    const all = inputs({ topics: [...DSA, ...OS], examSubject: "DSA" });
    expect(all.plan.today.every(b => b.subjectName === "DSA")).toBe(true);
    const os = inputs({ topics: [...DSA, ...OS], examSubject: "DSA", focus: "Operating Systems" });
    expect(os.plan.today.length).toBeGreaterThan(0);
    expect(os.plan.today.every(b => b.subjectName === "Operating Systems")).toBe(true);
  });

  it("says when nothing in that subject is left today", () => {
    const studied = OS.map(t => ({ ...t, masteryProbability: 0.9, lastStudied: hoursAgo(1), retentionEstimate: 0.95, reviewDueAt: daysFromNow(5), reviewCount: 2 }));
    const i = inputs({ topics: [...DSA, ...studied], focus: "Operating Systems" });
    expect(i.plan.today).toEqual([]);
    expect(planEmptyReason(i)).toBe("subject_done");
  });
});

describe("each subject's progress, for the switcher", () => {
  it("counts started topics, names the last one studied and the next one", () => {
    const progress = subjectProgress([{ name: "DSA" }, { name: "Operating Systems" }], [ARRAYS_AFTER, ...DSA.slice(1), ...OS]);
    expect(progress).toEqual([
      { subjectName: "DSA", topicsTotal: 5, topicsStarted: 1, lastTopic: "Arrays", lastStudiedAt: ARRAYS_AFTER.lastStudied!.toISOString(), nextTopic: "Linked lists" },
      { subjectName: "Operating Systems", topicsTotal: 3, topicsStarted: 0, lastTopic: null, lastStudiedAt: null, nextTopic: "Processes" },
    ]);
  });
});
