// ─── Today's flow: the learner's own list for the day ────────────────────────
// The only reader and writer of NovaDayFlow. The rules are day-flow-rules.ts
// (pure); this file reads what they need, checks every reference against the
// learner's own records, and writes the result.
//
//   - The day is the server's: the learner's calendar day in their zone.
//     Nothing from the request names a learner, a profile or a day.
//   - Reading writes nothing. With no flow saved for today, Nova's draft is
//     worked out from the record (tasks due, the planner's blocks) on every
//     read and named by a fingerprint of its items, like a recovery proposal;
//     taking it is a write that checks the fingerprint is still the one shown.
//     A saved flow is never replaced by a draft.
//   - Every change is made against the version it was read at; a change to a
//     newer version is refused (stale) with the flow as it now stands.
//     Several operations apply together or not at all.
//   - Items name tasks and topics by id, each checked to be the learner's own.
//     Nothing here writes a task, a topic, a session, an exam or the roadmap:
//     removing an item leaves its task as it is, "done for today" is not the
//     task's status, and a time for today is not the task's estimate.
//   - Starting a focus session from an item goes through the one session
//     command (session.ts) and records the session on the item.
//   - Undo puts back the state before the last change (FLOW_UNDO_MAX kept).

import { createHash, randomUUID } from "node:crypto";
import { prisma } from "@repo/db/client";
import { dayKey, localHour, localMinute, resolveTimezone } from "../engines/learner-calendar";
import { getAllTopicMasteries } from "../engines/knowledge-engine";
import { listTasks } from "./tasks";
import { listWorkspaces } from "./workspaces";
import { loadNovaToday } from "./today";
import { runNovaSessionCommand } from "./session";
import { applyFlowOps, draftFrom, ordered, type FlowState, type Resolved } from "./day-flow-rules";
import {
  FLOW_OPS_MAX, FLOW_UNDO_MAX,
  type DayFlowResponse, type FlowCandidate, type FlowDraft, type FlowItem, type FlowItemView, type FlowOp, type FlowView, type NewFlowItem, type NovaDayView,
} from "./day-flow.types";
import type { NovaTaskItem } from "./tasks.types";
import type { NovaTodayReady } from "./today.types";

type Refusal = Extract<DayFlowResponse, { ok: false }>;
const refuse = (error: Refusal["error"], message: string, flow?: NovaDayView): Refusal => ({ ok: false, error, message, ...(flow ? { flow } : {}) });

const newId = () => `f${randomUUID().split("-").join("").slice(0, 12)}`;

interface Row { id: string; day: string; intention: string | null; items: unknown; saved: boolean; view: string; history: unknown; version: number }

function readItems(raw: unknown): FlowItem[] {
  return Array.isArray(raw) ? raw.filter((x): x is FlowItem => !!x && typeof x === "object" && typeof (x as FlowItem).id === "string" && typeof (x as FlowItem).title === "string") : [];
}
function readHistory(raw: unknown): Array<{ items: FlowItem[]; intention: string | null }> {
  return Array.isArray(raw) ? raw.filter(h => h && typeof h === "object").map(h => ({ items: readItems((h as { items: unknown }).items), intention: typeof (h as { intention?: unknown }).intention === "string" ? (h as { intention: string }).intention : null })) : [];
}

async function learnerClock(profileId: string, now: Date): Promise<{ day: string; nowMinutes: number }> {
  const p = await prisma.novaAcademicProfile.findUnique({ where: { id: profileId }, select: { timezone: true } });
  const tz = resolveTimezone(p?.timezone ?? null);
  return { day: dayKey(now, tz), nowMinutes: localHour(now, tz) * 60 + localMinute(now, tz) };
}

// ── What the flow is made from ───────────────────────────────────────────────

interface Context {
  tasks:   Map<string, NovaTaskItem>;
  topics:  Map<string, { topicName: string; subjectName: string }>;
  blocks:  NovaTodayReady["alternatives"];
  budget:  number | null;
  activeSessionId: string | null;
  workspaceOf: (subjectName: string | null) => string | null;
}

