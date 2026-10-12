// When an open session stops being a session. The rule, with no database.
//   running   study time reaches the planned length plus thirty minutes
//   paused    one pause lasts two hours
// and what is kept of it: never more than was planned, never time made up.

import {
  ABANDON_FALLBACK_PLANNED_MINUTES, ABANDON_GRACE_MINUTES, ABANDON_PAUSED_MINUTES,
  abandonmentPlanMinutes, sessionAbandonment, sessionElapsedSeconds,
} from "../engines/session-clock";

const START = new Date("2026-10-12T10:00:00Z");
const at    = (minutes: number, seconds = 0) => new Date(START.getTime() + minutes * 60_000 + seconds * 1000);
const running = (planned: number | null, pausedSeconds = 0) =>
  ({ startedAt: START, status: "in_progress", pausedAt: null, totalPausedSeconds: pausedSeconds, plannedDurationMinutes: planned });
const paused = (planned: number | null, pausedAtMinute: number, earlierPausedSeconds = 0) =>
  ({ startedAt: START, status: "paused", pausedAt: at(pausedAtMinute), totalPausedSeconds: earlierPausedSeconds, plannedDurationMinutes: planned });

describe("the limits", () => {
  it("are thirty minutes past the plan, sixty minutes when there is no plan, and two hours paused", () => {
    expect([ABANDON_GRACE_MINUTES, ABANDON_FALLBACK_PLANNED_MINUTES, ABANDON_PAUSED_MINUTES]).toEqual([30, 60, 120]);
  });
});

describe("a running session with a planned length", () => {
  it("planned 25 minutes: still a session at 54:59 of study, abandoned at 55:00", () => {
    expect(sessionAbandonment(running(25), at(54, 59))).toBeNull();
    expect(sessionAbandonment(running(25), at(55))).toEqual({ reason: "ran_past_plan", countedMinutes: 25 });
  });

  it("keeps the planned length at most, however long it sat open", () => {
    expect(sessionAbandonment(running(25), at(3 * 24 * 60))).toEqual({ reason: "ran_past_plan", countedMinutes: 25 });
    expect(sessionAbandonment(running(45), at(500))?.countedMinutes).toBe(45);
  });

  it("paused time does not count toward the limit", () => {
    // 100 minutes on the wall, 60 of them paused: 40 of study, under 55.
    expect(sessionAbandonment(running(25, 60 * 60), at(100))).toBeNull();
    // 115 on the wall, 60 paused: 55 of study.
    expect(sessionAbandonment(running(25, 60 * 60), at(115))).toEqual({ reason: "ran_past_plan", countedMinutes: 25 });
  });
});

describe("a session started with no length", () => {
  it("is held to sixty minutes: still a session at 89:59, abandoned at 90:00", () => {
    expect(sessionAbandonment(running(null), at(89, 59))).toBeNull();
    expect(sessionAbandonment(running(null), at(90))).toEqual({ reason: "ran_past_plan", countedMinutes: 60 });
  });

  it("a planned length that is not a usable number is treated the same way", () => {
    for (const planned of [0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(abandonmentPlanMinutes(planned)).toBe(60);
      expect(sessionAbandonment(running(planned), at(89))).toBeNull();
      expect(sessionAbandonment(running(planned), at(90))?.countedMinutes).toBe(60);
    }
    expect(abandonmentPlanMinutes(undefined)).toBe(60);
  });
});

describe("a paused session", () => {
  it("is abandoned after two hours of one pause, however little was studied", () => {
    // Studied 5 minutes, then paused.
    expect(sessionAbandonment(paused(25, 5), at(5 + 119, 59))).toBeNull();
    expect(sessionAbandonment(paused(25, 5), at(5 + 120))).toEqual({ reason: "paused_too_long", countedMinutes: 5 });
  });

  it("stands still while paused: the study limit is not reached by waiting", () => {
    // Paused at 50 minutes of study on a 25-minute plan: 5 short of the limit, and it stays there.
    expect(sessionElapsedSeconds(paused(25, 50), at(50 + 100))).toBe(50 * 60);
    expect(sessionAbandonment(paused(25, 50), at(50 + 100))).toBeNull();
  });

  it("a resume starts the pause count again: earlier pauses are not added to this one", () => {
    // Paused 110 minutes earlier, resumed, and paused again half an hour ago.
    const again = paused(25, 130, 110 * 60);
    expect(sessionAbandonment(again, at(130 + 30))).toBeNull();
    expect(sessionAbandonment(again, at(130 + 120))?.reason).toBe("paused_too_long");
    // And once resumed it is a running session again, judged on study time alone.
    expect(sessionAbandonment(running(25, 110 * 60), at(130))).toBeNull();
  });
});

describe("what is never abandoned", () => {
  it("a session that is already closed, whatever its clock says", () => {
    for (const status of ["completed", "skipped", "abandoned"]) {
      expect(sessionAbandonment({ ...running(25), status }, at(10_000))).toBeNull();
    }
  });
});

describe("timestamps that are not times", () => {
  const broken = new Date("not a date");

  it("give no study time", () => {
    expect(sessionElapsedSeconds({ ...running(25), startedAt: broken }, at(500))).toBe(0);
    expect(sessionElapsedSeconds(running(25), broken)).toBe(0);
    expect(sessionElapsedSeconds(running(25, Number.NaN), at(500))).toBe(0);
  });

  it("a start in the future, or a pause before the start, is no study time and not a reason to abandon", () => {
    expect(sessionElapsedSeconds({ ...running(25), startedAt: at(600) }, at(500))).toBe(0);
    expect(sessionAbandonment({ ...running(25), startedAt: at(600) }, at(500))).toBeNull();
    expect(sessionElapsedSeconds(paused(25, -30), at(60))).toBe(0);
  });

  it("an unreadable start never becomes recorded time, and an unreadable pause is not counted as two hours", () => {
    expect(sessionAbandonment({ ...running(25), startedAt: broken }, at(100_000))).toBeNull();
    expect(sessionAbandonment({ ...paused(25, 5), pausedAt: broken }, at(100_000))).toBeNull();
  });

  it("a session marked paused with no pause time is judged as a running one, and still capped", () => {
    expect(sessionAbandonment({ ...running(null), status: "paused" }, at(3 * 24 * 60))).toEqual({ reason: "ran_past_plan", countedMinutes: 60 });
  });
});
