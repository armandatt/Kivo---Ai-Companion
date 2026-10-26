// Nova's copilot on Today (day-copilot.ts) and the session changes Today
// relies on (session-view.ts, session-clock.ts). No database, no model.
// Nova proposes and the learner decides: nothing here may write the flow
// except an approval of a proposal code made.

import { approvePending, askCopilot, BUILDS_A_DAY, copilotPrompt, decideStep, mapOutline, pendingIdOf, PLAN_QUESTION, readCopilotReply, type MapSubject } from "../product/day-copilot";
import * as dayFlow from "../product/day-flow";
import { previewOf } from "../product/day-flow-rules";
import { checkSessionCommand, parseSessionCommand } from "../product/session-view";
import { ABANDON_UNTIMED_MINUTES, abandonmentPlanMinutes, sessionAbandonment } from "../engines/session-clock";
import type { FlowItem, FlowOp, NovaDayView } from "../product/day-flow.types";

jest.mock("@repo/db/client", () => ({ prisma: {} }));
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));
jest.mock("../product/day-flow", () => ({ loadDayFlow: jest.fn(), changeDayFlow: jest.fn(), previewDayFlow: jest.fn() }));
jest.mock("../product/today", () => ({ loadNovaToday: jest.fn() }));
jest.mock("../product/setup-edit", () => ({ loadStudyStructure: jest.fn() }));
const loadDayFlow = dayFlow.loadDayFlow as jest.Mock;
const changeDayFlow = dayFlow.changeDayFlow as jest.Mock;
const previewDayFlow = dayFlow.previewDayFlow as jest.Mock;

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
const read = (reply: unknown) => readCopilotReply(JSON.stringify(reply), labels);
const noExtras = async () => ({ lines: [] as string[] });

describe("what code keeps of Nova's reading", () => {
  it("operations on today's flow, by the labels it was shown, mapped to ids; unknown labels dropped", () => {
    const r = read({ intent: "propose", reply: "Moving FastAPI up. Apply it?", ops: [
      { op: "move", item: "i2", to: 0 }, { op: "add", ref: "c2", minutes: 25 }, { op: "focus", title: "20 minutes of revision", minutes: 20, at: 0 },
      { op: "remove", item: "i9" }, { op: "add", ref: "c7" }, { op: "delete_everything" },
    ] })!;
    expect(r.ops).toEqual([
      { op: "move", id: "f-b", to: 0 },
      { op: "add", item: { kind: "topic", topicId: "p-dp", minutes: 25 } },
      { op: "add", item: { kind: "focus", title: "20 minutes of revision", minutes: 20 }, at: 0 },
    ]);
    expect(r.dropped).toBe(3);
    // An older reply's intent names still read.
    expect(read({ intent: "plan", ops: [{ op: "move", item: "i2", to: 0 }] })!.intent).toBe("propose");
    expect(read({ intent: "unclear", question: "Which one?" })!.intent).toBe("ask");
  });
  it("Nova has no operation on a task, and \"done\" is the learner's own tick", () => {
    const r = read({ intent: "propose", ops: [{ op: "set_status", item: "i1", status: "done" }, { op: "set_status", item: "i2", status: "later" }], proposals: [{ kind: "task_delete", ref: "c1" }, { kind: "create_task", title: "x" }] })!;
    expect(r.ops).toEqual([{ op: "set_status", id: "f-b", status: "later" }]);
    expect(r.dropped).toBe(1);
    expect(r).not.toHaveProperty("proposals");
  });
  it("quick replies are short and few; what was heard keeps its quote", () => {
    const r = read({ intent: "ask", question: "How long have you got?", choices: ["30–45 min", "1–2 hours", "Longer", "Just draft something", "a fifth", "x".repeat(60)], heard: [{ kind: "energy", quote: "pretty exhausted" }, { kind: "mood", quote: "sad" }] })!;
    expect(r.choices).toEqual(["30–45 min", "1–2 hours", "Longer", "Just draft something"]);
    expect(r.heard).toEqual([{ kind: "energy", quote: "pretty exhausted" }]);
    expect(readCopilotReply("", labels)).toBeNull();
    expect(readCopilotReply("{ broken", labels)).toBeNull();
  });
});

