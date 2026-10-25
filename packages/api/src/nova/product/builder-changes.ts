// ─── Build with Nova: something the learner already has ──────────────────────
// Pure. Two jobs, both decided by code rather than the model:
//
//   1. Finding it. The model reports the name the learner used for something
//      of theirs ("my DSA plan") and what they want with it; matchResources
//      looks for that name among their own workspaces and subjects (whole
//      words, a course code or an acronym: "DSA" is Data Structures and
//      Algorithms), and decideResource says what happens: one match is
//      opened (a subject as itself, never the workspace around it), several
//      are offered to choose from, none is said to be none.
//      Nothing is opened from a guess.
//   2. Changing it. The model proposes operations on its records by id;
//      checkChanges keeps only those that name a record of this resource,
//      would change something, and break no rule (a studied topic is never
//      removed, a finished task never deleted, no date in the past), and says
//      in words what each does. What it leaves out is listed with why. The
//      same check runs again on approval against the records as they are
//      then (workspaces.ts changeResource), so a change set made on an older
//      state cannot write over a newer one.
//
// No regex: text is compared by characters (SKILL.md; the no-regex guard).

import type { ChangeKind, ChangeOp, ChangeSet, ProposedChange, ResourceRef, UndoRecord, WorkspaceDetail } from "./builder.types";
import { isPlaceholderTopic, oneLine } from "./workspace-plan";
import { TASK_DEPTH_MAX, canPlace, levelOf, parentsOf, subtreeOf, type TreeNode } from "./task-tree";

// New tasks before their new steps (parentKey), whatever order the model
// gave; everything else keeps its place.
function parentsFirst(list: unknown[]): unknown[] {
  const keyOf = (o: unknown) => ((o as { op?: unknown })?.op === "add_task" ? (o as { key?: unknown }).key : undefined);
  const parentOf = (o: unknown) => ((o as { op?: unknown })?.op === "add_task" ? (o as { parentKey?: unknown }).parentKey : undefined);
  const out: unknown[] = [];
  const place = (o: unknown, depth: number) => {
    if (out.includes(o) || depth > TASK_DEPTH_MAX + 1) return;
    const p = parentOf(o);
    if (typeof p === "string") { const parent = list.find(x => keyOf(x) === p); if (parent && parent !== o) place(parent, depth + 1); }
    out.push(o);
  };
  for (const o of list) place(o, 0);
  return out;
}

// ── Finding it ────────────────────────────────────────────────────────────────

export interface ResourceCandidates {
  workspaces: Array<{ id: string; title: string; subjectIds: string[] }>;
  subjects:   Array<{ id: string; name: string; code: string | null }>;
}
export type ResourceMatch =
  | { kind: "workspace"; id: string; name: string; subjectIds: string[] }
  | { kind: "subject"; id: string; name: string };

const SKIP = new Set(["and", "of", "the", "in", "to", "for", "a", "an", "on", "&"]);
// Words a learner wraps around a name that are not part of it: "my DSA plan".
const WRAPPING = new Set(["my", "the", "existing", "current", "old", "plan", "workspace", "subject", "roadmap", "course", "study", "notes", "board"]);

export function wordsOf(text: string): string[] {
  const out: string[] = [];
  let w = "";
  for (const c of text.toLowerCase()) {
    if ((c >= "a" && c <= "z") || (c >= "0" && c <= "9") || c > "\u007f") w += c;
    else if (c === "+" || c === "#") w += c;                     // C++, C#
    else if (w) { out.push(w); w = ""; }
  }
  if (w) out.push(w);
  return out;
}
const acronym = (words: string[]) => words.filter(w => !SKIP.has(w)).map(w => w[0]).join("");
const phrase = (words: string[]) => ` ${words.join(" ")} `;

// The learner's records a name refers to. Exact first: the name is a
// record's name, course code or acronym. Otherwise every record whose name
// holds the name as whole words, or is held in it. Workspaces before
// subjects; a subject that belongs to a matched workspace is that workspace.
export function matchResources(said: string, c: ResourceCandidates): ResourceMatch[] {
  const raw = wordsOf(said);
  const core = raw.filter(w => !WRAPPING.has(w));
  const forms = [raw, core].filter(f => f.length > 0);
  if (forms.length === 0) return [];
  const all: Array<ResourceMatch & { words: string[]; code: string | null }> = [
    ...c.workspaces.map(w => ({ kind: "workspace" as const, id: w.id, name: w.title, subjectIds: w.subjectIds, words: wordsOf(w.title), code: null })),
    ...c.subjects.map(s => ({ kind: "subject" as const, id: s.id, name: s.name, words: wordsOf(s.name), code: s.code })),
  ];
  const exact = all.filter(r => forms.some(f => {
    const j = f.join(" ");
    return j === r.words.join(" ") || (r.code !== null && j === wordsOf(r.code).join(" ")) || (f.length === 1 && r.words.length > 1 && f[0] === acronym(r.words));
  }));
  const loose = exact.length > 0 ? exact : all.filter(r => forms.some(f => {
    if (f.length === 0 || r.words.length === 0) return false;
    const mine = phrase(r.words), theirs = phrase(f);
    return mine.includes(theirs) || theirs.includes(mine) || (r.words.length > 1 && f.includes(acronym(r.words)));
  }));
  const workspaces = loose.filter(r => r.kind === "workspace") as Array<Extract<ResourceMatch, { kind: "workspace" }>>;
  const subjects = loose.filter(r => r.kind === "subject" && !workspaces.some(w => w.subjectIds.includes(r.id)));
  return [...workspaces, ...subjects].map(r => (r.kind === "workspace"
    ? { kind: "workspace", id: r.id, name: r.name, subjectIds: r.subjectIds }
    : { kind: "subject", id: r.id, name: r.name }));
}

