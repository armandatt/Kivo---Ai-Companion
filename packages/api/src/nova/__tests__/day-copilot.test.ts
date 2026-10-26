// Nova's copilot on Today (day-copilot.ts) and the session changes Today
// relies on (session-view.ts, session-clock.ts). No database, no model.

import { askCopilot, readCopilotReply } from "../product/day-copilot";
import * as dayFlow from "../product/day-flow";
import { checkSessionCommand, parseSessionCommand } from "../product/session-view";
import { ABANDON_UNTIMED_MINUTES, abandonmentPlanMinutes, sessionAbandonment } from "../engines/session-clock";
import type { NovaDayView } from "../product/day-flow.types";

jest.mock("@repo/db/client", () => ({ prisma: {} }));
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));
jest.mock("../product/day-flow", () => ({ loadDayFlow: jest.fn(), changeDayFlow: jest.fn() }));
const loadDayFlow = dayFlow.loadDayFlow as jest.Mock;
const changeDayFlow = dayFlow.changeDayFlow as jest.Mock;

const FLOW: NovaDayView = {
  status: "ready", day: "2026-10-27", version: 4, saved: true, intention: "Finish the assignment", view: "list", draft: null, canUndo: true,
  budgetMinutes: 120, plannedMinutes: 105, activeSessionId: null, nowMinutes: 600,
  items: [
    { id: "f-a", kind: "task", taskId: "t-assign", topicId: null, title: "Assignment 3", subjectName: "DAA", topicName: null, minutes: 60, status: "planned", at: null, sessionId: null, addedBy: "learner", ref: { status: "todo", minutes: 60, dueInDays: 0, gone: false }, spentMinutes: null, sessionEnded: false },
    { id: "f-b", kind: "topic", taskId: null, topicId: "p-fast", title: "FastAPI auth", subjectName: "Backend", topicName: "FastAPI auth", minutes: 45, status: "planned", at: null, sessionId: null, addedBy: "learner", ref: { status: null, minutes: 30, dueInDays: null, gone: false }, spentMinutes: null, sessionEnded: false },
  ],
  candidates: [
    { kind: "task", id: "t-startup", title: "Startup deck", subjectName: null, topicName: null, minutes: 30, why: null, workspace: "Startup" },
    { kind: "topic", id: "p-dp", title: "Dynamic programming", subjectName: "DAA", topicName: "Dynamic programming", minutes: 30, why: "planned today: review due", workspace: null },
  ],
};
const labels = { items: ["f-a", "f-b"], candidates: [{ kind: "task" as const, id: "t-startup" }, { kind: "topic" as const, id: "p-dp" }] };
const titles = new Map([["t-assign", "Assignment 3"], ["t-startup", "Startup deck"]]);
const itemTasks = new Map<string, string | null>([["f-a", "t-assign"], ["f-b", null]]);
const read = (reply: unknown) => readCopilotReply(JSON.stringify(reply), labels, titles, itemTasks);

describe("what code keeps of Nova's reading", () => {
  it("operations on today's flow, by the labels it was shown, mapped to ids; unknown labels dropped", () => {
    const r = read({ intent: "plan", reply: "Moving FastAPI up.", ops: [
      { op: "move", item: "i2", to: 0 }, { op: "add", ref: "c2" }, { op: "focus", title: "20 minutes of revision", minutes: 20, at: 0 },
      { op: "remove", item: "i9" }, { op: "add", ref: "c7" }, { op: "delete_everything" },
    ] })!;
    expect(r.ops).toEqual([
      { op: "move", id: "f-b", to: 0 },
      { op: "add", item: { kind: "topic", topicId: "p-dp" } },
      { op: "add", item: { kind: "focus", title: "20 minutes of revision", minutes: 20 }, at: 0 },
    ]);
    expect(r.dropped).toBe(3);
  });
  it("a change to a task itself is only a proposal, and only for a task of theirs", () => {
    const r = read({ intent: "plan", reply: "That needs your yes.", ops: [], proposals: [
      { kind: "task_due", ref: "i1", dueDay: "2026-10-30" }, { kind: "task_delete", ref: "c1" }, { kind: "task_title", ref: "i2", title: "x" },
      { kind: "task_status", ref: "c2", status: "done" }, { kind: "create_task", title: "Email the professor" }, { kind: "task_due", ref: "i1", dueDay: "tomorrow" },
    ] })!;
    expect(r.proposals.map(p => [p.kind, p.taskId, p.label])).toEqual([
      ["task_due", "t-assign", "Change Assignment 3's due day to 2026-10-30"],
      ["task_delete", "t-startup", "Delete the task Startup deck (from your board, not only today)"],
      ["create_task", null, "Make a new task: Email the professor"],
    ]);
  });
  it("a learning question changes nothing; an unclear message asks", () => {
    expect(read({ intent: "learn", reply: "JWTs are signed tokens…", ops: [{ op: "remove", item: "i1" }] })).toMatchObject({ intent: "learn", ops: [], proposals: [] });
    expect(read({ intent: "unclear", reply: "", question: "Plan or explain?", ops: [{ op: "remove", item: "i1" }] })).toMatchObject({ ops: [], question: "Plan or explain?" });
    expect(readCopilotReply("not json", labels, titles, itemTasks)).toBeNull();
  });
});

