// Repeating calendar events, without a database: which days a series is on,
// when each occurrence's reminder is due, and what a change may be.
// "Every Wednesday at 8 pm, the contest" is the case that asked for it.

import {
  checkEvent, nextReminder, occurrenceOfReminder, occurrencesBetween, remindAtFor, reminderKey, reminderKeyMoment, reminderText,
  startsOn, type EventFields,
} from "../product/calendar-rules";

const ok = (raw: unknown, base: Parameters<typeof checkEvent>[1] = null, zone = "Asia/Kolkata"): EventFields => {
  const r = checkEvent(raw, base, zone);
  if (!r.ok) throw new Error(`refused: ${r.error} ${r.message}`);
  return r.fields;
};
const refused = (raw: unknown) => {
  const r = checkEvent(raw, null, "Asia/Kolkata");
  return r.ok ? null : r.error;
};

// Wednesday 21 October 2026, 20:00–21:30 in Kolkata, every week, reminded 30 minutes before.
const CONTEST = { title: "Contest", category: "other", startDay: "2026-10-21", startTime: "20:00", endTime: "21:30", reminderMinutes: 30, repeat: { freq: "weekly" } };

describe("what a repeating event may be", () => {
  it("weekly defaults to the weekday it starts on", () => {
    const e = ok(CONTEST);
    expect(e.repeat).toEqual({ freq: "weekly", days: [3], until: null });
    expect(e.skipDays).toEqual([]);
  });

  it("keeps chosen weekdays, sorted, once each", () => {
    expect(ok({ ...CONTEST, repeat: { freq: "weekly", days: [5, 1, 5] } }).repeat!.days).toEqual([1, 5]);
  });

  it("refuses a rule it cannot keep", () => {
    expect(refused({ ...CONTEST, repeat: { freq: "hourly" } })).toBe("bad_repeat");
    expect(refused({ ...CONTEST, repeat: { freq: "weekly", days: [] } })).toBe("bad_repeat");
    expect(refused({ ...CONTEST, repeat: { freq: "weekly", days: [7] } })).toBe("bad_repeat");
    expect(refused({ ...CONTEST, repeat: { freq: "weekly", until: "2026-10-01" } })).toBe("bad_repeat");
    expect(refused({ ...CONTEST, repeat: { freq: "daily", until: "2026-13-01" } })).toBe("bad_repeat");
    // An occurrence that would run into the next one.
    expect(refused({ title: "Night", startDay: "2026-10-21", startTime: "23:00", endDay: "2026-10-22", endTime: "01:00", repeat: { freq: "daily" } })).toBe("bad_repeat");
    expect(refused({ title: "Trip", allDay: true, startDay: "2026-10-21", endDay: "2026-10-28", repeat: { freq: "weekly" } })).toBe("bad_repeat");
  });

  it("a change that names other things keeps the rule; stopping clears removed dates", () => {
    const series = { ...ok(CONTEST), skipDays: ["2026-10-28"] };
    const draft = { title: series.title, description: null, category: series.category, allDay: false, startDay: series.startDay, endDay: null,
      startTime: "20:00", endTime: "21:30", timezone: series.timezone, reminderMinutes: 30, taskId: null, subjectId: null,
      repeat: series.repeat, skipDays: series.skipDays };
    const renamed = ok({ title: "Weekly contest" }, draft);
    expect(renamed.repeat).toEqual(series.repeat);
    expect(renamed.skipDays).toEqual(["2026-10-28"]);
    const once = ok({ repeat: null }, draft);
    expect([once.repeat, once.skipDays]).toEqual([null, []]);
  });
});

