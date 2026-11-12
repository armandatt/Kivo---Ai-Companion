// Sessions on a Today item (day-flow.ts): every session on it today counts,
// and a new one never replaces the time of an earlier one (12 Nov: a second
// Start replaced the item's session id, the earlier time vanished, and Start
// offered the whole time again).
import { sessionIdsOf, spentOn, withSession } from "../product/day-flow";
import type { FlowItem } from "../product/day-flow.types";

jest.mock("@repo/db/client", () => ({ prisma: {} }));
jest.mock("../../services/openai.service", () => ({ generateOpenAIText: jest.fn() }));

const item = (over: Partial<FlowItem> = {}): FlowItem => ({ id: "f1", kind: "task", taskId: "t1", topicId: null, title: "Assignment", subjectName: null, topicName: null, minutes: 60, status: "planned", at: null, sessionId: null, addedBy: "learner", ...over });
const ended = (minutes: number) => ({ status: "completed", minutes });

describe("sessions on one item", () => {
  it("a second session keeps the first among the earlier ones", () => {
    const one = withSession(item(), "s1");
    expect(one).toMatchObject({ status: "active", sessionId: "s1" });
    expect(one.earlierSessionIds).toBeUndefined();
    const two = withSession({ ...one, status: "planned" }, "s2");
    expect(two).toMatchObject({ sessionId: "s2", earlierSessionIds: ["s1"] });
    const three = withSession({ ...two, status: "planned" }, "s3");
    expect(sessionIdsOf(three)).toEqual(["s1", "s2", "s3"]);
  });

  it("the same session twice is recorded once", () => {
    const again = withSession(withSession(item(), "s1"), "s1");
    expect(sessionIdsOf(again)).toEqual(["s1"]);
  });

  it("time spent is every ended session added up; a running one is not counted yet", () => {
    const i = item({ sessionId: "s3", earlierSessionIds: ["s1", "s2"] });
    expect(spentOn(i, new Map([["s1", ended(25)], ["s2", ended(10)], ["s3", { status: "in_progress", minutes: 0 }]]))).toBe(35);
    expect(spentOn(i, new Map([["s1", ended(25)], ["s2", ended(10)], ["s3", ended(20)]]))).toBe(55);
    expect(spentOn(item({ sessionId: "s1" }), new Map([["s1", { status: "paused", minutes: 0 }]]))).toBeNull();
    expect(spentOn(item(), new Map())).toBeNull();
  });

  it("an item saved before this change (no earlier list) reads as before", () => {
    expect(sessionIdsOf(item({ sessionId: "s9" }))).toEqual(["s9"]);
    expect(spentOn(item({ sessionId: "s9" }), new Map([["s9", ended(30)]]))).toBe(30);
  });
});
