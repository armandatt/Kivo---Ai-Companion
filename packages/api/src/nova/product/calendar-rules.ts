// ─── Calendar rules ───────────────────────────────────────────────────────────
// What an event may be, when its reminder is due, and what the reminder says.
// Pure: no DB, no model, no clock but the one passed in. calendar.ts applies
// these; event-reminders.ts sends what they schedule.
//
// A day is a day: an all-day event is stored as calendar days and nothing
// else, so it never moves when a timezone does. A timed event is stored as
// moments, worked out on the server from the wall-clock times and the zone
// they were given in.

import { clockTime, currentZoneName, dayKey, dayNumber, dayKeyOfNumber, isValidTimezone, zonedInstant } from "../engines/learner-calendar";
import {
  ALL_DAY_REMINDERS, ALL_DAY_REMINDER_HOUR, EVENT_CATEGORIES, EVENT_DESCRIPTION_MAX, EVENT_KEY_MAX, EVENT_SPAN_MAX_DAYS,
  EVENT_TITLE_MAX, EVENT_CATEGORY_LABEL, REPEAT_FREQS, TIMED_REMINDERS,
  type CalendarError, type CalendarEventInput, type EventCategory, type RepeatFreq, type RepeatRule,
} from "./calendar.types";

const DIGITS = "0123456789";
const isDigits = (s: string) => s.length > 0 && [...s].every(ch => DIGITS.includes(ch));

// YYYY-MM-DD naming a real day between 2000 and 2100.
export function isCalendarDay(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== 10 || value[4] !== "-" || value[7] !== "-") return false;
  const [y, m, d] = [value.slice(0, 4), value.slice(5, 7), value.slice(8, 10)];
  if (!isDigits(y) || !isDigits(m) || !isDigits(d)) return false;
  const year = Number(y);
  if (year < 2000 || year > 2100) return false;
  return dayKeyOfNumber(dayNumber(value)) === value;
}

// "HH:MM" as minutes after midnight, or null.
export function clockMinute(value: unknown): number | null {
  if (typeof value !== "string" || value.length !== 5 || value[2] !== ":") return null;
  const [h, m] = [value.slice(0, 2), value.slice(3, 5)];
  if (!isDigits(h) || !isDigits(m)) return null;
  const hour = Number(h), minute = Number(m);
  return hour <= 23 && minute <= 59 ? hour * 60 + minute : null;
}

// Whitespace and control characters collapsed to single spaces.
const oneLine = (text: string): string =>
  [...text].map(ch => (ch.trim() === "" || ch.charCodeAt(0) < 32 || ch.charCodeAt(0) === 127 ? " " : ch)).join("").split(" ").filter(Boolean).join(" ");

// An event as it is stored (less the ids the database gives it).
export interface EventFields {
  title:           string;
  description:     string | null;
  category:        EventCategory;
  allDay:          boolean;
  startDay:        string;
  endDay:          string;
  startAt:         Date | null;
  endAt:           Date | null;
  timezone:        string;
  reminderMinutes: number | null;
  taskId:          string | null;
  subjectId:       string | null;
  // How it repeats (null: once), and the occurrences the learner removed.
  repeat:          RepeatRule | null;
  skipDays:        string[];
}

// The same event as the page edits it: wall-clock times in its own zone.
export interface EventDraft {
  title:           string;
  description:     string | null;
  category:        EventCategory;
  allDay:          boolean;
  startDay:        string;
  endDay:          string | null;
  startTime:       string | null;
  endTime:         string | null;
  timezone:        string;
  reminderMinutes: number | null;
  taskId:          string | null;
  subjectId:       string | null;
  repeat:          RepeatRule | null;
  // Not edited as such: kept through a change, cleared when it stops repeating.
  skipDays:        string[];
}

export function draftOf(fields: EventFields): EventDraft {
  return {
    title: fields.title, description: fields.description, category: fields.category, allDay: fields.allDay,
    startDay: fields.startDay, endDay: fields.endDay === fields.startDay ? null : fields.endDay,
    startTime: fields.startAt ? clockTime(fields.startAt, fields.timezone) : null,
    endTime:   fields.endAt ? clockTime(fields.endAt, fields.timezone) : null,
    timezone: fields.timezone, reminderMinutes: fields.reminderMinutes, taskId: fields.taskId, subjectId: fields.subjectId,
    repeat: fields.repeat, skipDays: fields.skipDays,
  };
}

