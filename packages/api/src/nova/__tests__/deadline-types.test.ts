// A dated thing a learner is working toward is one record with a type. The
// type says what it is and how far it may shape a day. One planner reads all
// of them; exams behave exactly as they did before types existed.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  DEADLINE_RULES, DEADLINE_TYPES, deadlineType, parseDeadlineType, preparesTopics, takesOverTheDay, type DeadlineType,
} from "../product/deadline-types";
import { checkExamChange } from "../product/exams";
import { normalizeSetupDraft } from "../product/setup";
import { computeAcademicState } from "../engines/academic-state-engine";
import { selectActiveExam } from "../engines/exam-engine";
import { generateStudyPlan } from "../engines/planning-engine";
import { buildPlannerView } from "../product/planner";
import { buildTodayView } from "../product/today";
import type { PlanningInputs } from "../product/planning-inputs";
import type { StudySnapshotResult } from "../engines/study-snapshot";
import type { TopicMasteryState } from "../types/engine.types";
import type { AcademicUnderstanding } from "../types/understanding.types";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
// A fixed hour of today, so "in N days" (calendar days) does not depend on
// the time of day the suite runs at.
const NOW = (() => { const d = new Date(); d.setUTCHours(20, 0, 0, 0); return d; })();
const daysFromNow = (d: number) => new Date(NOW.getTime() + d * 86_400_000);
const NO_MESSAGE: AcademicUnderstanding = {
  intent: "general_chat", emotion: "neutral", topic: null, topicConfidence: 0,
  disclosureClass: "none", ambiguityScore: 0, routingSignal: "coaching_only", rawText: "",
};

const topics: TopicMasteryState[] = [1, 2, 3].map(i => ({
  topicId: `t${i}`, topicName: `Part ${i}`, subjectName: "System design",
  masteryProbability: 0, lastStudied: null, retentionEstimate: 0, confidenceReported: 0, calibrationGap: 0,
  reviewDueAt: null, masteryTrend: "stable", reviewCount: 0,
}));

// The same routing the loaders use (planning-inputs.ts): which dates reach
// the academic state, and which the exam engine.
function inputs(examType: string, inDays: number): PlanningInputs {
  const snapshot: StudySnapshotResult = {
    profileId: "p1", yearOfStudy: null, major: null, institution: null, semesterStartDate: null, semesterEndDate: null,
    preferredStudyHoursPerDay: 1, dailyMinutesStated: 60, daysSinceJoined: 30, activeSession: null,
    subjects: [{ id: "s1", name: "System design", code: null }], studySessions: [],
    upcomingExams: [{ id: "e1", title: "The date", examType, scheduledAt: daysFromNow(inDays - 0.5), subjectId: "s1", subjectName: "System design" }],
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0, stateHistory: [], cognitiveState: null, learningDNA: null,
  };
  const academicState = computeAcademicState({
    semesterStartDate: null, semesterEndDate: null, daysSinceJoined: 30, studySessions: [],
    upcomingExams: snapshot.upcomingExams.filter(takesOverTheDay), stateHistory: [],
    signals: { detectedSignals: [], stateUpdates: [] }, mentionedTopicMastery: null, understanding: NO_MESSAGE,
    storedScores: null, storedStreakDays: 0, storedConsecutiveMisses: 0,
  }, NOW);
  const examContext = selectActiveExam(
    snapshot.upcomingExams.filter(preparesTopics).map(e => ({ id: e.id, title: e.title, subjectName: e.subjectName, scheduledAt: e.scheduledAt, examType: e.examType })),
    {}, NOW,
  );
  const plan = generateStudyPlan(academicState, topics, 1, examContext, { now: NOW });
  return { snapshot, academicState, topics, examContext, plan, constraints: [], goals: [], timezone: "UTC", preferredStudyTime: null, now: NOW, availableMinutes: null };
}