async function loadContext(profileId: string, platformChatId: string, now: Date): Promise<Context> {
  const [board, topics, today, workspaces] = await Promise.all([
    listTasks(profileId, { now }),
    getAllTopicMasteries(profileId, now),
    loadNovaToday(platformChatId, { now }).catch(() => null),
    listWorkspaces(profileId).catch(() => ({ status: "ready" as const, workspaces: [] })),
  ]);
  const ready = today && today.status === "ready" ? today as NovaTodayReady : null;
  const bySubject = new Map<string, string>();
  for (const w of workspaces.workspaces) for (const s of w.subjects) if (!bySubject.has(s.name.toLowerCase())) bySubject.set(s.name.toLowerCase(), w.title);
  return {
    tasks: new Map(board.tasks.map(t => [t.id, t])),
    topics: new Map(topics.map(t => [t.topicId, { topicName: t.topicName, subjectName: t.subjectName }])),
    blocks: ready ? [...(ready.recommendation ? [ready.recommendation] : []), ...ready.alternatives] : [],
    budget: ready ? ready.plan.budgetMinutes : null,
    activeSessionId: ready?.activeSession?.id ?? null,
    workspaceOf: s => (s ? bySubject.get(s.toLowerCase()) ?? null : null),
  };
}

function resolver(ctx: Context): (item: NewFlowItem) => Resolved | null {
  return item => {
    if (!item || typeof item !== "object") return null;
    if (item.kind === "task") {
      const t = typeof item.taskId === "string" ? ctx.tasks.get(item.taskId) : undefined;
      return t ? { kind: "task", taskId: t.id, topicId: null, title: t.title, subjectName: t.subjectName, topicName: t.topicName, minutes: t.estimatedMinutes } : null;
    }
    if (item.kind === "topic") {
      const t = typeof item.topicId === "string" ? ctx.topics.get(item.topicId) : undefined;
      if (!t) return null;
      const block = ctx.blocks.find(b => b.topicId === item.topicId);
      return { kind: "topic", taskId: null, topicId: item.topicId, title: t.topicName, subjectName: t.subjectName, topicName: t.topicName, minutes: block?.durationMinutes ?? null };
    }
    if (item.kind === "focus") {
      const title = typeof item.title === "string" ? item.title.trim() : "";
      return title ? { kind: "focus", taskId: null, topicId: null, title, subjectName: null, topicName: null, minutes: null } : null;
    }
    return null;
  };
}

function draftOf(ctx: Context, now: Date): (FlowDraft & { id: string }) | null {
  // Ids that do not change between reads, so the draft shown is the draft taken.
  let n = 0;
  const draft = draftFrom({
    tasks: [...ctx.tasks.values()], blocks: ctx.blocks, budgetMinutes: ctx.budget, now: now.toISOString(),
  }, () => `d${++n}`);
  if (!draft) return null;
  const id = createHash("sha256").update(JSON.stringify(draft.items.map(i => [i.kind, i.taskId, i.topicId, i.minutes, i.status]))).digest("hex").slice(0, 16);
  return { ...draft, id };
}

function candidatesOf(ctx: Context, items: FlowItem[]): FlowCandidate[] {
  const inFlow = (kind: string, id: string) => items.some(i => (kind === "task" ? i.taskId === id : i.topicId === id));
  const due = (d: number | null) => (d === null ? null : d < 0 ? `overdue ${-d} day${d === -1 ? "" : "s"}` : d === 0 ? "due today" : d === 1 ? "due tomorrow" : `due in ${d} days`);
  const tasks: FlowCandidate[] = [...ctx.tasks.values()].filter(t => t.status !== "done" && !inFlow("task", t.id))
    .sort((a, b) => (a.dueInDays ?? 999) - (b.dueInDays ?? 999))
    .map(t => ({ kind: "task", id: t.id, title: t.title, subjectName: t.subjectName, topicName: t.topicName, minutes: t.estimatedMinutes, why: due(t.dueInDays), workspace: ctx.workspaceOf(t.subjectName) }));
  const planned = new Set(ctx.blocks.map(b => b.topicId));
  const topics: FlowCandidate[] = [...ctx.topics.entries()].filter(([id]) => !inFlow("topic", id))
    .sort(([a], [b]) => Number(planned.has(b)) - Number(planned.has(a)))
    .map(([id, t]) => {
      const block = ctx.blocks.find(b => b.topicId === id);
      return { kind: "topic", id, title: t.topicName, subjectName: t.subjectName, topicName: t.topicName, minutes: block?.durationMinutes ?? null, why: block ? `planned today: ${block.reasons[0] ?? block.activityType.replace("_", " ")}` : null, workspace: ctx.workspaceOf(t.subjectName) };
    });
  return [...tasks.slice(0, 60), ...topics.slice(0, 80)];
}

