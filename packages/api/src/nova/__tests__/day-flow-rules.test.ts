// Today's flow (day-flow-rules.ts): what each change does to the learner's
// list for the day, and what it never does. Pure.

import { applyFlowOps, clockMinutes, draftFrom, fitTo, ordered, scheduleOf, type ApplyContext, type FlowState } from "../product/day-flow-rules";
import type { FlowItem, NewFlowItem } from "../product/day-flow.types";

const TASKS: Record<string, { title: string; minutes: number | null }> = { t1: { title: "Assignment 3", minutes: 60 }, t2: { title: "Startup pitch", minutes: 45 } };
const TOPICS: Record<string, { name: string; subject: string; minutes: number | null }> = { p1: { name: "FastAPI authentication", subject: "Backend", minutes: 30 }, p2: { name: "Dynamic programming", subject: "DAA", minutes: null } };
let n = 0;
const ctx: ApplyContext = {
  newId: () => `x${++n}`,
  by: "learner",
  resolve: (i: NewFlowItem) => i.kind === "task" ? (TASKS[i.taskId] ? { kind: "task", taskId: i.taskId, topicId: null, title: TASKS[i.taskId]!.title, subjectName: null, topicName: null, minutes: TASKS[i.taskId]!.minutes } : null)
    : i.kind === "topic" ? (TOPICS[i.topicId] ? { kind: "topic", taskId: null, topicId: i.topicId, title: TOPICS[i.topicId]!.name, subjectName: TOPICS[i.topicId]!.subject, topicName: TOPICS[i.topicId]!.name, minutes: TOPICS[i.topicId]!.minutes } : null)
    : { kind: "focus", taskId: null, topicId: null, title: i.title, subjectName: null, topicName: null, minutes: null },
};
const item = (id: string, over: Partial<FlowItem> = {}): FlowItem => ({ id, kind: "focus", taskId: null, topicId: null, title: id, subjectName: null, topicName: null, minutes: 30, status: "planned", at: null, sessionId: null, addedBy: "learner", ...over });
const EMPTY: FlowState = { items: [], intention: null };
const ok = (r: ReturnType<typeof applyFlowOps>) => { if (!r.ok) throw new Error(r.message); return r; };

describe("adding work to today", () => {
  it("a task, a topic and a focus item, each with its own time; a topic stays a topic", () => {
    const r = ok(applyFlowOps(EMPTY, [
      { op: "add", item: { kind: "task", taskId: "t1" } },
      { op: "add", item: { kind: "topic", topicId: "p1" } },
      { op: "add", item: { kind: "focus", title: "20 minutes of revision", minutes: 20 } },
    ], ctx));
    expect(r.state.items.map(i => [i.kind, i.title, i.minutes])).toEqual([["task", "Assignment 3", 60], ["topic", "FastAPI authentication", 30], ["focus", "20 minutes of revision", 20]]);
    expect(r.state.items[1]!.taskId).toBeNull();
  });
  it("the same thing twice is one item (a retry changes nothing); a reference that isn't theirs is refused whole", () => {
    const once = ok(applyFlowOps(EMPTY, [{ op: "add", item: { kind: "task", taskId: "t1" } }], ctx)).state;
    const twice = ok(applyFlowOps(once, [{ op: "add", item: { kind: "task", taskId: "t1" } }], ctx));
    expect(twice.state.items).toHaveLength(1);
    expect(twice.changed).toEqual(["Assignment 3 is already in today's flow."]);
    const bad = applyFlowOps(once, [{ op: "add", item: { kind: "topic", topicId: "p2" } }, { op: "add", item: { kind: "task", taskId: "someone-elses" } }], ctx);
    expect(bad).toMatchObject({ ok: false, index: 1 });
  });
  it("an added item can go first", () => {
    const r = ok(applyFlowOps({ items: [item("a"), item("b")], intention: null }, [{ op: "add", item: { kind: "topic", topicId: "p1" }, at: 0 }], ctx));
    expect(r.state.items.map(i => i.title)).toEqual(["FastAPI authentication", "a", "b"]);
  });
});

describe("changing today", () => {
  const day: FlowState = { items: [item("a"), item("b", { kind: "task", taskId: "t2", title: "Startup pitch" }), item("c")], intention: null };
  it("moving keeps every other item where it was", () => {
    const r = ok(applyFlowOps(day, [{ op: "move", id: "c", to: 0 }], ctx));
    expect(r.state.items.map(i => i.id)).toEqual(["c", "a", "b"]);
    expect(r.changed).toEqual(["Moved c to first."]);
    expect(r.touched).toEqual(["c"]);
  });
  it("taking a task out of today says its task is unchanged; nothing else is touched", () => {
    const r = ok(applyFlowOps(day, [{ op: "remove", id: "b" }], ctx));
    expect(r.state.items.map(i => i.id)).toEqual(["a", "c"]);
    expect(r.changed[0]).toBe("Took Startup pitch out of today's flow. The task itself is unchanged.");
    expect(ok(applyFlowOps(r.state, [{ op: "remove", id: "b" }], ctx)).state.items).toHaveLength(2);
  });
  it("today's time, a fixed time, done for today, the intention; bad values are refused whole", () => {
    const r = ok(applyFlowOps(day, [{ op: "set_minutes", id: "a", minutes: 45 }, { op: "set_time", id: "a", at: "09:30" }, { op: "set_status", id: "c", status: "done" }, { op: "set_intention", text: "  Finish my assignment\nand study FastAPI " }], ctx));
    expect(r.state.items[0]).toMatchObject({ minutes: 45, at: "09:30" });
    expect(r.state.items[2]!.status).toBe("done");
    expect(r.state.intention).toBe("Finish my assignment and study FastAPI");
    for (const bad of [{ op: "set_minutes", id: "a", minutes: 2 }, { op: "set_minutes", id: "a", minutes: 30.5 }, { op: "set_time", id: "a", at: "25:00" }, { op: "set_status", id: "a", status: "failed" }, { op: "move", id: "gone", to: 0 }] as const) {
      expect(applyFlowOps(day, [{ op: "set_minutes", id: "b", minutes: 50 }, bad as never], ctx).ok).toBe(false);
    }
  });
  it("splitting makes blocks of the same thing; replacing keeps the place", () => {
    const s = ok(applyFlowOps(day, [{ op: "split", id: "a", parts: [20, 10] }], ctx));
    expect(s.state.items.map(i => [i.title, i.minutes])).toEqual([["a (1 of 2)", 20], ["a (2 of 2)", 10], ["Startup pitch", 30], ["c", 30]]);
    expect(applyFlowOps(day, [{ op: "split", id: "a", parts: [30] }], ctx).ok).toBe(false);
    const r = ok(applyFlowOps(day, [{ op: "replace", id: "c", item: { kind: "task", taskId: "t1" } }], ctx));
    expect(r.state.items.map(i => i.title)).toEqual(["a", "Startup pitch", "Assignment 3"]);
  });
  it("no fixed times: every time cleared, nothing else", () => {
    const r = ok(applyFlowOps({ items: [item("a", { at: "09:00" }), item("b")], intention: "x" }, [{ op: "clear_times" }], ctx));
    expect(r.state.items.map(i => i.at)).toEqual([null, null]);
    expect(r.state.intention).toBe("x");
  });
});