describe("the types", () => {
  it("are six, and each has a word, a default name and a defined effect on the plan", () => {
    expect(DEADLINE_TYPES).toEqual(["exam", "assignment", "project", "interview", "certification", "other"]);
    for (const type of DEADLINE_TYPES) {
      const rule = DEADLINE_RULES[type];
      expect([type, rule.label.length > 2, rule.titleSuffix.length > 2]).toEqual([type, true, true]);
      expect(typeof rule.preparesTopics).toBe("boolean");
      // Nothing takes over a day that the planner does not prepare for.
      if (rule.takesOverTheDay) expect(rule.preparesTopics).toBe(true);
    }
  });

  it("what each type may do to a day", () => {
    const effect = (t: DeadlineType) => [DEADLINE_RULES[t].preparesTopics, DEADLINE_RULES[t].takesOverTheDay];
    expect(effect("exam")).toEqual([true, true]);
    expect(effect("certification")).toEqual([true, true]);
    expect(effect("interview")).toEqual([true, false]);
    for (const t of ["assignment", "project", "other"] as DeadlineType[]) expect(effect(t)).toEqual([false, false]);
  });

  it("every row stored before types existed is an exam", () => {
    for (const stored of ["exam", "midterm", "final", "quiz", "", "Exam", "anything", null, undefined]) expect(deadlineType(stored)).toBe("exam");
    expect(deadlineType("interview")).toBe("interview");
  });

  it("a type from a request is one of the six or nothing", () => {
    expect(parseDeadlineType("project")).toBe("project");
    for (const bad of ["midterm", "add_exam", "Exam", "", null, undefined, 3, {}]) expect(parseDeadlineType(bad)).toBeNull();
  });

  it("each says why a block is on the plan in its own words", () => {
    expect(DEADLINE_RULES.exam.reason(6)).toBe("exam in 6 days");
    expect(DEADLINE_RULES.exam.reason(1)).toBe("exam tomorrow");
    expect(DEADLINE_RULES.exam.reason(0)).toBe("exam today");
    expect(DEADLINE_RULES.interview.reason(3)).toBe("interview in 3 days");
    expect(DEADLINE_RULES.certification.reason(1)).toBe("certification test tomorrow");
    expect(DEADLINE_RULES.assignment.reason(2)).toBe("assignment due in 2 days");
  });
});

describe("how each type shapes the plan", () => {
  it("an exam two days away takes the whole day, as before", () => {
    const i = inputs("exam", 2);
    expect(i.academicState.hardDirectives.examCrisisMode).toBe(true);
    expect(i.plan.today.length).toBeGreaterThan(0);
    expect(i.plan.today.every(b => b.activityType === "exam_prep")).toBe(true);
    expect(buildPlannerView(i).reasoning.mode).toBe("exam_crisis");
    expect(buildTodayView(i).recommendation!.reasons).toContain("exam in 2 days");
  });

  it("a row with an old type value behaves as that same exam", () => {
    const i = inputs("midterm", 2);
    expect(i.academicState.hardDirectives.examCrisisMode).toBe(true);
    expect(buildTodayView(i).upcoming[0]).toMatchObject({ examType: "midterm", kind: "exam", kindLabel: "Exam" });
  });

  it("a certification is prepared for the same way, and named as one", () => {
    const i = inputs("certification", 2);
    expect(i.academicState.hardDirectives.examCrisisMode).toBe(true);
    expect(buildTodayView(i).recommendation!.reasons).toContain("certification test in 2 days");
  });

  it("an interview is prepared for but never takes over the day", () => {
    const i = inputs("interview", 2);
    expect(i.academicState.hardDirectives.examCrisisMode).toBe(false);
    expect(i.examContext?.examTitle).toBe("The date");
    expect(i.plan.today.some(b => b.activityType === "exam_prep")).toBe(true);
    expect(buildPlannerView(i).reasoning.mode).toBe("standard");
    const today = buildTodayView(i);
    expect(today.recommendation!.reasons).toContain("interview in 2 days");
    expect(today.recommendation!.reasons.join(" ")).not.toContain("exam");
  });

  it.each(["assignment", "project", "other"])("a %s changes no study block: it is a date, shown and counted down", type => {
    const dated = inputs(type, 2);
    const plain = { ...dated, plan: generateStudyPlan(dated.academicState, topics, 1, null, { now: NOW }) };
    expect(dated.examContext).toBeNull();
    expect(dated.academicState.hardDirectives.examCrisisMode).toBe(false);
    expect(dated.plan.today).toEqual(plain.plan.today);
    expect(dated.plan.today.some(b => b.activityType === "exam_prep")).toBe(false);
    expect(dated.plan.shortfall).toBeNull();
    const planner = buildPlannerView(dated);
    expect(planner.pressure[0]).toMatchObject({ kind: type, kindLabel: DEADLINE_RULES[type as DeadlineType].label, drivesPlan: false, preparation: null });
    expect(buildTodayView(dated).upcoming[0]).toMatchObject({ kind: type, title: "The date" });
    expect(buildTodayView(dated).recommendation!.reasons.join(" ")).not.toContain("exam");
  });

  it("the loaders and the chat turn route dates the same way", () => {
    for (const file of ["product/planning-inputs.ts", "nova-orchestrator.ts"]) {
      const source = read(file);
      expect([file, source.includes("snapshot.upcomingExams.filter(takesOverTheDay)")]).toEqual([file, true]);
      expect([file, source.includes("snapshot.upcomingExams.filter(preparesTopics).map(")]).toEqual([file, true]);
    }
    // There is still one planner and one table.
    expect(read("product/deadline-types.ts")).not.toContain("import ");
  });
});

