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
  TASK_DONE_SHOWN, TASK_KEY_MAX, TASK_OPEN_MAX, TASK_PRIORITIES, TASK_STATUSES, TASK_TITLE_MAX, TASK_TOPIC_MAX,
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
} as const;
type Row = {
  id: string; title: string; status: string; priority: string | null; subjectId: string | null; topicName: string | null;
  dueDay: string | null; completedAt: Date | null; createdAt: Date; updatedAt: Date; subject: { name: string } | null;
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
