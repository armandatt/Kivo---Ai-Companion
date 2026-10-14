// Getting back on track: where the learner is, what changes by itself, and
// what waits for their yes. Pure (engines/recovery-engine.ts,
// decision/plan-change-policy.ts); the writes are in nova-recovery.itest.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  assessRecovery, isReentryDay, proposalId, proposeTaskMoves, reentryMinutes, studyGap,
  type RecoveryDeadline, type RecoveryInput, type RecoveryTask,
} from "../engines/recovery-engine";
import { classifyChange } from "../decision/plan-change-policy";
import { dayKey } from "../engines/learner-calendar";

const TODAY = "2026-10-14";
const task = (id: string, dueDay: string | null, extra: Partial<RecoveryTask> = {}): RecoveryTask => ({
  id, title: `Task ${id}`, status: "todo", priority: null, dueDay, subjectName: null, createdAt: `2026-10-01T00:00:0${id.length}Z`, ...extra,
});
const exam = (day: string, extra: Partial<RecoveryDeadline> = {}): RecoveryDeadline => ({
  id: `e-${day}`, title: "OS final", subjectName: "Operating Systems", day, takesOverTheDay: true, ...extra,
});
const input = (extra: Partial<RecoveryInput> = {}): RecoveryInput => ({
  today: TODAY, studyDays: ["2026-10-13"], tasks: [], deadlines: [], mostTasksDoneInADay: 1, ...extra,
});

describe("where the learner is", () => {
  it("counts whole calendar days since the last day with a counted session", () => {
    expect(studyGap(TODAY, ["2026-10-14"])).toMatchObject({ situation: "on_track", daysSinceStudy: 0, missedDays: 0 });
    expect(studyGap(TODAY, ["2026-10-13"])).toMatchObject({ situation: "on_track", daysSinceStudy: 1, missedDays: 0 });
    expect(studyGap(TODAY, ["2026-10-12"])).toMatchObject({ situation: "missed_one", missedDays: 1 });
    expect(studyGap(TODAY, ["2026-10-11", "2026-10-01"])).toMatchObject({ situation: "missed_several", missedDays: 2, lastStudyDay: "2026-10-11" });
    expect(studyGap(TODAY, ["2026-10-10"])).toMatchObject({ situation: "returning", daysSinceStudy: 4, missedDays: 3 });
    expect(studyGap(TODAY, ["2026-09-01"])).toMatchObject({ situation: "returning", daysSinceStudy: 43 });
    expect(studyGap(TODAY, [])).toMatchObject({ situation: "no_history", lastStudyDay: null, daysSinceStudy: null });
  });

  it("a day after today (another zone's tomorrow) is not a study day yet", () => {
    expect(studyGap(TODAY, ["2026-10-15", "2026-10-09"])).toMatchObject({ situation: "returning", lastStudyDay: "2026-10-09" });
  });

  it("days are the learner's own: 23:30 UTC is already tomorrow in Auckland and still today in New York", () => {
    const session = new Date("2026-10-13T23:30:00Z");
    const now     = new Date("2026-10-14T08:00:00Z");
    // Auckland (UTC+13): studied today. New York (UTC−4): studied yesterday.
    expect(studyGap(dayKey(now, "Pacific/Auckland"), [dayKey(session, "Pacific/Auckland")]).daysSinceStudy).toBe(0);
    expect(studyGap(dayKey(now, "America/New_York"), [dayKey(session, "America/New_York")]).daysSinceStudy).toBe(1);
  });

  it("a re-entry day is a first day back after four or more days, and ends with the first session", () => {
    expect(isReentryDay(TODAY, ["2026-10-10"])).toBe(true);
    expect(isReentryDay(TODAY, ["2026-10-10", "2026-10-14"])).toBe(false);
    expect(isReentryDay(TODAY, ["2026-10-11"])).toBe(false);
    expect(isReentryDay(TODAY, [])).toBe(false);
  });
});

