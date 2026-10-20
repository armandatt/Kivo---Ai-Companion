// ─── Calendar ─────────────────────────────────────────────────────────────────
// The only code that reads or writes NovaCalendarEvent. The calendar page's
// read model puts those events beside the learner's tasks with a due day
// (read through tasks.ts) and their dated deadlines (read through exams.ts),
// so there is one calendar and no copy of a task or a deadline.
//
// Ownership: every query carries the learner's profile id, which the route
// takes from the session cookie. An id from the request only ever selects
// among that learner's own rows; another learner's event is "not found".
//
// An event is not evidence and not memory: writing one touches no session,
// mastery, plan, goal, fact or reality, and no engine reads events. A task an
// event is for stays the one record of that work.
//
// Reminders: each write works out remindAt (calendar-rules.ts). The tick
// sends what is due (proactive/event-reminders.ts); nothing else is
// scheduled, so a moved or deleted event leaves nothing behind to undo.
//
// A repeating event is one row and a rule. Its occurrences are worked out
// for the days asked for (occurrencesBetween); removing one occurrence adds
// its day to skipDays. remindAt is the next occurrence's reminder, and the
// tick moves it on after each one.

import { prisma } from "@repo/db/client";
import { dayKey, dayKeyOfNumber, dayNumber, resolveTimezone } from "../engines/learner-calendar";
import { reminderStatuses } from "../proactive/proactive-outbox";
import {
  checkEvent, checkRange, draftOf, occurrenceOn, occurrencesBetween, REMINDER_GRACE_MINUTES, reminderAt, remindAtFor, reminderBlock, reminderKey,
  startsOn, type EventFields, type Occurrence,
} from "./calendar-rules";
import {
  CALENDAR_RANGE_MAX_DAYS, EVENT_CATEGORIES, EVENT_SPAN_MAX_DAYS, REPEAT_FREQS, SKIP_DAYS_MAX,
  type CalendarDeadlineItem, type CalendarEventItem, type CalendarEventResponse, type CalendarReminderChannel,
  type CalendarTaskItem, type EventCategory, type NovaCalendarReady, type ReminderStatus, type RepeatFreq, type RepeatRule,
} from "./calendar.types";
import { DEADLINE_RULES } from "./deadline-types";
import { listDeadlinesBetween } from "./exams";
import { listTasks, listTasksDueBetween, tasksOwnedBy } from "./tasks";

// The most events one learner keeps on record. Far above any real calendar;
// it stops a runaway client, not a person.
export const EVENTS_MAX = 5000;

const ROW = {
  id: true, title: true, description: true, category: true, allDay: true, startDay: true, endDay: true,
  startAt: true, endAt: true, timezone: true, reminderMinutes: true, remindAt: true, taskId: true, subjectId: true,
  repeat: true, repeatDays: true, repeatUntil: true, skipDays: true,
  task: { select: { id: true, title: true, status: true } },
  subject: { select: { id: true, name: true } },
} as const;

type Row = {
  id: string; title: string; description: string | null; category: string; allDay: boolean; startDay: string; endDay: string;
  startAt: Date | null; endAt: Date | null; timezone: string; reminderMinutes: number | null; remindAt: Date | null;
  taskId: string | null; subjectId: string | null;
  repeat: string | null; repeatDays: number[]; repeatUntil: string | null; skipDays: string[];
  task: { id: string; title: string; status: string } | null;
  subject: { id: string; name: string } | null;
};

const asCategory = (value: string): EventCategory =>
  (EVENT_CATEGORIES as readonly string[]).includes(value) ? value as EventCategory : "other";

// The stored rule; an unknown value reads as "happens once".
const ruleOf = (row: Pick<Row, "repeat" | "repeatDays" | "repeatUntil">): RepeatRule | null =>
  row.repeat && (REPEAT_FREQS as readonly string[]).includes(row.repeat)
    ? { freq: row.repeat as RepeatFreq, days: row.repeat === "weekly" ? row.repeatDays : [], until: row.repeatUntil }
    : null;

const fieldsOf = (row: Row): EventFields => ({
  title: row.title, description: row.description, category: asCategory(row.category), allDay: row.allDay,
  startDay: row.startDay, endDay: row.endDay, startAt: row.startAt, endAt: row.endAt, timezone: row.timezone,
  reminderMinutes: row.reminderMinutes, taskId: row.taskId, subjectId: row.subjectId,
  repeat: ruleOf(row), skipDays: row.skipDays,
});

