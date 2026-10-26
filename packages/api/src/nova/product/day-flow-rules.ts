// ─── Today's flow: the rules ─────────────────────────────────────────────────
// Pure: no database, no model. day-flow.ts reads and writes the flow; the
// copilot (day-copilot.ts) turns a sentence into the same operations; this
// file decides what each operation does and whether it may.
//
//   applyFlowOps   a list of operations, applied in order to the flow as it
//                  is, all or none. Each names items by id or things by
//                  reference; a reference is resolved by the caller (it must
//                  be the learner's own) before this runs. Nothing outside
//                  the day is touched: removing an item is not deleting its
//                  task, "done" for today is not the task's status.
//   fitTo          the time left today: what fits stays, in the learner's
//                  order; the rest moves below "If there's time", never out.
//   draftFrom      Nova's proposal for a day with no flow: tasks due today or
//                  overdue, then the planner's blocks, inside the day's time.
//   scheduleOf     the flow as time blocks from now, for the schedule view.
//
// No regex (SKILL.md; the no-regex guard).

import {
  FLOW_INTENTION_MAX, FLOW_ITEMS_MAX, FLOW_MINUTES_MAX, FLOW_MINUTES_MIN, FLOW_TITLE_MAX,
  type FlowDraft, type FlowItem, type FlowItemStatus, type FlowOp, type NewFlowItem,
} from "./day-flow.types";

export interface FlowState { items: FlowItem[]; intention: string | null }

// A reference made concrete: what the item shows. null: not the learner's,
// or gone.
export type Resolved = Pick<FlowItem, "kind" | "taskId" | "topicId" | "title" | "subjectName" | "topicName"> & { minutes: number | null };

export interface ApplyContext {
  resolve: (item: NewFlowItem) => Resolved | null;
  newId:   () => string;
  by:      "learner" | "nova";
}

export type ApplyResult =
  | { ok: true; state: FlowState; changed: string[]; touched: string[] }
  | { ok: false; index: number; message: string };

const STATUSES: readonly FlowItemStatus[] = ["planned", "active", "done", "later"];
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

export function validMinutes(m: unknown): m is number | null {
  return m === null || (typeof m === "number" && Number.isInteger(m) && m >= FLOW_MINUTES_MIN && m <= FLOW_MINUTES_MAX);
}

// "09:30" → 570. null: not a time of day.
export function clockMinutes(at: string): number | null {
  if (at.length !== 5 || at[2] !== ":" || ![0, 1, 3, 4].every(i => isDigit(at[i]))) return null;
  const h = Number(at.slice(0, 2)), m = Number(at.slice(3));
  return h < 24 && m < 60 ? h * 60 + m : null;
}
export const clockLabel = (minutes: number) => `${String(Math.floor(minutes / 60) % 24).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;

const sameRef = (a: Pick<FlowItem, "kind" | "taskId" | "topicId" | "title">, b: Pick<FlowItem, "kind" | "taskId" | "topicId" | "title">) =>
  a.kind === b.kind && (a.kind === "task" ? a.taskId === b.taskId : a.kind === "topic" ? a.topicId === b.topicId : a.title.toLowerCase() === b.title.toLowerCase());

export const minutesWord = (m: number) => (m >= 60 && m % 60 === 0 ? `${m / 60} h` : m > 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`);

function oneLine(s: string, max: number): string {
  let out = "", gap = false;
  for (const c of s) { if (c === "\n" || c === "\r" || c === "\t" || c === " ") { gap = out.length > 0; continue; } if (gap) out += " "; out += c; gap = false; }
  return out.slice(0, max);
}

// The order of the open part of the day: planned and active first, done
// after them, "later" last, each group in the learner's order.
export function ordered(items: FlowItem[]): FlowItem[] {
  const rank = (s: FlowItemStatus) => (s === "later" ? 2 : s === "done" ? 1 : 0);
  return items.map((it, i) => ({ it, i })).sort((a, b) => rank(a.it.status) - rank(b.it.status) || a.i - b.i).map(x => x.it);
}