export type ResourceStep =
  | { type: "none" }
  | { type: "found"; ref: ResourceRef; intent: "open" | "change" }
  | { type: "choose"; names: string[]; question: string }
  | { type: "missing"; question: string };

// What happens with the name the learner used. "new" (they asked for a new
// one) and no name at all: nothing is opened.
export function decideResource(said: { name: string; intent: "open" | "change" | "new" } | null, c: ResourceCandidates): ResourceStep {
  if (!said || said.intent === "new") return { type: "none" };
  const hits = matchResources(said.name, c);
  if (hits.length === 0) {
    return { type: "missing", question: `I couldn't find "${said.name}" among your subjects and workspaces. Should I start a new one, or is it called something else?` };
  }
  if (hits.length > 1) {
    const names = hits.slice(0, 5).map(h => h.name);
    return { type: "choose", names, question: `You have more than one that could be "${said.name}": ${names.join(", ")}. Which one do you mean?` };
  }
  const h = hits[0]!;
  if (h.kind === "workspace") return { type: "found", intent: said.intent, ref: { kind: "workspace", workspaceId: h.id, subjectIds: h.subjectIds, title: h.name } };
  // A subject is opened as that subject alone, even when a workspace holds
  // it with others: "my DSA plan" is DSA, not the whole semester (seen 22 Oct).
  return { type: "found", intent: said.intent, ref: { kind: "subjects", workspaceId: null, subjectIds: [h.id], title: h.name } };
}

// ── Changing it ───────────────────────────────────────────────────────────────

export const CHANGE_OPS_MAX = 60;
const NAME_MAX = 120, TITLE_MAX = 160, NOTE_TITLE_MAX = 120, NOTE_BODY_MAX = 8000, NAMES_PER_ADD = 40;
const PRIORITIES = ["low", "medium", "high"] as const;
const DATE_KINDS = ["exam", "assignment", "project", "interview", "certification", "other"] as const;