async function sessionsOf(profileId: string, items: FlowItem[]) {
  const ids = items.map(i => i.sessionId).filter((x): x is string => !!x);
  if (!ids.length) return new Map<string, { status: string; minutes: number }>();
  const rows = await prisma.novaStudySession.findMany({ where: { profileId, id: { in: ids } }, select: { id: true, status: true, durationMinutes: true } });
  return new Map(rows.map(r => [r.id, { status: r.status, minutes: r.durationMinutes }]));
}

async function viewOf(profileId: string, row: Row | null, ctx: Context, clock: { day: string; nowMinutes: number }, now: Date): Promise<NovaDayView> {
  const items = ordered(readItems(row?.items));
  const sessions = await sessionsOf(profileId, items);
  const views: FlowItemView[] = items.map(i => {
    const task = i.taskId ? ctx.tasks.get(i.taskId) : undefined;
    const topic = i.topicId ? ctx.topics.get(i.topicId) : undefined;
    const block = i.topicId ? ctx.blocks.find(b => b.topicId === i.topicId) : undefined;
    const s = i.sessionId ? sessions.get(i.sessionId) : undefined;
    const open = s && (s.status === "in_progress" || s.status === "paused");
    return {
      ...i,
      // A task's title as it is now, renamed or not.
      title: task ? (i.title.endsWith(")") && i.title.startsWith(task.title) ? i.title : task.title) : i.title,
      ref: i.kind === "task" ? { status: task?.status ?? null, minutes: task?.estimatedMinutes ?? null, dueInDays: task?.dueInDays ?? null, gone: !task }
        : i.kind === "topic" ? { status: null, minutes: block?.durationMinutes ?? null, dueInDays: null, gone: !topic } : null,
      spentMinutes: s ? (open ? null : s.minutes) : null,
      sessionEnded: i.status === "active" && !!i.sessionId && !open && i.sessionId !== ctx.activeSessionId,
    };
  });
  const saved = row?.saved === true;
  const draft = !saved && items.length === 0 ? draftOf(ctx, now) : null;
  return {
    status: "ready", day: clock.day, version: row?.version ?? 0, saved, intention: row?.intention ?? null,
    view: row?.view === "schedule" ? "schedule" : "list", items: views, draft,
    canUndo: readHistory(row?.history).length > 0,
    budgetMinutes: ctx.budget,
    plannedMinutes: views.filter(v => v.status === "planned" || v.status === "active").reduce((s, v) => s + (v.minutes ?? 0), 0),
    candidates: candidatesOf(ctx, items), activeSessionId: ctx.activeSessionId, nowMinutes: clock.nowMinutes,
  };
}

const SELECT = { id: true, day: true, intention: true, items: true, saved: true, view: true, history: true, version: true } as const;

export async function loadDayFlow(profileId: string, platformChatId: string, now = new Date()): Promise<NovaDayView> {
  const clock = await learnerClock(profileId, now);
  const [row, ctx] = await Promise.all([
    prisma.novaDayFlow.findUnique({ where: { profileId_day: { profileId, day: clock.day } }, select: SELECT }),
    loadContext(profileId, platformChatId, now),
  ]);
  return viewOf(profileId, row, ctx, clock, now);
}

// ── Writing ──────────────────────────────────────────────────────────────────

// Writes the next state only over the version it was read at. A first write
// for the day creates the row (a second create racing it is stale too).
async function write(profileId: string, day: string, row: Row | null, version: number, next: { items: FlowItem[]; intention: string | null; view?: FlowView; history?: Array<{ items: FlowItem[]; intention: string | null }> }): Promise<boolean> {
  const data = {
    items: next.items as unknown as object, intention: next.intention, saved: true,
    ...(next.view ? { view: next.view } : {}),
    ...(next.history ? { history: next.history as unknown as object } : {}),
  };
  if (!row) {
    if (version !== 0) return false;
    try { await prisma.novaDayFlow.create({ data: { profileId, day, ...data, version: 1 } }); return true; } catch { return false; }
  }
  const done = await prisma.novaDayFlow.updateMany({ where: { id: row.id, version }, data: { ...data, version: { increment: 1 } } });
  return done.count === 1;
}

interface Changing { profileId: string; platformChatId: string; version: unknown; now?: Date }

