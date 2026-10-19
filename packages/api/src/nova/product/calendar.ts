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

import { prisma } from "@repo/db/client";
import { dayKey, resolveTimezone } from "../engines/learner-calendar";
import { reminderStatuses } from "../proactive/proactive-outbox";
import { checkEvent, checkRange, draftOf, REMINDER_GRACE_MINUTES, reminderAt, reminderBlock, reminderKey, type EventFields } from "./calendar-rules";
import {
  CALENDAR_RANGE_MAX_DAYS, EVENT_CATEGORIES,
  type CalendarDeadlineItem, type CalendarEventItem, type CalendarEventResponse, type CalendarReminderChannel,
  type CalendarTaskItem, type EventCategory, type NovaCalendarReady, type ReminderStatus,
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
  task: { select: { id: true, title: true, status: true } },
  subject: { select: { id: true, name: true } },
} as const;

type Row = {
  id: string; title: string; description: string | null; category: string; allDay: boolean; startDay: string; endDay: string;
  startAt: Date | null; endAt: Date | null; timezone: string; reminderMinutes: number | null; remindAt: Date | null;
  taskId: string | null; subjectId: string | null;
  task: { id: string; title: string; status: string } | null;
  subject: { id: string; name: string } | null;
};

const asCategory = (value: string): EventCategory =>
  (EVENT_CATEGORIES as readonly string[]).includes(value) ? value as EventCategory : "other";

const fieldsOf = (row: Row): EventFields => ({
  title: row.title, description: row.description, category: asCategory(row.category), allDay: row.allDay,
  startDay: row.startDay, endDay: row.endDay, startAt: row.startAt, endAt: row.endAt, timezone: row.timezone,
  reminderMinutes: row.reminderMinutes, taskId: row.taskId, subjectId: row.subjectId,
});

// Where a reminder stands, from its outbox row (if claimed) and the clock.
export function reminderStatusOf(at: Date, outboxStatus: string | undefined, channelOk: boolean, now: Date): ReminderStatus {
  if (outboxStatus === "sent" || outboxStatus === "unknown") return "sent";
  if (outboxStatus === "abandoned") return "failed";
  if (!channelOk) return "unavailable";
  if (outboxStatus) return at.getTime() + REMINDER_GRACE_MINUTES * 60_000 < now.getTime() ? "failed" : "scheduled";
  return at.getTime() + REMINDER_GRACE_MINUTES * 60_000 < now.getTime() ? "missed" : "scheduled";
}

function toItem(row: Row, statuses: Map<string, string>, channelOk: boolean, now: Date): CalendarEventItem {
  const draft = draftOf(fieldsOf(row));
  return {
    id: row.id, title: row.title, description: row.description, category: asCategory(row.category), allDay: row.allDay,
    startDay: row.startDay, endDay: row.endDay,
    startAt: row.startAt?.toISOString() ?? null, endAt: row.endAt?.toISOString() ?? null,
    startTime: draft.startTime, endTime: draft.endTime, timezone: row.timezone,
    reminderMinutes: row.reminderMinutes,
    reminder: row.remindAt
      ? { at: row.remindAt.toISOString(), status: reminderStatusOf(row.remindAt, statuses.get(reminderKey(row.id, row.remindAt)), channelOk, now) }
      : null,
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

async function itemsFor(profileId: string, rows: Row[], channelOk: boolean, now: Date): Promise<CalendarEventItem[]> {
  const keys = rows.filter(r => r.remindAt).map(r => reminderKey(r.id, r.remindAt!));
  const statuses = await reminderStatuses(profileId, keys);
  return rows.map(r => toItem(r, statuses, channelOk, now));
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
    prisma.novaCalendarEvent.findMany({
      where:   { profileId, startDay: { lte: range.to }, endDay: { gte: range.from } },
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
      events:    await itemsFor(profileId, rows, learner.reminders.channel === "telegram", now),
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

const dataOf = (fields: EventFields) => ({ ...fields, remindAt: reminderAt(fields) });
const isUniqueViolation = (err: unknown) => (err as { code?: string } | null)?.code === "P2002";

async function respond(profileId: string, id: string, now: Date, created?: boolean): Promise<CalendarEventResponse> {
  const row = await prisma.novaCalendarEvent.findFirst({ where: { id, profileId }, select: ROW }) as Row | null;
  if (!row) return { ok: false, error: "not_found", message: "That event doesn't exist." };
  const learner = await learnerOf(profileId);
  const [event] = await itemsFor(profileId, [row], learner.reminders.channel === "telegram", now);
  return { ok: true, event: event!, ...(created === undefined ? {} : { created }) };
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
      data:   { profileId, clientKey: checked.clientKey, ...dataOf(checked.fields) },
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
  const written = await prisma.novaCalendarEvent.updateMany({ where: { id: eventId, profileId }, data: dataOf(checked.fields) });
  if (written.count === 0) return { ok: false, error: "not_found", message: "That event doesn't exist." };
  return respond(profileId, eventId, now);
}

// Removes one of the learner's events. false: there was no such event.
export async function deleteEvent(profileId: string, eventId: string): Promise<boolean> {
  const gone = await prisma.novaCalendarEvent.deleteMany({ where: { id: eventId, profileId } });
  return gone.count === 1;
}