describe("which days a series is on", () => {
  it("every Wednesday, at the same wall-clock time", () => {
    const e = ok(CONTEST);
    const occ = occurrencesBetween(e, "2026-10-19", "2026-11-15");
    expect(occ.map(o => o.startDay)).toEqual(["2026-10-21", "2026-10-28", "2026-11-04", "2026-11-11"]);
    // 20:00 in Kolkata is 14:30 UTC, every week.
    expect(occ.map(o => o.startAt!.toISOString().slice(11, 16))).toEqual(["14:30", "14:30", "14:30", "14:30"]);
    expect(occ[1]!.endAt!.toISOString()).toBe("2026-10-28T16:00:00.000Z");
  });

  it("stays at 20:00 local across a clock change", () => {
    const ny = ok({ ...CONTEST, startDay: "2026-03-04", timezone: "America/New_York" });
    const [before, after] = occurrencesBetween(ny, "2026-03-01", "2026-03-12");
    expect(before!.startAt!.toISOString()).toBe("2026-03-05T01:00:00.000Z");   // EST
    expect(after!.startAt!.toISOString()).toBe("2026-03-12T00:00:00.000Z");    // EDT
  });

  it("not before it starts, not after its last day, and not on a removed date", () => {
    const e = { ...ok({ ...CONTEST, repeat: { freq: "weekly", until: "2026-11-04" } }), skipDays: ["2026-10-28"] };
    expect(occurrencesBetween(e, "2026-10-01", "2026-12-31").map(o => o.startDay)).toEqual(["2026-10-21", "2026-11-04"]);
    expect(startsOn(e, "2026-10-28")).toBe(true);     // still one of its days; it was removed
    expect(startsOn(e, "2026-10-14")).toBe(false);
  });

  it("daily, several weekdays, and monthly", () => {
    const daily = ok({ title: "Revise", allDay: true, startDay: "2026-10-30", repeat: { freq: "daily" } });
    expect(occurrencesBetween(daily, "2026-10-29", "2026-11-02").map(o => o.startDay)).toEqual(["2026-10-30", "2026-10-31", "2026-11-01", "2026-11-02"]);
    const classes = ok({ title: "Lab", startDay: "2026-10-19", startTime: "10:00", endTime: "11:00", repeat: { freq: "weekly", days: [1, 3, 5] } });
    expect(occurrencesBetween(classes, "2026-10-19", "2026-10-25").map(o => o.startDay)).toEqual(["2026-10-19", "2026-10-21", "2026-10-23"]);
    // A month without the 31st has none.
    const rent = ok({ title: "Rent", allDay: true, startDay: "2026-01-31", repeat: { freq: "monthly" } });
    expect(occurrencesBetween(rent, "2026-01-01", "2026-05-31").map(o => o.startDay)).toEqual(["2026-01-31", "2026-03-31", "2026-05-31"]);
  });

  it("an all-day series over two days covers both days of each", () => {
    const fest = ok({ title: "Fest", allDay: true, startDay: "2026-10-24", endDay: "2026-10-25", repeat: { freq: "weekly" } });
    const occ = occurrencesBetween(fest, "2026-10-25", "2026-11-01");
    expect(occ.map(o => [o.startDay, o.endDay])).toEqual([["2026-10-24", "2026-10-25"], ["2026-10-31", "2026-11-01"]]);
  });
});

describe("reminders for a series", () => {
  const e = ok(CONTEST);

  it("is the next occurrence's, 30 minutes before 20:00", () => {
    const before = new Date("2026-10-21T10:00:00Z");
    expect(nextReminder(e, before)!.at.toISOString()).toBe("2026-10-21T14:00:00.000Z");
    // Once that one has gone, the next Wednesday's.
    expect(nextReminder(e, new Date("2026-10-21T14:00:00Z"))!.at.toISOString()).toBe("2026-10-28T14:00:00.000Z");
  });

  it("a write stores the one not yet past the grace period", () => {
    expect(remindAtFor(e, new Date("2026-10-21T14:10:00Z"))!.toISOString()).toBe("2026-10-21T14:00:00.000Z");
    expect(remindAtFor(e, new Date("2026-10-21T15:00:00Z"))!.toISOString()).toBe("2026-10-28T14:00:00.000Z");
  });

  it("skips removed dates and ends with the series", () => {
    const skipped = { ...e, skipDays: ["2026-10-28"] };
    expect(nextReminder(skipped, new Date("2026-10-22T00:00:00Z"))!.at.toISOString()).toBe("2026-11-04T14:00:00.000Z");
    const ending = ok({ ...CONTEST, repeat: { freq: "weekly", until: "2026-10-21" } });
    expect(nextReminder(ending, new Date("2026-10-22T00:00:00Z"))).toBeNull();
    expect(nextReminder({ ...e, reminderMinutes: null }, new Date("2026-10-20T00:00:00Z"))).toBeNull();
  });

  it("a claimed moment is still sendable only while the event still has it", () => {
    const at = new Date("2026-10-28T14:00:00Z");
    expect(occurrenceOfReminder(e, at)!.startDay).toBe("2026-10-28");
    expect(occurrenceOfReminder({ ...e, skipDays: ["2026-10-28"] }, at)).toBeNull();
    expect(occurrenceOfReminder({ ...e, reminderMinutes: 10 }, at)).toBeNull();
    expect(occurrenceOfReminder(e, new Date("2026-10-28T14:05:00Z"))).toBeNull();
  });

  it("each occurrence has its own key, and the key gives its moment back", () => {
    const at = new Date("2026-10-28T14:00:00Z");
    const key = reminderKey("ev1", at);
    expect(key).not.toBe(reminderKey("ev1", new Date("2026-10-21T14:00:00Z")));
    expect(reminderKeyMoment(key, "ev1")!.toISOString()).toBe(at.toISOString());
    expect(reminderKeyMoment(key, "ev2")).toBeNull();
    expect(reminderKeyMoment("event:ev1:nonsense", "ev1")).toBeNull();
  });

  it("the text names that occurrence's time", () => {
    const occ = occurrenceOfReminder(e, new Date("2026-10-28T14:00:00Z"))!;
    expect(reminderText({ ...e, ...occ }, new Date("2026-10-28T14:00:00Z"))).toBe("Reminder: Contest at 20:00–21:30 today. Other.");
  });
});
