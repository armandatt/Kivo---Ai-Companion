// The Planner contract: buildPlannerView arranges what the engines produced
// and reports the facts behind it. It plans nothing and invents nothing.

import { buildPlannerView, dayKey, weekOf } from "../product/planner";
import type { PlanningInputs } from "../product/planning-inputs";
import { computeAcademicState } from "../engines/academic-state-engine";
import { generateStudyPlan } from "../engines/planning-engine";
import { selectActiveExam } from "../engines/exam-engine";
import type { ActiveSessionInfo, StudySnapshotResult } from "../engines/study-snapshot";
import type { AcademicState } from "../types/academic-state.types";
import type { TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

// The engines read the wall clock for "overdue", so the fixtures are built
// around the real now.
const NOW = new Date();
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

const TOPICS = [
  topic({}),
  topic({ topicId: "t2", topicName: "Paging", masteryProbability: 0.6, retentionEstimate: 0.9, reviewDueAt: daysFromNow(9) }),
  topic({ topicId: "t3", topicName: "Normalization", subjectName: "DBMS", masteryProbability: 0.55, retentionEstimate: 0.9, reviewDueAt: daysFromNow(9) }),
];

function snapshot(over: Partial<StudySnapshotResult> = {}): StudySnapshotResult {
  return {
    profileId: "p1", yearOfStudy: 2, major: "CS", institution: null,
    semesterStartDate: null, semesterEndDate: null,
    preferredStudyHoursPerDay: 3, daysSinceJoined: 60,
    activeSession: null,
    subjects: [{ id: "s1", name: "Operating Systems", code: null }, { id: "s2", name: "DBMS", code: null }],
    studySessions: [], upcomingExams: [],
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
    stateHistory: [], cognitiveState: null, learningDNA: null,
    ...over,
  };
}

function inputs(
  snap: StudySnapshotResult,
  topics: TopicMasteryState[],
  opts: { availableMinutes?: number | null; state?: (s: AcademicState) => AcademicState; over?: Partial<PlanningInputs> } = {},
): PlanningInputs & { availableMinutes: number | null } {
  let academicState = computeAcademicState({
    semesterStartDate: null, semesterEndDate: null, daysSinceJoined: snap.daysSinceJoined,
    studySessions: snap.studySessions, upcomingExams: snap.upcomingExams, stateHistory: [],
    signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding: NO_MESSAGE,
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
  }, NOW);
  if (opts.state) academicState = opts.state(academicState);
  const examContext = selectActiveExam(
    snap.upcomingExams.map(e => ({ id: e.id, title: e.title, subjectName: e.subjectName, scheduledAt: e.scheduledAt, examType: e.examType })),
    {}, NOW,
  );
  const availableMinutes = opts.availableMinutes ?? null;
  const plan = generateStudyPlan(academicState, topics, snap.preferredStudyHoursPerDay, examContext, { availableMinutes });
  return {
    snapshot: snap, academicState, topics, examContext, plan, constraints: [], goals: [],
    timezone: "UTC", preferredStudyTime: null, now: NOW, availableMinutes, ...opts.over,
  };
}

const session = (over: Partial<ActiveSessionInfo> = {}): ActiveSessionInfo => ({
  id: "sess1", startedAt: new Date(NOW.getTime() - 20 * 60_000),
  topicName: "Deadlocks", subjectId: "s1", subjectName: "Operating Systems",
  status: "in_progress", currentFocus: null, plannedDurationMinutes: 25,
  confusionPoints: [], topicsCompleted: [], pauseCount: 0, totalPausedMinutes: 0, totalPausedSeconds: 0,
  pausedAt: null, energyLevel: null,
  ...over,
});

const completed = (id: string, daysAgo: number, topicName: string, minutes: number) =>
  ({ id, sessionDate: daysFromNow(-daysAgo), status: "completed", durationMinutes: minutes, topicId: null, topicName });

// ── The Planning Engine and a stated time budget ──────────────────────────────

describe("planning engine time budget", () => {
  const base = () => inputs(snapshot(), TOPICS);

  it("plans from the student's usual hours when no time is stated", () => {
    const { plan } = base();
    expect(plan).toMatchObject({ budgetMinutes: 180, budgetBasis: "preferred" });
    expect(plan.totalMinutesToday).toBeLessThanOrEqual(180);
  });

  it("refits the whole day to the time the student has", () => {
    const usual = base().plan;
    const short = inputs(snapshot(), TOPICS, { availableMinutes: 30 }).plan;
    expect(short).toMatchObject({ budgetMinutes: 30, budgetBasis: "stated_time" });
    expect(short.totalMinutesToday).toBeLessThanOrEqual(30);
    expect(short.totalMinutesToday).toBeLessThan(usual.totalMinutesToday);
    expect(short.today.length).toBeLessThan(usual.today.length);
    expect(short.today[0]!.topicName).toBe(usual.today[0]!.topicName);   // same priorities, less of them
  });

  it("does not let a stated time lift a wellbeing cap", () => {
    const tired = (s: AcademicState): AcademicState =>
      ({ ...s, hardDirectives: { ...s.hardDirectives, noStudyPressure: true } });
    const plan = inputs(snapshot(), TOPICS, { availableMinutes: 240, state: tired }).plan;
    expect(plan).toMatchObject({ budgetMinutes: 30, budgetBasis: "no_pressure" });
  });
});

// ── Today ─────────────────────────────────────────────────────────────────────

describe("buildPlannerView: today", () => {
  it("lists exactly the engine's blocks, in the engine's order", () => {
    const input = inputs(snapshot(), TOPICS);
    const view  = buildPlannerView(input);

    expect(input.plan.today.length).toBeGreaterThan(1);
    expect(view.today.blocks.map(b => [b.topicName, b.subjectName, b.durationMinutes, b.activityType, b.urgency, b.rationale]))
      .toEqual(input.plan.today.map(b => [b.topicName, b.subjectName, b.durationMinutes, b.activityType, b.urgency, b.rationale]));
    expect(view.today.blocks.map(b => b.order)).toEqual(input.plan.today.map((_, i) => i + 1));
    expect(view.today.blocks.every(b => b.status === "planned" && !b.trimmedToFit)).toBe(true);
    expect(view.today.emptyReason).toBeNull();
  });

  it("gives each block the facts behind it", () => {
    const view = buildPlannerView(inputs(snapshot(), TOPICS));
    const deadlocks = view.today.blocks.find(b => b.topicName === "Deadlocks")!;
    expect(deadlocks.reasons).toEqual(expect.arrayContaining(["weak mastery (32%)", "review 2 days overdue"]));
    // A topic that is not overdue is not described as overdue.
    const paging = view.today.blocks.find(b => b.topicName === "Paging")!;
    expect(paging.reasons.some(r => r.includes("overdue"))).toBe(false);
    expect(paging.reasons).toContain("developing (60%)");
  });

  it("marks the block the running session is on, and no other", () => {
    const view = buildPlannerView(inputs(snapshot({ activeSession: session() }), TOPICS));
    const running = view.today.blocks.filter(b => b.status !== "planned");
    expect(running).toHaveLength(1);
    expect(running[0]).toMatchObject({ topicName: "Deadlocks", status: "in_progress" });
    expect(view.today.activeBlockId).toBe(running[0]!.id);
    expect(view.today.activeSession).toMatchObject({ id: "sess1", elapsedMinutes: 20, plannedDurationMinutes: 25 });
  });

  it("reports a session that is not one of today's blocks without attaching it to one", () => {
    const view = buildPlannerView(inputs(snapshot({ activeSession: session({ topicName: "Compilers", subjectName: null, subjectId: null }) }), TOPICS));
    expect(view.today.activeSession).toMatchObject({ topicName: "Compilers" });
    expect(view.today.activeBlockId).toBeNull();
    expect(view.today.blocks.every(b => b.status === "planned")).toBe(true);
  });

  it("shows a paused session as paused", () => {
    const paused = session({ status: "paused", pausedAt: new Date(NOW.getTime() - 5 * 60_000) });
    const view = buildPlannerView(inputs(snapshot({ activeSession: paused }), TOPICS));
    expect(view.today.blocks.find(b => b.topicName === "Deadlocks")!.status).toBe("paused");
    expect(view.today.activeSession).toMatchObject({ status: "paused", elapsedMinutes: 15 });
  });

  it("lists what was completed today from recorded sessions only", () => {
    const snap = snapshot({ studySessions: [completed("a", 0, "Deadlocks", 25), completed("b", 3, "Paging", 30)] });
    const view = buildPlannerView(inputs(snap, TOPICS));
    expect(view.today.done).toEqual([{ id: "a", topicName: "Deadlocks", status: "completed", minutes: 25 }]);
    expect(view.today.doneMinutes).toBe(25);
  });
});

// ── Not knowing ───────────────────────────────────────────────────────────────

describe("buildPlannerView: what Nova does not know", () => {
  it("plans nothing and says why when there are no topics", () => {
    const view = buildPlannerView(inputs(snapshot(), []));
    expect(view.today.blocks).toEqual([]);
    expect(view.today.emptyReason).toBe("no_topics");
    expect(view.reasoning.subjects).toEqual([]);
    expect(view.reasoning.budget.plannedMinutes).toBe(0);
    expect(view.pressure).toEqual([]);
    expect(view.goals).toEqual([]);
    expect(view.unknowns).toEqual(["no_topics", "no_exams", "no_goals", "no_sessions"]);
    expect(view.week.every(d => d.sessions.length === 0 && d.planned.length === 0 && d.reviewsDue.length === 0 && d.exams.length === 0)).toBe(true);
  });

  it("reports only the gaps that exist", () => {
    const snap = snapshot({
      studySessions: [completed("a", 1, "Deadlocks", 25)],
      upcomingExams: [{ id: "e1", title: "OS midterm", examType: "midterm", scheduledAt: daysFromNow(20), subjectId: "s1", subjectName: "Operating Systems" }],
    });
    const view = buildPlannerView(inputs(snap, TOPICS, { over: { goals: ["Clear OS with an A"] } }));
    expect(view.unknowns).toEqual([]);
    expect(view.goals).toEqual(["Clear OS with an A"]);
  });

  it("does not judge readiness for an exam whose subject has no tracked topics", () => {
    const snap = snapshot({
      upcomingExams: [
        { id: "e1", title: "OS midterm", examType: "midterm", scheduledAt: daysFromNow(6), subjectId: "s1", subjectName: "Operating Systems" },
        { id: "e2", title: "CN quiz", examType: "quiz", scheduledAt: daysFromNow(10), subjectId: null, subjectName: "Computer Networks" },
        { id: "e3", title: "Viva", examType: "viva", scheduledAt: daysFromNow(12), subjectId: null, subjectName: null },
      ],
    });
    const view = buildPlannerView(inputs(snap, TOPICS));
    const [os, cn, viva] = view.pressure;
    expect(os).toMatchObject({ title: "OS midterm", daysUntil: 6, drivesPlan: true });
    expect(os!.preparation).toMatchObject({ weak: ["Deadlocks"], developing: ["Paging"], solid: [], focusTopic: "Deadlocks" });
    expect(cn).toMatchObject({ title: "CN quiz", drivesPlan: false, preparation: null });
    expect(viva).toMatchObject({ title: "Viva", preparation: null });
  });
});

// ── Reasoning ─────────────────────────────────────────────────────────────────

describe("buildPlannerView: reasoning", () => {
  it("accounts for every planned minute by subject, with that subject's evidence", () => {
    const view = buildPlannerView(inputs(snapshot(), TOPICS));
    const { subjects, budget } = view.reasoning;

    expect(subjects.reduce((sum, s) => sum + s.minutes, 0)).toBe(budget.plannedMinutes);
    expect(budget.plannedMinutes).toBe(view.today.blocks.reduce((sum, b) => sum + b.durationMinutes, 0));
    expect(subjects.map(s => s.subjectName)).toEqual(["Operating Systems", "DBMS"]);   // most time first

    for (const s of subjects) {
      const fromBlocks = view.today.blocks.filter(b => b.subjectName === s.subjectName).flatMap(b => b.reasons);
      expect(s.reasons.length).toBeGreaterThan(0);
      for (const r of s.reasons) expect(fromBlocks).toContain(r);   // no reason the blocks do not carry
    }
  });

  it("names no adjustment when the plan is the usual day", () => {
    const calm = [topic({ reviewDueAt: daysFromNow(5), retentionEstimate: 0.9, masteryProbability: 0.6 })];
    const view = buildPlannerView(inputs(snapshot(), calm));
    expect(view.reasoning).toMatchObject({ mode: "standard", adjustments: [] });
    expect(view.reasoning.budget).toMatchObject({ basis: "preferred", minutes: 180, usualMinutes: 180 });
  });

  it("says overdue reviews come first when they do", () => {
    const view = buildPlannerView(inputs(snapshot(), TOPICS));
    expect(view.reasoning.adjustments).toEqual([{ kind: "overdue_first", text: "1 overdue review comes before anything else." }]);
  });

  it("says the plan was fitted to the stated time", () => {
    const view = buildPlannerView(inputs(snapshot(), TOPICS, { availableMinutes: 30 }));
    expect(view.availableMinutes).toBe(30);
    expect(view.reasoning.budget).toMatchObject({ basis: "stated_time", minutes: 30, usualMinutes: 180 });
    expect(view.reasoning.adjustments[0]).toEqual({ kind: "stated_time", text: "Fitted to the 30 min you said you have today." });
  });

  it("explains a raised day by the exam that raised it", () => {
    const snap = snapshot({
      upcomingExams: [{ id: "e1", title: "OS midterm", examType: "midterm", scheduledAt: daysFromNow(6.5), subjectId: "s1", subjectName: "Operating Systems" }],
    });
    const view = buildPlannerView(inputs(snap, TOPICS));
    expect(view.reasoning.budget.basis).toBe("exam_ramp");
    expect(view.reasoning.budget.minutes).toBeGreaterThan(180);
    expect(view.reasoning.adjustments[0]!.kind).toBe("exam_ramp");
    expect(view.reasoning.adjustments[0]!.text).toBe(
      `OS midterm is in 7 days: study time is raised from 180 to ${view.reasoning.budget.minutes} min.`,
    );
  });

  it("explains a recovery day by the missed days behind it", () => {
    const recovering = (s: AcademicState): AcademicState =>
      ({ ...s, consecutiveMisses: 6, hardDirectives: { ...s.hardDirectives, recoveryMode: true } });
    const view = buildPlannerView(inputs(snapshot(), TOPICS, { state: recovering }));
    expect(view.reasoning.mode).toBe("recovery");
    expect(view.reasoning.adjustments[0]).toEqual({
      kind: "recovery", text: "Cut from 180 to 60 min: 6 planned days were missed in a row.",
    });
    expect(view.today.blocks.length).toBeLessThanOrEqual(1);
  });
});

// ── This week ─────────────────────────────────────────────────────────────────

describe("buildPlannerView: this week", () => {
  it("is Monday to Sunday around today", () => {
    expect(weekOf("2026-10-07")).toEqual(["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-08", "2026-10-09", "2026-10-10", "2026-10-11"]);
    expect(weekOf("2026-10-11")[0]).toBe("2026-10-05");   // Sunday belongs to the week that started Monday
    expect(weekOf("2026-10-05")[0]).toBe("2026-10-05");
  });

  it("draws day boundaries in the student's timezone", () => {
    const lateUtc = new Date("2026-10-05T20:00:00Z");
    expect(dayKey(lateUtc, "UTC")).toBe("2026-10-05");
    expect(dayKey(lateUtc, "Asia/Kolkata")).toBe("2026-10-06");
  });

  it("shows records in the past, the plan today, and only scheduled reviews ahead", () => {
    const today = dayKey(NOW, "UTC");
    const week  = weekOf(today);
    const snap  = snapshot({
      studySessions: week.filter(d => d < today).map((d, i) => ({
        id: `p${i}`, sessionDate: new Date(`${d}T10:00:00Z`), status: "completed", durationMinutes: 30, topicId: null, topicName: "Paging",
      })),
    });
    const future = week.filter(d => d > today);
    const topics = [
      ...TOPICS,
      ...future.slice(0, 1).map(d => topic({ topicId: "t9", topicName: "Scheduling", reviewDueAt: new Date(`${d}T09:00:00Z`), retentionEstimate: 0.9, masteryProbability: 0.9 })),
    ];
    const view = buildPlannerView(inputs(snap, topics));

    expect(view.week.map(d => d.date)).toEqual(week);
    for (const day of view.week) {
      if (day.relation === "past") {
        expect(day.sessions).toHaveLength(1);
        expect(day.planned).toEqual([]);
        expect(day.reviewsDue).toEqual([]);
      } else if (day.relation === "today") {
        expect(day.planned.map(p => p.topicName)).toEqual(view.today.blocks.map(b => b.topicName));
      } else {
        expect(day.sessions).toEqual([]);
        expect(day.planned).toEqual([]);   // the engine has not planned this day; nothing is made up for it
      }
    }
    if (future.length > 0) {
      const day = view.week.find(d => d.date === future[0])!;
      expect(day.reviewsDue).toEqual([{ topicName: "Scheduling", subjectName: "Operating Systems" }]);
      expect(day.reviewsDueCount).toBe(1);
    }
  });

  it("places an exam on its day", () => {
    const today = dayKey(NOW, "UTC");
    const last  = weekOf(today)[6]!;
    const snap  = snapshot({
      upcomingExams: [{ id: "e1", title: "OS midterm", examType: "midterm", scheduledAt: new Date(`${last}T23:00:00Z`), subjectId: "s1", subjectName: "Operating Systems" }],
    });
    // On a Sunday evening the exam may already be past; then there is nothing to place.
    if (snap.upcomingExams[0]!.scheduledAt <= NOW) return;
    const view = buildPlannerView(inputs(snap, TOPICS));
    expect(view.week.find(d => d.date === last)!.exams).toEqual([{ title: "OS midterm", subjectName: "Operating Systems" }]);
  });
});