export type EventCheck =
  | { ok: true; fields: EventFields; clientKey: string | null }
  | { ok: false; error: CalendarError; message: string };

const fail = (error: CalendarError, message: string): EventCheck => ({ ok: false, error, message });

// Checks a create (base null) or a change to an existing event (base: it, as
// a draft). A change names only what changes; everything is checked whole
// afterwards, so a change cannot leave an event that a create would refuse.
export function checkEvent(raw: unknown, base: EventDraft | null, defaultZone: string): EventCheck {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return fail("invalid", "Nothing to save.");
  const input = raw as Record<string, unknown> & CalendarEventInput;
  const has = (key: keyof CalendarEventInput) => Object.prototype.hasOwnProperty.call(input, key) && input[key] !== undefined;

  const pick = (key: keyof EventDraft & keyof CalendarEventInput, fallback: unknown): unknown =>
    has(key) ? input[key] : base ? base[key] : fallback;

  // Title
  const rawTitle = pick("title", "");
  if (typeof rawTitle !== "string") return fail("no_title", "Give it a title.");
  const title = oneLine(rawTitle);
  if (!title) return fail("no_title", "Give it a title.");
  if ([...title].length > EVENT_TITLE_MAX) return fail("title_too_long", `Keep the title to ${EVENT_TITLE_MAX} characters.`);

  // Description: kept as typed (line endings unified), or none.
  const rawDescription = pick("description", null);
  if (rawDescription !== null && typeof rawDescription !== "string") return fail("invalid", "The description should be text.");
  const description = typeof rawDescription === "string" && rawDescription.trim() ? rawDescription.split("\r\n").join("\n").trim() : null;
  if (description && description.length > EVENT_DESCRIPTION_MAX) return fail("description_too_long", `Keep the description to ${EVENT_DESCRIPTION_MAX} characters.`);

  const category = pick("category", "other");
  if (typeof category !== "string" || !(EVENT_CATEGORIES as readonly string[]).includes(category)) return fail("bad_category", "Choose a kind of event.");

  const allDay = pick("allDay", false);
  if (typeof allDay !== "boolean") return fail("invalid", "Say whether it lasts all day.");

  // Timezone: the one given, else the event's own, else the learner's.
  const rawZone = pick("timezone", defaultZone);
  if (typeof rawZone !== "string" || rawZone.length > 64 || !isValidTimezone(rawZone)) return fail("bad_timezone", "That timezone isn't one Kivo knows.");
  const timezone = currentZoneName(rawZone);

  // Days
  const startDay = pick("startDay", null);
  if (!isCalendarDay(startDay)) return fail("bad_day", "Choose the day it starts.");
  const rawEndDay = pick("endDay", null);
  if (rawEndDay !== null && !isCalendarDay(rawEndDay)) return fail("bad_day", "Choose a real day for the end.");
  const endDay = (rawEndDay as string | null) ?? startDay;
  if (endDay < startDay) return fail("end_before_start", "It can't end before it starts.");
  if (dayNumber(endDay) - dayNumber(startDay) + 1 > EVENT_SPAN_MAX_DAYS) return fail("too_long", `An event can span at most ${EVENT_SPAN_MAX_DAYS} days.`);

  // Times: only for a timed event, worked out in its zone.
  let startAt: Date | null = null, endAt: Date | null = null;
  if (!allDay) {
    const start = clockMinute(pick("startTime", null));
    if (start === null) return fail("bad_time", "Choose the time it starts, or make it all day.");
    startAt = zonedInstant(startDay, start, timezone);
    const rawEnd = pick("endTime", null);
    if (rawEnd !== null) {
      const end = clockMinute(rawEnd);
      if (end === null) return fail("bad_time", "Choose a real time for the end.");
      endAt = zonedInstant(endDay, end, timezone);
      if (endAt.getTime() <= startAt.getTime()) return fail("end_before_start", "It has to end after it starts.");
    } else if (endDay !== startDay) {
      return fail("bad_time", "Give an end time for an event that runs over more than one day.");
    }
  }

  // Reminder: one of the fixed choices for this kind of event, or none.
  const rawReminder = pick("reminderMinutes", null);
  let reminderMinutes: number | null = null;
  if (rawReminder !== null) {
    const choices = allDay ? ALL_DAY_REMINDERS : TIMED_REMINDERS;
    if (typeof rawReminder !== "number" || !choices.some(c => c.minutes === rawReminder)) return fail("bad_reminder", "Choose one of the reminder times.");
    reminderMinutes = rawReminder;
  }

  const taskId = pick("taskId", null);
  if (taskId !== null && (typeof taskId !== "string" || !taskId || taskId.length > 64)) return fail("bad_task", "That task isn't one of yours.");
  const subjectId = pick("subjectId", null);
  if (subjectId !== null && (typeof subjectId !== "string" || !subjectId || subjectId.length > 64)) return fail("bad_subject", "That subject isn't one of yours.");

  // The days it really starts and ends on: a timed event's are where its
  // moments fall in its zone.
  const firstDay = startAt ? dayKey(startAt, timezone) : startDay;
  const lastDay  = startAt ? dayKey(endAt ?? startAt, timezone) : endDay;

  // Repeating: a rule the series can keep without one occurrence running
  // into the next.
  const rawRepeat = pick("repeat", null);
  let repeat: RepeatRule | null = null;
  if (rawRepeat !== null) {
    if (typeof rawRepeat !== "object" || Array.isArray(rawRepeat)) return fail("bad_repeat", "Choose how often it repeats.");
    const rule = rawRepeat as { freq?: unknown; days?: unknown; until?: unknown };
    if (typeof rule.freq !== "string" || !(REPEAT_FREQS as readonly string[]).includes(rule.freq)) return fail("bad_repeat", "Choose how often it repeats.");
    const freq = rule.freq as RepeatFreq;
    let days: number[] = [];
    if (freq === "weekly") {
      const given = rule.days === undefined || rule.days === null ? [weekdayOf(firstDay)] : rule.days;
      if (!Array.isArray(given) || given.length === 0 || given.length > 7 || !given.every(d => Number.isInteger(d) && d >= 0 && d <= 6)) {
        return fail("bad_repeat", "Choose the days of the week it repeats on.");
      }
      days = [...new Set(given as number[])].sort((a, b) => a - b);
    }
    const until = rule.until ?? null;
    if (until !== null && !isCalendarDay(until)) return fail("bad_repeat", "Choose a real day for it to stop repeating.");
    if (until !== null && until < firstDay) return fail("bad_repeat", "It can't stop repeating before it starts.");
    const span = dayNumber(lastDay) - dayNumber(firstDay);
    const gap  = freq === "daily" ? 1 : freq === "monthly" ? 28 : days.length > 1 ? 1 : 7;
    if (span >= gap) return fail("bad_repeat", freq === "monthly" ? "A monthly event has to be shorter than a month." : "A repeating event has to end before the next one starts.");
    repeat = { freq, days, until: until as string | null };
  }
  const skipDays = repeat ? (base?.skipDays ?? []) : [];

  let clientKey: string | null = null;
  if (!base && has("clientKey")) {
    if (typeof input.clientKey !== "string" || !input.clientKey.trim() || input.clientKey.length > EVENT_KEY_MAX) return fail("invalid", "That request can't be told apart from another.");
    clientKey = input.clientKey.trim();
  }

  return {
    ok: true,
    clientKey,
    fields: {
      title, description, category: category as EventCategory, allDay, startDay: firstDay, endDay: lastDay,
      startAt, endAt, timezone, reminderMinutes,
      taskId: taskId as string | null, subjectId: subjectId as string | null,
      repeat, skipDays,
    },
  };
}