export function applyFlowOps(start: FlowState, ops: FlowOp[], ctx: ApplyContext): ApplyResult {
  let items = start.items.map(i => ({ ...i }));
  let intention = start.intention;
  const changed: string[] = [];
  const touched = new Set<string>();
  const fail = (index: number, message: string): ApplyResult => ({ ok: false, index, message });
  const find = (id: unknown) => (typeof id === "string" ? items.findIndex(i => i.id === id) : -1);
  const make = (r: Resolved, minutes: number | null | undefined): FlowItem => ({
    id: ctx.newId(), kind: r.kind, taskId: r.taskId, topicId: r.topicId, title: oneLine(r.title, FLOW_TITLE_MAX) || "Focus",
    subjectName: r.subjectName, topicName: r.topicName, minutes: minutes === undefined ? r.minutes : minutes,
    status: "planned", at: null, sessionId: null, addedBy: ctx.by,
  });

  for (let n = 0; n < ops.length; n++) {
    const op = ops[n]!;
    switch (op?.op) {
      case "add":
      case "replace": {
        const r = op.item ? ctx.resolve(op.item) : null;
        if (!r) return fail(n, "That isn't one of your tasks or topics, or it no longer exists.");
        const minutes = op.item.minutes;
        if (minutes !== undefined && !validMinutes(minutes)) return fail(n, `A time for today is between ${FLOW_MINUTES_MIN} and ${FLOW_MINUTES_MAX} minutes.`);
        const at = op.op === "replace" ? find(op.id) : -1;
        if (op.op === "replace" && at === -1) return fail(n, "That item isn't in today's flow any more.");
        const dup = items.findIndex((i, k) => k !== at && sameRef(i, r));
        if (dup !== -1) {
          // Already there: a retry or a second ask changes nothing.
          if (op.op === "add") { changed.push(`${items[dup]!.title} is already in today's flow.`); touched.add(items[dup]!.id); continue; }
          return fail(n, `${items[dup]!.title} is already in today's flow.`);
        }
        const item = make(r, minutes);
        if (op.op === "replace") {
          const was = items[at]!;
          items[at] = item;
          changed.push(`Replaced ${was.title} with ${item.title}.`);
        } else {
          if (items.length >= FLOW_ITEMS_MAX) return fail(n, `Today's flow holds up to ${FLOW_ITEMS_MAX} items.`);
          const where = typeof op.at === "number" && Number.isInteger(op.at) ? Math.max(0, Math.min(op.at, items.length)) : items.length;
          items.splice(where, 0, item);
          changed.push(`Added ${item.title}${where === 0 && items.length > 1 ? " first" : ""}.`);
        }
        touched.add(item.id);
        break;
      }
      case "remove": {
        const at = find(op.id);
        if (at === -1) continue;   // already gone: a retry
        const [was] = items.splice(at, 1);
        changed.push(was!.kind === "task" ? `Took ${was!.title} out of today's flow. The task itself is unchanged.` : `Took ${was!.title} out of today's flow.`);
        break;
      }
      case "move": {
        const at = find(op.id);
        if (at === -1) return fail(n, "That item isn't in today's flow any more.");
        if (typeof op.to !== "number" || !Number.isInteger(op.to)) return fail(n, "That isn't a place in the flow.");
        const to = Math.max(0, Math.min(op.to, items.length - 1));
        if (to === at) continue;
        const [it] = items.splice(at, 1);
        // A "later" item moved up the list is back in the day.
        if (it!.status === "later" && to < items.filter(i => i.status !== "later").length) it!.status = "planned";
        items.splice(to, 0, it!);
        // Said by its place among what is still to do today, as the page shows it.
        const open = items.filter(i => i.status === "planned" || i.status === "active");
        const place = open.indexOf(it!);
        changed.push(place === 0 ? `Moved ${it!.title} to first.` : place === open.length - 1 ? `Moved ${it!.title} to the end.` : place > 0 ? `Moved ${it!.title} to number ${place + 1}.` : `Moved ${it!.title}.`);
        touched.add(it!.id);
        break;
      }
      case "set_minutes": {
        const at = find(op.id);
        if (at === -1) return fail(n, "That item isn't in today's flow any more.");
        if (!validMinutes(op.minutes)) return fail(n, `A time for today is between ${FLOW_MINUTES_MIN} and ${FLOW_MINUTES_MAX} minutes.`);
        items[at]!.minutes = op.minutes;
        changed.push(op.minutes === null ? `${items[at]!.title}: no set time today.` : `${items[at]!.title}: ${minutesWord(op.minutes)} today.`);
        touched.add(items[at]!.id);
        break;
      }
      case "set_status": {
        const at = find(op.id);
        if (at === -1) return fail(n, "That item isn't in today's flow any more.");
        if (!STATUSES.includes(op.status)) return fail(n, "That isn't a state an item can be in.");
        items[at]!.status = op.status;
        if (op.status !== "active" && op.status !== "done") items[at]!.sessionId = op.status === "planned" ? items[at]!.sessionId : null;
        changed.push(op.status === "done" ? `${items[at]!.title}: done for today.` : op.status === "later" ? `${items[at]!.title}: moved to If there's time.` : `${items[at]!.title}: back in today's flow.`);
        touched.add(items[at]!.id);
        break;
      }
      case "set_time": {
        const at = find(op.id);
        if (at === -1) return fail(n, "That item isn't in today's flow any more.");
        if (op.at !== null && (typeof op.at !== "string" || clockMinutes(op.at) === null)) return fail(n, "A time of day is written like 09:30.");
        items[at]!.at = op.at;
        changed.push(op.at ? `${items[at]!.title} at ${op.at}.` : `${items[at]!.title}: no fixed time.`);
        touched.add(items[at]!.id);
        break;
      }
      case "clear_times": {
        if (!items.some(i => i.at)) continue;
        items = items.map(i => ({ ...i, at: null }));
        changed.push("No fixed times: the flow is in order, nothing scheduled.");
        break;
      }
      case "split": {
        const at = find(op.id);
        if (at === -1) return fail(n, "That item isn't in today's flow any more.");
        const parts = Array.isArray(op.parts) ? op.parts : [];
        if (parts.length < 2 || parts.length > 6 || !parts.every(p => validMinutes(p) && p !== null)) return fail(n, `Split it into 2 to 6 blocks of at least ${FLOW_MINUTES_MIN} minutes.`);
        if (items.length - 1 + parts.length > FLOW_ITEMS_MAX) return fail(n, `Today's flow holds up to ${FLOW_ITEMS_MAX} items.`);
        const was = items[at]!;
        const pieces = parts.map((m, k) => ({ ...was, id: ctx.newId(), minutes: m, at: null, sessionId: null, status: "planned" as const, title: `${baseTitle(was.title)} (${k + 1} of ${parts.length})` }));
        items.splice(at, 1, ...pieces);
        changed.push(`Split ${baseTitle(was.title)} into ${parts.length} blocks of ${parts.map(minutesWord).join(", ")}.`);
        pieces.forEach(p => touched.add(p.id));
        break;
      }
      case "set_intention": {
        const text = op.text === null ? null : typeof op.text === "string" ? oneLine(op.text, FLOW_INTENTION_MAX) || null : undefined;
        if (text === undefined) return fail(n, "That isn't an intention.");
        intention = text;
        changed.push(text ? "Today's intention is set." : "Today's intention is cleared.");
        break;
      }
      case "fit": {
        if (typeof op.minutes !== "number" || !Number.isInteger(op.minutes) || op.minutes < 0 || op.minutes > 24 * 60) return fail(n, "That isn't a length of time.");
        const fitted = fitTo(items, op.minutes);
        items = fitted.items;
        changed.push(fitted.summary);
        fitted.touched.forEach(id => touched.add(id));
        break;
      }
      default:
        return fail(n, "That isn't a change Today can make.");
    }
  }
  return { ok: true, state: { items, intention }, changed, touched: [...touched].filter(id => items.some(i => i.id === id)) };
}

