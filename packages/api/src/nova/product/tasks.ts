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
import { TASK_DEPTH_MAX, canPlace, levelOf, parentsOf, subtreeOf, wouldLoop, type TreeNode, type Wait } from "./task-tree";
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
  if (input.parentId !== undefined) {
    if (input.parentId === null || input.parentId === "") changes.parentId = null;
    else if (typeof input.parentId === "string" && input.parentId.length <= 64) changes.parentId = input.parentId;
    else return reject("bad_parent", "That task isn't one of yours.");
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
  estimatedMinutes: true, position: true, parentId: true,
  waitsOn: { select: { dependsOnId: true }, orderBy: { createdAt: "asc" as const } },
} as const;
type Row = {
  id: string; title: string; status: string; priority: string | null; subjectId: string | null; topicName: string | null;
  dueDay: string | null; completedAt: Date | null; createdAt: Date; updatedAt: Date; subject: { name: string } | null;
  estimatedMinutes: number | null; position: number | null; parentId: string | null;
  waitsOn: Array<{ dependsOnId: string }>;
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
    estimatedMinutes: row.estimatedMinutes, position: row.position, parentId: row.parentId,
    after: row.waitsOn.map(w => w.dependsOnId),
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

// Every open task and the most recently finished, as an outline (title,
// status, the task it is a step of, where it is filed): what the Knowledge
// Map shows in a topic's panel.
export interface TaskOutlineRow {
  id: string; title: string; status: TaskStatus; parentId: string | null; subjectId: string | null; topicName: string | null;
  dueDay: string | null; priority: TaskPriority | null; estimatedMinutes: number | null; clientKey: string | null; after: string[];
}
export async function listTaskOutline(profileId: string): Promise<TaskOutlineRow[]> {
  const select = { id: true, title: true, status: true, parentId: true, subjectId: true, topicName: true, createdAt: true, dueDay: true, priority: true, estimatedMinutes: true, clientKey: true, position: true, waitsOn: { select: { dependsOnId: true } } } as const;
  const [open, done] = await Promise.all([
    prisma.novaTask.findMany({ where: { profileId, status: { not: "done" } }, select, orderBy: { createdAt: "asc" }, take: TASK_OPEN_MAX }),
    prisma.novaTask.findMany({ where: { profileId, status: "done" }, select, orderBy: { completedAt: "desc" }, take: TASK_DONE_SHOWN * 4 }),
  ]);
  // In the order they were made (a plan's order), a board position first where the learner gave one.
  return [...open, ...done].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
    .map(t => ({
      id: t.id, title: t.title, status: TASK_STATUSES.find(s => s === t.status) ?? "todo", parentId: t.parentId, subjectId: t.subjectId, topicName: t.topicName,
      dueDay: t.dueDay, priority: TASK_PRIORITIES.find(p => p === t.priority) ?? null, estimatedMinutes: t.estimatedMinutes, clientKey: t.clientKey,
      after: t.waitsOn.map(w => w.dependsOnId),
    }));
}

// ── Writes ────────────────────────────────────────────────────────────────────

// The learner's tasks as a tree (id and parent only), read in the caller's
// transaction when there is one: what a step or a move is checked against.
async function treeOf(db: Pick<typeof prisma, "novaTask">, profileId: string): Promise<TreeNode[]> {
  return (await db.novaTask.findMany({ where: { profileId }, select: { id: true, parentId: true }, take: 2_000 })).map(t => ({ id: t.id, parent: t.parentId }));
}

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
  changes: Array<{ taskId: string; title?: string; dueDay?: string | null; priority?: "low" | "medium" | "high" | null; parentId?: string | null; estimatedMinutes?: number | null; topicName?: string | null }>,
): Promise<void> {
  for (const c of changes) {
    const data: Record<string, unknown> = {};
    if (c.parentId !== undefined) {
      // Checked against the tree as it is inside this transaction.
      if (!canPlace(await treeOf(tx, profileId), c.taskId, c.parentId).ok) throw new TaskChanged();
      data.parentId = c.parentId;
    }
    if (c.title !== undefined) data.title = c.title;
    if (c.dueDay !== undefined) data.dueDay = c.dueDay;
    if (c.priority !== undefined) data.priority = c.priority;
    if (c.estimatedMinutes !== undefined) data.estimatedMinutes = c.estimatedMinutes;
    if (c.topicName !== undefined) data.topicName = c.topicName;
    if (Object.keys(data).length === 0) continue;
    const r = await tx.novaTask.updateMany({ where: { id: c.taskId, profileId }, data });
    if (r.count !== 1) throw new TaskChanged();
  }
}

