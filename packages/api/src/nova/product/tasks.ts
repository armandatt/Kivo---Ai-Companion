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
import { TASK_DEPTH_MAX, ancestorsOf, descendantsOf, wouldLoop } from "./task-tree";
import {
  TASK_DESCRIPTION_MAX, TASK_DONE_SHOWN, TASK_KEY_MAX, TASK_MINUTES_MAX, TASK_MINUTES_MIN, TASK_OPEN_MAX, TASK_ORDER_MAX, TASK_PRIORITIES, TASK_STATUSES, TASK_TITLE_MAX, TASK_TOPIC_MAX,
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
  if (input.parentId !== undefined) {
    if (input.parentId === null || input.parentId === "") changes.parentId = null;
    else if (typeof input.parentId === "string" && input.parentId.length <= 64) changes.parentId = input.parentId;
    else return reject("unknown_parent", "That task isn't one of yours.");
  }
  if (input.description !== undefined) {
    if (input.description === null) changes.description = null;
    else if (typeof input.description !== "string") return reject("invalid", "The description must be text.");
    else {
      const text = input.description.split("\r").join("").trim();
      if (text.length > TASK_DESCRIPTION_MAX) return reject("description_too_long", `Keep the description under ${TASK_DESCRIPTION_MAX} characters.`);
      changes.description = text || null;
    }
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
  estimatedMinutes: true, position: true, parentId: true, description: true,
} as const;
type Row = {
  id: string; title: string; status: string; priority: string | null; subjectId: string | null; topicName: string | null;
  dueDay: string | null; completedAt: Date | null; createdAt: Date; updatedAt: Date; subject: { name: string } | null;
  estimatedMinutes: number | null; position: number | null; parentId: string | null; description: string | null;
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
    parentId: row.parentId, description: row.description,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

// ── The tree (task-tree.ts holds the rules) ───────────────────────────────────

type TreeReader = Pick<typeof prisma, "novaTask">;

// Every task of the learner's as tree items, for checking a parent.
async function treeOf(db: TreeReader, profileId: string): Promise<Array<{ key: string; parent: string | null }>> {
  const rows = await db.novaTask.findMany({ where: { profileId }, select: { id: true, parentId: true } });
  return rows.map(r => ({ key: r.id, parent: r.parentId }));
}

// How many levels a task and its steps take (1: no steps).
const heightOf = (tree: Array<{ key: string; parent: string | null }>, key: string): number =>
  1 + Math.max(0, ...descendantsOf(tree, key).map(k => ancestorsOf(tree, k).length - ancestorsOf(tree, key).length));

// Whether `taskId` (null: a new task) may be a step of `parentId`: the
// parent is the learner's, it is not inside the task, and the result is not
// deeper than TASK_DEPTH_MAX. A message, or null when it may.
export async function parentProblem(db: TreeReader, profileId: string, taskId: string | null, parentId: string | null): Promise<string | null> {
  if (parentId === null) return null;
  const tree = await treeOf(db, profileId);
  if (!tree.some(t => t.key === parentId)) return "That task isn't one of yours.";
  if (taskId !== null && wouldLoop(tree, taskId, parentId)) return "A task can't be a step of itself or of one of its own steps.";
  const depth = ancestorsOf(tree, parentId).length + 1 + (taskId ? heightOf(tree, taskId) : 1);
  if (depth > TASK_DEPTH_MAX) return `Steps go at most ${TASK_DEPTH_MAX} levels deep.`;
  return null;
}

// Before tasks are removed: their steps that stay move up to the nearest
// task above them that stays, so no step is left pointing at nothing.
export async function promoteStepsIn(tx: TreeReader, profileId: string, removed: readonly string[]): Promise<void> {
  if (removed.length === 0) return;
  const gone = new Set(removed);
  const tree = await treeOf(tx, profileId);
  for (const t of tree) {
    if (gone.has(t.key) || t.parent === null || !gone.has(t.parent)) continue;
    const up = ancestorsOf(tree, t.key).find(k => !gone.has(k)) ?? null;
    await tx.novaTask.updateMany({ where: { id: t.key, profileId }, data: { parentId: up } });
  }
}

// A task and every step inside it, by id (the learner's own only).
export async function taskWithSteps(profileId: string, taskId: string): Promise<string[]> {
  const tree = await treeOf(prisma, profileId);
  return tree.some(t => t.key === taskId) ? [taskId, ...descendantsOf(tree, taskId)] : [];
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

// Every task of the learner's due from..to (YYYY-MM-DD, inclusive), finished
// ones too: the calendar shows a day's tasks whatever their column.
export async function listTasksDueBetween(profileId: string, range: { from: string; to: string }, options: { now?: Date } = {}): Promise<NovaTaskItem[]> {
  const now = options.now ?? new Date();
  const [today, rows] = await Promise.all([
    todayOf(profileId, now),
    prisma.novaTask.findMany({ where: { profileId, dueDay: { gte: range.from, lte: range.to } }, select: ROW, take: TASK_OPEN_MAX }),
  ]);
  return rows.map(row => toItem(row, today)).sort(compareTasks);
}

// The learner's tasks created under one key prefix (a workspace's
// "ws:<key>:"), as they now are: how a workspace shows its tasks back.
export async function listTasksWithKeyPrefix(profileId: string, prefix: string, options: { now?: Date } = {}): Promise<NovaTaskItem[]> {
  const now = options.now ?? new Date();
  const [today, rows] = await Promise.all([
    todayOf(profileId, now),
    prisma.novaTask.findMany({ where: { profileId, clientKey: { startsWith: prefix } }, select: ROW, orderBy: { createdAt: "asc" }, take: TASK_OPEN_MAX }),
  ]);
  return rows.map(row => toItem(row, today));
}

// The learner's tasks filed under these subjects, oldest first: the tasks of
// a subject Build with Nova works on.
export async function listTasksInSubjects(profileId: string, subjectIds: string[], options: { now?: Date } = {}): Promise<NovaTaskItem[]> {
  if (subjectIds.length === 0) return [];
  const now = options.now ?? new Date();
  const [today, rows] = await Promise.all([
    todayOf(profileId, now),
    prisma.novaTask.findMany({ where: { profileId, subjectId: { in: subjectIds } }, select: ROW, orderBy: { createdAt: "asc" }, take: TASK_OPEN_MAX }),
  ]);
  return rows.map(row => toItem(row, today));
}

// ── Changes Build with Nova applies (product/workspaces.ts changeResource) ────
// Each inside the caller's transaction, each guarded on the task being the
// learner's (and, for a removal, still open): a task that is not stops the
// whole change set (the caller rolls back).

export class TaskChanged extends Error {}

export async function updateTasksIn(
  tx: Pick<typeof prisma, "novaTask">,
  profileId: string,
  changes: Array<{ taskId: string; title?: string; dueDay?: string | null; priority?: "low" | "medium" | "high" | null; parentId?: string | null; description?: string | null }>,
): Promise<void> {
  for (const c of changes) {
    const data: Record<string, unknown> = {};
    if (c.title !== undefined) data.title = c.title;
    if (c.dueDay !== undefined) data.dueDay = c.dueDay;
    if (c.priority !== undefined) data.priority = c.priority;
    if (c.description !== undefined) data.description = c.description;
    if (c.parentId !== undefined) {
      // Checked against the tree as it is inside this transaction.
      if (await parentProblem(tx, profileId, c.taskId, c.parentId)) throw new TaskChanged();
      data.parentId = c.parentId;
    }
    const r = await tx.novaTask.updateMany({ where: { id: c.taskId, profileId }, data });
    if (r.count !== 1) throw new TaskChanged();
  }
}

// Only open tasks: a finished one is the learner's record and stays.
export async function removeOpenTasksIn(tx: Pick<typeof prisma, "novaTask">, profileId: string, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  await promoteStepsIn(tx, profileId, taskIds);
  const r = await tx.novaTask.deleteMany({ where: { id: { in: taskIds }, profileId, status: { not: "done" } } });
  if (r.count !== taskIds.length) throw new TaskChanged();
}

// These open tasks first, in this order (the board's own order, position).
export async function placeTasksIn(tx: Pick<typeof prisma, "novaTask">, profileId: string, taskIds: string[]): Promise<void> {
  for (const [position, id] of taskIds.entries()) {
    const r = await tx.novaTask.updateMany({ where: { id, profileId, status: { not: "done" } }, data: { position } });
    if (r.count !== 1) throw new TaskChanged();
  }
}

// The learner's tasks filed under a subject, with their parents, for the
// Knowledge Map: open ones first, then the most recently finished, at most
// `take`. Steps of a task that is shown come with it when they fit.
export async function listTaskLinks(profileId: string, take: number): Promise<{
  tasks: Array<{ id: string; title: string; status: "todo" | "in_progress" | "done"; subjectId: string | null; topicName: string | null; parentId: string | null }>; total: number;
}> {
  const select = { id: true, title: true, status: true, subjectId: true, topicName: true, parentId: true } as const;
  const [open, done, total] = await Promise.all([
    prisma.novaTask.findMany({ where: { profileId, subjectId: { not: null }, status: { not: "done" } }, select, orderBy: { createdAt: "asc" }, take }),
    prisma.novaTask.findMany({ where: { profileId, subjectId: { not: null }, status: "done" }, select, orderBy: { completedAt: "desc" }, take }),
    prisma.novaTask.count({ where: { profileId, subjectId: { not: null } } }),
  ]);
  const rows = [...open, ...done].slice(0, take);
  return { tasks: rows.map(r => ({ ...r, status: TASK_STATUSES.find(s => s === r.status) ?? "todo" })), total };
}

// Of these ids, the ones that are this learner's tasks: id → title and status.
// How the calendar checks a task an event is for, and names it.
export async function tasksOwnedBy(profileId: string, ids: string[]): Promise<Map<string, { title: string; status: string }>> {
  if (ids.length === 0) return new Map();
  const rows = await prisma.novaTask.findMany({ where: { profileId, id: { in: ids } }, select: { id: true, title: true, status: true } });
  return new Map(rows.map(r => [r.id, { title: r.title, status: r.status }]));
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
  const problem = await parentProblem(prisma, profileId, null, changes.parentId ?? null);
  if (problem) return { ok: false, error: changes.parentId ? "bad_parent" : "unknown_parent", message: problem };
  // A step is filed where its task is, unless the learner said otherwise.
  if (changes.parentId) {
    const parent = await prisma.novaTask.findFirst({ where: { id: changes.parentId, profileId }, select: { subjectId: true, topicName: true } });
    if (parent && changes.subjectId === undefined) changes.subjectId = parent.subjectId;
    if (parent && changes.topicName === undefined) changes.topicName = parent.topicName;
  }

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
        parentId: changes.parentId ?? null, description: changes.description ?? null,
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

// A workspace's tasks (product/workspaces.ts), inside its transaction. Each
// is checked as createTask checks one, carries its key, and is made once: a
// key already on record is left as it is. Refused whole when it would take
// the learner past the open-task limit; the transaction then writes nothing.
// A task may name its parent by the parent's key (`parentKey`: a task made
// in the same call or already on record under that key) or by id
// (`parentId`: a task of the learner's). Parents are made before their steps;
// a step whose parent is neither is made a task of its own. The tree rules
// (task-tree.ts) are the caller's: a plan was checked before it got here.
export async function createTasksIn(
  tx: Pick<typeof prisma, "novaTask">,
  profileId: string,
  tasks: Array<Record<string, unknown>>,
): Promise<{ ok: true; added: number; existing: number; ids: Map<string, string> } | { ok: false; message: string }> {
  const parsed: Array<TaskInput & { parentKey: string | null }> = [];
  for (const raw of tasks) {
    const p = parseTaskInput(raw, true);
    if (!p.ok) return { ok: false, message: p.message };
    const parentKey = typeof raw.parentKey === "string" && raw.parentKey ? raw.parentKey : null;
    parsed.push({ ...p.changes, parentKey });
  }
  const keys = parsed.flatMap(c => [c.clientKey, c.parentKey]).filter((k): k is string => typeof k === "string");
  const existing = await tx.novaTask.findMany({ where: { profileId, clientKey: { in: keys } }, select: { id: true, clientKey: true } });
  // key → id, for every task this call makes or finds.
  const ids = new Map(existing.map(t => [t.clientKey!, t.id]));
  const fresh = parsed.filter(c => !c.clientKey || !ids.has(c.clientKey));
  if (await tx.novaTask.count({ where: { profileId, status: { not: "done" } } }) + fresh.length > TASK_OPEN_MAX) {
    return { ok: false, message: "That would be more open tasks than Kivo keeps. Finish or remove some first." };
  }
  const own = new Set((await tx.novaTask.findMany({ where: { profileId, id: { in: fresh.flatMap(c => (c.parentId ? [c.parentId] : [])) } }, select: { id: true } })).map(t => t.id));
  // Parents first: a step waits until the task it belongs to is made.
  const pending = [...fresh];
  for (let pass = 0; pending.length > 0 && pass <= fresh.length; pass++) {
    for (const c of [...pending]) {
      const waiting = c.parentKey !== null && !ids.has(c.parentKey) && pending.some(o => o.clientKey === c.parentKey);
      if (waiting) continue;
      const parentId = c.parentKey !== null ? ids.get(c.parentKey) ?? null : c.parentId && own.has(c.parentId) ? c.parentId : null;
      const made = await tx.novaTask.create({
        data: {
          profileId, title: c.title!, status: "todo", priority: c.priority ?? null, subjectId: c.subjectId ?? null,
          topicName: c.topicName ?? null, dueDay: c.dueDay ?? null, clientKey: c.clientKey ?? null, estimatedMinutes: c.estimatedMinutes ?? null,
          parentId, description: c.description ?? null,
        },
        select: { id: true },
      });
      if (c.clientKey) ids.set(c.clientKey, made.id);
      pending.splice(pending.indexOf(c), 1);
    }
  }
  return { ok: true, added: fresh.length, existing: parsed.length - fresh.length, ids };
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
  if (changes.description !== undefined) data.description = changes.description;
  if (changes.parentId !== undefined) {
    const problem = await parentProblem(prisma, profileId, taskId, changes.parentId);
    if (problem) return { ok: false, error: "bad_parent", message: problem };
    data.parentId = changes.parentId;
  }
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

// Its steps stay: they move up to the task it was a step of (or become tasks
// of their own). Removing a task with its steps is a choice the page makes
// explicitly (deleteTasks).
export async function deleteTask(profileId: string, taskId: string): Promise<boolean> {
  return prisma.$transaction(async tx => {
    await promoteStepsIn(tx, profileId, [taskId]);
    return (await tx.novaTask.deleteMany({ where: { id: taskId, profileId } })).count === 1;
  });
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
      // this column: one that is not stops the whole order. Rows are written
      // in one fixed order (by id), so two reorders at once wait for each
      // other instead of deadlocking.
      const placed = (ids as string[]).map((id, position) => [position, id] as const).sort((a, b) => a[1].localeCompare(b[1]));
      for (const [position, id] of placed) {
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

// When the learner renames, moves or removes a topic in study setup
// (product/setup-edit.ts), the tasks filed under it follow, in the caller's
// transaction. Only the filing changes.
export async function refileTasksForTopic(
  tx: Pick<typeof prisma, "novaTask">,
  profileId: string,
  from: { subjectId: string; topicName: string },
  to: { subjectId: string; topicName: string | null },
): Promise<number> {
  const r = await tx.novaTask.updateMany({
    where: { profileId, subjectId: from.subjectId, topicName: { equals: from.topicName, mode: "insensitive" } },
    data:  { subjectId: to.subjectId, topicName: to.topicName },
  });
  return r.count;
}
