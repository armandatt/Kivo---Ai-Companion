// K-11: "the week ahead" is today and the six days after it, in the
// learner's own calendar, across week, month and year boundaries.
import { daysFrom, weekOf, dayKey } from "../product/planner";

describe("the week ahead (K-11)", () => {
  test("from a Sunday: that Sunday and the six days after, not Monday to Sunday", () => {
    // 2026-11-22 is a Sunday.
    expect(daysFrom("2026-11-22")).toEqual(["2026-11-22", "2026-11-23", "2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27", "2026-11-28"]);
    expect(weekOf("2026-11-22")[0]).toBe("2026-11-16"); // the calendar week started six days before
  });
  test("from a Monday", () => {
    expect(daysFrom("2026-11-23")[0]).toBe("2026-11-23");
    expect(daysFrom("2026-11-23")[6]).toBe("2026-11-29");
  });
  test("across a month end", () => {
    expect(daysFrom("2026-11-28")).toEqual(["2026-11-28", "2026-11-29", "2026-11-30", "2026-12-01", "2026-12-02", "2026-12-03", "2026-12-04"]);
    expect(daysFrom("2028-02-27")).toEqual(["2028-02-27", "2028-02-28", "2028-02-29", "2028-03-01", "2028-03-02", "2028-03-03", "2028-03-04"]);
  });
  test("across a year end", () => {
    expect(daysFrom("2026-12-29")).toEqual(["2026-12-29", "2026-12-30", "2026-12-31", "2027-01-01", "2027-01-02", "2027-01-03", "2027-01-04"]);
  });
  test("today is the learner's day, not the server's", () => {
    // 20:00 UTC on Saturday 21 Nov is already Sunday 22 Nov in India, still Saturday in New York.
    const at = new Date("2026-11-21T20:00:00Z");
    expect(daysFrom(dayKey(at, "Asia/Kolkata"))[0]).toBe("2026-11-22");
    expect(daysFrom(dayKey(at, "America/New_York"))[0]).toBe("2026-11-21");
  });
});