async function begin(input: Changing) {
  const now = input.now ?? new Date();
  const clock = await learnerClock(input.profileId, now);
  const [row, ctx] = await Promise.all([
    prisma.novaDayFlow.findUnique({ where: { profileId_day: { profileId: input.profileId, day: clock.day } }, select: SELECT }),
    loadContext(input.profileId, input.platformChatId, now),
  ]);
  const current = row?.version ?? 0;
  const version = typeof input.version === "number" && Number.isInteger(input.version) ? input.version : -1;
  return { now, clock, row, ctx, current, version, stale: version !== current };
}

const stale = async (profileId: string, ctx: Context, clock: { day: string; nowMinutes: number }, now: Date) => {
  const row = await prisma.novaDayFlow.findUnique({ where: { profileId_day: { profileId, day: clock.day } }, select: SELECT });
  return refuse("stale", "Today's flow changed in another tab or by Nova a moment ago. Here it is as it now stands.", await viewOf(profileId, row, ctx, clock, now));
};

// Operations on today's flow, from the learner (the page) or Nova (the
// copilot, after its reading is checked). All or none.
export async function changeDayFlow(input: Changing & { ops: unknown; by: "learner" | "nova" }): Promise<DayFlowResponse & { touched?: string[] }> {
  if (!Array.isArray(input.ops) || input.ops.length === 0 || input.ops.length > FLOW_OPS_MAX) return refuse("invalid", "That isn't a change Today can make.");
  const b = await begin(input);
  if (b.stale) return stale(input.profileId, b.ctx, b.clock, b.now);
  const state: FlowState = { items: readItems(b.row?.items), intention: b.row?.intention ?? null };
  const applied = applyFlowOps(state, input.ops as FlowOp[], { resolve: resolver(b.ctx), newId, by: input.by });
  if (!applied.ok) return refuse("invalid", applied.message, await viewOf(input.profileId, b.row, b.ctx, b.clock, b.now));
  const history = [...readHistory(b.row?.history), state].slice(-FLOW_UNDO_MAX);
  if (!await write(input.profileId, b.clock.day, b.row, b.version, { items: applied.state.items, intention: applied.state.intention, history })) return stale(input.profileId, b.ctx, b.clock, b.now);
  const flow = await loadDayFlow(input.profileId, input.platformChatId, b.now);
  return { ok: true, flow, changed: applied.changed, message: applied.changed.join(" "), touched: applied.touched };
}

// What operations would do to today's flow, worked out by the same rules and
// reference checks as changeDayFlow, written nowhere: how Nova's proposal is
// shown before the learner says yes. The ids of added items are the
// preview's own; applying makes new ones.
export async function previewDayFlow(input: Changing & { ops: unknown; by: "learner" | "nova" }): Promise<
  | { ok: true; before: FlowItem[]; after: FlowItem[]; changed: string[]; touched: string[]; budgetMinutes: number | null; intention: string | null }
  | Refusal
> {
  if (!Array.isArray(input.ops) || input.ops.length === 0 || input.ops.length > FLOW_OPS_MAX) return refuse("invalid", "That isn't a change Today can make.");
  const b = await begin(input);
  if (b.stale) return stale(input.profileId, b.ctx, b.clock, b.now);
  const state: FlowState = { items: readItems(b.row?.items), intention: b.row?.intention ?? null };
  const applied = applyFlowOps(state, input.ops as FlowOp[], { resolve: resolver(b.ctx), newId, by: input.by });
  if (!applied.ok) return refuse("invalid", applied.message);
  return { ok: true, before: ordered(state.items), after: ordered(applied.state.items), changed: applied.changed, touched: applied.touched, budgetMinutes: b.ctx.budget, intention: applied.state.intention };
}

// Nova's draft, taken as the day's flow: only when today has no flow saved,
// and only the draft the learner saw (its fingerprint).
export async function acceptDraft(input: Changing & { draftId: unknown }): Promise<DayFlowResponse> {
  const b = await begin(input);
  if (b.stale) return stale(input.profileId, b.ctx, b.clock, b.now);
  if (b.row?.saved && readItems(b.row.items).length) return refuse("invalid", "Today already has a flow. Nova's draft never replaces it.", await viewOf(input.profileId, b.row, b.ctx, b.clock, b.now));
  const draft = draftOf(b.ctx, b.now);
  if (!draft || draft.id !== input.draftId) return refuse("stale", "Your tasks or plan changed since Nova drafted this. Here is the draft as it now stands.", await viewOf(input.profileId, b.row, b.ctx, b.clock, b.now));
  const items = draft.items.map(i => ({ ...i, id: newId() }));
  if (!await write(input.profileId, b.clock.day, b.row, b.version, { items, intention: b.row?.intention ?? null, history: [...readHistory(b.row?.history), { items: [], intention: b.row?.intention ?? null }].slice(-FLOW_UNDO_MAX) })) return stale(input.profileId, b.ctx, b.clock, b.now);
  return { ok: true, flow: await loadDayFlow(input.profileId, input.platformChatId, b.now), changed: ["Took Nova's draft as today's flow."], message: "Took Nova's draft as today's flow. Change anything in it." };
}

