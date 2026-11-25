// ─── Calendar planning: what needs time, what was missed, when it could go ───
// Reads only, through the calendar's and tasks' own readers (calendar.ts
// loadCalendar, tasks.ts listTasks); writes nothing. A proposal the learner
// accepts is created by the page as an ordinary calendar event for that task
// (POST /api/nova/calendar with taskId, category "study", a clientKey made
// from the task and the start, so a double click makes one block). So the
// task stays the one record in Planner and Calendar, and nothing is moved
// without the learner choosing it (docs/CALENDAR_2.md).
//
//   unscheduled  open tasks with no block from now on (a task whose block was
//                missed is unscheduled again)
//   missed       blocks for a task that ended in the last week while the task
//                stayed open, and with no later block for it
//   proposals    calendar-plan.ts proposeTimes over the next two weeks
//   workload     each of the next seven days: hours already on the calendar,
//                planned task time, and what is left of the working day

import { loadCalendar } from "./calendar";
import { listTasks } from "./tasks";
import { dayKeyOfNumber, dayNumber } from "../engines/learner-calendar";
import { DEFAULT_PLAN, DEFAULT_TASK_MINUTES, isMissed, proposeTimes, type Busy, type PlanSettings } from "./calendar-plan";
import type { CalendarPlanResult, DayLoad, MissedBlock, PlanTaskView, ProposalView } from "./calendar-plan.types";
export type { CalendarPlanResult, CalendarPlanView, DayLoad, MissedBlock, PlanTaskView, ProposalView } from "./calendar-plan.types";


const int = (v: unknown, lo: number, hi: number): number | undefined => (typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : undefined);

/** The learner's planning settings from a request, each checked; anything else is the default. */
export function readPlanSettings(raw: unknown): PlanSettings {
  const r = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
  const dayStart = int(r.dayStart, 0, 22 * 60) ?? DEFAULT_PLAN.dayStart;
  const dayEnd = int(r.dayEnd, dayStart + 60, 24 * 60) ?? Math.max(DEFAULT_PLAN.dayEnd, dayStart + 60);
  return {
    dayStart, dayEnd,
    focusPerDay: int(r.focusPerDay, 30, 12 * 60) ?? DEFAULT_PLAN.focusPerDay,
    bufferMinutes: int(r.bufferMinutes, 0, 60) ?? DEFAULT_PLAN.bufferMinutes,
    horizonDays: DEFAULT_PLAN.horizonDays,
  };
}

const clock = (d: Date, tz: string) => new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hour12: false }).format(d);
const minutesBetween = (a: string, b: string) => Math.max(0, Math.round((Date.parse(b) - Date.parse(a)) / 60_000));

export async function planCalendar(profileId: string, input: { taskIds?: unknown; settings?: unknown } = {}, now = new Date()): Promise<CalendarPlanResult> {
  if (input.taskIds !== undefined && !(Array.isArray(input.taskIds) && input.taskIds.length <= 50 && input.taskIds.every(t => typeof t === "string" && t.length <= 40))) {
    return { ok: false, error: "invalid", message: "That task list can't be read." };
  }
  const settings = readPlanSettings(input.settings);
  const tasks = await listTasks(profileId, { now });
  const today = tasks.today;
  const t0 = dayNumber(today);
  const cal = await loadCalendar(profileId, dayKeyOfNumber(t0 - 7), dayKeyOfNumber(t0 + settings.horizonDays - 1), now);
  if (!cal.ok) return { ok: false, error: "failed", message: cal.message };
  const { view } = cal;
  const tz = view.timezone;

  // Busy time: every timed event (meetings, classes, blocks). All-day events
  // (an exam day, a holiday) mark the day, not its hours.
  const timed = view.events.filter(e => !e.allDay && e.startAt && e.endAt);
  const busy: Busy[] = timed.map(e => ({ start: new Date(e.startAt!), end: new Date(e.endAt!), studyMinutes: e.task || e.category === "study" ? minutesBetween(e.startAt!, e.endAt!) : 0 }));

  // Which tasks already have time from now on, and which blocks were missed.
  const ahead = new Set(timed.filter(e => e.task && Date.parse(e.endAt!) > now.getTime()).map(e => e.task!.id));
  const open = tasks.tasks.filter(t => t.status !== "done");
  const missed: MissedBlock[] = timed
    .filter(e => isMissed(e, now) && !ahead.has(e.task!.id) && Date.parse(e.endAt!) > now.getTime() - 7 * 86_400_000)
    .map(e => ({ eventId: e.id, key: e.key ?? e.id, taskId: e.task!.id, taskTitle: e.task!.title, startAt: e.startAt!, endAt: e.endAt!, day: e.startDay }));
  // One missed block per task: its latest.
  const lastMissed = new Map<string, MissedBlock>();
  for (const m of missed) { const had = lastMissed.get(m.taskId); if (!had || had.endAt < m.endAt) lastMissed.set(m.taskId, m); }

  const unscheduled: PlanTaskView[] = open.filter(t => !ahead.has(t.id)).map(t => ({
    id: t.id, title: t.title, minutes: t.estimatedMinutes ?? DEFAULT_TASK_MINUTES, estimated: t.estimatedMinutes !== null,
    dueDay: t.dueDay, overdue: t.dueInDays !== null && t.dueInDays < 0, priority: t.priority, subjectName: t.subjectName, topicName: t.topicName,
  }));

  const wanted = input.taskIds ? new Set(input.taskIds as string[]) : null;
  const toPlan = unscheduled.filter(t => !wanted || wanted.has(t.id)).slice(0, 50);
  const proposals: ProposalView[] = proposeTimes({
    tasks: toPlan.map(t => ({ id: t.id, title: t.title, minutes: t.minutes, dueDay: t.dueDay, priority: t.priority })),
    busy, settings, timezone: tz, today, now,
  }).map(p => ({
    taskId: p.taskId, title: p.title, day: p.day, minutes: p.minutes, late: p.late, split: p.split, reason: p.reason,
    startAt: p.start ? p.start.toISOString() : null, endAt: p.end ? p.end.toISOString() : null,
    startTime: p.start ? clock(p.start, tz) : null, endTime: p.end ? clock(p.end, tz) : null,
  }));

  const workload: DayLoad[] = [];
  const capacity = settings.dayEnd - settings.dayStart;
  for (let n = t0; n < t0 + 7; n++) {
    const day = dayKeyOfNumber(n);
    const onDay = timed.filter(e => e.startDay === day);
    const busyMinutes = onDay.reduce((m, e) => m + minutesBetween(e.startAt!, e.endAt!), 0);
    const plannedMinutes = onDay.filter(e => e.task || e.category === "study").reduce((m, e) => m + minutesBetween(e.startAt!, e.endAt!), 0);
    workload.push({ day, busyMinutes, plannedMinutes, freeMinutes: Math.max(0, capacity - busyMinutes), capacityMinutes: capacity });
  }

  return { ok: true, today, timezone: tz, settings, unscheduled, missed: [...lastMissed.values()], proposals, workload };
}