const low = (s: string) => s.trim().toLowerCase();
const isDay = (v: unknown): v is string =>
  typeof v === "string" && v.length === 10 && v[4] === "-" && v[7] === "-" && [...v].every((c, i) => i === 4 || i === 7 || (c >= "0" && c <= "9"))
  && !Number.isNaN(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v;
const quoted = (s: string) => `"${s}"`;

export interface ChangeContext {
  today: string;
  // Topics with recorded study (sessions, reviews, mastery history): renamed, never removed.
  studied: ReadonlySet<string>;
}

// The model's operations (or a stored or edited change set), kept only where
// they are valid for this resource as it is now.
export function checkChanges(raw: unknown, current: WorkspaceDetail, ctx: ChangeContext): ChangeSet {
  const list = Array.isArray(raw) ? raw : raw && typeof raw === "object" && Array.isArray((raw as { ops?: unknown }).ops) ? (raw as { ops: unknown[] }).ops : [];
  const ops: ProposedChange[] = [];
  const dropped: string[] = [];
  const subjectById = (id: unknown) => current.subjects.find(s => s.id === id);
  const topicById = (id: unknown) => { for (const s of current.subjects) { const t = s.topics.find(x => x.id === id); if (t) return { s, t }; } return null; };
  const taskById = (id: unknown) => current.tasks.find(t => t.id === id);
  const dateById = (id: unknown) => current.dates.find(d => d.id === id);
  // Names added in this set, so two operations cannot add one thing twice.
  const addedTopics = new Map<string, Set<string>>();
  const addedTasks = new Set<string>();
  const touched = new Set<string>();
  const why = (x: Record<string, unknown>) => oneLine(x.why, 200) || null;
  const keep = (op: ChangeOp, says: string, effect: ProposedChange["effect"], x: Record<string, unknown>) => {
    if (ops.length >= CHANGE_OPS_MAX) { dropped.push(`${says} (too many changes at once)`); return; }
    ops.push({ ...op, id: `c${ops.length + 1}`, says, effect, why: why(x) });
  };
  const subjectOrNull = (v: unknown): string | null | undefined => (v === null || v === undefined || v === "" ? null : subjectById(v) ? (v as string) : undefined);

  const removeDate = (d: WorkspaceDetail["dates"][number], x: Record<string, unknown> = {}) => {
    if (touched.has(d.id)) return;
    touched.add(d.id);
    keep({ op: "remove_date", dateId: d.id }, `Remove date ${quoted(d.title)} (${d.day})`, "remove", x);
  };
  // A subject goes with its topics and dates, each said, so the learner sees
  // exactly what goes. Never one with studied topics.
  const removeSubject = (s: WorkspaceDetail["subjects"][number], x: Record<string, unknown>) => {
    if (touched.has(s.id)) return;
    const studied = s.topics.filter(t => ctx.studied.has(t.id));
    if (studied.length) { dropped.push(`removing ${quoted(s.name)} (you've studied ${studied.slice(0, 2).map(t => quoted(t.name)).join(", ")}; topics with study are kept)`); return; }
    touched.add(s.id);
    for (const t of s.topics) {
      if (touched.has(t.id)) continue;
      touched.add(t.id);
      keep({ op: "remove_topic", topicId: t.id }, `Remove topic ${quoted(t.name)} from ${s.name}`, "remove", {});
    }
    for (const d of current.dates.filter(v => v.subjectId === s.id)) removeDate(d);
    keep({ op: "remove_subject", subjectId: s.id }, `Remove subject ${quoted(s.name)} (its notes and tasks stay, unfiled)`, "remove", x);
  };

  // Removals that bring others with them are checked after everything else
  // in the set (a workspace's last), so what they bring is not said twice.
  const late = (o: unknown) => ((o as { op?: unknown })?.op === "remove_workspace" ? 2 : (o as { op?: unknown })?.op === "remove_subject" ? 1 : 0);
  const ordered = parentsFirst([...list.slice(0, CHANGE_OPS_MAX * 2)]).sort((a, b) => late(a) - late(b));
  // The tasks as a tree: stored ones by id, ones this set adds as "+key".
  const tree: TreeNode[] = current.tasks.map(t => ({ id: t.id, parent: t.parentId ?? null }));
  for (const item of ordered) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const x = item as Record<string, unknown>;
    switch (x.op) {
      case "add_topics": {
        const s = subjectById(x.subjectId);
        if (!s) { dropped.push("topics for a subject that isn't part of this"); break; }
        const have = new Set([...s.topics.map(t => low(t.name)), ...(addedTopics.get(s.id) ?? [])]);
        const names: string[] = [];
        for (const n of Array.isArray(x.names) ? x.names : []) {
          const name = oneLine(n, NAME_MAX);
          if (!name) continue;
          if (have.has(low(name))) { dropped.push(`topic ${quoted(name)} (${s.name} already has it)`); continue; }
          if (isPlaceholderTopic(name, s.name)) { dropped.push(`topic ${quoted(name)} (too general: name what it covers)`); continue; }
          if (names.length < NAMES_PER_ADD) { names.push(name); have.add(low(name)); }
        }
        if (names.length === 0) break;
        addedTopics.set(s.id, new Set([...(addedTopics.get(s.id) ?? []), ...names.map(low)]));
        keep({ op: "add_topics", subjectId: s.id, names }, `Add to ${s.name}: ${names.join(", ")}`, "add", x);
        break;
      }
      case "add_subject": {
        const name = oneLine(x.name, NAME_MAX);
        if (!name) break;
        const topics = (Array.isArray(x.topics) ? x.topics : []).map(t => oneLine(t, NAME_MAX)).filter(t => t && !isPlaceholderTopic(t, name)).slice(0, NAMES_PER_ADD);
        if (current.subjects.some(s => low(s.name) === low(name))) { dropped.push(`subject ${quoted(name)} (it's already here; add topics to it instead)`); break; }
        keep({ op: "add_subject", name, topics }, `Add subject ${quoted(name)}${topics.length ? ` with ${topics.join(", ")}` : ""}`, "add", x);
        break;
      }
      case "rename_topic": {
        const hit = topicById(x.topicId);
        const name = oneLine(x.name, NAME_MAX);
        if (!hit || !name) { dropped.push("a rename of a topic that isn't part of this"); break; }
        if (low(name) === low(hit.t.name)) break;
        if (hit.s.topics.some(t => t.id !== hit.t.id && low(t.name) === low(name))) { dropped.push(`renaming ${quoted(hit.t.name)} (${hit.s.name} already has ${quoted(name)})`); break; }
        if (touched.has(hit.t.id)) break;
        touched.add(hit.t.id);
        keep({ op: "rename_topic", topicId: hit.t.id, name }, `Rename topic ${quoted(hit.t.name)} to ${quoted(name)}`, "change", x);
        break;
      }
      case "remove_topic": {
        const hit = topicById(x.topicId);
        if (!hit) { dropped.push("removing a topic that isn't part of this"); break; }
        if (ctx.studied.has(hit.t.id)) { dropped.push(`removing ${quoted(hit.t.name)} (you've studied it; it can be renamed but not removed)`); break; }
        if (touched.has(hit.t.id)) break;
        touched.add(hit.t.id);
        keep({ op: "remove_topic", topicId: hit.t.id }, `Remove topic ${quoted(hit.t.name)} from ${hit.s.name}`, "remove", x);
        break;
      }
      case "remove_subject": {
        const s = subjectById(x.subjectId);
        if (!s) { dropped.push("removing a subject that isn't part of this"); break; }
        removeSubject(s, x);
        break;
      }
      case "remove_workspace": {
        const w = current.workspace;
        if (!w || (x.workspaceId !== undefined && x.workspaceId !== w.id)) { dropped.push("removing a workspace that isn't this one"); break; }
        // All of it or none of it: a workspace half removed would leave its
        // studied subjects outside any workspace.
        const studied = current.subjects.flatMap(s => s.topics.filter(t => ctx.studied.has(t.id)));
        if (studied.length) { dropped.push(`deleting ${quoted(current.title)} (you've studied ${studied.slice(0, 2).map(t => quoted(t.name)).join(", ")}; topics with study are kept)`); break; }
        for (const s of current.subjects) removeSubject(s, {});
        for (const t of current.tasks) {
          if (t.status === "done" || touched.has(t.id)) continue;
          touched.add(t.id);
          keep({ op: "remove_task", taskId: t.id }, `Remove task ${quoted(t.title)}`, "remove", {});
        }
        for (const n of current.notes) {
          if (touched.has(n.id)) continue;
          touched.add(n.id);
          keep({ op: "remove_note", noteId: n.id }, `Remove note ${quoted(n.title)}`, "remove", {});
        }
        for (const d of current.dates) removeDate(d);
        const kept = current.tasks.filter(t => t.status === "done").length;
        keep({ op: "remove_workspace", workspaceId: w.id }, `Delete the workspace ${quoted(current.title)}${kept ? ` (${kept} finished task${kept === 1 ? "" : "s"} stay in your Planner)` : ""}. This can't be undone`, "remove", x);
        break;
      }
      case "remove_date": {
        const d = dateById(x.dateId);
        if (!d) { dropped.push("removing a date that isn't part of this"); break; }
        removeDate(d, x);
        break;
      }
      case "remove_note": {
        const n = current.notes.find(v => v.id === x.noteId);
        if (!n) { dropped.push("removing a note that isn't part of this"); break; }
        if (touched.has(n.id)) break;
        touched.add(n.id);
        keep({ op: "remove_note", noteId: n.id }, `Remove note ${quoted(n.title)}`, "remove", x);
        break;
      }
      case "add_task": {
        const title = oneLine(x.title, TITLE_MAX);
        if (!title) break;
        // A step: under a task here (parentId) or one this set adds (parentKey).
        const parentTask = typeof x.parentId === "string" && x.parentId ? taskById(x.parentId) : null;
        if (typeof x.parentId === "string" && x.parentId && !parentTask) { dropped.push(`task ${quoted(title)} (a step of a task that isn't part of this)`); break; }
        const parentKey = !parentTask && typeof x.parentKey === "string" && x.parentKey ? oneLine(x.parentKey, 40) : null;
        const parentAdded = parentKey ? ops.find((o): o is ProposedChange & Extract<ChangeOp, { op: "add_task" }> => o.op === "add_task" && o.key === parentKey) : undefined;
        if (parentKey && !parentAdded) { dropped.push(`task ${quoted(title)} (a step of a task this change doesn't add)`); break; }
        const parentNode = parentTask ? parentTask.id : parentAdded ? `+${parentAdded.key}` : null;
        // One title once among a task's steps (two "Write tests" under two features are two tasks).
        const sibling = `${parentNode ?? ""}\n${low(title)}`;
        const twin = !parentAdded && current.tasks.some(t => t.status !== "done" && low(t.title) === low(title) && (t.parentId ?? null) === (parentTask?.id ?? null));
        if (twin || addedTasks.has(sibling)) { dropped.push(`task ${quoted(title)} (already there)`); break; }
        if (parentNode && levelOf(parentsOf(tree), parentNode) + 1 > TASK_DEPTH_MAX) { dropped.push(`task ${quoted(title)} (steps go at most ${TASK_DEPTH_MAX} levels deep)`); break; }
        const subjectIdRaw = subjectOrNull(x.subjectId);
        if (subjectIdRaw === undefined) { dropped.push(`task ${quoted(title)} (filed under a subject that isn't part of this)`); break; }
        // A step is filed where the task it belongs to is.
        const subjectId = parentTask ? parentTask.subjectId : parentAdded ? parentAdded.subjectId : subjectIdRaw;
        const topicFromParent = parentTask ? parentTask.topicName : parentAdded ? parentAdded.topicName : null;
        const dueDay = isDay(x.dueDay) && x.dueDay >= ctx.today ? x.dueDay : null;
        if (x.dueDay != null && dueDay === null) dropped.push(`the due day of ${quoted(title)} (not a day from today on)`);
        const priority = PRIORITIES.find(p => p === x.priority) ?? null;
        const key = oneLine(x.key, 40) || `t${ops.length + 1}`;
        const keyOk = [...key].every(c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "-" || c === "_");
        addedTasks.add(sibling);
        const finalKey = keyOk && !ops.some(o => o.op === "add_task" && o.key === key) ? key : `t${ops.length + 1}`;
        tree.push({ id: `+${finalKey}`, parent: parentNode });
        const parentTitle = parentTask?.title ?? parentAdded?.title ?? null;
        keep({
          op: "add_task", key: finalKey, title, subjectId: subjectId ?? (current.subjects.length === 1 ? current.subjects[0]!.id : null),
          topicName: topicFromParent ?? (oneLine(x.topicName, NAME_MAX) || null), dueDay, priority,
          ...(parentTask ? { parentId: parentTask.id } : parentAdded ? { parentKey: parentAdded.key } : {}),
        }, `${parentTitle ? `Add step ${quoted(title)} under ${quoted(parentTitle)}` : `Add task ${quoted(title)}`}${dueDay ? `, due ${dueDay}` : ""}${priority ? `, ${priority} priority` : ""}`, "add", x);
        break;
      }
      case "update_task": {
        const t = taskById(x.taskId);
        if (!t) { dropped.push("a change to a task that isn't part of this"); break; }
        if (touched.has(t.id)) break;
        const change: Extract<ChangeOp, { op: "update_task" }> = { op: "update_task", taskId: t.id };
        const parts: string[] = [];
        const title = x.title === undefined ? "" : oneLine(x.title, TITLE_MAX);
        if (title && title !== t.title) { change.title = title; parts.push(`rename to ${quoted(title)}`); }
        if (x.dueDay !== undefined) {
          if (x.dueDay === null) { if (t.dueDay !== null) { change.dueDay = null; parts.push("no due day"); } }
          else if (isDay(x.dueDay) && x.dueDay >= ctx.today) { if (x.dueDay !== t.dueDay) { change.dueDay = x.dueDay; parts.push(`due ${x.dueDay}${t.dueDay ? ` (was ${t.dueDay})` : ""}`); } }
          else dropped.push(`the new due day of ${quoted(t.title)} (not a day from today on)`);
        }
        if (x.priority !== undefined) {
          const p = x.priority === null ? null : PRIORITIES.find(v => v === x.priority);
          if (p !== undefined && p !== t.priority) { change.priority = p; parts.push(p ? `${p} priority` : "no priority"); }
        }
        if (x.parentId !== undefined) {
          const to = x.parentId === null || x.parentId === "" ? null : typeof x.parentId === "string" ? x.parentId : undefined;
          if (to !== (t.parentId ?? null)) {
            const placed = to === undefined ? { ok: false as const, reason: "missing" as const } : canPlace(tree, t.id, to);
            if (placed.ok) { change.parentId = to!; parts.push(to ? `move under ${quoted(taskById(to)?.title ?? "")}` : "make it a task of its own"); }
            else dropped.push(`moving ${quoted(t.title)} (${placed.reason === "too_deep" ? `steps go at most ${TASK_DEPTH_MAX} levels deep` : placed.reason === "missing" ? "under a task that isn't part of this" : "not under itself or its own steps"})`);
          }
        }
        if (parts.length === 0) break;
        touched.add(t.id);
        keep(change, `Change task ${quoted(t.title)}: ${parts.join(", ")}`, "change", x);
        break;
      }
      case "remove_task": {
        const t = taskById(x.taskId);
        if (!t) { dropped.push("removing a task that isn't part of this"); break; }
        if (t.status === "done") { dropped.push(`removing ${quoted(t.title)} (it's finished; finished tasks are kept)`); break; }
        if (touched.has(t.id)) break;
        // Its steps go with it: never one that is finished.
        const steps = subtreeOf(tree, t.id).slice(1).map(id => taskById(id)).filter((k): k is WorkspaceDetail["tasks"][number] => Boolean(k));
        if (steps.some(k => k.status === "done")) { dropped.push(`removing ${quoted(t.title)} (it has finished steps; finished tasks are kept)`); break; }
        touched.add(t.id);
        for (const k of steps) touched.add(k.id);
        keep({ op: "remove_task", taskId: t.id }, `Remove task ${quoted(t.title)}${steps.length ? ` and its ${steps.length} step${steps.length === 1 ? "" : "s"}` : ""}`, "remove", x);
        break;
      }
      case "order_tasks": {
        const ids = (Array.isArray(x.taskIds) ? x.taskIds : []).filter((id, i, all) => typeof id === "string" && all.indexOf(id) === i);
        const tasks = ids.map(id => taskById(id)).filter((t): t is WorkspaceDetail["tasks"][number] => Boolean(t) && t!.status !== "done");
        if (tasks.length < 2 || tasks.length !== ids.length) { dropped.push("a new order that names tasks that aren't open here"); break; }
        keep({ op: "order_tasks", taskIds: tasks.map(t => t.id) }, `Put tasks in this order: ${tasks.map(t => quoted(t.title)).join(", ")}`, "change", x);
        break;
      }
      case "add_date": {
        const title = oneLine(x.title, 80);
        if (!title) break;
        if (!isDay(x.day) || x.day < ctx.today) { dropped.push(`date ${quoted(title)} (not a day from today on)`); break; }
        const subjectId = subjectOrNull(x.subjectId);
        if (subjectId === undefined) { dropped.push(`date ${quoted(title)} (for a subject that isn't part of this)`); break; }
        if (current.dates.some(d => low(d.title) === low(title))) { dropped.push(`date ${quoted(title)} (already there; move it instead)`); break; }
        const kind = DATE_KINDS.find(k => k === x.kind) ?? "other";
        keep({ op: "add_date", title, day: x.day, subjectId: subjectId ?? (current.subjects.length === 1 ? current.subjects[0]!.id : null), kind }, `Add date ${quoted(title)} on ${x.day}`, "add", x);
        break;
      }
      case "update_date": {
        const d = dateById(x.dateId);
        if (!d) { dropped.push("a change to a date that isn't part of this"); break; }
        if (touched.has(d.id)) break;
        const change: Extract<ChangeOp, { op: "update_date" }> = { op: "update_date", dateId: d.id };
        const parts: string[] = [];
        const title = x.title === undefined ? "" : oneLine(x.title, 80);
        if (title && title !== d.title) { change.title = title; parts.push(`rename to ${quoted(title)}`); }
        if (x.day !== undefined) {
          if (isDay(x.day) && x.day >= ctx.today) { if (x.day !== d.day) { change.day = x.day; parts.push(`move to ${x.day} (was ${d.day})`); } }
          else dropped.push(`moving ${quoted(d.title)} (not a day from today on)`);
        }
        if (parts.length === 0) break;
        touched.add(d.id);
        keep(change, `Change date ${quoted(d.title)}: ${parts.join(", ")}`, "change", x);
        break;
      }
      case "add_note": {
        const title = oneLine(x.title, NOTE_TITLE_MAX);
        const body = typeof x.body === "string" ? x.body.split("\r").join("").trim().slice(0, NOTE_BODY_MAX) : "";
        if (!title || !body) break;
        if (current.notes.some(n => low(n.title) === low(title))) { dropped.push(`note ${quoted(title)} (a note with that title is already here)`); break; }
        const subjectId = subjectOrNull(x.subjectId);
        if (subjectId === undefined) { dropped.push(`note ${quoted(title)} (for a subject that isn't part of this)`); break; }
        keep({ op: "add_note", title, body, subjectId: subjectId ?? (current.subjects.length === 1 ? current.subjects[0]!.id : null), topicName: oneLine(x.topicName, NAME_MAX) || null },
          `Add note ${quoted(title)}`, "add", x);
        break;
      }
      default:
        break;
    }
  }
  return { ops, dropped: dropped.slice(0, 12) };
}