// The tasks one key prefix made (a workspace's "ws:<key>:", its build and
// every change applied to it) and everything under them, as an outline:
// what deleting that workspace removes. A step the learner added under one
// of them goes with it, and is counted.
export async function tasksMadeUnder(profileId: string, prefix: string): Promise<Array<{ id: string; title: string; status: TaskStatus; parentId: string | null; made: boolean }>> {
  const all = await prisma.novaTask.findMany({ where: { profileId }, select: { id: true, title: true, status: true, parentId: true, clientKey: true }, take: 2_000 });
  const made = new Set(all.filter(t => t.clientKey?.startsWith(prefix)).map(t => t.id));
  const nodes = all.map(t => ({ id: t.id, parent: t.parentId }));
  const going = new Set([...made].flatMap(id => subtreeOf(nodes, id)));
  return all.filter(t => going.has(t.id)).map(t => ({ id: t.id, title: t.title, status: TASK_STATUSES.find(s => s === t.status) ?? "todo", parentId: t.parentId, made: made.has(t.id) }));
}

// These steps become tasks of their own (the learner's steps under tasks
// about to be removed), inside the caller's transaction.
export async function liftStepsIn(tx: Pick<typeof prisma, "novaTask">, profileId: string, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  const r = await tx.novaTask.updateMany({ where: { id: { in: taskIds }, profileId }, data: { parentId: null } });
  if (r.count !== taskIds.length) throw new TaskChanged();
}

// Removes these tasks, finished or not, and their steps (a confirmed
// deletion of what Nova made). One that is not the learner's stops it.
export async function removeTasksIn(tx: Pick<typeof prisma, "novaTask">, profileId: string, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  const owned = await tx.novaTask.count({ where: { id: { in: taskIds }, profileId } });
  if (owned !== taskIds.length) throw new TaskChanged();
  await tx.novaTask.deleteMany({ where: { id: { in: taskIds }, profileId } });
}

