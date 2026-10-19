// The calendar's rules, without a database: what an event may be, which days
// it is on, when its reminder is due and what the reminder says.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  checkEvent, checkRange, clockMinute, draftOf, isCalendarDay, reminderAt, reminderBlock, reminderKey, reminderText,
  type EventFields,
} from "../product/calendar-rules";
import { zonedInstant, clockTime } from "../engines/learner-calendar";
import { ALL_DAY_REMINDERS, TIMED_REMINDERS } from "../product/calendar.types";

const read = (path: string) => readFileSync(join(__dirname, "..", path), "utf8");
const ok = (raw: unknown, base = null, zone = "Asia/Kolkata") => {
  const r = checkEvent(raw, base, zone);
  if (!r.ok) throw new Error(`refused: ${r.error} ${r.message}`);
  return r.fields;
};

describe("a day is a day", () => {
  it("reads only real days, 2000–2100", () => {
    expect(isCalendarDay("2026-02-28")).toBe(true);
    for (const bad of ["2026-02-30", "2026-2-3", "26-02-03", "2026/02/03", "1999-12-31", "2101-01-01", 20260203, null]) expect(isCalendarDay(bad)).toBe(false);
    expect(clockMinute("09:05")).toBe(545);
    for (const bad of ["9:05", "24:00", "12:60", "ab:cd"]) expect(clockMinute(bad)).toBeNull();
  });

  it("an all-day event is stored as days only, and its days never move with a zone", () => {
    for (const zone of ["Pacific/Kiritimati", "Pacific/Pago_Pago", "UTC", "America/New_York"]) {
      const e = ok({ title: "Holi", allDay: true, startDay: "2026-03-04", timezone: zone });
      expect([e.startDay, e.endDay, e.startAt, e.endAt]).toEqual(["2026-03-04", "2026-03-04", null, null]);
    }
    const trip = ok({ title: "Trip", allDay: true, startDay: "2026-12-30", endDay: "2027-01-02" });
    expect([trip.startDay, trip.endDay]).toEqual(["2026-12-30", "2027-01-02"]);
  });

  it("a timed event is the moment its wall-clock time names in its zone, DST included", () => {
    const kolkata = ok({ title: "Lab", startDay: "2026-11-03", startTime: "14:30", endTime: "16:00", timezone: "Asia/Kolkata" });
    expect(kolkata.startAt!.toISOString()).toBe("2026-11-03T09:00:00.000Z");
    expect(kolkata.endAt!.toISOString()).toBe("2026-11-03T10:30:00.000Z");
    // New York, before and after the clocks change: the same 09:00 on the wall.
    expect(ok({ title: "A", startDay: "2026-03-07", startTime: "09:00", timezone: "America/New_York" }).startAt!.toISOString()).toBe("2026-03-07T14:00:00.000Z");
    expect(ok({ title: "B", startDay: "2026-03-09", startTime: "09:00", timezone: "America/New_York" }).startAt!.toISOString()).toBe("2026-03-09T13:00:00.000Z");
    // A time the clocks skip lands after the gap; a repeated one is the first.
    expect(clockTime(zonedInstant("2026-03-08", 150, "America/New_York"), "America/New_York")).toBe("03:30");
    expect(zonedInstant("2026-11-01", 90, "America/New_York").toISOString()).toBe("2026-11-01T05:30:00.000Z");
    // Late at night in a zone ahead of UTC is still that local day.
    const late = ok({ title: "Late", startDay: "2026-06-01", startTime: "00:30", timezone: "Pacific/Kiritimati" });
    expect(late.startDay).toBe("2026-06-01");
    expect(late.startAt!.toISOString()).toBe("2026-05-31T10:30:00.000Z");
  });

  it("an overnight event spans its two days; an edit shows the times it was given", () => {
    const night = ok({ title: "Night shift", startDay: "2026-10-20", endDay: "2026-10-21", startTime: "22:00", endTime: "06:00" });
    expect([night.startDay, night.endDay]).toEqual(["2026-10-20", "2026-10-21"]);
    const draft = draftOf(night);
    expect([draft.startTime, draft.endTime, draft.endDay]).toEqual(["22:00", "06:00", "2026-10-21"]);
  });
});

