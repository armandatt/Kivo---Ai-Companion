import { DEFAULT_PLAN, freeStretches, isMissed, planOrder, proposeTimes, type Busy, type PlanTask } from "../product/calendar-plan";

const TZ = "Asia/Kolkata";
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);
const task = (id: string, minutes: number, dueDay: string | null, priority: PlanTask["priority"] = null): PlanTask => ({ id, title: id, minutes, dueDay, priority });

describe("finding time for tasks (calendar-plan)", () => {
  it("orders by due day, then priority, then the shorter task", () => {
    const order = planOrder([task("later", 30, "2026-12-05", "high"), task("long", 120, "2026-12-01"), task("short", 30, "2026-12-01"), task("none", 30, null, "high"), task("hi", 60, "2026-12-01", "high")]);
    expect(order.map(t => t.id)).toEqual(["hi", "short", "long", "later", "none"]);
  });

  it("finds gaps inside working hours, after now, around busy time with a buffer", () => {
    const busy: Busy[] = [{ start: at("2026-11-26", "10:00"), end: at("2026-11-26", "11:00") }];
    const free = freeStretches("2026-11-26", busy, DEFAULT_PLAN, TZ, at("2026-11-26", "08:00"));
    expect(free.map(f => [f.start.toISOString(), f.end.toISOString()])).toEqual([
      [at("2026-11-26", "09:00").toISOString(), at("2026-11-26", "10:00").toISOString()],
      [at("2026-11-26", "11:15").toISOString(), at("2026-11-26", "21:00").toISOString()],
    ]);
    // Never before now, rounded up to the quarter hour.
    expect(freeStretches("2026-11-26", [], DEFAULT_PLAN, TZ, at("2026-11-26", "14:07"))[0]!.start.toISOString()).toBe(at("2026-11-26", "14:15").toISOString());
  });

  it("proposes non-overlapping blocks, respects the day's focus limit, and flags late and unfit tasks", () => {
    const now = at("2026-11-26", "09:00");
    const props = proposeTimes({
      tasks: [task("a", 120, "2026-11-26", "high"), task("b", 120, "2026-11-26"), task("c", 60, "2026-11-26"), task("huge", 2000, null)],
      busy: [], timezone: TZ, today: "2026-11-26", now, settings: { focusPerDay: 240, horizonDays: 3 },
    });
    const by = (id: string) => props.find(p => p.taskId === id)!;
    const [a, b, c, huge] = [by("a"), by("b"), by("c"), by("huge")];
    expect(props.map(p => p.taskId)).toEqual(["a", "c", "b", "huge"]);                         // shorter first on the same due day
    expect(a).toMatchObject({ day: "2026-11-26", late: false });
    expect(c).toMatchObject({ day: "2026-11-26", late: false });
    expect(c.start!.getTime()).toBeGreaterThanOrEqual(a.end!.getTime() + 10 * 60_000);       // buffer, no overlap
    expect(b).toMatchObject({ day: "2026-11-27", late: true });                                // the 4 h day is full
    expect(b.reason).toMatch(/earliest after/);
    expect(huge).toMatchObject({ taskId: "huge", minutes: 180, split: true });                 // a first block of a long task
    expect(proposeTimes({ tasks: [task("x", 90, null)], busy: [{ start: at("2026-11-26", "09:00"), end: at("2026-11-26", "21:00") }], timezone: TZ, today: "2026-11-26", now, settings: { horizonDays: 1 } })[0])
      .toMatchObject({ day: null, late: true });
  });

  it("existing study blocks count toward the day's focus", () => {
    const now = at("2026-11-26", "09:00");
    const p = proposeTimes({ tasks: [task("t", 60, null)], busy: [{ start: at("2026-11-26", "18:00"), end: at("2026-11-26", "21:00"), studyMinutes: 200 }], timezone: TZ, today: "2026-11-26", now, settings: { focusPerDay: 240 } });
    expect(p[0]).toMatchObject({ day: "2026-11-27" });
  });

  it("a block for an unfinished task that has ended is missed", () => {
    const now = at("2026-11-26", "12:00");
    expect(isMissed({ endAt: at("2026-11-26", "11:00").toISOString(), task: { status: "todo" } }, now)).toBe(true);
    expect(isMissed({ endAt: at("2026-11-26", "11:00").toISOString(), task: { status: "done" } }, now)).toBe(false);
    expect(isMissed({ endAt: at("2026-11-26", "13:00").toISOString(), task: { status: "todo" } }, now)).toBe(false);
    expect(isMissed({ endAt: at("2026-11-26", "11:00").toISOString(), task: null }, now)).toBe(false);
  });
});
