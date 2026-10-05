// The Home contract: buildTodayView reports what the engines decided and
// invents nothing. Session view and command rules are covered here too.

import { buildTodayView, type TodayInputs } from "../product/today";
import {
  checkSessionCommand,
  parseSessionCommand,
  sessionElapsedSeconds,
  toSessionView,
} from "../product/session-view";
import { computeAcademicState } from "../engines/academic-state-engine";
import { generateStudyPlan } from "../engines/planning-engine";
import { selectActiveExam } from "../engines/exam-engine";
import type { ActiveSessionInfo, StudySnapshotResult } from "../engines/study-snapshot";
import type { StudyPlan, TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

const NOW = new Date("2026-10-05T18:00:00Z");
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

const NO_MESSAGE: AcademicUnderstanding = {
  intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
  disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "",
};

function topic(over: Partial<TopicMasteryState>): TopicMasteryState {
  return {
    topicId: "t1", topicName: "Deadlocks", subjectName: "Operating Systems",
    masteryProbability: 0.32, lastStudied: daysFromNow(-4), retentionEstimate: 0.4,
    confidenceReported: 0.4, calibrationGap: 0, reviewDueAt: daysFromNow(-2),
    masteryTrend: "stable", reviewCount: 2,
    ...over,
  };
}

function snapshot(over: Partial<StudySnapshotResult> = {}): StudySnapshotResult {
  return {
    profileId: "p1", yearOfStudy: 2, major: "CS", institution: null,
    semesterStartDate: null, semesterEndDate: null,
    preferredStudyHoursPerDay: 3, daysSinceJoined: 30,
    activeSession: null,
    subjects: [{ id: "s1", name: "Operating Systems", code: null }],
    studySessions: [], upcomingExams: [],
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
    stateHistory: [], cognitiveState: null, learningDNA: null,
    ...over,
  };
}

function inputs(snap: StudySnapshotResult, topics: TopicMasteryState[], over: Partial<TodayInputs> = {}): TodayInputs {
  const academicState = computeAcademicState({
    semesterStartDate: snap.semesterStartDate, semesterEndDate: snap.semesterEndDate,
    daysSinceJoined: snap.daysSinceJoined, studySessions: snap.studySessions,
    upcomingExams: snap.upcomingExams, stateHistory: snap.stateHistory,
    signals: { detectedSignals: [], stateUpdates: [] },
    mentionedTopicMastery: null, understanding: NO_MESSAGE,
    storedScores: snap.storedScores, storedStreakDays: snap.storedStreakDays,
    storedConsecutiveMisses: snap.storedConsecutiveMisses,
  }, NOW);
  const examContext = selectActiveExam(
    snap.upcomingExams.map(e => ({ id: e.id, title: e.title, subjectName: e.subjectName, scheduledAt: e.scheduledAt, examType: e.examType })),
    {}, NOW,
  );
  const plan = generateStudyPlan(academicState, topics, snap.preferredStudyHoursPerDay, examContext);
  return { snapshot: snap, academicState, topics, examContext, plan, constraints: [], availableMinutes: null, now: NOW, ...over };
}

const session = (over: Partial<ActiveSessionInfo> = {}): ActiveSessionInfo => ({
  id: "sess1", startedAt: new Date(NOW.getTime() - 30 * 60_000),
  topicName: "Deadlocks", subjectId: "s1", subjectName: "Operating Systems",
  status: "in_progress", currentFocus: null, plannedDurationMinutes: 45,
  confusionPoints: [], topicsCompleted: [], pauseCount: 0, totalPausedMinutes: 0, totalPausedSeconds: 0,
  pausedAt: null, energyLevel: null,
  ...over,
});

describe("buildTodayView", () => {
  it("recommends the planning engine's first block and reports the facts behind it", () => {
    const input = inputs(snapshot(), [topic({})]);
    const view  = buildTodayView(input);

    expect(input.plan.today.length).toBeGreaterThan(0);
    const first = input.plan.today[0]!;
    expect(view.recommendation).toMatchObject({
      topicName: first.topicName, subjectName: first.subjectName,
      durationMinutes: first.durationMinutes, urgency: first.urgency, rationale: first.rationale,
    });
    expect(view.emptyReason).toBeNull();
    expect(view.recommendation!.reasons).toEqual(
      expect.arrayContaining(["weak mastery (32%)", "review 2 days overdue"]),
    );
    expect(view.weakArea).toMatchObject({ topicName: "Deadlocks", masteryPercent: 32, reviewDue: true });
    expect(view.reviewDue.count).toBe(1);
  });

  it("explains an empty plan instead of inventing a recommendation", () => {
    const view = buildTodayView(inputs(snapshot(), []));
    expect(view.recommendation).toBeNull();
    expect(view.alternatives).toEqual([]);
    expect(view.emptyReason).toBe("no_topics");
    expect(view.weakArea).toBeNull();
    expect(view.progress.lastSession).toBeNull();
    expect(view.progress.daysSinceLastSession).toBeNull();
  });

  it("says nothing is due when topics exist but the plan is empty", () => {
    const base  = inputs(snapshot(), [topic({})]);
    const empty: StudyPlan = { ...base.plan, today: [], totalMinutesToday: 0 };
    const view  = buildTodayView({ ...base, plan: empty });
    expect(view.recommendation).toBeNull();
    expect(view.emptyReason).toBe(view.plan.mode === "recovery" ? "recovery" : "nothing_due");
  });

  it("surfaces an upcoming exam as the next deadline and as a reason", () => {
    const snap = snapshot({
      upcomingExams: [
        { id: "e2", title: "DBMS quiz", examType: "quiz", scheduledAt: daysFromNow(12), subjectId: null, subjectName: "DBMS" },
        { id: "e1", title: "OS midterm", examType: "midterm", scheduledAt: daysFromNow(6), subjectId: "s1", subjectName: "Operating Systems" },
      ],
    });
    const view = buildTodayView(inputs(snap, [topic({})]));
    expect(view.nextDeadline).toMatchObject({ title: "OS midterm", daysUntil: 6 });
    expect(view.upcoming.map(u => u.title)).toEqual(["OS midterm", "DBMS quiz"]);
    expect(view.recommendation!.reasons).toContain("exam in 6 days");
  });

  it("never changes a block's length: the engine fitted the plan, the page shows it", () => {
    const base = inputs(snapshot(), [topic({})]);
    const view = buildTodayView({ ...base, availableMinutes: 15 });
    // A plan built without a stated time is shown as it is, whatever number
    // arrives beside it. Fitting is the engine's job (see home-planner tests).
    expect(view.recommendation!.durationMinutes).toBe(base.plan.today[0]!.durationMinutes);
    expect(view.plan).toMatchObject({ budgetBasis: "preferred", budgetMinutes: 180 });
  });

  it("reports the running session, excluding paused time", () => {
    const snap = snapshot({ activeSession: session({ totalPausedSeconds: 300 }) });
    const view = buildTodayView(inputs(snap, [topic({})]));
    expect(view.activeSession).toMatchObject({
      id: "sess1", topicName: "Deadlocks", status: "in_progress",
      elapsedMinutes: 25, plannedDurationMinutes: 45,
    });
  });

  it("reports only sessions that happened", () => {
    const snap = snapshot({
      studySessions: [
        { id: "a", sessionDate: daysFromNow(-1), status: "completed", durationMinutes: 42, topicId: null, topicName: "Deadlocks" },
        { id: "b", sessionDate: daysFromNow(-3), status: "completed", durationMinutes: 30, topicId: null, topicName: "Paging" },
        { id: "c", sessionDate: daysFromNow(-2), status: "skipped",   durationMinutes: 0,  topicId: null, topicName: null },
        { id: "d", sessionDate: daysFromNow(-20), status: "completed", durationMinutes: 60, topicId: null, topicName: "Threads" },
      ],
    });
    const view = buildTodayView(inputs(snap, [topic({})]));
    expect(view.progress.sessionsThisWeek).toBe(2);
    expect(view.progress.minutesThisWeek).toBe(72);
    expect(view.progress.lastSession).toMatchObject({ topicName: "Deadlocks", minutes: 42 });
    expect(view.progress.daysSinceLastSession).toBe(1);
  });

  it("carries the learner's name and goals through untouched", () => {
    const view = buildTodayView(inputs(snapshot(), [], { learnerName: "Arman", goals: ["Clear OS with an A"] }));
    expect(view.learnerName).toBe("Arman");
    expect(view.goals).toEqual(["Clear OS with an A"]);
    expect(buildTodayView(inputs(snapshot(), [])).learnerName).toBeNull();
  });
});

describe("session view", () => {
  it("counts study time, not wall time", () => {
    expect(sessionElapsedSeconds(session(), NOW)).toBe(30 * 60);
    expect(sessionElapsedSeconds(session({ totalPausedSeconds: 600 }), NOW)).toBe(20 * 60);
  });

  it("stops the clock while paused", () => {
    const paused = session({ status: "paused", pausedAt: new Date(NOW.getTime() - 12 * 60_000) });
    expect(sessionElapsedSeconds(paused, NOW)).toBe(18 * 60);
    expect(sessionElapsedSeconds(paused, new Date(NOW.getTime() + 3_600_000))).toBe(18 * 60);
    expect(toSessionView(paused, NOW)).toMatchObject({ status: "paused", elapsedSeconds: 18 * 60 });
  });

  it("never goes negative", () => {
    expect(sessionElapsedSeconds(session({ totalPausedSeconds: 99_999 }), NOW)).toBe(0);
  });
});

describe("session commands", () => {
  it("parses a start command and clamps the planned length", () => {
    expect(parseSessionCommand({ action: "start", topicName: "  Deadlocks ", subjectName: "Operating Systems", plannedMinutes: 40 }))
      .toEqual({ action: "start", topicName: "Deadlocks", subjectName: "Operating Systems", plannedMinutes: 40 });
    expect(parseSessionCommand({ action: "start", topicName: "x", plannedMinutes: 9999 }))
      .toMatchObject({ plannedMinutes: 240, subjectName: null });
    expect(parseSessionCommand({ action: "start", topicName: "x", plannedMinutes: 1 })).toMatchObject({ plannedMinutes: 5 });
    expect(parseSessionCommand({ action: "start", topicName: "x" })).toMatchObject({ plannedMinutes: null });
  });

  it("parses the learner's answer on an end command, and treats anything else as no answer", () => {
    expect(parseSessionCommand({ action: "end", outcome: "struggled" })).toEqual({ action: "end", outcome: "struggled" });
    expect(parseSessionCommand({ action: "end", outcome: "crushed_it" })).toEqual({ action: "end", outcome: "crushed_it" });
    expect(parseSessionCommand({ action: "end" })).toEqual({ action: "end", outcome: null });
    expect(parseSessionCommand({ action: "end", outcome: "amazing" })).toEqual({ action: "end", outcome: null });
    expect(parseSessionCommand({ action: "end", outcome: 0.99 })).toEqual({ action: "end", outcome: null });
  });

  it("rejects anything that is not a command", () => {
    expect(parseSessionCommand(null)).toBeNull();
    expect(parseSessionCommand("start")).toBeNull();
    expect(parseSessionCommand({ action: "delete" })).toBeNull();
    expect(parseSessionCommand({ action: "start", topicName: "   " })).toBeNull();
    expect(parseSessionCommand({ action: "start", topicName: 42 })).toBeNull();
  });

  it("allows one session at a time", () => {
    const start = { action: "start", topicName: "x", subjectName: null, plannedMinutes: null } as const;
    expect(checkSessionCommand(start, null).verdict).toBe("apply");
    expect(checkSessionCommand(start, { status: "in_progress" }).verdict).toBe("noop");
  });

  it("needs a running session to pause, resume or end", () => {
    for (const command of [{ action: "pause" }, { action: "resume" }, { action: "end", outcome: null }] as const) {
      expect(checkSessionCommand(command, null)).toMatchObject({ verdict: "reject", error: "no_active_session" });
    }
  });

  it("treats a repeated pause or resume as already done", () => {
    expect(checkSessionCommand({ action: "pause" },  { status: "in_progress" }).verdict).toBe("apply");
    expect(checkSessionCommand({ action: "pause" },  { status: "paused" }).verdict).toBe("noop");
    expect(checkSessionCommand({ action: "resume" }, { status: "paused" }).verdict).toBe("apply");
    expect(checkSessionCommand({ action: "resume" }, { status: "in_progress" }).verdict).toBe("noop");
    expect(checkSessionCommand({ action: "end", outcome: "good" }, { status: "paused" }).verdict).toBe("apply");
  });
});