describe("fitting the rest of the day into the time left", () => {
  const day = [item("a", { minutes: 30 }), item("b", { minutes: 30 }), item("c", { minutes: 30 }), item("d", { minutes: null }), item("done", { status: "done" })];
  it("keeps what fits in the learner's order, shortens one to fill the gap, moves the rest below If there's time, removes nothing", () => {
    const f = fitTo(day, 45);
    expect(f.items.map(i => [i.id, i.status, i.minutes])).toEqual([["a", "planned", 30], ["b", "planned", 15], ["d", "planned", null], ["done", "done", 30], ["c", "later", 30]]);
    expect(f.summary).toBe("Fitted to 45 min: b is shortened to fit; c moved to If there's time. Nothing was removed.");
    expect(f.items).toHaveLength(day.length);
  });
  it("more time brings later items back", () => {
    const back = fitTo(fitTo(day, 30).items, 120);
    expect(back.items.filter(i => i.status === "later")).toHaveLength(0);
  });
});

describe("Nova's draft for a day with no flow", () => {
  const input = {
    tasks: [
      { id: "t-over", title: "Overdue essay", status: "todo", dueInDays: -1, estimatedMinutes: 40, subjectName: null, topicName: null, priority: null },
      { id: "t-done", title: "Done thing", status: "done", dueInDays: 0, estimatedMinutes: 10, subjectName: null, topicName: null, priority: null },
      { id: "t-soon", title: "Due tomorrow", status: "todo", dueInDays: 1, estimatedMinutes: 20, subjectName: null, topicName: null, priority: null },
      { id: "t-later", title: "Due next week", status: "todo", dueInDays: 6, estimatedMinutes: 20, subjectName: null, topicName: null, priority: null },
    ],
    blocks: [{ topicId: "p1", topicName: "FastAPI authentication", subjectName: "Backend", durationMinutes: 30, reasons: ["review due"] }, { topicId: "p2", topicName: "DP", subjectName: "DAA", durationMinutes: 45, reasons: [] }],
    budgetMinutes: 90, now: "2026-10-27T08:00:00Z",
  };
  it("tasks due or overdue first, then the planner's blocks, inside the day's time; the rest kept below, with reasons", () => {
    let k = 0;
    const d = draftFrom(input, () => `d${++k}`)!;
    expect(d.items.map(i => [i.title, i.status])).toEqual([["Overdue essay", "planned"], ["FastAPI authentication", "planned"], ["DP", "later"]]);
    expect(d.items.map(i => i.minutes)).toEqual([40, 30, 45]);
    expect(d.reasons.join(" ")).toContain("due today or overdue");
    expect(d.reasons.join(" ")).toContain("More than fits in today's 1 h 30 min");
    expect(d.items.every(i => i.addedBy === "nova")).toBe(true);
  });
  it("with room, a task due soon joins; with nothing on record there is no draft", () => {
    let k = 0;
    const roomy = draftFrom({ ...input, budgetMinutes: 240 }, () => `d${++k}`)!;
    expect(roomy.items.map(i => i.title)).toContain("Due tomorrow");
    expect(roomy.items.map(i => i.title)).not.toContain("Due next week");
    expect(draftFrom({ tasks: [], blocks: [], budgetMinutes: 60, now: "x" }, () => "d")).toBeNull();
  });
});

describe("the schedule view", () => {
  it("blocks from now in order; a fixed time is kept; an item with no time is an estimate; done and later are not scheduled", () => {
    const blocks = scheduleOf([item("a", { minutes: 30 }), item("b", { minutes: null }), item("c", { minutes: 20, at: "12:00" }), item("x", { status: "later" }), item("y", { status: "done" })], 9 * 60);
    expect(blocks).toEqual([
      { id: "a", start: 540, end: 570, fixed: false, estimated: false },
      { id: "b", start: 570, end: 595, fixed: false, estimated: true },
      { id: "c", start: 720, end: 740, fixed: true, estimated: false },
    ]);
    expect(clockMinutes("9:30")).toBeNull();
    expect(ordered([item("l", { status: "later" }), item("p")]).map(i => i.id)).toEqual(["p", "l"]);
  });
});