describe("a reply that isn't only the object", () => {
  it("prose before the object: the object is read", () => {
    expect(readCopilotReply(`Sure. Here it is: {"intent":"propose","ops":[{"op":"move","item":"i2","to":0}]}`, labels)).toMatchObject({ intent: "propose", ops: [{ op: "move", id: "f-b", to: 0 }] });
    // A brace inside the prose doesn't hide the object after it.
    expect(readCopilotReply(`Sets look like {a, b}. {"intent":"elsewhere","reply":"Focus is the place for that."}`, labels)).toMatchObject({ intent: "elsewhere", reply: "Focus is the place for that." });
  });
  it("prose with no object is words that change nothing", () => {
    expect(readCopilotReply("Concurrency is tasks overlapping in time.", labels)).toEqual({ intent: "elsewhere", reply: "Concurrency is tasks overlapping in time.", ops: [], question: null, choices: [], heard: [], dropped: 0 });
  });
});

describe("when Nova asks and when it proposes", () => {
  const day = (heard: Array<{ kind: "priority" | "time"; quote: string }> = []) => read({ intent: "propose", reply: "Here's a day.", ops: [{ op: "add", ref: "c1" }, { op: "add", ref: "c2" }], heard })!;
  it("\"plan my day\" with nothing said about what matters or how long: a question, never a drafted day", () => {
    expect(BUILDS_A_DAY).toBe(2);
    const step = decideStep(day(), { learnerWords: "Plan my day", draftNow: false, hasOpen: false });
    expect(step).toMatchObject({ kind: "ask", question: PLAN_QUESTION, overruled: true });
    expect((step as { choices: string[] }).choices).toContain("Just draft something");
  });
  it("Kivo's record is not the learner's answer: a fact counts only when its quote is in their words", () => {
    // The model 'heard' a priority that came from the task list, not from them.
    expect(decideStep(day([{ kind: "priority", quote: "Startup deck" }]), { learnerWords: "Plan my day", draftNow: false, hasOpen: false }).kind).toBe("ask");
    expect(decideStep(day([{ kind: "priority", quote: "study DSA" }, { kind: "time", quote: "About an hour" }]), { learnerWords: "Plan my day\nI need to study DSA, but I'm exhausted\nabout an hour. Revision.", draftNow: false, hasOpen: false }).kind).toBe("propose");
  });
  it("skipping the questions is the learner's choice; a specific change needs none", () => {
    expect(decideStep(day(), { learnerWords: "Just draft something", draftNow: true, hasOpen: false }).kind).toBe("propose");
    expect(decideStep(read({ intent: "propose", ops: [{ op: "move", item: "i2", to: 0 }] })!, { learnerWords: "Move FastAPI to the top", draftNow: false, hasOpen: false })).toMatchObject({ kind: "propose", ops: [{ op: "move", id: "f-b", to: 0 }] });
  });
  it("a yes or a no needs a proposal to be about; a request outside today's plan changes nothing", () => {
    expect(decideStep(read({ intent: "approve" })!, { learnerWords: "yes", draftNow: false, hasOpen: false }).kind).toBe("say");
    expect(decideStep(read({ intent: "approve" })!, { learnerWords: "yes", draftNow: false, hasOpen: true }).kind).toBe("approve");
    expect(decideStep(read({ intent: "decline" })!, { learnerWords: "keep my plan", draftNow: false, hasOpen: true }).kind).toBe("decline");
    // Older intent names for a learning question or a note edit read as "elsewhere", with no ops.
    for (const intent of ["learn", "note_edit", "elsewhere"]) expect(read({ intent, reply: "…", ops: [{ op: "remove", item: "i1" }] })).toMatchObject({ intent: "elsewhere", ops: [] });
    expect(decideStep(read({ intent: "elsewhere", reply: "The Board does that." })!, { learnerWords: "rename my task", draftNow: false, hasOpen: true }).kind).toBe("elsewhere");
  });
});