// ── Only what was asked ───────────────────────────────────────────────────────

export const kindOf = (op: ChangeOp["op"]): ChangeKind =>
  op === "add_topics" || op === "rename_topic" || op === "remove_topic" ? "topics"
  : op === "add_subject" || op === "remove_subject" || op === "remove_workspace" ? "subjects"
  : op === "add_date" || op === "update_date" || op === "remove_date" ? "dates"
  : op === "add_note" || op === "remove_note" ? "notes" : "tasks";

// Keeps the changes of the kinds the learner's request is about; the rest
// are left out and said ("not asked for"). A subject's removal keeps the
// topic and date removals it brings, a workspace's everything it brings.
// No kinds known (an older reading): all are kept.
export function withinAsk(set: ChangeSet, touches: readonly ChangeKind[], current: WorkspaceDetail): ChangeSet {
  if (touches.length === 0 || set.ops.some(o => o.op === "remove_workspace")) return set;
  const goingSubjects = new Set(set.ops.flatMap(o => (o.op === "remove_subject" ? [o.subjectId] : [])));
  const withSubject = new Set([
    ...current.subjects.filter(s => goingSubjects.has(s.id)).flatMap(s => s.topics.map(t => t.id)),
    ...current.dates.filter(d => d.subjectId !== null && goingSubjects.has(d.subjectId)).map(d => d.id),
  ]);
  // A change to a task's priority alone is about priorities.
  const onlyPriority = (o: ProposedChange) => o.op === "update_task" && o.priority !== undefined && o.title === undefined && o.dueDay === undefined && o.parentId === undefined;
  const ok = (o: ProposedChange) => touches.includes(onlyPriority(o) ? "priorities" : kindOf(o.op))
    || (touches.includes("subjects") && ((o.op === "remove_topic" && withSubject.has(o.topicId)) || (o.op === "remove_date" && withSubject.has(o.dateId))));
  const kept = set.ops.filter(ok).map((o, i) => ({ ...o, id: `c${i + 1}` }));
  const left = set.ops.filter(o => !ok(o)).map(o => `${o.says.charAt(0).toLowerCase()}${o.says.slice(1)} (not asked for)`);
  return { ops: kept, dropped: [...set.dropped, ...left].slice(0, 12) };
}