// Only open tasks: a finished one is the learner's record and stays.
export async function removeOpenTasksIn(tx: Pick<typeof prisma, "novaTask">, profileId: string, taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
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
  // A step: under a task of theirs, within the depth, filed where its parent is unless said.
  if (changes.parentId) {
    const nodes = await treeOf(prisma, profileId);
    const parent = await prisma.novaTask.findFirst({ where: { id: changes.parentId, profileId }, select: { subjectId: true, topicName: true } });
    if (!parent) return { ok: false, error: "bad_parent", message: "That task isn't one of yours." };
    if (levelOf(parentsOf(nodes), changes.parentId) + 1 > TASK_DEPTH_MAX) return { ok: false, error: "bad_parent", message: `Steps go at most ${TASK_DEPTH_MAX} levels deep.` };
    if (changes.subjectId === undefined) changes.subjectId = parent.subjectId;
    if (changes.topicName === undefined) changes.topicName = parent.topicName;
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
        estimatedMinutes: changes.estimatedMinutes ?? null, parentId: changes.parentId ?? null,
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
// A step names its parent by `parentKey` (the clientKey of a task in this
// batch or already stored) or `parentId`; parents are written first, so
// each step is made under the task it belongs to. A step whose parent can't
// be found stops the batch.
export async function createTasksIn(
  tx: Pick<typeof prisma, "novaTask" | "novaTaskDependency">,
  profileId: string,
  tasks: Array<Record<string, unknown>>,
): Promise<{ ok: true; added: number; existing: number } | { ok: false; message: string }> {
  const parsed: Array<TaskInput & { parentKey?: string; afterKeys?: string[]; afterIds?: string[] }> = [];
  const keysOf = (v: unknown) => (Array.isArray(v) ? v.filter((k): k is string => typeof k === "string" && k.length > 0 && k.length <= 160) : []);
  for (const raw of tasks) {
    const p = parseTaskInput(raw, true);
    if (!p.ok) return { ok: false, message: p.message };
    const parentKey = typeof raw.parentKey === "string" && raw.parentKey ? raw.parentKey : undefined;
    // What it waits on: tasks of this batch or stored ones by clientKey (afterKeys), or by id (afterIds).
    const afterKeys = keysOf(raw.afterKeys), afterIds = keysOf(raw.afterIds);
    parsed.push({ ...p.changes, ...(parentKey ? { parentKey } : {}), ...(afterKeys.length ? { afterKeys } : {}), ...(afterIds.length ? { afterIds } : {}) });
  }
  const keys = parsed.map(c => c.clientKey).filter((k): k is string => typeof k === "string");
  const have = new Set((await tx.novaTask.findMany({ where: { profileId, clientKey: { in: keys } }, select: { clientKey: true } })).map(t => t.clientKey));
  const fresh = parsed.filter(c => !c.clientKey || !have.has(c.clientKey));
  if (await tx.novaTask.count({ where: { profileId, status: { not: "done" } } }) + fresh.length > TASK_OPEN_MAX) {
    return { ok: false, message: "That would be more open tasks than Kivo keeps. Finish or remove some first." };
  }
  // Ids by clientKey: those stored already, then each as it is made.
  const parentKeys = parsed.map(c => c.parentKey).filter((k): k is string => typeof k === "string");
  const ids = new Map((await tx.novaTask.findMany({ where: { profileId, clientKey: { in: [...keys, ...parentKeys] } }, select: { id: true, clientKey: true } })).map(t => [t.clientKey!, t.id]));
  const nodes: TreeNode[] = await treeOf(tx, profileId);
  const keysMissing = new Set<string>();
  // Parents first: a step waits until the task it names has been made.
  let pending = fresh;
  for (let round = 0; pending.length > 0; round++) {
    const ready = pending.filter(c => (!c.parentKey || ids.has(c.parentKey)));
    if (ready.length === 0 || round > TASK_DEPTH_MAX + 1) return { ok: false, message: "A step names a task that isn't there." };
    for (const c of ready) {
      const parentId = c.parentId ?? (c.parentKey ? ids.get(c.parentKey)! : null);
      if (parentId) {
        const parent = await tx.novaTask.findFirst({ where: { id: parentId, profileId }, select: { id: true } });
        if (!parent) return { ok: false, message: "A step names a task that isn't one of yours." };
        if (levelOf(parentsOf(nodes), parentId) + 1 > TASK_DEPTH_MAX) return { ok: false, message: `Steps go at most ${TASK_DEPTH_MAX} levels deep.` };
      }
      const row = await tx.novaTask.create({
        data: {
          profileId, title: c.title!, status: "todo", priority: c.priority ?? null, subjectId: c.subjectId ?? null,
          topicName: c.topicName ?? null, dueDay: c.dueDay ?? null, clientKey: c.clientKey ?? null, estimatedMinutes: c.estimatedMinutes ?? null,
          parentId,
        },
        select: { id: true },
      });
      nodes.push({ id: row.id, parent: parentId });
      if (c.clientKey) ids.set(c.clientKey, row.id);
    }
    pending = pending.filter(c => !ready.includes(c));
  }
  // Waits, once every task of the batch is there. A wait on a task that
  // can't be found stops the batch.
  const waits: Array<{ taskId: string; after: string[] }> = [];
  for (const c of fresh) {
    if (!c.clientKey || (!c.afterKeys?.length && !c.afterIds?.length)) continue;
    const on = [...(c.afterKeys ?? []).map(k => ids.get(k) ?? (keysMissing.add(k), "")), ...(c.afterIds ?? [])].filter(Boolean);
    if (on.length) waits.push({ taskId: ids.get(c.clientKey)!, after: on });
  }
  if (keysMissing.size > 0) {
    const late = await tx.novaTask.findMany({ where: { profileId, clientKey: { in: [...keysMissing] } }, select: { id: true, clientKey: true } });
    if (late.length !== keysMissing.size) return { ok: false, message: "A task waits on one that isn't there." };
    for (const t of late) ids.set(t.clientKey!, t.id);
    for (const c of fresh) {
      const w = waits.find(x => x.taskId === ids.get(c.clientKey ?? ""));
      const extra = (c.afterKeys ?? []).filter(k => keysMissing.has(k)).map(k => ids.get(k)!);
      if (w) w.after.push(...extra); else if (extra.length && c.clientKey) waits.push({ taskId: ids.get(c.clientKey)!, after: extra });
    }
  }
  try { await addWaitsIn(tx, profileId, waits); } catch (err) { if (err instanceof TaskChanged) return { ok: false, message: "A task can't wait on itself or go round in a circle." }; throw err; }
  return { ok: true, added: fresh.length, existing: parsed.length - fresh.length };
}

// ── Waits (NovaTaskDependency; this file is its only writer) ──────────────────

async function waitsOf(db: Pick<typeof prisma, "novaTaskDependency">, profileId: string): Promise<Wait[]> {
  return (await db.novaTaskDependency.findMany({ where: { task: { profileId } }, select: { taskId: true, dependsOnId: true }, take: 5_000 }))
    .map(w => ({ task: w.taskId, on: w.dependsOnId }));
}

// Adds these waits (each task on the ones listed), inside the caller's
// transaction. Every task named must be the learner's; a wait on itself, or
// one that would go round in a circle, stops it all (TaskChanged).
export async function addWaitsIn(tx: Pick<typeof prisma, "novaTask" | "novaTaskDependency">, profileId: string, changes: Array<{ taskId: string; after: string[] }>): Promise<void> {
  const pairs = changes.flatMap(c => [...new Set(c.after)].map(on => ({ task: c.taskId, on })));
  if (pairs.length === 0) return;
  const named = [...new Set(pairs.flatMap(p => [p.task, p.on]))];
  if (await tx.novaTask.count({ where: { id: { in: named }, profileId } }) !== named.length) throw new TaskChanged();
  const waits = await waitsOf(tx, profileId);
  for (const p of pairs) {
    if (waits.some(w => w.task === p.task && w.on === p.on)) continue;
    if (wouldLoop(waits, p.task, p.on)) throw new TaskChanged();
    waits.push(p);
    await tx.novaTaskDependency.create({ data: { taskId: p.task, dependsOnId: p.on } });
  }
}

// What a task waits on, set to exactly these (an empty list: nothing).
export async function setWaitsIn(tx: Pick<typeof prisma, "novaTask" | "novaTaskDependency">, profileId: string, changes: Array<{ taskId: string; after: string[] }>): Promise<void> {
  for (const c of changes) {
    if (await tx.novaTask.count({ where: { id: c.taskId, profileId } }) !== 1) throw new TaskChanged();
    await tx.novaTaskDependency.deleteMany({ where: { taskId: c.taskId, task: { profileId } } });
  }
  await addWaitsIn(tx, profileId, changes);
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
  if (changes.parentId !== undefined) {
    const placed = canPlace(await treeOf(prisma, profileId), taskId, changes.parentId);
    if (!placed.ok) return { ok: false, error: "bad_parent", message: placed.reason === "too_deep" ? `Steps go at most ${TASK_DEPTH_MAX} levels deep.` : placed.reason === "missing" ? "That task isn't one of yours." : "A task can't be a step of itself or of its own steps." };
  }

  const data: Record<string, unknown> = {};
  if (changes.title !== undefined)     data.title = changes.title;
  if (changes.priority !== undefined)  data.priority = changes.priority;
  if (changes.subjectId !== undefined) data.subjectId = changes.subjectId;
  if (changes.topicName !== undefined) data.topicName = changes.topicName;
  if (changes.dueDay !== undefined)    data.dueDay = changes.dueDay;
  if (changes.estimatedMinutes !== undefined) data.estimatedMinutes = changes.estimatedMinutes;
  if (changes.parentId !== undefined) data.parentId = changes.parentId;
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
