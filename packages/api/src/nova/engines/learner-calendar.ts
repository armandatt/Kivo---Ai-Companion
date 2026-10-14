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

// A stored date is a day, not a moment. Nova writes the day a learner gave
// as noon UTC on that day (product/exams.ts, examInstant), and older rows were
// written as midnight UTC. Either way its UTC day is the day they meant,
// wherever they are: read in a zone twelve or more hours from UTC, noon UTC
// is already the next day (or still the one before). Any other instant is a
// real moment and is read in the learner's zone.
export function isDateOnlyInstant(at: Date): boolean {
  const minuteOfDay = at.getUTCHours() * 60 + at.getUTCMinutes();
  return at.getUTCSeconds() === 0 && at.getUTCMilliseconds() === 0 && (minuteOfDay === 720 || minuteOfDay === 0);
}

// The learner's calendar day a stored date falls on.
export function dateDayKey(at: Date, timezone: string | null): string {
  return isDateOnlyInstant(at) ? at.toISOString().slice(0, 10) : dayKey(at, resolveTimezone(timezone));
}

// Whole calendar days from now to a stored date (an exam or another
// deadline), in the learner's timezone: 0 is today, 1 is tomorrow, whatever
// the hour. This is what "in N days" means to a person; elapsed time rounded
// up calls tomorrow afternoon's exam "in 2 days" all morning.
export function calendarDaysUntil(at: Date, now: Date, timezone: string | null): number {
  return Math.max(0, dayNumber(dateDayKey(at, timezone)) - dayNumber(dayKey(now, resolveTimezone(timezone))));
}

export const dayKeyOfNumber = (day: number): string => new Date(day * DAY_MS).toISOString().slice(0, 10);

// The Monday of the week a day falls in.
export const mondayOf = (day: number): number => day - ((new Date(day * DAY_MS).getUTCDay() + 6) % 7);

// The clock hour (0–23) of an instant, in a timezone.
export function localHour(date: Date, timezone: string): number {
  const hour = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(date);
  return Number(hour) % 24;
}

// Minutes past the hour (0–59) of an instant, in a timezone. Not every zone
// is a whole number of hours from UTC, so this is asked of the zone too.
export function localMinute(date: Date, timezone: string): number {
  const minute = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, minute: "2-digit" }).format(date);
  return Number(minute) % 60;
}
