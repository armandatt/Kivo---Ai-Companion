// ─── Learner calendar ─────────────────────────────────────────────────────────
// Days, weeks and clock hours in the learner's own timezone. Pure: no DB.
// Every reader that draws a day boundary (Planner, Progress, Learning DNA)
// uses these, so a session never falls on two different days.

const DAY_MS = 86_400_000;

// A stored zone that is not a real IANA zone counts as none.
export function isValidTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-CA", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

// Browsers still report some zones under the name they had before a rename.
// The stored name is the current one.
const RENAMED_ZONES: Record<string, string> = {
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Rangoon":  "Asia/Yangon",
  "Asia/Saigon":   "Asia/Ho_Chi_Minh",
  "Europe/Kiev":   "Europe/Kyiv",
};
export function currentZoneName(timezone: string): string {
  const renamed = RENAMED_ZONES[timezone];
  return renamed && isValidTimezone(renamed) ? renamed : timezone;
}

export function resolveTimezone(timezone: string | null): string {
  return timezone && isValidTimezone(timezone) ? timezone : "UTC";
}

// YYYY-MM-DD of an instant, in a timezone.
export function dayKey(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(date);
}

// A day key as a whole number of days, so that gaps and weeks are subtraction.
export function dayNumber(key: string): number {
  const [y, m, d] = key.split("-").map(Number) as [number, number, number];
  return Math.floor(Date.UTC(y, m - 1, d) / DAY_MS);
}

// Whole calendar days from now to an instant, in the learner's timezone:
// 0 is today, 1 is tomorrow, whatever the hour. This is what "in N days"
// means to a person; elapsed time rounded up calls tomorrow afternoon's exam
// "in 2 days" all morning.
export function calendarDaysUntil(at: Date, now: Date, timezone: string | null): number {
  const zone = resolveTimezone(timezone);
  return Math.max(0, dayNumber(dayKey(at, zone)) - dayNumber(dayKey(now, zone)));
}

export const dayKeyOfNumber = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

// The Monday of the week a day falls in.
export const mondayOf = (day: number): number => day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);

// The clock hour (0–23) of an instant, in a timezone.
export function localHour(date: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(date);
  return Number(hour) % 24;
}