describe("asking the copilot", () => {
  beforeEach(() => { loadDayFlow.mockReset().mockResolvedValue(FLOW); changeDayFlow.mockReset(); });
  const gen = (reply: unknown) => jest.fn(async () => JSON.stringify(reply));

  it("applies flow changes through the page's own path, as Nova, against the version read, and reports what was written", async () => {
    changeDayFlow.mockResolvedValue({ ok: true, flow: { ...FLOW, version: 5 }, changed: ["Moved FastAPI auth to first."], message: "", touched: ["f-b"] });
    const g = gen({ intent: "plan", reply: "FastAPI first, then the assignment.", ops: [{ op: "move", item: "i2", to: 0 }] });
    const r = await askCopilot("p1", "web:u1", { message: "Move FastAPI to the top", mode: "plan", version: 4 }, g as never);
    expect(changeDayFlow).toHaveBeenCalledWith({ profileId: "p1", platformChatId: "web:u1", version: 4, ops: [{ op: "move", id: "f-b", to: 0 }], by: "nova" });
    expect(r).toMatchObject({ ok: true, changed: ["Moved FastAPI auth to first."], touched: ["f-b"], flow: { version: 5 } });
    const prompt = (g.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain("i2: FastAPI auth [topic, Backend] planned, 45 min");
    expect(prompt).toContain("c1: Startup deck [task], 30 min");
    expect(prompt).not.toContain("t-startup");
  });
  it("a change that fails is said to have failed: nothing is passed off as applied", async () => {
    changeDayFlow.mockResolvedValue({ ok: false, error: "invalid", message: "That item isn't in today's flow any more.", flow: FLOW });
    const r = await askCopilot("p1", "web:u1", { message: "move it", mode: "plan", version: 4 }, gen({ intent: "plan", reply: "Done! Moved it.", ops: [{ op: "move", item: "i1", to: 1 }] }) as never);
    expect(r).toMatchObject({ ok: true, changed: [], reply: "I couldn't make that change: That item isn't in today's flow any more." });
  });
  it("a task change never touches the flow or the task: it comes back for the learner's yes", async () => {
    const r = await askCopilot("p1", "web:u1", { message: "push the assignment to Friday", mode: "plan", version: 4 }, gen({ intent: "plan", reply: "That changes the task.", ops: [], proposals: [{ kind: "task_due", ref: "i1", dueDay: "2026-10-30" }] }) as never);
    expect(changeDayFlow).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, flow: null, proposals: [{ kind: "task_due", taskId: "t-assign", change: { dueDay: "2026-10-30" } }] });
  });
  it("a stale page is told, with the flow as it now stands; the model is not asked", async () => {
    const g = gen({});
    expect(await askCopilot("p1", "web:u1", { message: "x", mode: "plan", version: 3 }, g as never)).toMatchObject({ ok: false, error: "stale", flow: { version: 4 } });
    expect(g).not.toHaveBeenCalled();
  });
  it("a model that is down changes nothing", async () => {
    const r = await askCopilot("p1", "web:u1", { message: "plan my day", mode: "plan", version: 4 }, jest.fn(async () => { throw new Error("429"); }) as never);
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
    expect(changeDayFlow).not.toHaveBeenCalled();
  });
});

describe("focus sessions Today starts", () => {
  it("a length for this session, no time limit (0), or a task with no topic carried as a label", () => {
    expect(parseSessionCommand({ action: "start", topicName: "FastAPI auth", subjectName: "Backend", plannedMinutes: 45 })).toEqual({ action: "start", topicName: "FastAPI auth", subjectName: "Backend", plannedMinutes: 45, label: null });
    expect(parseSessionCommand({ action: "start", topicName: "FastAPI auth", subjectName: "Backend", plannedMinutes: 0 })).toMatchObject({ plannedMinutes: 0 });
    expect(parseSessionCommand({ action: "start", topicName: "FastAPI auth", untimed: true })).toMatchObject({ plannedMinutes: 0 });
    expect(parseSessionCommand({ action: "start", topicName: null, label: "Assignment 3", subjectName: "DAA", plannedMinutes: 30 })).toEqual({ action: "start", topicName: null, subjectName: null, plannedMinutes: 30, label: "Assignment 3" });
    expect(parseSessionCommand({ action: "start", topicName: "", label: "" })).toBeNull();
  });
  it("a running session's length changes, or becomes untimed; nothing else is a length", () => {
    expect(parseSessionCommand({ action: "set_length", minutes: 55 })).toEqual({ action: "set_length", minutes: 55 });
    expect(parseSessionCommand({ action: "set_length", minutes: 0 })).toEqual({ action: "set_length", minutes: 0 });
    for (const m of [3, 241, 12.5, "30", null]) expect(parseSessionCommand({ action: "set_length", minutes: m })).toBeNull();
    expect(checkSessionCommand({ action: "set_length", minutes: 30 }, null)).toMatchObject({ verdict: "reject", error: "no_active_session" });
    expect(checkSessionCommand({ action: "set_length", minutes: 30 }, { status: "paused" })).toEqual({ verdict: "apply" });
  });
  it("a session with no time limit is not closed as forgotten after 90 minutes; one with none given still is", () => {
    const start = new Date("2026-10-27T08:00:00Z");
    const at = (minutes: number) => new Date(start.getTime() + minutes * 60_000);
    const row = (planned: number | null) => ({ status: "in_progress", startedAt: start, totalPausedSeconds: 0, pausedAt: null, plannedDurationMinutes: planned });
    expect(abandonmentPlanMinutes(0)).toBe(ABANDON_UNTIMED_MINUTES);
    expect(sessionAbandonment(row(0) as never, at(180))).toBeNull();
    expect(sessionAbandonment(row(null) as never, at(180))).toMatchObject({ reason: "ran_past_plan" });
    expect(sessionAbandonment(row(0) as never, at(ABANDON_UNTIMED_MINUTES + 31))).toMatchObject({ reason: "ran_past_plan" });
    expect(sessionAbandonment(row(45) as never, at(80))).toMatchObject({ reason: "ran_past_plan", countedMinutes: 45 });
  });
});