describe("their map, as Nova sees it", () => {
  it("only top-level subjects head the outline; subjects inside them, units and topics nest under it; a topic in today names its item", () => {
    const map: MapSubject[] = [
      { id: "fin", name: "Finance", topics: [] },
      { id: "basic", name: "Basic Finance", parentId: "fin", topics: [{ id: "tvm", name: "Time Value of Money" }, { id: "risk", name: "Risk and Returns" }, { id: "old", name: "Old", archived: true }] },
      { id: "acc", name: "Accounting", parentId: "fin", topics: [{ id: "m1", name: "Close the books", kind: "milestone" }] },
    ];
    let n = 0;
    const lines = mapOutline(map, new Set(["tvm", "risk"]), new Map([["risk", "i1"]]), null, () => `c${++n}`);
    expect(lines).toEqual([
      "SUBJECT Finance",
      "  subject Basic Finance",
      "    - Time Value of Money [c1]",
      "    - Risk and Returns (in today: i1)",
      "  subject Accounting",
      "    - Close the books",
    ]);
  });
});

describe("a proposal, read against the flow", () => {
  const it0 = (id: string, title: string, minutes: number | null, status: FlowItem["status"] = "planned"): FlowItem => ({ id, kind: "topic", taskId: null, topicId: id, title, subjectName: "DAA", topicName: title, minutes, status, at: null, sessionId: null, addedBy: "learner" });
  it("each item marked added, moved or changed; what leaves the day listed; the minutes added up", () => {
    const before = [it0("a", "Graphs", 30), it0("b", "Trees", 20), it0("c", "Heaps", 15), it0("d", "Sorting", 10, "done")];
    const after = [it0("b", "Trees", 20), it0("a", "Graphs", 45), it0("n", "DP revision", 25), it0("d", "Sorting", 10, "done")];
    expect(previewOf(before, after)).toEqual({
      items: [
        expect.objectContaining({ id: "b", change: "moved" }),
        expect.objectContaining({ id: "a", change: "changed", minutes: 45 }),
        expect.objectContaining({ id: "n", change: "added" }),
      ],
      removed: [{ title: "Heaps", kind: "topic" }],
      plannedMinutes: 90,
    });
  });
});