// Where a reminder stands, from its outbox row (if claimed) and the clock.
export function reminderStatusOf(at: Date, outboxStatus: string | undefined, channelOk: boolean, now: Date): ReminderStatus {
  if (outboxStatus === "sent" || outboxStatus === "unknown") return "sent";
  if (outboxStatus === "abandoned") return "failed";
  if (!channelOk) return "unavailable";
  if (outboxStatus) return at.getTime() + REMINDER_GRACE_MINUTES * 60_000 < now.getTime() ? "failed" : "scheduled";
  return at.getTime() + REMINDER_GRACE_MINUTES * 60_000 < now.getTime() ? "missed" : "scheduled";
}

// The reminder of one occurrence, and where it stands. A one-off event's is
// its remindAt. An occurrence of a repeating one has its own moment: claimed
// in the outbox, it stands as the outbox says; the one remindAt points at,
// or a later one, is scheduled; an earlier one never claimed (from before
// the event or its reminder existed) is not shown.
function occurrenceReminder(row: Row, fields: EventFields, occurrence: Occurrence, statuses: Map<string, string>, channelOk: boolean, now: Date): CalendarEventItem["reminder"] {
  if (!fields.repeat) {
    return row.remindAt
      ? { at: row.remindAt.toISOString(), status: reminderStatusOf(row.remindAt, statuses.get(reminderKey(row.id, row.remindAt)), channelOk, now) }
      : null;
  }
  const at = reminderAt({ ...fields, ...occurrence });
  if (!at) return null;
  const claimed = statuses.get(reminderKey(row.id, at));
  const current = row.remindAt !== null && at.getTime() >= row.remindAt.getTime();
  if (!claimed && !current) return null;
  return { at: at.toISOString(), status: reminderStatusOf(at, claimed, channelOk, now) };
}

function toItem(row: Row, occurrence: Occurrence, statuses: Map<string, string>, channelOk: boolean, now: Date): CalendarEventItem {
  const fields = fieldsOf(row);
  const draft = draftOf(fields);
  return {
    id: row.id, key: fields.repeat ? `${row.id}@${occurrence.startDay}` : row.id,
    title: row.title, description: row.description, category: asCategory(row.category), allDay: row.allDay,
    startDay: occurrence.startDay, endDay: occurrence.endDay,
    startAt: occurrence.startAt?.toISOString() ?? null, endAt: occurrence.endAt?.toISOString() ?? null,
    startTime: draft.startTime, endTime: draft.endTime, timezone: row.timezone,
    reminderMinutes: row.reminderMinutes,
    reminder: occurrenceReminder(row, fields, occurrence, statuses, channelOk, now),
    repeat: fields.repeat, seriesStartDay: row.startDay,
    task: row.task ? { id: row.task.id, title: row.task.title, status: row.task.status } : null,
    subject: row.subject ? { id: row.subject.id, name: row.subject.name } : null,
  };
}

// The learner's zone and where their reminders can go.
async function learnerOf(profileId: string): Promise<{ timezone: string; reminders: CalendarReminderChannel }> {
  const profile = await prisma.novaAcademicProfile.findUnique({
    where:  { id: profileId },
    select: {
      timezone:        true,
      user:            { select: { platform: true, persona: true } },
      telegramChannel: { select: { undeliverableSince: true } },
    },
  });
  const block = profile ? reminderBlock(profile.user, profile.telegramChannel) : "not_connected";
  return {
    timezone:  resolveTimezone(profile?.timezone ?? null),
    reminders: { channel: block ? "none" : "telegram", reason: block },
  };
}

// Each row's occurrences in from..to, as page items, with their reminders' standing.
async function itemsFor(profileId: string, rows: Row[], range: { from: string; to: string }, channelOk: boolean, now: Date): Promise<CalendarEventItem[]> {
  const placed = rows.flatMap(row => occurrencesBetween(fieldsOf(row), range.from, range.to).map(occurrence => ({ row, occurrence })));
  const keys = placed.flatMap(({ row, occurrence }) => {
    const at = row.repeat ? reminderAt({ ...fieldsOf(row), ...occurrence }) : row.remindAt;
    return at ? [reminderKey(row.id, at)] : [];
  });
  const statuses = await reminderStatuses(profileId, keys);
  return placed
    .map(({ row, occurrence }) => toItem(row, occurrence, statuses, channelOk, now))
    .sort((a, b) => a.startDay.localeCompare(b.startDay) || (a.startAt ?? "").localeCompare(b.startAt ?? ""));
}

export type CalendarLoad =
  | { ok: true; view: NovaCalendarReady }
  | { ok: false; error: "bad_range"; message: string };

