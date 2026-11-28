import { clock12, dayEnd, decodeReminderCallback, pickTimes, reminderMessage, slotsFor, stillEligible } from "../proactive/plan-reminder-rules";
import type { FlowItem } from "../product/day-flow.types";

const item = (over: Partial<FlowItem>): FlowItem => ({
  id: "i1", kind: "topic", taskId: null, topicId: "t1", title: "Operating Systems", subjectName: "CS", topicName: "Operating Systems",
  minutes: 25, status: "planned", at: null, sessionId: null, addedBy: "learner", ...over,
});

describe("plan notifications: which blocks prompt, and when", () => {
  it("a timed block is one occurrence at its local start time (IST)", () => {
    const [slot] = slotsFor([item({ at: "18:00" })], "2026-11-28", "Asia/Kolkata", null);
    expect(slot!.slotKey).toBe("at:18:00");
    expect(slot!.dueAt.toISOString()).toBe("2026-11-28T12:30:00.000Z");
    expect(slot!.expiresAt.toISOString()).toBe("2026-11-28T18:30:00.000Z");   // local midnight
  });
  it("at a non-IST time, including across a clock change", () => {
    const [ny] = slotsFor([item({ at: "18:00" })], "2026-11-28", "America/New_York", null);
    expect(ny!.dueAt.toISOString()).toBe("2026-11-28T23:00:00.000Z");
    // Europe/London on the day clocks go back (25 Oct 2026): 09:00 is BST→GMT after 02:00.
    const [ldn] = slotsFor([item({ at: "09:00" })], "2026-10-25", "Europe/London", null);
    expect(ldn!.dueAt.toISOString()).toBe("2026-10-25T09:00:00.000Z");
  });
  it("blocks at the same time are one message", () => {
    const slots = slotsFor([item({ id: "a", at: "18:00" }), item({ id: "b", title: "Read ch 4", at: "18:00" }), item({ id: "c", at: "20:00" })], "2026-11-28", "Asia/Kolkata", null);
    expect(slots.map(s => [s.slotKey, s.items.map(i => i.id)])).toEqual([["at:18:00", ["a", "b"]], ["at:20:00", ["c"]]]);
  });
  it("ordered blocks: the first one at check-in; none without a check-in time", () => {
    const items = [item({ id: "a" }), item({ id: "b" })];
    expect(slotsFor(items, "2026-11-28", "Asia/Kolkata", 9 * 60).map(s => [s.slotKey, s.items[0]!.id])).toEqual([["checkin", "a"]]);
    expect(slotsFor(items, "2026-11-28", "Asia/Kolkata", null)).toEqual([]);
  });
  it("'If there's time', started, done blocks never prompt by themselves", () => {
    const items = [item({ id: "a", status: "later", at: "18:00" }), item({ id: "b", status: "active", at: "19:00" }), item({ id: "c", status: "done", at: "20:00" }), item({ id: "d", status: "later" })];
    expect(slotsFor(items, "2026-11-28", "Asia/Kolkata", 9 * 60)).toEqual([]);
  });
});

describe("the message", () => {
  it("names the block, its time and its length, with the three buttons", () => {
    const m = reminderMessage({ id: "occ1", source: "day_plan", slotKey: "at:18:00" }, [{ id: "a", title: "Operating Systems", minutes: 25, taskId: null, topicId: "t" }], "18:00");
    expect(m.text).toBe("6:00 PM · Your plan: Operating Systems, 25 minutes. Ready to start?");
    expect(m.buttons.flat().map(b => [b.text, b.callback_data])).toEqual([["Start 25 min", "r:occ1:s0"], ["Remind me later", "r:occ1:l"], ["Skip this block", "r:occ1:k"]]);
  });
  it("blocks at one time: one Start each", () => {
    const m = reminderMessage({ id: "o", source: "day_plan", slotKey: "at:18:00" }, [{ id: "a", title: "OS", minutes: 25, taskId: null, topicId: null }, { id: "b", title: "DBMS", minutes: 20, taskId: null, topicId: null }], "18:00");
    expect(m.text).toBe("6:00 PM · Your plan: OS, 25 minutes; DBMS, 20 minutes. Ready to start?");
    expect(m.buttons.flat().map(b => b.text)).toEqual(["Start OS · 25 min", "Start DBMS · 20 min", "Remind me later", "Skip this block"]);
  });
  it("12-hour clock", () => {
    expect(["00:05", "09:30", "12:00", "23:45"].map(clock12)).toEqual(["12:05 AM", "9:30 AM", "12:00 PM", "11:45 PM"]);
  });
});

describe("reminder buttons", () => {
  it("decode only their closed vocabulary", () => {
    expect(decodeReminderCallback("r:abc:s0")).toEqual({ occurrenceId: "abc", code: { kind: "start", index: 0 } });
    expect(decodeReminderCallback("r:abc:l")).toEqual({ occurrenceId: "abc", code: { kind: "later_menu" } });
    expect(decodeReminderCallback("r:abc:l15")).toEqual({ occurrenceId: "abc", code: { kind: "snooze", minutes: 15 } });
    expect(decodeReminderCallback("r:abc:l60")).toEqual({ occurrenceId: "abc", code: { kind: "snooze", minutes: 60 } });
    expect(decodeReminderCallback("r:abc:a1830")).toEqual({ occurrenceId: "abc", code: { kind: "at", at: "18:30" } });
    expect(decodeReminderCallback("r:abc:t")).toEqual({ occurrenceId: "abc", code: { kind: "tomorrow" } });
    expect(decodeReminderCallback("r:abc:k")).toEqual({ occurrenceId: "abc", code: { kind: "skip" } });
    for (const bad of ["r:abc:l7", "r:abc:s9", "r:abc:a2599", "p:abc:a", "r::k", "r:abc", "r:abc:k:x", "r:abc:zz"]) expect(decodeReminderCallback(bad)).toBeNull();
  });
  it("Pick a time offers the next times at least 30 minutes ahead, before midnight", () => {
    expect(pickTimes(17 * 60 + 40)).toEqual(["18:30", "19:30", "20:30"]);
    expect(pickTimes(23 * 60 + 10)).toEqual([]);
    expect(pickTimes(22 * 60 + 50)).toEqual(["23:30"]);
  });
  it("dayEnd is the zone's next midnight", () => {
    expect(dayEnd("2026-11-28", "America/New_York").toISOString()).toBe("2026-11-29T05:00:00.000Z");
  });
});

describe("eligibility, re-read before every send and tap", () => {
  const o = { source: "day_plan" as const, items: [{ id: "a", title: "OS", minutes: 25, taskId: null, topicId: "t1" }] };
  it("a block still planned is offered; removed, started, done or moved to later is not", () => {
    expect(stillEligible(o, [item({ id: "a" })]).map(i => i.id)).toEqual(["a"]);
    for (const status of ["active", "done", "later"] as const) expect(stillEligible(o, [item({ id: "a", status })])).toEqual([]);
    expect(stillEligible(o, [])).toEqual([]);
  });
  it("a title edit keeps it, and the message names the new title", () => {
    expect(stillEligible(o, [item({ id: "a", title: "Operating Systems II" })])[0]!.title).toBe("Operating Systems II");
  });
  it("a reminder carried to tomorrow matches the new day's block by what it points at", () => {
    const carried = { ...o, source: "carried" as const };
    expect(stillEligible(carried, [item({ id: "new-id", topicId: "t1" })]).map(i => i.id)).toEqual(["new-id"]);
    expect(stillEligible(carried, [item({ id: "x", topicId: "t2" })])).toEqual([]);
  });
});