// When the reminder is due, or null when there is none. A timed event counts
// back from its start; an all-day event from 09:00 on its first day, in its zone.
export function reminderAt(event: Pick<EventFields, "allDay" | "startDay" | "startAt" | "timezone" | "reminderMinutes">): Date | null {
  if (event.reminderMinutes === null) return null;
  const anchor = event.allDay || !event.startAt
    ? zonedInstant(event.startDay, ALL_DAY_REMINDER_HOUR * 60, event.timezone)
    : event.startAt;
  return new Date(anchor.getTime() - event.reminderMinutes * 60_000);
}

// ── Repeating events ─────────────────────────────────────────────────────────
// A repeating event is one row: its first occurrence and a rule. Every other
// occurrence is worked out here from those, on the learner's calendar in the
// event's zone, so a weekly 20:00 stays 20:00 across a clock change.

const weekdayOf = (day: string): number => new Date(`${day}T12:00:00Z`).getUTCDay();

export interface Occurrence { startDay: string; endDay: string; startAt: Date | null; endAt: Date | null }

export type Series = Pick<EventFields, "allDay" | "startDay" | "endDay" | "startAt" | "endAt" | "timezone" | "repeat" | "skipDays">;

// Whether the series has an occurrence starting on this day, removed ones included.
export function startsOn(series: Pick<Series, "startDay" | "repeat">, day: string): boolean {
  const rule = series.repeat;
  if (!rule) return day === series.startDay;
  if (day < series.startDay || (rule.until !== null && day > rule.until)) return false;
  switch (rule.freq) {
    case "daily":   return true;
    case "weekly":  return (rule.days.length > 0 ? rule.days : [weekdayOf(series.startDay)]).includes(weekdayOf(day));
    case "monthly": return day.slice(8) === series.startDay.slice(8);
  }
}