// Everything on the calendar from..to (inclusive): events that overlap the
// range, tasks due in it, deadlines dated in it.
export async function loadCalendar(profileId: string, from: unknown, to: unknown, now = new Date()): Promise<CalendarLoad> {
  const range = checkRange(from, to, CALENDAR_RANGE_MAX_DAYS);
  if (!range) return { ok: false, error: "bad_range", message: `Ask for up to ${CALENDAR_RANGE_MAX_DAYS} days at a time.` };

  const learner = await learnerOf(profileId);
  const [rows, tasks, deadlines, board] = await Promise.all([
    // One-off events that overlap the range; repeating ones that started by
    // its end and have not stopped before it (less the longest span).
    prisma.novaCalendarEvent.findMany({
      where: {
        profileId,
        OR: [
          { repeat: null, startDay: { lte: range.to }, endDay: { gte: range.from } },
          {
            repeat: { not: null }, startDay: { lte: range.to },
            OR: [{ repeatUntil: null }, { repeatUntil: { gte: dayKeyOfNumber(dayNumber(range.from) - EVENT_SPAN_MAX_DAYS) } }],
          },
        ],
      },
      orderBy: [{ startDay: "asc" }, { startAt: "asc" }],
      take:    EVENTS_MAX,
      select:  ROW,
    }) as Promise<Row[]>,
    listTasksDueBetween(profileId, range, { now }),
    listDeadlinesBetween({ id: profileId, timezone: learner.timezone }, range),
    listTasks(profileId, { now }),
  ]);
  const today = dayKey(now, learner.timezone);

  const taskItems: CalendarTaskItem[] = tasks.filter(t => t.dueDay).map(t => ({
    id: t.id, title: t.title, dueDay: t.dueDay!, status: t.status, priority: t.priority, subjectName: t.subjectName,
    overdue: t.status !== "done" && t.dueDay! < today,
  }));
  const deadlineItems: CalendarDeadlineItem[] = deadlines.map(d => ({
    id: d.id, title: d.title, kind: d.type, kindLabel: DEADLINE_RULES[d.type].label, day: d.date, subjectName: d.subjectName,
  }));

  return {
    ok: true,
    view: {
      status: "ready", from: range.from, to: range.to, today, timezone: learner.timezone,
      events:    await itemsFor(profileId, rows, range, learner.reminders.channel === "telegram", now),
      tasks:     taskItems,
      deadlines: deadlineItems,
      subjects:  board.subjects,
      openTasks: board.tasks.filter(t => t.status !== "done").map(t => ({ id: t.id, title: t.title, dueDay: t.dueDay })),
      reminders: learner.reminders,
    },
  };
}

// The task and subject an event names must be this learner's own.
async function checkLinks(profileId: string, fields: EventFields): Promise<CalendarEventResponse | null> {
  if (fields.taskId && !(await tasksOwnedBy(profileId, [fields.taskId])).has(fields.taskId)) {
    return { ok: false, error: "bad_task", message: "That task isn't one of yours." };
  }
  if (fields.subjectId) {
    const subject = await prisma.novaSubject.findFirst({ where: { id: fields.subjectId, profileId }, select: { id: true } });
    if (!subject) return { ok: false, error: "bad_subject", message: "That subject isn't one of yours." };
  }
  return null;
}

const dataOf = ({ repeat, ...fields }: EventFields, now: Date) => ({
  ...fields,
  repeat: repeat?.freq ?? null, repeatDays: repeat?.days ?? [], repeatUntil: repeat?.until ?? null,
  remindAt: remindAtFor({ ...fields, repeat }, now),
});
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

async function respond(profileId: string, id: string, now: Date, created?: boolean): Promise<CalendarEventResponse> {
  const row = await prisma.novaCalendarEvent.findFirst({ where: { id, profileId }, select: ROW }) as Row | null;
  if (!row) return { ok: false, error: "not_found", message: "That event doesn't exist." };
  const learner = await learnerOf(profileId);
  // A repeating event answers with its next occurrence from today (or its
  // first, when none is left).
  const today = dayKey(now, row.timezone);
  const window = row.repeat
    ? { from: today > row.startDay ? today : row.startDay, to: dayKeyOfNumber(dayNumber(today > row.startDay ? today : row.startDay) + 400) }
    : { from: row.startDay, to: row.endDay };
  const channelOk = learner.reminders.channel === "telegram";
  const [next] = await itemsFor(profileId, [row], window, channelOk, now);
  const event = next ?? toItem(row, occurrenceOn(fieldsOf(row), row.startDay), new Map(), channelOk, now);
  return { ok: true, event, ...(created === undefined ? {} : { created }) };
}

