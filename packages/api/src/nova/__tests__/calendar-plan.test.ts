import { DEFAULT_PLAN, freeStretches, isMissed, planOrder, proposeTimes, type Busy, type PlanTask } from "../product/calendar-plan";

const TZ = "Asia/Kolkata";
const at = (day: string, hhmm: string) => new Date(`${day}T${hhmm}:00+05:30`);
const task = (id: string, minutes: number, dueDay: string | null, priority: PlanTask["priority"] = null): PlanTask => ({ id, title: id, minutes, dueDay, priority });

describe("finding time for tasks (calendar-plan)", () => {
  it("orders exam-linked first, then priority, then due day, then the shorter task (Plan your time, 28 Nov)", () => {
    const exam = { ...task("exam", 60, "2026-12-09", "low"), examLinked: true };
    const order = planOrder([task("later", 30, "2026-12-05", "high"), task("long", 120, "2026-12-01"), task("short", 30, "2026-12-01"), task("none", 30, null, "high"), task("hi", 60, "2026-12-01", "high"), exam]);
    expect(order.map(t => t.id)).toEqual(["exam", "hi", "later", "none", "short", "long"]);
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
    // Due today and the 4 h day is full: not placed after its deadline, and says why.
    expect(b).toMatchObject({ day: null });
    expect(b.reason).toMatch(/Over your daily limit every day up to its deadline/);
    expect(huge).toMatchObject({ taskId: "huge", minutes: 180, split: true });                 // a first block of a long task
    expect(proposeTimes({ tasks: [task("x", 90, null)], busy: [{ start: at("2026-11-26", "09:00"), end: at("2026-11-26", "21:00") }], timezone: TZ, today: "2026-11-26", now, settings: { horizonDays: 1 } })[0])
      .toMatchObject({ day: null, late: true });
  });

  it("never plans on avoided weekdays or exam days; an overdue task gets the earliest time", () => {
    const now = at("2026-11-26", "09:00");   // a Thursday
    const p = proposeTimes({ tasks: [task("late", 60, "2026-11-20")], busy: [], timezone: TZ, today: "2026-11-26", now, settings: { avoidDays: [4] }, examDays: ["2026-11-27"] });
    expect(p[0]).toMatchObject({ day: "2026-11-28", late: false });
  });

  it("32 tasks under a 4 h cap: no day over 4 h, nothing overlaps, every unplaced one has a reason", () => {
    const now = at("2026-11-26", "09:00");
    const busy: Busy[] = [{ start: at("2026-11-27", "10:00"), end: at("2026-11-27", "12:00") }, { start: at("2026-11-28", "14:00"), end: at("2026-11-28", "15:30") }];
    const tasks = Array.from({ length: 32 }, (_, i) => task(`t${i}`, [25, 45, 90, 60][i % 4]!, i % 3 === 0 ? "2026-11-20" : i % 3 === 1 ? "2026-11-29" : null, (["high", "medium", "low", null] as const)[i % 4]));
    const props = proposeTimes({ tasks, busy, timezone: TZ, today: "2026-11-26", now, settings: { focusPerDay: 240 } });
    const placed = props.filter(p => p.day);
    const perDay = new Map<string, number>();
    for (const p of placed) perDay.set(p.day!, (perDay.get(p.day!) ?? 0) + p.minutes);
    for (const m of perDay.values()) expect(m).toBeLessThanOrEqual(240);
    const all = [...placed.map(p => ({ s: p.start!.getTime(), e: p.end!.getTime() })), ...busy.map(b => ({ s: b.start.getTime(), e: b.end.getTime() }))].sort((x, y) => x.s - y.s);
    for (let i = 1; i < all.length; i++) expect(all[i]!.s).toBeGreaterThanOrEqual(all[i - 1]!.e);
    for (const p of props.filter(p => !p.day)) expect(p.reason).toBeTruthy();
    expect(placed.every(p => p.start!.getTime() >= now.getTime())).toBe(true);
  });

  it("a block near local midnight lands on the right day in another zone", () => {
    const NY = "America/New_York";
    const now = new Date("2026-11-27T03:00:00Z");   // 22:00 on 26 Nov in New York
    const p = proposeTimes({ tasks: [task("x", 30, null)], busy: [], timezone: NY, today: "2026-11-26", now, settings: { dayStart: 22 * 60, dayEnd: 24 * 60 } });
    expect(p[0]).toMatchObject({ day: "2026-11-26" });
    expect(p[0]!.start!.toISOString()).toBe("2026-11-27T03:00:00.000Z");
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