describe("asking the copilot", () => {
  beforeEach(() => {
    loadDayFlow.mockReset().mockResolvedValue(FLOW);
    changeDayFlow.mockReset();
    previewDayFlow.mockReset().mockImplementation(async ({ ops }: { ops: unknown[] }) => ({ ok: true, before: FLOW.items, after: [FLOW.items[1], FLOW.items[0]], changed: ops.map(() => "Moved FastAPI auth to first."), touched: ["f-b"], budgetMinutes: 120, intention: null }));
  });
  const gen = (reply: unknown) => jest.fn(async () => JSON.stringify(reply));

  it("a clear change comes back as a proposal: worked out by the page's rules, written nowhere, named for this learner and version", async () => {
    const g = gen({ intent: "propose", reply: "I'll move FastAPI auth to first. Apply that?", ops: [{ op: "move", item: "i2", to: 0 }] });
    const r = await askCopilot("p1", "web:u1", { message: "Move FastAPI to the top", version: 4 }, g as never, noExtras);
    expect(changeDayFlow).not.toHaveBeenCalled();
    expect(previewDayFlow).toHaveBeenCalledWith({ profileId: "p1", platformChatId: "web:u1", version: 4, ops: [{ op: "move", id: "f-b", to: 0 }], by: "nova" });
    expect(r).toMatchObject({ ok: true, flow: null, changed: [], pending: {
      id: pendingIdOf("p1", 4, [{ op: "move", id: "f-b", to: 0 }]), version: 4, ops: [{ op: "move", id: "f-b", to: 0 }], changed: ["Moved FastAPI auth to first."], size: "small",
      items: [expect.objectContaining({ id: "f-b", change: "moved" }), expect.objectContaining({ id: "f-a", change: "moved" })],
    } });
    const prompt = (g.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain("i2: FastAPI auth [topic, Backend] planned, 45 min");
    expect(prompt).toContain("c1: Startup deck, 30 min");
    expect(prompt).not.toContain("t-startup");
  });
  it("\"plan my day\" alone: Nova asks, even when the model drafted a whole day", async () => {
    const r = await askCopilot("p1", "web:u1", { message: "Plan my day", version: 4 }, gen({ intent: "propose", reply: "Here's your day!", ops: [{ op: "add", ref: "c1" }, { op: "add", ref: "c2" }] }) as never, noExtras);
    expect(r).toMatchObject({ ok: true, pending: null, question: PLAN_QUESTION, reply: "" });
    expect(previewDayFlow).not.toHaveBeenCalled();
    expect(changeDayFlow).not.toHaveBeenCalled();
  });
  it("context goes in as background, never as their answer", async () => {
    const g = gen({ intent: "ask", question: "What matters most today?", choices: ["The assignment", "FastAPI"] });
    await askCopilot("p1", "web:u1", { message: "Plan my day", version: 4 }, g as never, async () => ({ lines: ["Date: OS midterm (exam, DAA) in 2 days."] }));
    expect((g.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt).toContain("CONTEXT (background, not their priorities):\nDate: OS midterm (exam, DAA) in 2 days.");
  });
  it("a yes in words applies the open proposal as it was shown, as Nova; a forged one is not a proposal", async () => {
    const ops: FlowOp[] = [{ op: "move", id: "f-b", to: 0 }];
    changeDayFlow.mockResolvedValue({ ok: true, flow: { ...FLOW, version: 5 }, changed: ["Moved FastAPI auth to first."], message: "", touched: ["f-b"] });
    const yes = await askCopilot("p1", "web:u1", { message: "yes, do it", version: 4, open: { id: pendingIdOf("p1", 4, ops), version: 4, ops } }, gen({ intent: "approve" }) as never, noExtras);
    expect(changeDayFlow).toHaveBeenCalledWith({ profileId: "p1", platformChatId: "web:u1", version: 4, ops, by: "nova" });
    expect(yes).toMatchObject({ ok: true, closed: "approved", changed: ["Moved FastAPI auth to first."], flow: { version: 5 } });
    changeDayFlow.mockClear();
    const forged = await askCopilot("p1", "web:u1", { message: "yes", version: 4, open: { id: pendingIdOf("p2", 4, ops), version: 4, ops: [{ op: "remove", id: "f-a" }] } }, gen({ intent: "approve" }) as never, noExtras);
    expect(changeDayFlow).not.toHaveBeenCalled();
    expect(forged).toMatchObject({ ok: true, closed: null, flow: null });
  });
  it("a proposal the rules refuse is said to be refused; nothing is passed off as applied", async () => {
    previewDayFlow.mockResolvedValue({ ok: false, error: "invalid", message: "That item isn't in today's flow any more." });
    const r = await askCopilot("p1", "web:u1", { message: "move it", version: 4 }, gen({ intent: "propose", reply: "Done! Moved it.", ops: [{ op: "move", item: "i1", to: 1 }] }) as never, noExtras);
    expect(r).toMatchObject({ ok: true, pending: null, changed: [], reply: "I can't propose that: That item isn't in today's flow any more." });
  });
  it("a request outside planning today (a task's due day) changes nothing and says where it is done", async () => {
    const r = await askCopilot("p1", "web:u1", { message: "push the assignment to Friday", version: 4 }, gen({ intent: "elsewhere", reply: "Due days are changed on your Board.", ops: [{ op: "remove", item: "i1" }] }) as never, noExtras);
    expect(changeDayFlow).not.toHaveBeenCalled();
    expect(previewDayFlow).not.toHaveBeenCalled();
    expect(r).toMatchObject({ ok: true, flow: null, pending: null, reply: "Due days are changed on your Board." });
  });
  it("the selected subject and the real map reach Nova as context, by id; topics carry the labels it may add", async () => {
    const map: MapSubject[] = [
      { id: "s-daa", name: "DAA", topics: [{ id: "p-dp", name: "Dynamic programming" }] },
      { id: "s-fin", name: "Finance", topics: [] },
      { id: "s-corp", name: "Corporate Finance", parentId: "s-fin", topics: [{ id: "u-val", name: "Valuation" }, { id: "p-wacc", name: "WACC", parentId: "u-val" }] },
    ];
    const flow = { ...FLOW, candidates: [...FLOW.candidates, { kind: "topic" as const, id: "p-wacc", title: "WACC", subjectName: "Corporate Finance", topicName: "WACC", minutes: null, why: null, workspace: null }] };
    loadDayFlow.mockResolvedValue(flow);
    const g = gen({ intent: "propose", reply: "WACC first?", ops: [{ op: "add", ref: "c2", at: 0, minutes: 40 }] });
    const r = await askCopilot("p1", "web:u1", { message: "Add WACC", version: 4, subjectId: "s-fin" }, g as never, async () => ({ lines: [], map }));
    const prompt = (g.mock.calls[0] as unknown as [{ prompt: string }])[0].prompt;
    expect(prompt).toContain("SELECTED: they have the subject Finance selected on the page (context only).");
    expect(prompt).toContain("SUBJECT Finance (SELECTED on the page)\n  subject Corporate Finance\n    - Valuation (unit)\n      - WACC [c2]");
    // The selected subject comes first; the one not selected after it.
    expect(prompt.indexOf("SUBJECT Finance")).toBeLessThan(prompt.indexOf("SUBJECT DAA"));
    expect(previewDayFlow).toHaveBeenCalledWith(expect.objectContaining({ ops: [{ op: "add", item: { kind: "topic", topicId: "p-wacc", minutes: 40 }, at: 0 }] }));
    expect(r).toMatchObject({ ok: true, pending: { size: "small" } });
    // A subject id that isn't in their map names nothing.
    expect(copilotPrompt(flow, "x", [], { lines: [], map }, null, false, "someone-elses").prompt).not.toContain("SELECTED");
  });
  it("a stale page is told, with the flow as it now stands; the model is not asked", async () => {
    const g = gen({});
    expect(await askCopilot("p1", "web:u1", { message: "x", version: 3 }, g as never, noExtras)).toMatchObject({ ok: false, error: "stale", flow: { version: 4 } });
    expect(g).not.toHaveBeenCalled();
  });
  it("a model that is down changes nothing", async () => {
    const r = await askCopilot("p1", "web:u1", { message: "plan my day", version: 4 }, jest.fn(async () => { throw new Error("429"); }) as never, noExtras);
    expect(r).toMatchObject({ ok: false, error: "unavailable" });
    expect(changeDayFlow).not.toHaveBeenCalled();
  });
});

describe("approving a proposal", () => {
  const ops: FlowOp[] = [{ op: "move", id: "f-b", to: 0 }, { op: "set_minutes", id: "f-a", minutes: 30 }];
  beforeEach(() => changeDayFlow.mockReset().mockResolvedValue({ ok: true, flow: { ...FLOW, version: 5 }, changed: ["…"], message: "…", touched: [] }));
  it("applies exactly what was proposed, as Nova, against the version it was proposed on", async () => {
    await approvePending("p1", "web:u1", { pendingId: pendingIdOf("p1", 4, ops), version: 4, ops });
    expect(changeDayFlow).toHaveBeenCalledWith({ profileId: "p1", platformChatId: "web:u1", version: 4, ops, by: "nova" });
  });
  it("only the operations the learner kept", async () => {
    await approvePending("p1", "web:u1", { pendingId: pendingIdOf("p1", 4, ops), version: 4, ops, keep: [1, 7, 1] });
    expect(changeDayFlow).toHaveBeenCalledWith(expect.objectContaining({ ops: [ops[1]] }));
  });
  it("a proposal changed after it was made, made for someone else, or for another version is not one: nothing is written", async () => {
    for (const body of [
      { pendingId: pendingIdOf("p1", 4, ops), version: 4, ops: [...ops, { op: "remove", id: "f-a" }] },
      { pendingId: pendingIdOf("p2", 4, ops), version: 4, ops },
      { pendingId: pendingIdOf("p1", 4, ops), version: 5, ops },
      { pendingId: pendingIdOf("p1", 4, ops), version: 4, ops, keep: [] },
    ]) expect(await approvePending("p1", "web:u1", body)).toMatchObject({ ok: false, error: "invalid" });
    expect(changeDayFlow).not.toHaveBeenCalled();
  });
  it("one the flow has moved on from is refused as stale, never written over the newer flow", async () => {
    changeDayFlow.mockResolvedValue({ ok: false, error: "stale", message: "x", flow: { ...FLOW, version: 6 } });
    expect(await approvePending("p1", "web:u1", { pendingId: pendingIdOf("p1", 4, ops), version: 4, ops })).toMatchObject({ ok: false, error: "stale", message: expect.stringContaining("wasn't applied"), flow: { version: 6 } });
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