// Operations with any priority taken out: what Nova may propose when the
// learner's request is not about priorities (their priorities are theirs).
export function withoutPriorities(ops: unknown[]): unknown[] {
  return ops.map(o => {
    if (!o || typeof o !== "object" || Array.isArray(o)) return o;
    const x = o as Record<string, unknown>;
    if (x.op !== "add_task" && x.op !== "update_task") return o;
    const { priority: _p, ...rest } = x;
    return rest;
  });
}

// A stored change set, read back. Not re-checked here: that needs the records.
export function readChangeSet(raw: unknown): ChangeSet | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as { ops?: unknown; dropped?: unknown };
  if (!Array.isArray(r.ops) || r.ops.length === 0) return null;
  return {
    ops: r.ops.filter((o): o is ProposedChange => Boolean(o) && typeof o === "object" && typeof (o as { op?: unknown }).op === "string" && typeof (o as { id?: unknown }).id === "string"),
    dropped: Array.isArray(r.dropped) ? r.dropped.filter((d): d is string => typeof d === "string") : [],
  };
}

// "3 additions, 1 change and 1 removal", for the message and the page.
export function changeCounts(set: ChangeSet): string {
  const n = (effect: ProposedChange["effect"]) => set.ops.filter(o => o.effect === effect).length;
  const part = (count: number, one: string, many: string) => (count ? `${count} ${count === 1 ? one : many}` : null);
  const parts = [part(n("add"), "addition", "additions"), part(n("change"), "change", "changes"), part(n("remove"), "removal", "removals")].filter(Boolean) as string[];
  return parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`;
}

// The operations without what the page needs to show them, as stored for
// checking again (checkChanges reads the same fields back).
export const bareOps = (set: ChangeSet): Array<Record<string, unknown>> => set.ops.map(({ id: _id, says: _says, effect: _effect, ...op }) => op as Record<string, unknown>);

// ── Taking it back ────────────────────────────────────────────────────────────
// "Revert that": what this conversation last applied, taken back by code
// rather than by the model. When a set is applied, undoOf writes the steps
// that would undo it from the records as they were before. Records are
// named, not given by id (what was added has an id only once it exists);
// resolveUndo finds them again among the records as they are, and the
// result is checked by checkChanges and approved like any other change.

export interface NoteBefore { id: string; title: string; body: string; subjectId: string | null; topicName: string | null }

export function undoOf(set: ChangeSet, before: WorkspaceDetail, notes: readonly NoteBefore[], label: string): UndoRecord {
  const steps: Array<Record<string, unknown>> = [];
  const kept: string[] = [];
  const subjectName = (id: string | null) => (id ? before.subjects.find(s => s.id === id)?.name ?? null : null);
  const topicOf = (id: string) => { for (const s of before.subjects) { const t = s.topics.find(x => x.id === id); if (t) return { s, t }; } return null; };
  const going = new Set(set.ops.flatMap(o => (o.op === "remove_subject" ? [o.subjectId] : [])));
  for (const o of set.ops) {
    switch (o.op) {
      case "add_topics": for (const name of o.names) steps.push({ op: "remove_topic", subjectName: subjectName(o.subjectId), topicName: name }); break;
      case "add_subject": steps.push({ op: "remove_subject", subjectName: o.name }); break;
      case "rename_topic": { const hit = topicOf(o.topicId); if (hit) steps.push({ op: "rename_topic", subjectName: hit.s.name, topicName: o.name, name: hit.t.name }); break; }
      case "remove_topic": {
        const hit = topicOf(o.topicId);
        // A subject that goes comes back whole, with its topics.
        if (hit && !going.has(hit.s.id)) steps.push({ op: "add_topics", subjectName: hit.s.name, names: [hit.t.name] });
        break;
      }
      case "remove_subject": { const s = before.subjects.find(x => x.id === o.subjectId); if (s) steps.push({ op: "add_subject", name: s.name, topics: s.topics.map(t => t.name) }); break; }
      case "add_task": steps.push({ op: "remove_task", taskTitle: o.title }); break;
      case "update_task": {
        const t = before.tasks.find(x => x.id === o.taskId);
        if (!t) break;
        steps.push({
          op: "update_task", taskTitle: o.title ?? t.title,
          ...(o.title !== undefined ? { title: t.title } : {}), ...(o.dueDay !== undefined ? { dueDay: t.dueDay } : {}), ...(o.priority !== undefined ? { priority: t.priority } : {}),
        });
        break;
      }
      case "remove_task": {
        const t = before.tasks.find(x => x.id === o.taskId);
        if (t) steps.push({ op: "add_task", key: `u${steps.length + 1}`, title: t.title, subjectName: subjectName(t.subjectId), topicName: t.topicName, dueDay: t.dueDay, priority: t.priority });
        break;
      }
      case "order_tasks": kept.push("the new order of tasks"); break;
      case "add_date": steps.push({ op: "remove_date", dateTitle: o.title }); break;
      case "update_date": {
        const d = before.dates.find(x => x.id === o.dateId);
        if (d) steps.push({ op: "update_date", dateTitle: o.title ?? d.title, ...(o.title !== undefined ? { title: d.title } : {}), ...(o.day !== undefined ? { day: d.day } : {}) });
        break;
      }
      case "remove_date": {
        const d = before.dates.find(x => x.id === o.dateId);
        if (d) steps.push({ op: "add_date", title: d.title, day: d.day, kind: d.kind, subjectName: subjectName(d.subjectId) });
        break;
      }
      case "add_note": steps.push({ op: "remove_note", noteTitle: o.title }); break;
      case "remove_note": {
        const n = notes.find(x => x.id === o.noteId);
        if (n) steps.push({ op: "add_note", title: n.title, body: n.body, subjectName: subjectName(n.subjectId), topicName: n.topicName });
        break;
      }
      case "remove_workspace": kept.push(`the deleted workspace ${quoted(before.title)}`); break;
    }
  }
  return { label, steps, kept };
}

// Undoing a build: the workspace it made, all of it, as one proposed removal.
export function undoOfBuild(title: string): UndoRecord {
  return { label: `the build of ${title}`, steps: [{ op: "remove_workspace" }], kept: [] };
}

// The steps as operations on the records as they are now. A step whose
// record is no longer there is left out and said.
export function resolveUndo(undo: UndoRecord, current: WorkspaceDetail): { ops: Array<Record<string, unknown>>; missing: string[] } {
  const ops: Array<Record<string, unknown>> = [];
  const missing: string[] = [];
  const subject = (name: unknown) => (typeof name === "string" ? current.subjects.find(s => low(s.name) === low(name)) ?? null : null);
  const subjectId = (name: unknown) => subject(name)?.id ?? null;
  const task = (title: unknown) => (typeof title === "string" ? current.tasks.find(t => t.status !== "done" && low(t.title) === low(title)) ?? null : null);
  const date = (title: unknown) => (typeof title === "string" ? current.dates.find(d => low(d.title) === low(title)) ?? null : null);
  const note = (title: unknown) => (typeof title === "string" ? current.notes.find(n => low(n.title) === low(title)) ?? null : null);
  const gone = (what: string) => missing.push(what);
  for (const x of undo.steps) {
    switch (x.op) {
      case "remove_topic": {
        const t = subject(x.subjectName)?.topics.find(v => typeof x.topicName === "string" && low(v.name) === low(x.topicName));
        if (t) ops.push({ op: "remove_topic", topicId: t.id }); else gone(`topic ${quoted(String(x.topicName))}`);
        break;
      }
      case "rename_topic": {
        const t = subject(x.subjectName)?.topics.find(v => typeof x.topicName === "string" && low(v.name) === low(x.topicName));
        if (t) ops.push({ op: "rename_topic", topicId: t.id, name: x.name }); else gone(`topic ${quoted(String(x.topicName))}`);
        break;
      }
      case "remove_subject": { const s = subject(x.subjectName); if (s) ops.push({ op: "remove_subject", subjectId: s.id }); else gone(`subject ${quoted(String(x.subjectName))}`); break; }
      case "add_topics": {
        const s = subject(x.subjectName);
        if (s) ops.push({ op: "add_topics", subjectId: s.id, names: x.names }); else gone(`subject ${quoted(String(x.subjectName))}`);
        break;
      }
      case "remove_task": { const t = task(x.taskTitle); if (t) ops.push({ op: "remove_task", taskId: t.id }); else gone(`task ${quoted(String(x.taskTitle))}`); break; }
      case "update_task": {
        const t = task(x.taskTitle);
        if (!t) { gone(`task ${quoted(String(x.taskTitle))}`); break; }
        const { taskTitle: _t, ...rest } = x;
        ops.push({ ...rest, taskId: t.id });
        break;
      }
      case "remove_date": { const d = date(x.dateTitle); if (d) ops.push({ op: "remove_date", dateId: d.id }); else gone(`date ${quoted(String(x.dateTitle))}`); break; }
      case "update_date": {
        const d = date(x.dateTitle);
        if (!d) { gone(`date ${quoted(String(x.dateTitle))}`); break; }
        const { dateTitle: _d, ...rest } = x;
        ops.push({ ...rest, dateId: d.id });
        break;
      }
      case "remove_note": { const n = note(x.noteTitle); if (n) ops.push({ op: "remove_note", noteId: n.id }); else gone(`note ${quoted(String(x.noteTitle))}`); break; }
      case "remove_workspace": if (current.workspace) ops.push({ op: "remove_workspace", workspaceId: current.workspace.id }); else gone("the workspace"); break;
      // Additions name their subject; one that is not there (yet) files them under none.
      case "add_subject": ops.push(x); break;
      case "add_task": case "add_date": case "add_note": {
        const { subjectName, ...rest } = x;
        ops.push({ ...rest, subjectId: subjectId(subjectName) });
        break;
      }
    }
  }
  return { ops, missing };
}

export function readUndo(raw: unknown): UndoRecord | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const steps = Array.isArray(r.steps) ? r.steps.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x) && typeof (x as { op?: unknown }).op === "string") : [];
  if (typeof r.label !== "string" || steps.length === 0) return null;
  return { label: r.label.slice(0, 160), steps: steps.slice(0, CHANGE_OPS_MAX * 2), kept: Array.isArray(r.kept) ? r.kept.filter((k): k is string => typeof k === "string").slice(0, 6) : [] };
}
