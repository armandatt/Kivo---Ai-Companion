// ─── Tasks ────────────────────────────────────────────────────────────────────
// The learner's own to-do list: create, read, edit, move, delete.
// Owner of NovaTask. Nothing else reads or writes that table.
//
// The boundary this file holds:
//   - A task is something the learner decided to do. Finishing one is not a
//     study session and not evidence: nothing here touches sessions, topic
//     mastery, the review schedule, exams, the learner's stated time,
//     UserFact, UserReality or Learning DNA, and the Planning Engine does not
//     read tasks. Moving a card changes that card.
//   - Every read and write is scoped to the learner's own profile. A task id
//     alone is never enough to reach a task.
//   - No brain, no orchestrator, no consolidation and no LLM client is
//     imported here, and a test keeps it that way.

import { prisma } from "@repo/db/client";
import { dayKey, dayNumber, resolveTimezone } from "../engines/learner-calendar";
import {
  TASK_DONE_SHOWN, TASK_KEY_MAX, TASK_MINUTES_MAX, TASK_MINUTES_MIN, TASK_OPEN_MAX, TASK_ORDER_MAX, TASK_PRIORITIES, TASK_STATUSES, TASK_TITLE_MAX, TASK_TOPIC_MAX,
  type NovaTaskItem, type NovaTasksReady, type TaskError, type TaskInput, type TaskPriority, type TaskResponse, type TaskStatus,
} from "./tasks.types";

// ── Validation (pure) ─────────────────────────────────────────────────────────

type Parsed =
  | { ok: true; changes: TaskInput }
  | { ok: false; error: TaskError; message: string };

const reject = (error: TaskError, message: string): Parsed => ({ ok: false, error, message });

const DAY_LENGTH = "YYYY-MM-DD".length;
// A real calendar day written YYYY-MM-DD.
export function isDay(value: unknown): value is string {
  if (typeof value !== "string" || value.length !== DAY_LENGTH) return false;
  const [y, m, d] = value.split("-").map(Number);
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return false;
  const date = new Date(Date.UTC(y!, m! - 1, d!));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m! - 1 && date.getUTCDate() === d
    && value === date.toISOString().slice(0, DAY_LENGTH);
}

// Reads an untrusted request body. Only the fields of TaskInput are read:
// anything else, including any id naming a learner or profile, is ignored.
// `creating` requires a title.
export function parseTaskInput(raw: unknown, creating: boolean): Parsed {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return reject("invalid", "That is not a task.");
  const input = raw as Record<string, unknown>;
  const changes: TaskInput = {};

  if (input.title !== undefined || creating) {
    if (typeof input.title !== "string") return reject("title_required", "Say what the task is.");
    const title = input.title.split(/\s+/).filter(Boolean).join(" ");
    if (!title) return reject("title_required", "Say what the task is.");
    if (title.length > TASK_TITLE_MAX) return reject("title_too_long", `Keep it under ${TASK_TITLE_MAX} characters.`);
    changes.title = title;
  }
  if (input.status !== undefined) {
    const status = TASK_STATUSES.find(s => s === input.status);
    if (!status) return reject("unknown_status", "A task is to do, in progress or done.");
    changes.status = status;
  }
  if (input.priority !== undefined) {
    if (input.priority === null || input.priority === "") changes.priority = null;
    else {
      const priority = TASK_PRIORITIES.find(p => p === input.priority);
      if (!priority) return reject("unknown_priority", "Priority is low, medium or high.");
      changes.priority = priority;
    }
  }
  if (input.subjectId !== undefined) {
    if (input.subjectId === null || input.subjectId === "") changes.subjectId = null;
    else if (typeof input.subjectId === "string") changes.subjectId = input.subjectId;
    else return reject("unknown_subject", "That subject isn't one of yours.");
  }
  if (input.topicName !== undefined) {
    if (input.topicName === null) changes.topicName = null;
    else if (typeof input.topicName !== "string") return reject("invalid", "The topic must be text.");
    else {
      const topic = input.topicName.split(/\s+/).filter(Boolean).join(" ");
      if (topic.length > TASK_TOPIC_MAX) return reject("topic_too_long", `Keep the topic under ${TASK_TOPIC_MAX} characters.`);
      changes.topicName = topic || null;
    }
  }
  if (input.dueDay !== undefined) {
    if (input.dueDay === null || input.dueDay === "") changes.dueDay = null;
    else if (isDay(input.dueDay)) changes.dueDay = input.dueDay;
    else return reject("bad_due_day", "That isn't a date.");
  }
  if (input.estimatedMinutes !== undefined) {
    if (input.estimatedMinutes === null || input.estimatedMinutes === "") changes.estimatedMinutes = null;
    else if (typeof input.estimatedMinutes === "number" && Number.isInteger(input.estimatedMinutes)
      && input.estimatedMinutes >= TASK_MINUTES_MIN && input.estimatedMinutes <= TASK_MINUTES_MAX) changes.estimatedMinutes = input.estimatedMinutes;
    else return reject("bad_minutes", `A task's time is ${TASK_MINUTES_MIN} to ${TASK_MINUTES_MAX} minutes, in whole minutes.`);
  }
  if (creating && input.clientKey !== undefined) {
    if (typeof input.clientKey !== "string" || !input.clientKey.trim() || input.clientKey.length > TASK_KEY_MAX) return reject("invalid", "That is not a task.");
    changes.clientKey = input.clientKey.trim();
  }
  return { ok: true, changes };
}