// Creates one event. With a clientKey, a repeat of the same request (a double
// click, a retry after a dropped answer) returns the event it already made.
export async function createEvent(profileId: string, raw: unknown, now = new Date()): Promise<CalendarEventResponse> {
  const learner = await learnerOf(profileId);
  const checked = checkEvent(raw, null, learner.timezone);
  if (!checked.ok) return checked;
  const linkProblem = await checkLinks(profileId, checked.fields);
  if (linkProblem) return linkProblem;

  if (checked.clientKey) {
    const existing = await prisma.novaCalendarEvent.findUnique({ where: { profileId_clientKey: { profileId, clientKey: checked.clientKey } }, select: { id: true } });
    if (existing) return respond(profileId, existing.id, now, false);
  }
  if (await prisma.novaCalendarEvent.count({ where: { profileId } }) >= EVENTS_MAX) {
    return { ok: false, error: "invalid", message: "Your calendar is full. Remove some old events first." };
  }
  try {
    const row = await prisma.novaCalendarEvent.create({
      data:   { profileId, clientKey: checked.clientKey, ...dataOf(checked.fields, now) },
      select: { id: true },
    });
    return respond(profileId, row.id, now, true);
  } catch (err) {
    // The same key, created by a request that ran alongside this one.
    if (checked.clientKey && isUniqueViolation(err)) {
      const existing = await prisma.novaCalendarEvent.findUnique({ where: { profileId_clientKey: { profileId, clientKey: checked.clientKey } }, select: { id: true } });
      if (existing) return respond(profileId, existing.id, now, false);
    }
    throw err;
  }
}

// Changes one of the learner's events. Only what is named changes; the whole
// event is checked again, and its reminder time worked out again.
export async function updateEvent(profileId: string, eventId: string, raw: unknown, now = new Date()): Promise<CalendarEventResponse> {
  const row = await prisma.novaCalendarEvent.findFirst({ where: { id: eventId, profileId }, select: ROW }) as Row | null;
  if (!row) return { ok: false, error: "not_found", message: "That event doesn't exist." };
  const checked = checkEvent(raw, draftOf(fieldsOf(row)), row.timezone);
  if (!checked.ok) return checked;
  const linkProblem = await checkLinks(profileId, checked.fields);
  if (linkProblem) return linkProblem;
  const written = await prisma.novaCalendarEvent.updateMany({ where: { id: eventId, profileId }, data: dataOf(checked.fields, now) });
  if (written.count === 0) return { ok: false, error: "not_found", message: "That event doesn't exist." };
  return respond(profileId, eventId, now);
}

// Removes one of the learner's events. false: there was no such event.
export async function deleteEvent(profileId: string, eventId: string): Promise<boolean> {
  const gone = await prisma.novaCalendarEvent.deleteMany({ where: { id: eventId, profileId } });
  return gone.count === 1;
}

// Removes one occurrence of a repeating event, by the day it starts. The
// series stays; its reminder moves on if it pointed at that occurrence.
export async function skipOccurrence(profileId: string, eventId: string, day: unknown, now = new Date()): Promise<CalendarEventResponse> {
  const row = await prisma.novaCalendarEvent.findFirst({ where: { id: eventId, profileId }, select: ROW }) as Row | null;
  if (!row) return { ok: false, error: "not_found", message: "That event doesn't exist." };
  const fields = fieldsOf(row);
  if (!fields.repeat) return { ok: false, error: "bad_repeat", message: "That event doesn't repeat. Delete it instead." };
  if (typeof day !== "string" || !startsOn(fields, day)) return { ok: false, error: "bad_day", message: "That day isn't one this event happens on." };
  if (!fields.skipDays.includes(day)) {
    if (fields.skipDays.length >= SKIP_DAYS_MAX) return { ok: false, error: "invalid", message: "Too many dates removed from this event. Change how it repeats instead." };
    const skipDays = [...fields.skipDays, day].sort();
    // Guarded on the list as it was read, so two removals at once cannot
    // lose one: the second finds it changed and is refused.
    const written = await prisma.novaCalendarEvent.updateMany({
      where: { id: eventId, profileId, skipDays: { equals: fields.skipDays } },
      data:  { skipDays, remindAt: remindAtFor({ ...fields, skipDays }, now) },
    });
    if (written.count === 0) return { ok: false, error: "failed", message: "The event changed while this was saving. Try again." };
  }
  return respond(profileId, eventId, now);
}