describe("giving and changing a type", () => {
  const OS = { title: "OS exam", date: "2026-10-20", subjectId: "s1", type: "exam" as DeadlineType };
  const check = (input: unknown) => checkExamChange(OS, [], input, "2026-10-14", new Date("2026-10-14T08:00:00Z"));

  it("a change may set the kind, alone or with the rest", () => {
    expect(check({ type: "interview" })).toEqual({ ok: true, changed: true, change: { title: "OS exam", date: "2026-10-20", type: "interview" } });
    expect(check({ type: "exam" })).toMatchObject({ ok: true, changed: false });
  });

  it("a kind that is not one of the six is refused, and nothing changes", () => {
    for (const type of ["midterm", "add_exam", "", null, 4]) expect(check({ type })).toEqual({ ok: false, reason: "invalid" });
  });

  it("setup accepts a kind on a date, keeps it out when none is given, and refuses an unknown one", () => {
    const draft = (exam: Record<string, unknown>) => normalizeSetupDraft({ subjects: [{ name: "SQL", topics: ["Joins"] }], exams: [{ subjectName: "SQL", date: "2026-11-01", ...exam }] }, "2026-10-14");
    expect(draft({ type: "certification" }).draft.exams).toEqual([{ subjectName: "SQL", date: "2026-11-01", title: null, type: "certification" }]);
    expect(draft({}).draft.exams).toEqual([{ subjectName: "SQL", date: "2026-11-01", title: null }]);
    const bad = draft({ type: "viva" });
    expect(bad.draft.exams).toEqual([]);
    expect(bad.issues).toEqual([{ field: "exams", message: "The SQL date has a kind Nova doesn't know." }]);
  });

  it("the stored kind is never taken from an action's own name", () => {
    const exams = read("product/exams.ts");
    expect(exams).toContain('examType: parseDeadlineType(input.kind) ?? "exam", scheduledAt: at },');
    expect(exams).not.toContain("input.type");
    // Telegram's add_exam action goes to addExam whole; its `type` is "add_exam".
    expect(read("telegram/telegram-actions.ts")).toContain("const result = await addExam(ctx.chatId, action, ctx.now);");
  });

  it("a date saved without a name is named for its kind", () => {
    expect(read("product/setup.ts")).toContain("const suffix = e.type ? DEADLINE_RULES[e.type].titleSuffix : dateSuffix;");
  });
});

describe("what Nova says about a date that is close", () => {
  it("the model is told to use the name on record and not to call it an exam unless the facts do", () => {
    const response = read("proactive/nova-proactive-response.ts");
    expect(response).toContain("do not call it an exam unless the facts do");
    expect(response).toContain('exam_countdown:       "Coming up.",');
  });
});

// ── A rough pace toward a date ────────────────────────────────────────────────

import { paceProjection } from "../product/pace";