describe("what an event may be", () => {
  const base = { title: "Lab", startDay: "2026-11-03", startTime: "14:30" };
  const refused = (raw: unknown) => { const r = checkEvent(raw, null, "UTC"); return r.ok ? null : r.error; };

  it("refuses what cannot be saved, with the reason", () => {
    expect(refused({ ...base, title: "  " })).toBe("no_title");
    expect(refused({ ...base, title: "x".repeat(121) })).toBe("title_too_long");
    expect(refused({ ...base, category: "party" })).toBe("bad_category");
    expect(refused({ ...base, startDay: "2026-11-31" })).toBe("bad_day");
    expect(refused({ ...base, startTime: undefined })).toBe("bad_time");
    expect(refused({ ...base, endTime: "14:00" })).toBe("end_before_start");
    expect(refused({ ...base, endDay: "2026-11-02" })).toBe("end_before_start");
    expect(refused({ ...base, endDay: "2026-11-04" })).toBe("bad_time");          // over a day with no end time
    expect(refused({ title: "Long", allDay: true, startDay: "2026-01-01", endDay: "2026-02-15" })).toBe("too_long");
    expect(refused({ ...base, timezone: "Mars/Olympus" })).toBe("bad_timezone");
    expect(refused({ ...base, reminderMinutes: 7 })).toBe("bad_reminder");
    expect(refused({ title: "Day", allDay: true, startDay: "2026-11-03", reminderMinutes: 30 })).toBe("bad_reminder");
    expect(refused({ ...base, taskId: "" })).toBe("bad_task");
    expect(refused("nope")).toBe("invalid");
  });

  it("offers only the fixed reminder choices", () => {
    for (const c of TIMED_REMINDERS) expect(refused({ ...base, reminderMinutes: c.minutes })).toBeNull();
    for (const c of ALL_DAY_REMINDERS) expect(refused({ title: "D", allDay: true, startDay: "2026-11-03", reminderMinutes: c.minutes })).toBeNull();
  });

  it("a change names only what changes, and the whole event is checked again", () => {
    const saved = ok({ ...base, endTime: "16:00", reminderMinutes: 30, timezone: "Asia/Kolkata" });
    const moved = ok({ startDay: "2026-11-05" }, draftOf(saved) as never);
    expect(moved.title).toBe("Lab");
    expect(moved.startAt!.toISOString()).toBe("2026-11-05T09:00:00.000Z");
    expect(moved.endAt!.toISOString()).toBe("2026-11-05T10:30:00.000Z");
    expect(moved.reminderMinutes).toBe(30);
    // Made all day: the timed reminder no longer fits and must be chosen again.
    expect(checkEvent({ allDay: true }, draftOf(saved), "UTC")).toMatchObject({ ok: false, error: "bad_reminder" });
    expect(ok({ allDay: true, reminderMinutes: 0 }, draftOf(saved) as never).startAt).toBeNull();
  });
});