describe("a re-entry day (automatic)", () => {
  it("is half the usual day in five-minute steps, never under the shortest block, never longer than usual", () => {
    expect(reentryMinutes(60, 10)).toBe(30);
    expect(reentryMinutes(45, 10)).toBe(25);
    expect(reentryMinutes(15, 10)).toBe(10);
    expect(reentryMinutes(8, 10)).toBe(8);
  });

  it("the policy lets it happen by itself only while it shortens an unstated, unexamined day", () => {
    const base = { kind: "shorten_today" as const, usualMinutes: 60, minutes: 30, statedToday: false, dayTakenByExam: false };
    expect(classifyChange(base).class).toBe("automatic");
    expect(classifyChange({ ...base, statedToday: true }).class).toBe("refused");
    expect(classifyChange({ ...base, dayTakenByExam: true }).class).toBe("refused");
    expect(classifyChange({ ...base, minutes: 90 }).class).toBe("refused");
    expect(classifyChange({ kind: "lengthen_today" }).class).toBe("refused");
    expect(classifyChange({ kind: "change_deadline" }).class).toBe("refused");
  });
});

describe("overdue tasks: a proposal, never a change", () => {
  it("nothing overdue, nothing proposed; a finished or undated task is never overdue", () => {
    expect(proposeTaskMoves(input({ tasks: [task("a", "2026-10-20"), task("b", null), task("c", "2026-10-01", { status: "done" })] }))).toBeNull();
  });

  it("one missed task goes to today", () => {
    const p = proposeTaskMoves(input({ tasks: [task("a", "2026-10-12")] }))!;
    expect(p.moves).toEqual([expect.objectContaining({ taskId: "a", from: "2026-10-12", to: TODAY })]);
    expect(p.unplaced).toEqual([]);
  });

  it("several are spread at the learner's own pace, high priority first, around what is already due", () => {
    const p = proposeTaskMoves(input({
      mostTasksDoneInADay: 2,
      tasks: [
        task("low", "2026-10-05", { priority: "low" }),
        task("high", "2026-10-11", { priority: "high" }),
        task("mid", "2026-10-09", { priority: "medium" }),
        task("due-today", TODAY),
      ],
    }))!;
    // Today already holds one of two: high goes there; mid and low fill tomorrow.
    expect(p.moves.map(m => [m.taskId, m.to])).toEqual([["high", TODAY], ["mid", "2026-10-15"], ["low", "2026-10-15"]]);
    expect(p.perDayCap).toBe(2);
    expect(p.assumptions[0]).toContain("the most you have finished in one day");
  });

  it("with no finished task on record it assumes one a day, and says so", () => {
    const p = proposeTaskMoves(input({ mostTasksDoneInADay: 0, tasks: [task("a", "2026-10-01"), task("b", "2026-10-02")] }))!;
    expect(p.moves.map(m => m.to)).toEqual([TODAY, "2026-10-15"]);
    expect(p.assumptions[0]).toContain("does not know");
  });

  it("an exam day is left free", () => {
    const p = proposeTaskMoves(input({ tasks: [task("a", "2026-10-01"), task("b", "2026-10-02")], deadlines: [exam("2026-10-15", { subjectName: "Other" })] }))!;
    expect(p.moves.map(m => m.to)).toEqual([TODAY, "2026-10-16"]);
  });

  it("a task under a subject goes before that subject's next date, or is a conflict when the date is today", () => {
    const os = { subjectName: "Operating Systems" };
    const before = proposeTaskMoves(input({ tasks: [task("a", "2026-10-10", os), task("b", "2026-10-11", os)], deadlines: [exam("2026-10-16")] }))!;
    expect(before.moves.map(m => m.to)).toEqual([TODAY, "2026-10-15"]);
    expect(before.moves[1]!.reason).toContain("before OS final");

    const today = proposeTaskMoves(input({ tasks: [task("a", "2026-10-10", os)], deadlines: [exam(TODAY)] }))!;
    expect(today.moves).toEqual([]);
    expect(today.unplaced).toEqual([expect.objectContaining({ taskId: "a", why: "deadline_conflict" })]);
  });

  it("when the days before a date are full, the task is not squeezed in: it is reported as no room", () => {
    const os = { subjectName: "Operating Systems" };
    const p = proposeTaskMoves(input({
      tasks: [task("late", "2026-10-10", os), task("x", TODAY), task("y", "2026-10-15")],
      deadlines: [exam("2026-10-16")],
    }))!;
    expect(p.moves).toEqual([]);
    expect(p.unplaced).toEqual([expect.objectContaining({ taskId: "late", why: "no_room" })]);
  });

  it("every proposed move is one the policy says needs approval, never one it refuses", () => {
    const deadlines = [exam("2026-10-17"), exam("2026-10-15", { subjectName: "Maths", title: "Maths test" })];
    const tasks = Array.from({ length: 9 }, (_, i) => task(`t${i}`, `2026-10-0${i + 1}`, { subjectName: i % 2 ? "Operating Systems" : null }));
    const p = proposeTaskMoves(input({ tasks, deadlines, mostTasksDoneInADay: 1 }))!;
    expect(p.moves.length).toBeGreaterThan(0);
    for (const m of p.moves) {
      const t = tasks.find(x => x.id === m.taskId)!;
      const next = deadlines.filter(d => d.subjectName === t.subjectName).sort((a, b) => a.day.localeCompare(b.day))[0];
      const latestDay = next ? new Date(Date.parse(`${next.day}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10) : null;
      expect(classifyChange({ kind: "move_task", from: m.from, to: m.to, today: TODAY, takenDays: deadlines.map(d => d.day), latestDay, taskOpen: true }).class).toBe("needs_approval");
    }
  });

  it("the policy refuses a move into the past, onto an exam day, past the subject's date, or of a finished task", () => {
    const base = { kind: "move_task" as const, from: "2026-10-01", to: "2026-10-15", today: TODAY, takenDays: [], latestDay: null, taskOpen: true };
    expect(classifyChange(base).class).toBe("needs_approval");
    expect(classifyChange({ ...base, to: "2026-10-13" }).class).toBe("refused");
    expect(classifyChange({ ...base, takenDays: ["2026-10-15"] }).class).toBe("refused");
    expect(classifyChange({ ...base, latestDay: TODAY }).class).toBe("refused");
    expect(classifyChange({ ...base, taskOpen: false }).class).toBe("refused");
    expect(classifyChange({ ...base, to: "not a day" }).class).toBe("refused");
  });
});

describe("one record, one proposal", () => {
  const tasks = [task("a", "2026-10-10", { subjectName: "Operating Systems" }), task("b", "2026-10-11")];

  it("the same record gives the same id however often it is asked (a repeated trigger makes nothing new)", () => {
    const one = assessRecovery(input({ tasks })), two = assessRecovery(input({ tasks: [...tasks].reverse() }));
    expect(one.proposal!.id).toBe(two.proposal!.id);
    expect(one.proposal!.id).toMatch(/^rp_[0-9a-f]{16}$/);
  });

  it("any change to what would be written gives another id: a moved task, another day, a deadline that moves the plan", () => {
    const id = assessRecovery(input({ tasks })).proposal!.id;
    expect(assessRecovery(input({ tasks: [tasks[0]!, task("b", "2026-10-12")] })).proposal!.id).not.toBe(id);
    expect(assessRecovery(input({ tasks, today: "2026-10-15" })).proposal!.id).not.toBe(id);
    // Removing a date changes the plan only if it changes a move.
    const withExam = assessRecovery(input({ tasks, deadlines: [exam(TODAY)] })).proposal!;
    expect(withExam.unplaced).toHaveLength(1);
    expect(withExam.id).not.toBe(id);
  });

  it("the id is over the moves, not their wording", () => {
    expect(proposalId(TODAY, [{ taskId: "a", from: "x", to: "y" }], [])).toBe(proposalId(TODAY, [{ taskId: "a", from: "x", to: "y" }], []));
  });

  it("the assessment brings the parts together", () => {
    const a = assessRecovery(input({ studyDays: ["2026-10-08"], tasks }));
    expect(a).toMatchObject({ situation: "returning", daysSinceStudy: 6, reentryDay: true, overdueTaskCount: 2 });
    expect(a.proposal!.moves).toHaveLength(2);
  });
});

describe("boundaries", () => {
  const src = (p: string) => readFileSync(join(__dirname, "..", p), "utf8");

  it("the engine and the policy are pure: no database, no model, no clock", () => {
    for (const f of ["engines/recovery-engine.ts", "decision/plan-change-policy.ts"]) {
      const s = src(f);
      expect(s).not.toContain("@repo/db");
      expect(s).not.toContain("openai.service");
      expect(s).not.toContain("new Date()");
      expect(s).not.toContain("Date.now()");
    }
  });
});