// "Read paper (1 of 2)" → "Read paper".
function baseTitle(title: string): string {
  if (!title.endsWith(")")) return title;
  const open = title.lastIndexOf(" (");
  const inner = open === -1 ? "" : title.slice(open + 2, -1);
  const parts = inner.split(" of ");
  return parts.length === 2 && parts.every(p => p.length > 0 && [...p].every(isDigit)) ? title.slice(0, open) : title;
}

// The time left today, `minutes`, over the open items in the learner's order:
// each that fits stays; the first that does not is shortened to what is left
// when that is a useful block; the rest go below "If there's time". Items
// with no time count as nothing and stay. Items already "later" come back
// when there is room now. Nothing is removed, and done items are left alone.
// shorten: false keeps every item's time (Nova's draft only sorts; it never
// shortens what the learner has not seen).
export function fitTo(items: FlowItem[], minutes: number, options: { shorten?: boolean } = {}): { items: FlowItem[]; summary: string; touched: string[] } {
  const out = ordered(items.map(i => ({ ...i })));
  let left = minutes;
  const later: string[] = [], back: string[] = [], shortened: string[] = [], touched: string[] = [];
  for (const it of out) {
    if (it.status === "done" || it.status === "active") { if (it.status === "active") left -= Math.min(left, it.minutes ?? 0); continue; }
    const need = it.minutes ?? 0;
    if (need <= left) {
      if (it.status === "later") { it.status = "planned"; back.push(it.title); touched.push(it.id); }
      left -= need;
    } else if (options.shorten !== false && left >= 10 && it.status === "planned" && !shortened.length) {
      it.minutes = left; left = 0; shortened.push(it.title); touched.push(it.id);
    } else if (it.status !== "later") {
      it.status = "later"; later.push(it.title); touched.push(it.id);
    }
  }
  const parts = [
    shortened.length ? `${shortened[0]} is shortened to fit` : null,
    later.length ? `${later.length === 1 ? later[0] : `${later.length} items`} moved to If there's time` : null,
    back.length ? `${back.length === 1 ? back[0] : `${back.length} items`} back in the day` : null,
  ].filter(Boolean);
  return { items: ordered(out), summary: parts.length ? `Fitted to ${minutesWord(minutes)}: ${parts.join("; ")}. Nothing was removed.` : `Everything open fits in ${minutesWord(minutes)}.`, touched };
}