describe("reminders", () => {
  const fields = (raw: Record<string, unknown>): EventFields => ok({ title: "Physics lab", ...raw });

  it("a timed event's reminder counts back from its start", () => {
    const e = fields({ startDay: "2026-11-03", startTime: "14:30", timezone: "Asia/Kolkata", reminderMinutes: 30 });
    expect(reminderAt(e)!.toISOString()).toBe("2026-11-03T08:30:00.000Z");   // 14:00 in Kolkata
    expect(reminderAt({ ...e, reminderMinutes: null })).toBeNull();
  });

  it("an all-day event's reminder is 09:00 on its day (or the day before) in its own zone", () => {
    const e = fields({ allDay: true, startDay: "2026-11-03", timezone: "America/New_York", reminderMinutes: 0 });
    expect(reminderAt(e)!.toISOString()).toBe("2026-11-03T14:00:00.000Z");   // 09:00 EST
    const before = fields({ allDay: true, startDay: "2026-11-02", timezone: "America/New_York", reminderMinutes: 1440 });
    expect(reminderAt(before)!.toISOString()).toBe("2026-11-01T14:00:00.000Z"); // 09:00 EST on 1 Nov (the clocks changed that night)
  });

  it("the key names the moment: a moved event or reminder is a new occurrence, the old one is never claimed", () => {
    const a = fields({ startDay: "2026-11-03", startTime: "14:30", reminderMinutes: 30 });
    const b = fields({ startDay: "2026-11-03", startTime: "15:30", reminderMinutes: 30 });
    expect(reminderKey("ev1", reminderAt(a)!)).not.toBe(reminderKey("ev1", reminderAt(b)!));
    expect(reminderKey("ev1", reminderAt(a)!)).toBe(reminderKey("ev1", reminderAt({ ...a })!));
  });

  it("says what is on record, in the event's own time, and nothing else", () => {
    const e = fields({ startDay: "2026-11-03", startTime: "14:30", endTime: "16:00", timezone: "Asia/Kolkata", category: "class" });
    expect(reminderText(e, new Date("2026-11-03T08:30:00Z"))).toBe("Reminder: Physics lab at 14:30–16:00 today. Class.");
    expect(reminderText(e, new Date("2026-11-02T08:30:00Z"))).toBe("Reminder: Physics lab at 14:30–16:00 tomorrow. Class.");
    expect(reminderText(e, new Date("2026-11-03T09:10:00Z"))).toBe("Reminder: Physics lab started at 14:30–16:00 today. Class.");
    const day = fields({ allDay: true, startDay: "2026-11-05", timezone: "Asia/Kolkata", category: "personal" });
    expect(reminderText(day, new Date("2026-11-03T03:30:00Z"))).toBe("Reminder: Physics lab, on Thursday 5 November. Personal.");
  });

  it("goes only to a linked Nova chat that has not refused delivery; nudges being off does not stop it", () => {
    expect(reminderBlock({ platform: "web", persona: "nova" }, null)).toBe("not_connected");
    expect(reminderBlock({ platform: "telegram", persona: "rex" }, null)).toBe("not_connected");
    expect(reminderBlock({ platform: "telegram", persona: "nova" }, { undeliverableSince: new Date() })).toBe("blocked");
    expect(reminderBlock({ platform: "telegram", persona: "nova" }, { undeliverableSince: null })).toBeNull();
    expect(reminderBlock({ platform: "telegram", persona: "nova" }, null)).toBeNull();
  });

  it("is written by code: the reminder job calls no model and adds no second timer or outbox", () => {
    const job = read("proactive/event-reminders.ts");
    for (const banned of ["generateOpenAIText", "wordProactiveMessage", "setInterval", "setTimeout", "novaProactiveMessage.create"]) {
      expect([banned, job.includes(banned)]).toEqual([banned, false]);
    }
    expect(job).toContain("claimOccurrence(");
    expect(read("product/calendar-rules.ts")).not.toContain("openai");
  });
});

describe("the page's range", () => {
  it("is a real span of at most the limit", () => {
    expect(checkRange("2026-10-01", "2026-11-11", 62)).toEqual({ from: "2026-10-01", to: "2026-11-11" });
    expect(checkRange("2026-10-02", "2026-10-01", 62)).toBeNull();
    expect(checkRange("2026-01-01", "2026-06-01", 62)).toBeNull();
    expect(checkRange("x", "2026-06-01", 62)).toBeNull();
  });
});

describe("one source of truth (read from source)", () => {
  it("only calendar.ts touches calendar events; tasks and deadlines are read through their owners", () => {
    const calendar = read("product/calendar.ts");
    expect(calendar).not.toContain("prisma.novaTask");
    expect(calendar).not.toContain("prisma.novaExam");
    expect(calendar).toContain("listTasksDueBetween(");
    expect(calendar).toContain("listDeadlinesBetween(");
    for (const file of ["product/tasks.ts", "product/exams.ts", "product/planner.ts", "product/today.ts", "nova-orchestrator.ts"]) {
      expect([file, read(file).includes("novaCalendarEvent")]).toEqual([file, false]);
    }
  });

  it("every query of an event carries the learner's profile", () => {
    const calendar = read("product/calendar.ts");
    const calls = calendar.split("prisma.novaCalendarEvent.").slice(1).map(s => s.slice(0, 160));
    expect(calls.length).toBeGreaterThan(5);
    for (const call of calls) expect([call.slice(0, 60), call.includes("profileId")]).toEqual([call.slice(0, 60), true]);
  });

  it("reminders stay out of the proactive cap and the proactive tick's recovery", () => {
    const outbox = read("proactive/proactive-outbox.ts");
    const delivered = outbox.slice(outbox.indexOf("export async function loadDelivered"), outbox.indexOf("export async function claimOccurrence"));
    expect(delivered.split("eventType: NOT_A_REMINDER").length - 1).toBe(2);
    const recover = outbox.slice(outbox.indexOf("export async function recoverPending"), outbox.indexOf("// ── Calendar reminders"));
    expect(recover.split("eventType: NOT_A_REMINDER").length - 1).toBe(3);
  });
});
