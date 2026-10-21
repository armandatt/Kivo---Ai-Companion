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

import type { ChangeKind, ChangeOp, ChangeSet, ProposedChange, ResourceRef, WorkspaceDetail } from "./builder.types";
import { isPlaceholderTopic, oneLine } from "./workspace-plan";

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

  // A subject's removal is checked after everything else in the set, so the
  // topic removals it brings are not said twice.
  const ordered = [...list.slice(0, CHANGE_OPS_MAX * 2)].sort((a, b) =>
    Number((a as { op?: unknown })?.op === "remove_subject") - Number((b as { op?: unknown })?.op === "remove_subject"));
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
        if (touched.has(s.id)) break;
        const studied = s.topics.filter(t => ctx.studied.has(t.id));
        if (studied.length) { dropped.push(`removing ${quoted(s.name)} (you've studied ${studied.slice(0, 2).map(t => quoted(t.name)).join(", ")}; topics with study are kept)`); break; }
        if (current.dates.some(d => d.subjectId === s.id)) { dropped.push(`removing ${quoted(s.name)} (it has dates; move or remove them on the calendar first)`); break; }
        touched.add(s.id);
        // Its topics go with it: each said, so the learner sees exactly what goes.
        for (const t of s.topics) {
          if (touched.has(t.id)) continue;
          touched.add(t.id);
          keep({ op: "remove_topic", topicId: t.id }, `Remove topic ${quoted(t.name)} from ${s.name}`, "remove", {});
        }
        keep({ op: "remove_subject", subjectId: s.id }, `Remove subject ${quoted(s.name)} (its notes and tasks stay, unfiled)`, "remove", x);
        break;
      }
      case "add_task": {
        const title = oneLine(x.title, TITLE_MAX);
        if (!title) break;
        if (current.tasks.some(t => t.status !== "done" && low(t.title) === low(title)) || addedTasks.has(low(title))) { dropped.push(`task ${quoted(title)} (already there)`); break; }
        const subjectId = subjectOrNull(x.subjectId);
        if (subjectId === undefined) { dropped.push(`task ${quoted(title)} (filed under a subject that isn't part of this)`); break; }
        const dueDay = isDay(x.dueDay) && x.dueDay >= ctx.today ? x.dueDay : null;
        if (x.dueDay != null && dueDay === null) dropped.push(`the due day of ${quoted(title)} (not a day from today on)`);
        const priority = PRIORITIES.find(p => p === x.priority) ?? null;
        const key = oneLine(x.key, 40) || `t${ops.length + 1}`;
        const keyOk = [...key].every(c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "-" || c === "_");
        addedTasks.add(low(title));
        keep({ op: "add_task", key: keyOk ? key : `t${ops.length + 1}`, title, subjectId: subjectId ?? (current.subjects.length === 1 ? current.subjects[0]!.id : null), topicName: oneLine(x.topicName, NAME_MAX) || null, dueDay, priority },
          `Add task ${quoted(title)}${dueDay ? `, due ${dueDay}` : ""}${priority === "high" ? ", high priority" : ""}`, "add", x);
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
        touched.add(t.id);
        keep({ op: "remove_task", taskId: t.id }, `Remove task ${quoted(t.title)}`, "remove", x);
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
  : op === "add_subject" || op === "remove_subject" ? "subjects"
  : op === "add_date" || op === "update_date" ? "dates"
  : op === "add_note" ? "notes" : "tasks";

// Keeps the changes of the kinds the learner's request is about; the rest
// are left out and said ("not asked for"). A subject's removal keeps the
// topic removals it brings. No kinds known (an older reading): all are kept.
export function withinAsk(set: ChangeSet, touches: readonly ChangeKind[], current: WorkspaceDetail): ChangeSet {
  if (touches.length === 0) return set;
  const goingSubjects = new Set(set.ops.flatMap(o => (o.op === "remove_subject" ? [o.subjectId] : [])));
  const withSubject = new Set(current.subjects.filter(s => goingSubjects.has(s.id)).flatMap(s => s.topics.map(t => t.id)));
  const ok = (o: ProposedChange) => touches.includes(kindOf(o.op)) || (o.op === "remove_topic" && touches.includes("subjects") && withSubject.has(o.topicId));
  const kept = set.ops.filter(ok).map((o, i) => ({ ...o, id: `c${i + 1}` }));
  const left = set.ops.filter(o => !ok(o)).map(o => `${o.says.charAt(0).toLowerCase()}${o.says.slice(1)} (not asked for)`);
  return { ops: kept, dropped: [...set.dropped, ...left].slice(0, 12) };
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