// The occurrence that starts on a day: the first one's days and wall-clock
// times, moved to that day.
export function occurrenceOn(series: Series, day: string): Occurrence {
  if (!series.repeat || day === series.startDay) {
    return { startDay: series.startDay, endDay: series.endDay, startAt: series.startAt, endAt: series.endAt };
  }
  const span = dayNumber(series.endDay) - dayNumber(series.startDay);
  if (series.allDay || !series.startAt) return { startDay: day, endDay: dayKeyOfNumber(dayNumber(day) + span), startAt: null, endAt: null };
  const startAt = zonedInstant(day, clockMinute(clockTime(series.startAt, series.timezone)) ?? 0, series.timezone);
  const endAt = series.endAt
    ? zonedInstant(dayKeyOfNumber(dayNumber(day) + span), clockMinute(clockTime(series.endAt, series.timezone)) ?? 0, series.timezone)
    : null;
  return { startDay: dayKey(startAt, series.timezone), endDay: dayKey(endAt ?? startAt, series.timezone), startAt, endAt };
}

// Every occurrence that touches the days from..to, in order.
export function occurrencesBetween(series: Series, from: string, to: string): Occurrence[] {
  if (!series.repeat) return series.startDay <= to && series.endDay >= from ? [occurrenceOn(series, series.startDay)] : [];
  const span = dayNumber(series.endDay) - dayNumber(series.startDay);
  const skipped = new Set(series.skipDays);
  const first = Math.max(dayNumber(series.startDay), dayNumber(from) - span);
  const last  = Math.min(dayNumber(to), series.repeat.until !== null ? dayNumber(series.repeat.until) : Number.POSITIVE_INFINITY);
  const out: Occurrence[] = [];
  for (let n = first; n <= last; n++) {
    const day = dayKeyOfNumber(n);
    if (startsOn(series, day) && !skipped.has(day)) out.push(occurrenceOn(series, day));
  }
  return out;
}

// How far ahead the next reminder is looked for. A monthly series on the
// 31st has gaps of two months; a year covers any rule with removed dates.
const LOOKAHEAD_DAYS = 400;

// The first reminder of the series later than `after`, and its occurrence.
export function nextReminder(
  series: Series & Pick<EventFields, "reminderMinutes">,
  after:  Date,
): { at: Date; occurrence: Occurrence } | null {
  if (series.reminderMinutes === null) return null;
  if (!series.repeat) {
    const at = reminderAt(series);
    return at && at.getTime() > after.getTime() ? { at, occurrence: occurrenceOn(series, series.startDay) } : null;
  }
  const skipped = new Set(series.skipDays);
  // An occurrence's reminder comes before it starts, so one later than
  // `after` belongs to an occurrence starting on or after that day.
  const from = Math.max(dayNumber(series.startDay), dayNumber(dayKey(after, series.timezone)));
  for (let n = from; n <= from + LOOKAHEAD_DAYS; n++) {
    const day = dayKeyOfNumber(n);
    if (series.repeat.until !== null && day > series.repeat.until) return null;
    if (!startsOn(series, day) || skipped.has(day)) continue;
    const occurrence = occurrenceOn(series, day);
    const at = reminderAt({ ...series, ...occurrence });
    if (at && at.getTime() > after.getTime()) return { at, occurrence };
  }
  return null;
}

