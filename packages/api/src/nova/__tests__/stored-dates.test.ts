// A date a learner gives (an exam, an interview, something due) is a day,
// not a moment. It is stored as noon UTC on that day, and it must read as
// that day, and count down to it, wherever the learner is: twelve or more
// hours from UTC included, where noon UTC is already another day.

import { calendarDaysUntil, dateDayKey, dayKey, isDateOnlyInstant } from "../engines/learner-calendar";

jest.mock("@repo/db/client", () => ({ prisma: {} }));
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { examInstant } = require("../product/exams") as typeof import("../product/exams");

const ZONES = [
  "Pacific/Kiritimati",  // UTC+14
  "Pacific/Auckland",    // UTC+13 in October
  "Pacific/Fiji",        // UTC+12
  "Asia/Kolkata",        // UTC+5:30
  "UTC",
  "America/Los_Angeles", // UTC−7
  "Pacific/Pago_Pago",   // UTC−11
  "Etc/GMT+12",          // UTC−12
];

// Each hour of one local day in a zone, as instants.
function hoursOfLocalDay(zone: string, day: string): Date[] {
  const out: Date[] = [];
  const start = Date.parse(`${day}T00:00:00Z`) - 16 * 3_600_000;
  for (let t = start; t < start + 56 * 3_600_000; t += 3_600_000) {
    const d = new Date(t);
    if (dayKey(d, zone) === day) out.push(d);
  }
  return out;
}

describe("a stored date reads as the day the learner gave, in every timezone", () => {
  it.each(ZONES)("%s: a date two days ahead is 'in 2 days' at every hour of today, and is that day", zone => {
    const today = "2026-10-14";
    const hours = hoursOfLocalDay(zone, today);
    expect(hours.length).toBeGreaterThanOrEqual(23);
    for (const now of hours) {
      for (const [given, expected] of [["2026-10-14", 0], ["2026-10-15", 1], ["2026-10-16", 2], ["2026-10-21", 7]] as const) {
        const stored = examInstant(given);
        expect(dateDayKey(stored, zone)).toBe(given);
        expect(calendarDaysUntil(stored, now, zone)).toBe(expected);
      }
    }
  });

  it("the case that was wrong: Auckland in summer read noon UTC as the next day", () => {
    const stored = examInstant("2026-10-16");
    const now = new Date("2026-10-14T20:00:00Z");                      // 09:00 on the 15th in Auckland
    expect(dayKey(stored, "Pacific/Auckland")).toBe("2026-10-17");      // the old reading
    expect(dateDayKey(stored, "Pacific/Auckland")).toBe("2026-10-16");
    expect(calendarDaysUntil(stored, now, "Pacific/Auckland")).toBe(1); // tomorrow, not 2
  });

  it("older rows written at midnight UTC read as their day too, even west of UTC", () => {
    const stored = new Date("2026-10-16T00:00:00.000Z");
    expect(isDateOnlyInstant(stored)).toBe(true);
    expect(dateDayKey(stored, "America/Los_Angeles")).toBe("2026-10-16");
  });

  it("a real moment is still read in the learner's zone", () => {
    const moment = new Date("2026-10-16T18:45:00.000Z");
    expect(isDateOnlyInstant(moment)).toBe(false);
    expect(dateDayKey(moment, "Asia/Kolkata")).toBe("2026-10-17");
    expect(dateDayKey(moment, "America/Los_Angeles")).toBe("2026-10-16");
  });
});