// Board order: within a column, what is due soonest first, then what has a
// priority, then the oldest. Finished tasks: the most recently finished first.
const PRIORITY_RANK: Record<TaskPriority, number> = { high: 0, medium: 1, low: 2 };
export function compareTasks(a: NovaTaskItem, b: NovaTaskItem): number {
  if (a.status === "done" && b.status === "done") return (b.completedAt ?? "").localeCompare(a.completedAt ?? "");
  // The learner's own order comes first; unplaced tasks follow in the usual order.
  if (a.position !== null || b.position !== null) {
    if (a.position === null) return 1;
    if (b.position === null) return -1;
    if (a.position !== b.position) return a.position - b.position;
  }
  if ((a.dueDay === null) !== (b.dueDay === null)) return a.dueDay === null ? 1 : -1;
  if (a.dueDay !== b.dueDay) return (a.dueDay ?? "").localeCompare(b.dueDay ?? "");
  const pa = a.priority ? PRIORITY_RANK[a.priority] : 3;
  const pb = b.priority ? PRIORITY_RANK[b.priority] : 3;
  if (pa !== pb) return pa - pb;
  return a.createdAt.localeCompare(b.createdAt);
}

// ── Reads ─────────────────────────────────────────────────────────────────────

const ROW = {
  id: true, title: true, status: true, priority: true, subjectId: true, topicName: true, dueDay: true,
  completedAt: true, createdAt: true, updatedAt: true, subject: { select: { name: true } },
  estimatedMinutes: true, position: true,
} as const;
type Row = {
  id: string; title: string; status: string; priority: string | null; subjectId: string | null; topicName: string | null;
  dueDay: string | null; completedAt: Date | null; createdAt: Date; updatedAt: Date; subject: { name: string } | null;
  estimatedMinutes: number | null; position: number | null;
};