// What remindAt is stored as on a write. A one-off event: its reminder. A
// repeating one: the next occurrence's that is not yet past the grace
// period, so a reminder due a moment ago still goes out.
export function remindAtFor(series: Series & Pick<EventFields, "reminderMinutes">, now: Date): Date | null {
  if (!series.repeat) return reminderAt(series);
  return nextReminder(series, new Date(now.getTime() - REMINDER_GRACE_MINUTES * 60_000))?.at ?? null;
}

// The occurrence a reminder moment belongs to, or null when the event (as it
// is now) has no reminder at that moment: it was moved, its rule changed,
// the occurrence was removed, or the reminder was turned off.
export function occurrenceOfReminder(series: Series & Pick<EventFields, "reminderMinutes">, at: Date): Occurrence | null {
  const found = nextReminder(series, new Date(at.getTime() - 1));
  return found && found.at.getTime() === at.getTime() ? found.occurrence : null;
}

// The moment named in a reminder's key ("event:<id>:<ISO>"), or null.
export function reminderKeyMoment(key: string, eventId: string): Date | null {
  const prefix = `event:${eventId}:`;
  if (!key.startsWith(prefix)) return null;
  const at = new Date(key.slice(prefix.length));
  return Number.isFinite(at.getTime()) ? at : null;
}

// The one key an occurrence of a reminder is claimed under. It names the
// moment, so moving the event (or its reminder) makes a new occurrence and
// the old one is never sent.
export const reminderKey = (eventId: string, at: Date): string => `event:${eventId}:${at.toISOString()}`;

// How long after its time a reminder may still go out. Later than this it is
// "missed": a reminder for something already well under way helps nobody.
export const REMINDER_GRACE_MINUTES = 30;

// The reminder's text, written by code: no model words it, so it states
// exactly what is on record and nothing else. Times are the event's own zone.
export function reminderText(
  event: Pick<EventFields, "title" | "allDay" | "startDay" | "endDay" | "startAt" | "endAt" | "timezone" | "category">,
  now: Date,
): string {
  const title = oneLine(event.title).slice(0, EVENT_TITLE_MAX);
  const label = EVENT_CATEGORY_LABEL[event.category];
  const today = dayKey(now, event.timezone);
  const dayWord = (day: string) => {
    const gap = dayNumber(day) - dayNumber(today);
    if (gap === 0) return "today";
    if (gap === 1) return "tomorrow";
    return `on ${new Date(`${day}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" })}`;
  };
  if (event.allDay || !event.startAt) {
    const span = event.endDay !== event.startDay ? ` (until ${dayWord(event.endDay).replace("on ", "")})` : "";
    return `Reminder: ${title}, ${dayWord(event.startDay)}${span}. ${label}.`;
  }
  const start = clockTime(event.startAt, event.timezone);
  const end = event.endAt ? `–${clockTime(event.endAt, event.timezone)}` : "";
  const started = event.startAt.getTime() <= now.getTime();
  return started
    ? `Reminder: ${title} started at ${start}${end} ${dayWord(event.startDay)}. ${label}.`
    : `Reminder: ${title} at ${start}${end} ${dayWord(event.startDay)}. ${label}.`;
}

// Why a learner cannot be sent a reminder now, or null when they can. The
// calendar page (calendar.ts) and the tick (event-reminders.ts) both ask
// this, so what the page promises is what the tick sends.
//
// Turning Nova's nudges off on Telegram (NovaTelegramChannel.proactiveEnabled)
// does not stop reminders: a reminder is one the learner asked for on that
// event, which is its own notification choice. A chat that refuses delivery,
// or no chat at all, does.
export function reminderBlock(
  user: { platform: string; persona: string | null },
  channel: { undeliverableSince: Date | null } | null,
): "not_connected" | "blocked" | null {
  if (user.platform !== "telegram" || user.persona !== "nova") return "not_connected";
  if (channel?.undeliverableSince) return "blocked";
  return null;
}

// The days from..to inclusive, if that is a range the page may ask for.
export function checkRange(from: unknown, to: unknown, maxDays: number): { from: string; to: string } | null {
  if (!isCalendarDay(from) || !isCalendarDay(to) || to < from) return null;
  return dayNumber(to) - dayNumber(from) + 1 <= maxDays ? { from, to } : null;
}
