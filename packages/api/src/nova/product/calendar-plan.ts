// ─── Finding time for tasks: proposals, never writes ─────────────────────────
// Pure (no database, no model). Given the learner's busy time (calendar
// events, including the study blocks already set aside for tasks), their
// working hours and the open tasks waiting for time, this proposes when each
// task could happen. It never writes: a proposal becomes a calendar event
// (NovaCalendarEvent with taskId, product/calendar.ts createEvent) only when
// the learner accepts it, so the task stays the one record of the work and
// the event only schedules it (docs/CALENDAR_2.md).
//
// The rules (adapted from the planners the research looked at, kept simple
// and explainable):
//   - order: earliest due day first, then priority (high → low), then the
//     shorter task (a short one fits gaps a long one cannot);
//   - only inside working hours, never before now (rounded up to 15 minutes),
//     never over anything already on the calendar, with a buffer after
//     every block;
//   - never more than a day's planned focus (existing study blocks count),
//     so a plan never fills every minute;
//   - on or before the due day when possible. When it cannot fit by then,
//     the earliest time after is offered and marked late, with the reason;
//     when it cannot fit within the horizon at all, it is "could not fit".
// Proposals are made one after another, so two never overlap.

import { dayKey, dayKeyOfNumber, dayNumber, zonedInstant } from "../engines/learner-calendar";

export interface PlanTask {
  id: string; title: string;
  minutes: number;                         // the estimate; a task without one uses DEFAULT_TASK_MINUTES
  dueDay: string | null;                   // YYYY-MM-DD, the learner's calendar
  priority: "low" | "medium" | "high" | null;
}
export interface Busy { start: Date; end: Date; studyMinutes?: number }   // studyMinutes: counts toward the day's focus
export interface PlanSettings {
  dayStart: number;                        // minute of day, e.g. 9 * 60
  dayEnd: number;                          // e.g. 21 * 60
  focusPerDay: number;                     // minutes of planned task time a day, at most
  bufferMinutes: number;                   // after each block
  horizonDays: number;                     // how far ahead to look
}
export const DEFAULT_PLAN: PlanSettings = { dayStart: 9 * 60, dayEnd: 21 * 60, focusPerDay: 4 * 60, bufferMinutes: 10, horizonDays: 14 };
export const DEFAULT_TASK_MINUTES = 45;
export const BLOCK_MAX_MINUTES = 180;       // a longer task is proposed as its first block of this size

export type Proposal =
  | { taskId: string; title: string; day: string; start: Date; end: Date; minutes: number; late: boolean; reason: string | null; split: boolean }
  | { taskId: string; title: string; day: null; start: null; end: null; minutes: number; late: true; reason: string; split: false };

const STEP = 15;
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 } as const;

/** Tasks in the order they are given time. Pure. */
export function planOrder(tasks: PlanTask[]): PlanTask[] {
  return [...tasks].sort((a, b) =>
    (a.dueDay ?? "9999-99-99").localeCompare(b.dueDay ?? "9999-99-99")
    || (a.priority ? PRIORITY_RANK[a.priority] : 3) - (b.priority ? PRIORITY_RANK[b.priority] : 3)
    || a.minutes - b.minutes
    || a.title.localeCompare(b.title));
}

/** The free stretches of one day inside working hours, after `notBefore`, around what is busy (each busy block followed by the buffer). Pure. */
export function freeStretches(day: string, busy: Busy[], s: PlanSettings, timezone: string, notBefore: Date): Array<{ start: Date; end: Date }> {
  const open = zonedInstant(day, s.dayStart, timezone).getTime();
  const close = zonedInstant(day, s.dayEnd, timezone).getTime();
  let from = Math.max(open, roundUp(notBefore.getTime(), STEP));
  const taken = busy
    .map(b => ({ start: b.start.getTime(), end: b.end.getTime() + s.bufferMinutes * 60_000 }))
    .filter(b => b.end > from && b.start < close)
    .sort((a, b) => a.start - b.start);
  const out: Array<{ start: Date; end: Date }> = [];
  for (const b of taken) {
    if (b.start > from) out.push({ start: new Date(from), end: new Date(Math.min(b.start, close)) });
    from = Math.max(from, roundUp(b.end, STEP));
    if (from >= close) break;
  }
  if (from < close) out.push({ start: new Date(from), end: new Date(close) });
  return out.filter(x => x.end.getTime() - x.start.getTime() >= STEP * 60_000);
}

const roundUp = (ms: number, minutes: number) => Math.ceil(ms / (minutes * 60_000)) * minutes * 60_000;

/** How much planned task time each day already holds (study blocks). Pure. */
export function plannedMinutes(busy: Busy[], timezone: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const b of busy) if (b.studyMinutes) { const d = dayKey(b.start, timezone); m.set(d, (m.get(d) ?? 0) + b.studyMinutes); }
  return m;
}

/**
 * When each task could happen. `today` is the learner's calendar day; `now`
 * the moment. Proposals are one block per task (a task longer than
 * BLOCK_MAX_MINUTES gets its first block, marked split).
 */
export function proposeTimes(input: { tasks: PlanTask[]; busy: Busy[]; settings?: Partial<PlanSettings>; timezone: string; today: string; now: Date }): Proposal[] {
  const s: PlanSettings = { ...DEFAULT_PLAN, ...(input.settings ?? {}) };
  const busy = [...input.busy];
  const load = plannedMinutes(busy, input.timezone);
  const first = dayNumber(input.today);
  const out: Proposal[] = [];
  for (const t of planOrder(input.tasks)) {
    const want = Math.max(STEP, Math.min(BLOCK_MAX_MINUTES, Math.ceil((t.minutes || DEFAULT_TASK_MINUTES) / STEP) * STEP));
    const split = (t.minutes || DEFAULT_TASK_MINUTES) > BLOCK_MAX_MINUTES;
    const dueN = t.dueDay ? dayNumber(t.dueDay) : null;
    let placed: Proposal | null = null;
    for (let n = first; n < first + s.horizonDays && !placed; n++) {
      const day = dayKeyOfNumber(n);
      if ((load.get(day) ?? 0) + want > s.focusPerDay) continue;
      for (const f of freeStretches(day, busy, s, input.timezone, input.now)) {
        if (f.end.getTime() - f.start.getTime() < want * 60_000) continue;
        const start = f.start, end = new Date(f.start.getTime() + want * 60_000);
        const late = dueN !== null && n > dueN;
        placed = { taskId: t.id, title: t.title, day, start, end, minutes: want, late, split,
          reason: late ? `No free time is left on or before ${t.dueDay}; this is the earliest after.` : null };
        break;
      }
    }
    if (!placed) {
      out.push({ taskId: t.id, title: t.title, day: null, start: null, end: null, minutes: want, late: true, split: false,
        reason: `No ${want}-minute gap in your working hours in the next ${s.horizonDays} days.` });
      continue;
    }
    out.push(placed);
    busy.push({ start: placed.start!, end: placed.end!, studyMinutes: want });
    load.set(placed.day!, (load.get(placed.day!) ?? 0) + want);
  }
  return out;
}

/** A study block for a task that ended without the task being done: missed. Pure. */
export function isMissed(block: { endAt: string | null; task: { status: string } | null }, now: Date): boolean {
  return Boolean(block.task && block.task.status !== "done" && block.endAt && Date.parse(block.endAt) < now.getTime());
}
