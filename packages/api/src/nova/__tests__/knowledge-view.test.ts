// The Knowledge contract: buildKnowledgeView reports what is on record and
// invents nothing.

import { buildKnowledgeView, type KnowledgeInputs, type SessionRecord } from "../product/knowledge";
import { buildPlannerView } from "../product/planner";
import { buildTodayView } from "../product/today";
import type { PlanningInputs } from "../product/planning-inputs";
import { computeAcademicState } from "../engines/academic-state-engine";
import { generateStudyPlan, REVIEW_BLOCK_MINUTES } from "../engines/planning-engine";
import { daysSinceStudied, estimateRetention } from "../engines/retention-engine";
import type { TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

const NOW = new Date();
const DAY = 86_400_000;
const days = (d: number) => new Date(NOW.getTime() + d * DAY);

const SUBJECTS = [
  { id: "os", name: "Operating Systems" },
  { id: "db", name: "DBMS" },
  { id: "cn", name: "Computer Networks" },     // no topics yet
];

// A topic as the Knowledge Engine reads a stored row.
function topic(id: string, subjectName: string, topicName: string, mastery: number, reviewCount: number, studiedDaysAgo: number | null, scheduledInDays: number | null): TopicMasteryState {
  const lastStudied  = studiedDaysAgo === null ? null : days(-studiedDaysAgo);
  const nextReviewAt = scheduledInDays === null ? null : days(scheduledInDays);
  return {
    topicId: id, topicName, subjectName, masteryProbability: mastery, confidenceReported: mastery,
    calibrationGap: 0, masteryTrend: "stable", reviewCount, lastStudied,
    retentionEstimate: estimateRetention(2.5, daysSinceStudied(lastStudied, NOW)),
    reviewDueAt: nextReviewAt,
  };
}

const TOPICS = [
  topic("t1", "Operating Systems", "Deadlocks",     0.32, 2, 12, -2),   // due, weak
  topic("t2", "Operating Systems", "Paging",        0.78, 3, 1,  9),    // scheduled, solid
  topic("t3", "Operating Systems", "Semaphores",    0.55, 1, 9,  -1),   // due, developing
  topic("t4", "DBMS",              "Normalization", 0.42, 0, 0,  2),    // conversation only
];

const session = (over: Partial<SessionRecord>): SessionRecord => ({
  id: "s1", subjectId: "os", topicName: "Deadlocks", sessionDate: days(-12), durationMinutes: 30,
  activityType: "active", executionReport: { outcome: "struggled", confusionPoints: ["Banker's algorithm"] },
  ...over,
});

const inputs = (over: Partial<KnowledgeInputs> = {}): KnowledgeInputs =>
  ({ subjects: SUBJECTS, topics: TOPICS, sessions: [], activeSession: null, now: NOW, ...over });

describe("buildKnowledgeView: subjects and topics", () => {
  it("groups each topic under its own subject, and keeps subjects that have none", () => {
    const view = buildKnowledgeView(inputs());
    expect(view.subjects.map(s => [s.subjectName, s.topics.map(t => t.topicName)])).toEqual([
      ["Operating Systems", ["Deadlocks", "Semaphores", "Paging"]],   // due first, then weakest first
      ["DBMS", ["Normalization"]],
      ["Computer Networks", []],
    ]);
    expect(view.subjects[0]!.summary).toEqual({ topicCount: 3, dueCount: 2 });
    expect(view.subjects[2]!.summary).toEqual({ topicCount: 0, dueCount: 0 });
    expect(view.totals).toEqual({ subjectCount: 3, topicCount: 4, dueCount: 2 });
  });

  it("reports each topic's stored state and nothing more", () => {
    const view = buildKnowledgeView(inputs());
    const deadlocks = view.subjects[0]!.topics[0]!;
    expect(deadlocks).toEqual({
      id: "t1", topicName: "Deadlocks", subjectName: "Operating Systems",
      masteryPercent: 32, level: "weak", reviewCount: 2,
      lastStudiedAt: days(-12).toISOString(),
      retentionPercent: Math.round(TOPICS[0]!.retentionEstimate * 100),
      reviewState: "due", nextReviewAt: days(-2).toISOString(), daysOverdue: 2,
      recentSessions: [],
    });
    // No certainty measure, no history, no Learning DNA.
    expect(Object.keys(deadlocks).sort()).toEqual([
      "daysOverdue", "id", "lastStudiedAt", "level", "masteryPercent", "nextReviewAt", "recentSessions",
      "retentionPercent", "reviewCount", "reviewState", "subjectName", "topicName",
    ]);
  });

  it("does not give a level to a topic no session has fed", () => {
    const view = buildKnowledgeView(inputs());
    const normalization = view.subjects[1]!.topics[0]!;
    expect(normalization).toMatchObject({ level: "unverified", reviewCount: 0, reviewState: "scheduled", masteryPercent: 42 });
  });

  it("uses the same level bands for every topic", () => {
    const levels = buildKnowledgeView(inputs()).subjects.flatMap(s => s.topics).map(t => [t.topicName, t.level]);
    expect(levels).toEqual(expect.arrayContaining([["Deadlocks", "weak"], ["Semaphores", "developing"], ["Paging", "solid"]]));
  });

  it("shows a topic scheduled for today as due even while retention is high", () => {
    // Studied today, review date already here (what a mention in conversation
    // gets, and what any topic looks like on its review day).
    const view = buildKnowledgeView(inputs({ topics: [topic("t8", "DBMS", "Joins", 0.4, 1, 0, 0)] }));
    const joins = view.subjects.find(s => s.subjectName === "DBMS")!.topics[0]!;
    expect(joins).toMatchObject({ reviewState: "due", retentionPercent: 100, daysOverdue: 0 });
    expect(view.dueReviews.map(t => t.topicName)).toEqual(["Joins"]);
    expect(view.dueReviews[0]!.reasons).toEqual(["due today", "retention about 100%"]);   // retention shown, not decisive
  });

  it("marks a topic with no review date as unscheduled", () => {
    const view = buildKnowledgeView(inputs({ topics: [topic("t9", "DBMS", "Indexes", 0.5, 1, 3, null)] }));
    expect(view.subjects.find(s => s.subjectName === "DBMS")!.topics[0]).toMatchObject({ reviewState: "unscheduled", nextReviewAt: null, daysOverdue: 0 });
    expect(view.dueReviews).toEqual([]);
  });
});

describe("buildKnowledgeView: due reviews", () => {
  it("lists the due topics, least retained first, with why and how long", () => {
    const view = buildKnowledgeView(inputs());
    expect(view.dueReviews.map(t => t.topicName)).toEqual(["Deadlocks", "Semaphores"]);
    const [deadlocks, semaphores] = view.dueReviews;
    expect(deadlocks!.reasons).toEqual(["2 days overdue", `retention about ${deadlocks!.retentionPercent}%`, "weak (32%)"]);
    expect(semaphores!.reasons).toEqual(["1 day overdue", `retention about ${semaphores!.retentionPercent}%`]);
    expect(deadlocks!.reviewMinutes).toBe(REVIEW_BLOCK_MINUTES);
  });

  it("is the same list Home and the Planner act on", () => {
    const NO_MESSAGE: AcademicUnderstanding = {
      intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
      disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "",
    };
    const snapshot: PlanningInputs["snapshot"] = {
      profileId: "p1", yearOfStudy: 2, major: "CS", institution: null, semesterStartDate: null, semesterEndDate: null,
      preferredStudyHoursPerDay: 3, dailyMinutesStated: null, daysSinceJoined: 60, activeSession: null,
      subjects: SUBJECTS.map(s => ({ ...s, code: null })), studySessions: [], upcomingExams: [],
      storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0, stateHistory: [], cognitiveState: null, learningDNA: null,
    };
    const academicState = computeAcademicState({
      semesterStartDate: null, semesterEndDate: null, daysSinceJoined: 60, studySessions: [], upcomingExams: [], stateHistory: [],
      signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding: NO_MESSAGE,
      storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
    }, NOW);
    const planning: PlanningInputs = {
      availableMinutes: null, snapshot, academicState, topics: TOPICS, examContext: null,
      plan: generateStudyPlan(academicState, TOPICS, 3, null),
      constraints: [], goals: [], timezone: "UTC", preferredStudyTime: null, now: NOW,
    };

    const knowledge = buildKnowledgeView(inputs()).dueReviews.map(t => t.topicName);
    const home      = buildTodayView(planning);
    const planner   = buildPlannerView(planning);

    // Home's "due for review" count and topics.
    expect(home.reviewDue.count).toBe(knowledge.length);
    expect(home.reviewDue.topics.map(t => t.topicName)).toEqual(knowledge);
    // The Planner puts exactly those topics first, as overdue reviews, in that order.
    const overdueBlocks = planner.today.blocks.filter(b => b.activityType === "review" && b.urgency === "high").map(b => b.topicName);
    expect(overdueBlocks).toEqual(knowledge);
    for (const b of planner.today.blocks) {
      const saysDue = b.reasons.some(r => /review (due today|\d+ days? overdue)/.test(r));
      expect(saysDue).toBe(knowledge.includes(b.topicName));
    }
    // And none of them appears as a future "review due" in the week.
    expect(planner.week.flatMap(d => d.reviewsDue.map(r => r.topicName)).filter(n => knowledge.includes(n))).toEqual([]);
  });
});

describe("buildKnowledgeView: session evidence", () => {
  const sessions = [
    session({ id: "s3", sessionDate: days(-1),  durationMinutes: 25, executionReport: { outcome: "good", confusionPoints: [] } }),
    session({ id: "s2", sessionDate: days(-5),  durationMinutes: 40, executionReport: { outcome: null } }),
    session({ id: "s1", sessionDate: days(-12) }),
    session({ id: "s0", sessionDate: days(-20), executionReport: null }),
    session({ id: "p1", topicName: "paging", sessionDate: days(-1), executionReport: { outcome: "crushed_it" } }),
    session({ id: "x1", subjectId: "db", topicName: "Deadlocks", sessionDate: days(-2) }),          // another subject's topic of the same name
    session({ id: "c1", subjectId: null, topicName: "Deadlocks", sessionDate: days(-3), activityType: "self_reported", durationMinutes: 90, executionReport: null }),
  ];

  it("attaches to a topic the sessions with its subject and its name, newest first, three at most", () => {
    const view = buildKnowledgeView(inputs({ sessions }));
    const deadlocks = view.subjects[0]!.topics.find(t => t.topicName === "Deadlocks")!;
    expect(deadlocks.recentSessions.map(s => s.id)).toEqual(["s3", "s2", "s1"]);
    expect(deadlocks.recentSessions[0]).toMatchObject({ measured: true, minutes: 25, outcome: "good", confusionPoints: [] });
    expect(deadlocks.recentSessions[1]).toMatchObject({ outcome: null });          // not answered: not invented
    expect(deadlocks.recentSessions[2]).toMatchObject({ outcome: "struggled", confusionPoints: ["Banker's algorithm"] });
    const paging = view.subjects[0]!.topics.find(t => t.topicName === "Paging")!;
    expect(paging.recentSessions.map(s => s.id)).toEqual(["p1"]);                 // casing does not matter
  });

  it("never reports a self-reported session's placeholder duration as study time", () => {
    const view = buildKnowledgeView(inputs({ sessions }));
    const claimed = view.recentLearning.find(s => s.id === "c1")!;
    expect(claimed).toMatchObject({ measured: false, minutes: null, outcome: null, subjectName: null });
    // The 90 stored for it appears nowhere in the response.
    expect(JSON.stringify(view)).not.toContain("90");
    // …and it is not attached to a topic as session evidence.
    expect(view.subjects.flatMap(s => s.topics).flatMap(t => t.recentSessions).map(s => s.id)).not.toContain("c1");
    for (const s of view.recentLearning) expect(s.minutes === null).toBe(!s.measured);
  });

  it("lists recent learning newest first, with each session's own subject", () => {
    const view = buildKnowledgeView(inputs({ sessions }));
    expect(view.recentLearning.map(s => s.id)).toEqual(["s3", "p1", "x1", "c1", "s2", "s1", "s0"]);
    expect(view.recentLearning.find(s => s.id === "x1")!.subjectName).toBe("DBMS");
  });

  it("ignores an outcome value it does not know", () => {
    const view = buildKnowledgeView(inputs({ sessions: [session({ executionReport: { outcome: "amazing", confusionPoints: "none" } })] }));
    expect(view.recentLearning[0]).toMatchObject({ outcome: null, confusionPoints: [] });
  });
});

describe("buildKnowledgeView: nothing known", () => {
  it("returns no topics, no reviews and no sessions, and makes none up from subject names", () => {
    const view = buildKnowledgeView(inputs({ topics: [] }));
    expect(view.subjects.map(s => [s.subjectName, s.topics])).toEqual([["Computer Networks", []], ["DBMS", []], ["Operating Systems", []]]);
    expect(view.dueReviews).toEqual([]);
    expect(view.recentLearning).toEqual([]);
    expect(view.totals).toEqual({ subjectCount: 3, topicCount: 0, dueCount: 0 });
  });

  it("has nothing at all for a learner with no subjects", () => {
    const view = buildKnowledgeView({ subjects: [], topics: [], sessions: [], activeSession: null, now: NOW });
    expect(view).toMatchObject({ status: "ready", subjects: [], dueReviews: [], recentLearning: [], activeSession: null });
  });

  it("passes a running session through so a second cannot be started", () => {
    const view = buildKnowledgeView(inputs({ activeSession: { topicName: "Paging", subjectName: "Operating Systems" } }));
    expect(view.activeSession).toEqual({ topicName: "Paging", subjectName: "Operating Systems" });
  });
});