function toItem(row: Row, today: string): NovaTaskItem {
  return {
    id: row.id, title: row.title,
    status:   TASK_STATUSES.find(s => s === row.status) ?? "todo",
    priority: TASK_PRIORITIES.find(p => p === row.priority) ?? null,
    subjectId: row.subjectId, subjectName: row.subject?.name ?? null, topicName: row.topicName,
    dueDay: row.dueDay,
    dueInDays: row.dueDay ? dayNumber(row.dueDay) - dayNumber(today) : null,
    completedAt: row.completedAt?.toISOString() ?? null,
    estimatedMinutes: row.estimatedMinutes, position: row.position,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

async function todayOf(profileId: string, now: Date): Promise<string> {
  const profile = await prisma.novaAcademicProfile.findUnique({ where: { id: profileId }, select: { timezone: true } });
  return dayKey(now, resolveTimezone(profile?.timezone ?? null));
}

export async function listTasks(profileId: string, options: { now?: Date } = {}): Promise<NovaTasksReady> {
  const now = options.now ?? new Date();
  const [today, open, done, subjects, grouped] = await Promise.all([
    todayOf(profileId, now),
    prisma.novaTask.findMany({ where: { profileId, status: { not: "done" } }, select: ROW, take: TASK_OPEN_MAX }),
    prisma.novaTask.findMany({ where: { profileId, status: "done" }, select: ROW, orderBy: { completedAt: "desc" }, take: TASK_DONE_SHOWN }),
    prisma.novaSubject.findMany({ where: { profileId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.novaTask.groupBy({ by: ["status"], where: { profileId }, _count: { _all: true } }),
  ]);
  const counts = { todo: 0, in_progress: 0, done: 0 } as Record<TaskStatus, number>;
  for (const g of grouped) {
    const status = TASK_STATUSES.find(s => s === g.status);
    if (status) counts[status] = g._count._all;
  }
  const tasks = [...open, ...done].map(row => toItem(row, today)).sort((a, b) =>
    a.status === b.status ? compareTasks(a, b) : TASK_STATUSES.indexOf(a.status) - TASK_STATUSES.indexOf(b.status));
  return { status: "ready", today, tasks, subjects, counts };
}

// ── Writes ────────────────────────────────────────────────────────────────────

async function ownsSubject(profileId: string, subjectId: string): Promise<boolean> {
  return (await prisma.novaSubject.count({ where: { id: subjectId, profileId } })) === 1;
}

export async function createTask(profileId: string, raw: unknown, options: { now?: Date } = {}): Promise<TaskResponse> {
  const now = options.now ?? new Date();
  const parsed = parseTaskInput(raw, true);
  if (!parsed.ok) return parsed;
  const { changes } = parsed;
  if (changes.subjectId && !await ownsSubject(profileId, changes.subjectId)) {
    return { ok: false, error: "unknown_subject", message: "That subject isn't one of yours." };
  }
  const today = await todayOf(profileId, now);

  // The same key means the same task: a retry or a double click finds it.
  if (changes.clientKey) {
    const existing = await prisma.novaTask.findUnique({ where: { profileId_clientKey: { profileId, clientKey: changes.clientKey } }, select: ROW });
    if (existing) return { ok: true, task: toItem(existing, today), created: false };
  }
  if (await prisma.novaTask.count({ where: { profileId, status: { not: "done" } } }) >= TASK_OPEN_MAX) {
    return { ok: false, error: "too_many", message: "That's a lot of open tasks. Finish or remove some first." };
  }

  const status = changes.status ?? "todo";
  try {
    const row = await prisma.novaTask.create({
      data: {
        profileId, title: changes.title!, status,
        priority: changes.priority ?? null, subjectId: changes.subjectId ?? null, topicName: changes.topicName ?? null,
        dueDay: changes.dueDay ?? null, clientKey: changes.clientKey ?? null,
        estimatedMinutes: changes.estimatedMinutes ?? null,
        completedAt: status === "done" ? now : null,
      },
      select: ROW,
    });
    return { ok: true, task: toItem(row, today), created: true };
  } catch (err) {
    // Two requests with the same key at once: the other one made it.
    if ((err as { code?: string } | null)?.code === "P2002" && changes.clientKey) {
      const existing = await prisma.novaTask.findUnique({ where: { profileId_clientKey: { profileId, clientKey: changes.clientKey } }, select: ROW });
      if (existing) return { ok: true, task: toItem(existing, today), created: false };
    }
    throw err;
  }
}

export async function updateTask(profileId: string, taskId: string, raw: unknown, options: { now?: Date } = {}): Promise<TaskResponse> {
  const now = options.now ?? new Date();
  const parsed = parseTaskInput(raw, false);
  if (!parsed.ok) return parsed;
  const { changes } = parsed;
  const current = await prisma.novaTask.findFirst({ where: { id: taskId, profileId }, select: { status: true } });
  if (!current) return { ok: false, error: "not_found", message: "That task doesn't exist." };
  if (changes.subjectId && !await ownsSubject(profileId, changes.subjectId)) {
    return { ok: false, error: "unknown_subject", message: "That subject isn't one of yours." };
  }

  const data: Record<string, unknown> = {};
  if (changes.title !== undefined)     data.title = changes.title;
  if (changes.priority !== undefined)  data.priority = changes.priority;
  if (changes.subjectId !== undefined) data.subjectId = changes.subjectId;
  if (changes.topicName !== undefined) data.topicName = changes.topicName;
  if (changes.dueDay !== undefined)    data.dueDay = changes.dueDay;
  if (changes.estimatedMinutes !== undefined) data.estimatedMinutes = changes.estimatedMinutes;
  if (changes.status !== undefined && changes.status !== current.status) {
    data.status = changes.status;
    // Entering "done" stamps it once; leaving clears it.
    data.completedAt = changes.status === "done" ? now : null;
  }

  // Scoped to the learner again: the id alone writes nothing.
  await prisma.novaTask.updateMany({ where: { id: taskId, profileId }, data });
  const [row, today] = await Promise.all([
    prisma.novaTask.findFirst({ where: { id: taskId, profileId }, select: ROW }),
    todayOf(profileId, now),
  ]);
  if (!row) return { ok: false, error: "not_found", message: "That task doesn't exist." };
  return { ok: true, task: toItem(row, today) };
}

export async function deleteTask(profileId: string, taskId: string): Promise<boolean> {
  return (await prisma.novaTask.deleteMany({ where: { id: taskId, profileId } })).count === 1;
}

// ── Recovery (product/recovery.ts) ────────────────────────────────────────────

// Moves due days, all or none. Each move is guarded on the day the task has
// now and on its being open, so a task the learner changed, finished or
// removed meanwhile stops the whole set and nothing is written. A repeat of
// a set that already went through finds no task where it was and also
// writes nothing. Used to apply an accepted recovery proposal and to undo it.
export async function moveTaskDueDays(
  profileId: string,
  moves: ReadonlyArray<{ taskId: string; from: string | null; to: string | null }>,
): Promise<{ ok: true; moved: number } | { ok: false; error: "conflict" }> {
  if (moves.length === 0) return { ok: true, moved: 0 };
  class Stale extends Error {}
  try {
    // Rows are locked in one order (by id) whatever the caller's order, so two
    // overlapping sets wait for each other instead of deadlocking.
    const ordered = [...moves].sort((a, b) => a.taskId.localeCompare(b.taskId));
    await prisma.$transaction(async tx => {
      for (const m of ordered) {
        const r = await tx.novaTask.updateMany({
          where: { id: m.taskId, profileId, dueDay: m.from, status: { not: "done" } },
          data:  { dueDay: m.to },
        });
        if (r.count !== 1) throw new Stale();
      }
    });
    return { ok: true, moved: moves.length };
  } catch (err) {
    if (err instanceof Stale) return { ok: false, error: "conflict" };
    throw err;
  }
}

// Where each of these tasks is due now, for the learner's own tasks only.
export async function taskDueDays(profileId: string, taskIds: string[]): Promise<Map<string, { dueDay: string | null; open: boolean }>> {
  const rows = taskIds.length === 0 ? [] : await prisma.novaTask.findMany({
    where: { profileId, id: { in: taskIds } }, select: { id: true, dueDay: true, status: true },
  });
  return new Map(rows.map(r => [r.id, { dueDay: r.dueDay, open: r.status !== "done" }]));
}

// The most tasks the learner has finished on one of their calendar days in
// the last 90: how many a day suits them, from their own record. 0: none.
export async function mostTasksDoneInADay(profileId: string, timezone: string | null, now: Date): Promise<number> {
  const rows = await prisma.novaTask.findMany({
    where: { profileId, status: "done", completedAt: { gte: new Date(now.getTime() - 90 * 86_400_000) } },
    select: { completedAt: true },
    take: 2_000,
  });
  const zone = resolveTimezone(timezone);
  const perDay = new Map<string, number>();
  for (const r of rows) if (r.completedAt) { const d = dayKey(r.completedAt, zone); perDay.set(d, (perDay.get(d) ?? 0) + 1); }
  return Math.max(0, ...perDay.values());
}

// The learner's own order for one column: these tasks, in this order. Every id
// must be the learner's and still in that column, or nothing is written (a
// task moved or finished in another tab makes the request stale). Tasks of
// the column not named keep no place and sort after.
export async function reorderTasks(profileId: string, raw: unknown, options: { now?: Date } = {}): Promise<{ ok: true; tasks: NovaTasksReady } | { ok: false; error: TaskError; message: string }> {
  const input = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
  const status = TASK_STATUSES.find(s => s === input.status);
  const ids = input.ids;
  if (!status || status === "done") return { ok: false, error: "invalid", message: "Only open tasks can be put in order." };
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > TASK_ORDER_MAX || !ids.every(i => typeof i === "string" && i.length > 0 && i.length <= 64) || new Set(ids).size !== ids.length) {
    return { ok: false, error: "invalid", message: "That isn't an order Nova can use." };
  }
  class Changed extends Error {}
  try {
    await prisma.$transaction(async tx => {
      // Each write is guarded on the task still being the learner's and in
      // this column: one that is not stops the whole order.
      for (const [position, id] of (ids as string[]).entries()) {
        const r = await tx.novaTask.updateMany({ where: { id, profileId, status }, data: { position } });
        if (r.count !== 1) throw new Changed();
      }
      // Placed tasks of this column that were not named lose their place.
      await tx.novaTask.updateMany({ where: { profileId, status, id: { notIn: ids as string[] }, position: { not: null } }, data: { position: null } });
    });
  } catch (err) {
    if (err instanceof Changed) return { ok: false, error: "changed", message: "Some of these tasks changed since the page loaded. Here they are as they are now." };
    throw err;
  }
  return { ok: true, tasks: await listTasks(profileId, options) };
}
