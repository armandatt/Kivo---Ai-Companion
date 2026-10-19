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
  EVENT_TITLE_MAX, EVENT_CATEGORY_LABEL, TIMED_REMINDERS,
  type CalendarError, type CalendarEventInput, type EventCategory,
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
}

export function draftOf(fields: EventFields): EventDraft {
  return {
    title: fields.title, description: fields.description, category: fields.category, allDay: fields.allDay,
    startDay: fields.startDay, endDay: fields.endDay === fields.startDay ? null : fields.endDay,
    startTime: fields.startAt ? clockTime(fields.startAt, fields.timezone) : null,
    endTime:   fields.endAt ? clockTime(fields.endAt, fields.timezone) : null,
    timezone: fields.timezone, reminderMinutes: fields.reminderMinutes, taskId: fields.taskId, subjectId: fields.subjectId,
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

  let clientKey: string | null = null;
  if (!base && has("clientKey")) {
    if (typeof input.clientKey !== "string" || !input.clientKey.trim() || input.clientKey.length > EVENT_KEY_MAX) return fail("invalid", "That request can't be told apart from another.");
    clientKey = input.clientKey.trim();
  }

  return {
    ok: true,
    clientKey,
    fields: {
      title, description, category: category as EventCategory, allDay, startDay, endDay,
      // A timed event's days are the ones its moments fall on in its zone.
      ...(startAt ? { startDay: dayKey(startAt, timezone), endDay: dayKey(endAt ?? startAt, timezone) } : {}),
      startAt, endAt, timezone, reminderMinutes,
      taskId: taskId as string | null, subjectId: subjectId as string | null,
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