// ── Nova's draft for a day with no flow ──────────────────────────────────────

export interface DraftInputs {
  tasks:  Array<{ id: string; title: string; status: string; dueInDays: number | null; estimatedMinutes: number | null; subjectName: string | null; topicName: string | null; priority: string | null }>;
  blocks: Array<{ topicId?: string; topicName: string; subjectName: string; durationMinutes: number; reasons: string[] }>;
  budgetMinutes: number | null;
  now: string;
}

const DRAFT_TASKS_MAX = 4;

// Tasks due today or overdue come first (the learner set those dates), the
// planner's blocks next, inside the day's time; what does not fit is kept
// below "If there's time" so the learner sees all of it and decides. A task
// due soon is added only when there is room. Nothing is invented: every item
// is a task or a topic of theirs.
export function draftFrom(input: DraftInputs, newId: () => string): FlowDraft | null {
  const open = input.tasks.filter(t => t.status !== "done");
  const urgent = open.filter(t => t.dueInDays !== null && t.dueInDays <= 0)
    .sort((a, b) => (a.dueInDays ?? 0) - (b.dueInDays ?? 0) || (a.priority === "high" ? -1 : 0) - (b.priority === "high" ? -1 : 0)).slice(0, DRAFT_TASKS_MAX);
  const soon = open.filter(t => t.dueInDays !== null && t.dueInDays > 0 && t.dueInDays <= 2 && !urgent.includes(t)).sort((a, b) => (a.dueInDays ?? 0) - (b.dueInDays ?? 0));
  const items: FlowItem[] = [];
  const reasons: string[] = [];
  const task = (t: DraftInputs["tasks"][number]): FlowItem => ({ id: newId(), kind: "task", taskId: t.id, topicId: null, title: t.title, subjectName: t.subjectName, topicName: t.topicName, minutes: t.estimatedMinutes, status: "planned", at: null, sessionId: null, addedBy: "nova" });
  for (const t of urgent) items.push(task(t));
  if (urgent.length) reasons.push(`${urgent.length === 1 ? "A task is" : `${urgent.length} tasks are`} due today or overdue, so ${urgent.length === 1 ? "it comes" : "they come"} first.`);
  for (const b of input.blocks) {
    if (!b.topicId) continue;
    items.push({ id: newId(), kind: "topic", taskId: null, topicId: b.topicId, title: b.topicName, subjectName: b.subjectName, topicName: b.topicName, minutes: b.durationMinutes, status: "planned", at: null, sessionId: null, addedBy: "nova" });
  }
  if (input.blocks.some(b => b.topicId)) reasons.push(`Then what your planner has for today${input.blocks[0]?.reasons[0] ? `, starting with ${input.blocks[0].topicName} (${input.blocks[0].reasons[0]})` : ""}.`);
  const used = items.reduce((s, i) => s + (i.minutes ?? 0), 0);
  for (const t of soon) {
    if (input.budgetMinutes !== null && used + (t.estimatedMinutes ?? 0) > input.budgetMinutes) break;
    items.push(task(t));
    reasons.push(`${t.title} is due in ${t.dueInDays === 1 ? "a day" : `${t.dueInDays} days`}; there is room for it.`);
  }
  if (!items.length) return null;
  const fitted = input.budgetMinutes !== null ? fitTo(items, input.budgetMinutes, { shorten: false }) : null;
  if (fitted && fitted.items.some(i => i.status === "later")) reasons.push(`More than fits in today's ${minutesWord(input.budgetMinutes!)}: the rest is under If there's time, for you to choose.`);
  return { items: fitted ? fitted.items : items, reasons, budgetMinutes: input.budgetMinutes, madeAt: input.now };
}

// ── The schedule view ────────────────────────────────────────────────────────

// The open items as blocks from `from` (minutes past midnight) in order: an
// item with a fixed time starts then (or as soon as the one before ends),
// one with no time takes FALLBACK minutes. The flow is the same; only how it
// is shown differs.
export const SCHEDULE_FALLBACK_MINUTES = 25;
export function scheduleOf(items: FlowItem[], from: number): Array<{ id: string; start: number; end: number; fixed: boolean; estimated: boolean }> {
  let at = from;
  return ordered(items).filter(i => i.status === "planned" || i.status === "active").map(i => {
    const fixed = i.at ? clockMinutes(i.at) : null;
    const start = fixed !== null ? Math.max(fixed, at) : at;
    const length = i.minutes ?? SCHEDULE_FALLBACK_MINUTES;
    at = start + length;
    return { id: i.id, start, end: at, fixed: fixed !== null, estimated: i.minutes === null };
  });
}