describe("the pace projection", () => {
  const unstarted = (n: number) => Array.from({ length: n }, () => ({ masteryProbability: 0, reviewCount: 0 }));
  const solid     = (n: number) => Array.from({ length: n }, () => ({ masteryProbability: 0.8, reviewCount: 3 }));

  it("the audit's case: 40 topics, 20 days", () => {
    const pace = paceProjection({ topics: unstarted(40), daysUntil: 20, dailyMinutes: 60, dailyMinutesStated: true })!;
    // 40 topics at 30 min is 1200; 20 days at 60 is 1200: it just fits.
    expect(pace).toMatchObject({ topicsTotal: 40, topicsRemaining: 40, studyDays: 20, minutesNeeded: 1200, minutesAvailable: 1200, minutesPerDayNeeded: 60, fits: true });
    expect(pace.summary).toBe("40 of 40 topics not at a solid level yet. Covering them by then takes about 60 min a day; your usual day is 60 min, so there is room.");
  });

  it("says plainly when it does not fit, and by how much a day", () => {
    const pace = paceProjection({ topics: unstarted(40), daysUntil: 10, dailyMinutes: 60, dailyMinutesStated: true })!;
    expect(pace).toMatchObject({ fits: false, minutesPerDayNeeded: 120, minutesAvailable: 600 });
    expect(pace.summary).toBe("40 of 40 topics not at a solid level yet. Covering them by then would take about 120 min a day, and your usual day is 60 min. As things stand they do not all fit.");
  });

  it("counts only what is not yet solid, and says so when nothing is left", () => {
    expect(paceProjection({ topics: [...solid(3), ...unstarted(2)], daysUntil: 5, dailyMinutes: 30, dailyMinutesStated: true }))
      .toMatchObject({ topicsTotal: 5, topicsRemaining: 2, minutesNeeded: 60, fits: true });
    const done = paceProjection({ topics: solid(3), daysUntil: 5, dailyMinutes: 30, dailyMinutesStated: true })!;
    expect(done.summary).toBe("All 3 topics are at a solid level by your own ratings. Nothing is left to pace.");
  });

  it("always says what it assumed, and that the daily figure is a guess when it is one", () => {
    const stated  = paceProjection({ topics: unstarted(4), daysUntil: 9, dailyMinutes: 45, dailyMinutesStated: true })!;
    const guessed = paceProjection({ topics: unstarted(4), daysUntil: 9, dailyMinutes: 180, dailyMinutesStated: false })!;
    expect(stated.assumptions).toEqual([
      "30 min for each topic, all counted as equal: Nova has no record of how large each one is or how much it counts.",
      "Every day until then, with all of each day's time going to this. Your other subjects share those days.",
    ]);
    expect(guessed.assumptions[2]).toBe("180 min a day is a guess: you haven't said what you usually have.");
  });

  it("says nothing when there is nothing on record to pace, or the date has passed", () => {
    expect(paceProjection({ topics: [], daysUntil: 9, dailyMinutes: 60, dailyMinutesStated: true })).toBeNull();
    expect(paceProjection({ topics: unstarted(2), daysUntil: -1, dailyMinutes: 60, dailyMinutesStated: true })).toBeNull();
    // A date today still has today.
    expect(paceProjection({ topics: unstarted(2), daysUntil: 0, dailyMinutes: 60, dailyMinutesStated: true })).toMatchObject({ studyDays: 1 });
  });

  it("is on the Planner for a date the planner prepares for, and absent for an assignment or a project", () => {
    expect(buildPlannerView(inputs("exam", 20)).pressure[0]).toMatchObject({ prepares: true, pace: { topicsRemaining: 3, fits: true } });
    expect(buildPlannerView(inputs("interview", 20)).pressure[0]!.pace).not.toBeNull();
    expect(buildPlannerView(inputs("project", 20)).pressure[0]).toMatchObject({ prepares: false, pace: null });
  });

  it("is read-only: it reads no table, writes nothing and the plan does not read it", () => {
    const pace = read("product/pace.ts");
    expect(pace).not.toContain("prisma");
    expect(pace).not.toContain("generateOpenAIText");
    for (const file of ["engines/planning-engine.ts", "product/planning-inputs.ts", "decision/proactive-decision.ts"]) {
      expect([file, read(file).includes("paceProjection")]).toEqual([file, false]);
    }
  });
});