export async function undoDayFlow(input: Changing): Promise<DayFlowResponse> {
  const b = await begin(input);
  if (b.stale) return stale(input.profileId, b.ctx, b.clock, b.now);
  const history = readHistory(b.row?.history);
  const last = history.pop();
  if (!b.row || !last) return refuse("invalid", "There is nothing to undo today.");
  if (!await write(input.profileId, b.clock.day, b.row, b.version, { items: last.items, intention: last.intention, history })) return stale(input.profileId, b.ctx, b.clock, b.now);
  return { ok: true, flow: await loadDayFlow(input.profileId, input.platformChatId, b.now), changed: ["Undone."], message: "Undone: today's flow is as it was before that change." };
}

export async function setDayView(input: Changing & { view: unknown }): Promise<DayFlowResponse> {
  if (input.view !== "list" && input.view !== "schedule") return refuse("invalid", "That isn't a view.");
  const b = await begin(input);
  if (b.stale) return stale(input.profileId, b.ctx, b.clock, b.now);
  const items = readItems(b.row?.items);
  if (!await write(input.profileId, b.clock.day, b.row, b.version, { items, intention: b.row?.intention ?? null, view: input.view })) return stale(input.profileId, b.ctx, b.clock, b.now);
  return { ok: true, flow: await loadDayFlow(input.profileId, input.platformChatId, b.now), changed: [], message: null };
}

// ── Focus on an item ─────────────────────────────────────────────────────────

// minutes: a length for this session only (the item's time for today and the
// task's estimate are left as they are); 0: no time limit.
export async function startFocus(input: Changing & { itemId: unknown; minutes: unknown }): Promise<DayFlowResponse & { started?: boolean }> {
  const b = await begin(input);
  if (b.stale) return stale(input.profileId, b.ctx, b.clock, b.now);
  const items = readItems(b.row?.items);
  const item = items.find(i => i.id === input.itemId);
  if (!item) return refuse("not_found", "That item isn't in today's flow any more.", await viewOf(input.profileId, b.row, b.ctx, b.clock, b.now));
  // One session at a time: a second Start would answer with the one running,
  // and must not be recorded on this item as if it were its own.
  if (b.ctx.activeSessionId) return refuse("invalid", "A focus session is already running. Finish or pause it first.", await viewOf(input.profileId, b.row, b.ctx, b.clock, b.now));
  const minutes = input.minutes === 0 ? 0 : typeof input.minutes === "number" && Number.isInteger(input.minutes) && input.minutes >= 5 && input.minutes <= 240 ? input.minutes : null;
  if (minutes === null) return refuse("invalid", "Choose a length from 5 minutes to 4 hours, or no time limit.");
  // A topic is studied as that topic; a task or a focus item with no topic is
  // a session with no topic, its words as the label, so it moves no mastery.
  const topicName = item.topicName ?? null;
  const res = await runNovaSessionCommand(input.platformChatId, topicName
    ? { action: "start", topicName, subjectName: item.subjectName, plannedMinutes: minutes, label: item.kind === "topic" ? null : item.title }
    : { action: "start", topicName: null, subjectName: null, plannedMinutes: minutes, label: item.title }, b.now);
  if (!res.ok || !res.session) return refuse(res.ok ? "failed" : res.error === "session_abandoned" ? "failed" : "invalid", res.ok ? "The session did not start. Try again." : res.message, await viewOf(input.profileId, b.row, b.ctx, b.clock, b.now));
  const next = items.map(i => (i.id === item.id ? { ...i, status: "active" as const, sessionId: res.session!.id } : i.status === "active" ? { ...i, status: "planned" as const } : i));
  // The session is running whatever happens to this write; a stale flow just
  // shows it without the item marked.
  await write(input.profileId, b.clock.day, b.row, b.version, { items: next, intention: b.row?.intention ?? null });
  return { ok: true, started: true, flow: await loadDayFlow(input.profileId, input.platformChatId, b.now), changed: [`Started ${item.title}.`], message: null };
}
