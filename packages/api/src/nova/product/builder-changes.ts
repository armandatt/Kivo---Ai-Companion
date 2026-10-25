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

import type { ChangeKind, ChangeOp, ChangeSet, ProposedChange, ResourceRef, TopicPatch, WorkspaceDetail } from "./builder.types";
import { isPlaceholderTopic, oneLine } from "./workspace-plan";
import { TASK_DEPTH_MAX, canPlace, levelOf, parentsOf, subtreeOf, wouldLoop, type TreeNode, type Wait } from "./task-tree";
import { SUBJECT_DEPTH_MAX } from "./setup-edit.types";
import { TOPIC_DEPTH_MAX } from "./topic-tree";

// New tasks before their new steps (parentKey), whatever order the model
// gave; everything else keeps its place.
function parentsFirst(list: unknown[]): unknown[] {
  const opOf = (o: unknown) => (o as { op?: unknown })?.op;
  // A task by its key; topics this set adds by each of their keys.
  const keysOf = (o: unknown): unknown[] => (opOf(o) === "add_task" ? [(o as { key?: unknown }).key] : opOf(o) === "add_topics" ? (Array.isArray((o as { keys?: unknown }).keys) ? (o as { keys: unknown[] }).keys : []) : []);
  const parentOf = (o: unknown) => (opOf(o) === "add_task" || opOf(o) === "add_topics" ? (o as { parentKey?: unknown }).parentKey : undefined);
  const out: unknown[] = [];
  const place = (o: unknown, depth: number) => {
    if (out.includes(o) || depth > TASK_DEPTH_MAX + TOPIC_DEPTH_MAX + 1) return;
    const p = parentOf(o);
    if (typeof p === "string") { const parent = list.find(x => x !== o && opOf(x) === opOf(o) && keysOf(x).includes(p)); if (parent) place(parent, depth + 1); }
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

  // Each subject's topics as a tree: stored ones by id, ones this set adds
  // as "+key". A subject holds a name once, at any level.
  const topicTree = new Map<string, TreeNode[]>(current.subjects.map(x => [x.id, x.topics.map(t => ({ id: t.id, parent: t.parentId ?? null }))]));
  const addedTopicKeys = new Map<string, { subjectId: string; name: string }>();
  const topicName = (subjectId: string, node: string | null): string | null =>
    node === null ? null : node.startsWith("+") ? addedTopicKeys.get(node.slice(1))?.name ?? null : subjectById(subjectId)?.topics.find(t => t.id === node)?.name ?? null;
  // Where a topic goes in its subject: a topic there (parentId), one this set
  // adds (parentKey), or the top (null). undefined: nowhere in that subject.
  const topicParent = (subjectId: string, x: Record<string, unknown>): string | null | undefined => {
    if (typeof x.parentKey === "string" && x.parentKey) { const a = addedTopicKeys.get(x.parentKey); return a && a.subjectId === subjectId ? `+${x.parentKey}` : undefined; }
    if (typeof x.parentId === "string" && x.parentId) return topicTree.get(subjectId)?.some(n => n.id === x.parentId) ? x.parentId : undefined;
    return null;
  };
  const keyOk = (k: string) => k.length > 0 && k.length <= 40 && [...k].every(c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "-" || c === "_");
  // A topic and everything inside it, deepest first: the order they can go in.
  const topicSubtree = (subjectId: string, id: string): string[] => {
    const nodes = topicTree.get(subjectId) ?? [];
    const depthOf = (n: string) => levelOf(parentsOf(nodes), n);
    return subtreeOf(nodes, id).sort((a, b) => depthOf(b) - depthOf(a));
  };
  const removeTopicTree = (hit: { s: WorkspaceDetail["subjects"][number]; t: WorkspaceDetail["subjects"][number]["topics"][number] }, x: Record<string, unknown>): void => {
    const ids = topicSubtree(hit.s.id, hit.t.id).filter(id => !id.startsWith("+"));
    const studied = ids.filter(id => ctx.studied.has(id)).map(id => hit.s.topics.find(t => t.id === id)!);
    if (studied.length) {
      dropped.push(studied.some(t => t.id === hit.t.id) ? `removing ${quoted(hit.t.name)} (you've studied it; it can be renamed but not removed)` : `removing ${quoted(hit.t.name)} (you've studied ${quoted(studied[0]!.name)} inside it; topics with study are kept)`);
      return;
    }
    for (const id of ids) {
      if (touched.has(id)) continue;
      touched.add(id);
      const t = hit.s.topics.find(v => v.id === id)!;
      keep({ op: "remove_topic", topicId: id }, id === hit.t.id ? `Remove topic ${quoted(t.name)} from ${hit.s.name}` : `Remove ${quoted(t.name)} (inside ${quoted(hit.t.name)})`, "remove", id === hit.t.id ? x : {});
    }
    const nodes = topicTree.get(hit.s.id)!;
    topicTree.set(hit.s.id, nodes.filter(n => !ids.includes(n.id)));
  };
  const patchOf = (raw: unknown): TopicPatch => {
    const x = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
    const out: TopicPatch = {};
    const num = (v: unknown, max: number) => (v === null ? null : typeof v === "number" && Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 10) / 10 : undefined);
    const texts = (v: unknown) => (Array.isArray(v) ? v.map(t => oneLine(t, 240)).filter(Boolean).slice(0, 10) : undefined);
    if (x.explanation !== undefined) out.explanation = x.explanation === null ? null : oneLine(x.explanation, 600) || null;
    const w = num(x.weeks, 104), h = num(x.hoursPerWeek, 80);
    if (w !== undefined) out.weeks = w;
    if (h !== undefined) out.hoursPerWeek = h;
    const g = texts(x.goals), e = texts(x.exercises);
    if (g) out.goals = g;
    if (e) out.exercises = e;
    if (x.project !== undefined) out.project = x.project === null ? null : oneLine(x.project, 240) || null;
    if (x.completion !== undefined) out.completion = x.completion === null ? null : oneLine(x.completion, 240) || null;
    return out;
  };
  // Waits, as they are and as this set changes them: stored tasks by id, ones it adds as "+key".
  const waits: Wait[] = current.tasks.flatMap(t => (t.after ?? []).map(on => ({ task: t.id, on })));
  const waitTargets = (task: string, raw: unknown, title: string): string[] => {
    const out: string[] = [];
    for (const a of Array.isArray(raw) ? raw.slice(0, 10) : []) {
      if (typeof a !== "string" || !a) continue;
      const node = taskById(a) ? a : ops.some(o => o.op === "add_task" && o.key === a) ? `+${a}` : null;
      if (!node) { dropped.push(`a wait in ${quoted(title)} (on a task that isn't part of this)`); continue; }
      if (out.includes(node)) continue;
      if (wouldLoop(waits.filter(w => w.task !== task), task, node)) { dropped.push(`${quoted(title)} waiting on ${quoted(taskById(a)?.title ?? a)} (it would go round in a circle)`); continue; }
      out.push(node);
    }
    return out;
  };
  const refOf = (node: string) => (node.startsWith("+") ? node.slice(1) : node);

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
    // Inside ones first, so each goes once nothing is inside it.
    const nodes = topicTree.get(s.id) ?? [];
    const depth = (id: string) => levelOf(parentsOf(nodes), id);
    for (const t of [...s.topics].sort((a, b) => depth(b.id) - depth(a.id))) {
      if (touched.has(t.id)) continue;
      touched.add(t.id);
      keep({ op: "remove_topic", topicId: t.id }, `Remove topic ${quoted(t.name)} from ${s.name}`, "remove", {});
    }
    for (const d of current.dates.filter(v => v.subjectId === s.id)) removeDate(d);
    // The subjects inside it stay, on their own.
    const inside = subjectTree.filter(n => n.parent === s.id);
    for (const n of inside) n.parent = null;
    const insideNames = inside.map(n => nameOfNode(n.id)).filter((n): n is string => n !== null);
    keep({ op: "remove_subject", subjectId: s.id }, `Remove subject ${quoted(s.name)} (its notes and tasks stay, unfiled${insideNames.length ? `; ${insideNames.join(", ")} stay${insideNames.length === 1 ? "s" : ""}, on ${insideNames.length === 1 ? "its" : "their"} own` : ""})`, "remove", x);
  };

  // Removals that bring others with them are checked after everything else
  // in the set (a workspace's last), so what they bring is not said twice.
  // A subject is moved once the subjects this set adds are there to go into.
  // A topic is taken out after the moves, so one moved out of it is not taken with it.
  const late = (o: unknown) => ({ move_subject: 1, move_topic: 1, order_topics: 1, remove_topic: 1.5, remove_subject: 2 } as Record<string, number>)[String((o as { op?: unknown })?.op)] ?? 0;
  const ordered = parentsFirst([...list.slice(0, CHANGE_OPS_MAX * 2)]).sort((a, b) => late(a) - late(b));
  // The tasks as a tree: stored ones by id, ones this set adds as "+key".
  const tree: TreeNode[] = current.tasks.map(t => ({ id: t.id, parent: t.parentId ?? null }));
  // The subjects as a tree, the same way. A subject they keep elsewhere that
  // one of these sits inside is a node too.
  const subjectTree: TreeNode[] = current.subjects.map(x => ({ id: x.id, parent: x.parentId ?? null }));
  for (const x of current.subjects) if (x.parentId && !subjectTree.some(n => n.id === x.parentId)) subjectTree.push({ id: x.parentId, parent: null });
  const addedSubjects: Array<{ key: string; name: string }> = [];
  // Where a subject goes: one here (parentId) or one this set adds (parentKey).
  // null: on its own; undefined: nowhere that is part of this.
  const parentRef = (x: Record<string, unknown>): { node: string; name: string; ref: { parentId: string } | { parentKey: string } } | null | undefined => {
    if (typeof x.parentKey === "string" && x.parentKey) {
      const a = addedSubjects.find(v => v.key === x.parentKey);
      return a ? { node: `+${a.key}`, name: a.name, ref: { parentKey: a.key } } : undefined;
    }
    if (typeof x.parentId === "string" && x.parentId) {
      const p = subjectById(x.parentId);
      return p ? { node: p.id, name: p.name, ref: { parentId: p.id } } : undefined;
    }
    return null;
  };
  const nameOfNode = (node: string | null) => (node === null ? null : node.startsWith("+") ? addedSubjects.find(a => `+${a.key}` === node)?.name ?? null : subjectById(node)?.name ?? null);
  const moveSubject = (s: WorkspaceDetail["subjects"][number], parent: NonNullable<ReturnType<typeof parentRef>> | null, x: Record<string, unknown>) => {
    if (touched.has(`move:${s.id}`)) return;
    const node = subjectTree.find(n => n.id === s.id)!;
    if ((parent?.node ?? null) === node.parent) return;
    const placed = canPlace(subjectTree, s.id, parent?.node ?? null, SUBJECT_DEPTH_MAX);
    if (!placed.ok) { dropped.push(`putting ${quoted(s.name)} inside ${quoted(parent!.name)} (${placed.reason === "too_deep" ? `subjects go at most ${SUBJECT_DEPTH_MAX} levels deep` : "not inside itself or a subject inside it"})`); return; }
    touched.add(`move:${s.id}`);
    const from = nameOfNode(node.parent);
    node.parent = parent?.node ?? null;
    keep({ op: "move_subject", subjectId: s.id, ...(parent ? parent.ref : { parentId: null }) },
      parent ? `Put ${quoted(s.name)} inside ${quoted(parent.name)}` : `Take ${quoted(s.name)} out of ${quoted(from ?? "its subject")}, on its own`, "change", x);
  };
  for (const item of ordered) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const x = item as Record<string, unknown>;
    switch (x.op) {
      case "rename": {
        const title = oneLine(x.title, 80);
        if (!title || title === current.title || touched.has("title")) break;
        touched.add("title");
        keep({ op: "rename", title }, `Rename ${quoted(current.title)} to ${quoted(title)}`, "change", x);
        break;
      }
      case "add_topics": {
        const s = subjectById(x.subjectId);
        if (!s) { dropped.push("topics for a subject that isn't part of this"); break; }
        const parent = topicParent(s.id, x);
        if (parent === undefined) { dropped.push(`topics for ${s.name} (inside a topic that isn't part of it)`); break; }
        const parentName = topicName(s.id, parent);
        const nodes = topicTree.get(s.id)!;
        if (parent && levelOf(parentsOf(nodes), parent) + 1 > TOPIC_DEPTH_MAX) { dropped.push(`topics inside ${quoted(parentName ?? "")} (topics go at most ${TOPIC_DEPTH_MAX} levels deep)`); break; }
        const have = new Set([...s.topics.map(t => low(t.name)), ...(addedTopics.get(s.id) ?? [])]);
        const rawKeys = Array.isArray(x.keys) ? x.keys : [];
        const names: string[] = [];
        const keys: string[] = [];
        for (const [i, n] of (Array.isArray(x.names) ? x.names : []).entries()) {
          const name = oneLine(n, NAME_MAX);
          if (!name) continue;
          if (have.has(low(name))) { dropped.push(`topic ${quoted(name)} (${s.name} already has it)`); continue; }
          if (isPlaceholderTopic(name, parentName ?? s.name)) { dropped.push(`topic ${quoted(name)} (too general: name what it covers)`); continue; }
          if (names.length >= NAMES_PER_ADD) continue;
          const given = typeof rawKeys[i] === "string" ? oneLine(rawKeys[i], 40) : "";
          const key = keyOk(given) && !addedTopicKeys.has(given) ? given : `k${ops.length + 1}-${names.length + 1}`;
          names.push(name); keys.push(key); have.add(low(name));
          addedTopicKeys.set(key, { subjectId: s.id, name });
          nodes.push({ id: `+${key}`, parent });
        }
        if (names.length === 0) break;
        addedTopics.set(s.id, new Set([...(addedTopics.get(s.id) ?? []), ...names.map(low)]));
        const milestone = x.kind === "milestone";
        const placeRef = parent === null ? {} : parent.startsWith("+") ? { parentKey: parent.slice(1) } : { parentId: parent };
        keep({ op: "add_topics", subjectId: s.id, names, keys, ...placeRef, ...(milestone ? { kind: "milestone" as const } : {}) },
          `Add ${milestone ? `milestone${names.length === 1 ? "" : "s"} ` : ""}to ${parentName ? `${quoted(parentName)} in ${s.name}` : s.name}: ${names.join(", ")}`, "add", x);
        break;
      }
      case "move_topic": {
        // A topic this set adds, named by its key or its name: it is added where it is moved to.
        const added = typeof x.topicId === "string" ? [...addedTopicKeys].find(([k, v]) => k === x.topicId || low(v.name) === low(x.topicId as string)) : undefined;
        if (added && !topicById(x.topicId)) {
          const [key, { subjectId, name }] = added;
          const parent = topicParent(subjectId, x);
          const nodes = topicTree.get(subjectId)!;
          const node = nodes.find(n => n.id === `+${key}`);
          const from = ops.find((o): o is ProposedChange & Extract<ChangeOp, { op: "add_topics" }> => o.op === "add_topics" && (o.keys ?? []).includes(key));
          if (parent === undefined || !node || !from || parent === `+${key}`) { dropped.push(`moving ${quoted(name)} (inside a topic that isn't part of it)`); break; }
          if (parent === node.parent) break;
          if (!canPlace(nodes, node.id, parent, TOPIC_DEPTH_MAX).ok) { dropped.push(`moving ${quoted(name)} (not inside itself, at most ${TOPIC_DEPTH_MAX} levels deep)`); break; }
          // Out of the set it was added with, into one of its own under its new parent.
          const i = from.keys!.indexOf(key);
          from.names = from.names.filter((_, k) => k !== i);
          from.keys = from.keys!.filter((_, k) => k !== i);
          if (from.names.length === 0) ops.splice(ops.indexOf(from), 1);
          else from.says = `Add to ${topicName(from.subjectId, from.parentId ?? (from.parentKey ? `+${from.parentKey}` : null)) ?? subjectById(from.subjectId)!.name}: ${from.names.join(", ")}`;
          node.parent = parent;
          const placeRef = parent === null ? {} : parent.startsWith("+") ? { parentKey: parent.slice(1) } : { parentId: parent };
          const where = topicName(subjectId, parent);
          keep({ op: "add_topics", subjectId, names: [name], keys: [key], ...placeRef, ...(from.kind ? { kind: from.kind } : {}) }, `Add to ${where ? `${quoted(where)} in ${subjectById(subjectId)!.name}` : subjectById(subjectId)!.name}: ${name}`, "add", x);
          break;
        }
        const hit = topicById(x.topicId);
        if (!hit) { dropped.push("moving a topic that isn't part of this"); break; }
        if (touched.has(`place:${hit.t.id}`)) break;
        const parent = topicParent(hit.s.id, x);
        if (parent === undefined) { dropped.push(`moving ${quoted(hit.t.name)} (inside a topic that isn't part of ${hit.s.name})`); break; }
        const nodes = topicTree.get(hit.s.id)!;
        const node = nodes.find(n => n.id === hit.t.id)!;
        const index = typeof x.index === "number" && Number.isInteger(x.index) && x.index >= 0 ? x.index : null;
        if (parent === node.parent && index === null) break;
        const placed = canPlace(nodes, hit.t.id, parent, TOPIC_DEPTH_MAX);
        if (!placed.ok) { dropped.push(`moving ${quoted(hit.t.name)} (${placed.reason === "too_deep" ? `topics go at most ${TOPIC_DEPTH_MAX} levels deep` : "not inside itself or a topic inside it"})`); break; }
        touched.add(`place:${hit.t.id}`);
        node.parent = parent;
        const to = topicName(hit.s.id, parent);
        const placeRef = parent === null ? { parentId: null } : parent.startsWith("+") ? { parentKey: parent.slice(1) } : { parentId: parent };
        keep({ op: "move_topic", topicId: hit.t.id, ...placeRef, ...(index !== null ? { index } : {}) },
          to ? `Put ${quoted(hit.t.name)} inside ${quoted(to)}${index !== null ? ` (as number ${index + 1})` : ""}` : `Put ${quoted(hit.t.name)} at the top of ${hit.s.name}${index !== null ? ` (as number ${index + 1})` : ""}`, "change", x);
        break;
      }
      case "order_topics": {
        const ids = (Array.isArray(x.topicIds) ? x.topicIds : []).filter((id, i, all) => typeof id === "string" && all.indexOf(id) === i) as string[];
        const hits = ids.map(id => topicById(id));
        if (hits.length < 2 || hits.some(h => !h)) { dropped.push("a new order that names topics that aren't here"); break; }
        const s0 = hits[0]!.s;
        const nodes = topicTree.get(s0.id)!;
        const parentOf = (id: string) => nodes.find(n => n.id === id)?.parent ?? null;
        if (hits.some(h => h!.s.id !== s0.id) || ids.some(id => parentOf(id) !== parentOf(ids[0]!))) { dropped.push("a new order for topics that aren't beside one another"); break; }
        keep({ op: "order_topics", topicIds: ids }, `Put topics in this order: ${hits.map(h => quoted(h!.t.name)).join(", ")}`, "change", x);
        break;
      }
      case "update_topic": {
        const hit = topicById(x.topicId);
        if (!hit) { dropped.push("a change to a topic that isn't part of this"); break; }
        if (touched.has(`details:${hit.t.id}`)) break;
        const patch = patchOf(x.patch ?? x);
        const was = hit.t.details ?? {};
        const changed = (Object.keys(patch) as Array<keyof TopicPatch>).filter(k => JSON.stringify(patch[k] ?? null) !== JSON.stringify((was as Record<string, unknown>)[k] ?? null));
        if (changed.length === 0) break;
        touched.add(`details:${hit.t.id}`);
        const said: Record<string, string> = { explanation: "what it covers", weeks: "weeks", hoursPerWeek: "hours a week", goals: "goals", exercises: "exercises", project: "project", completion: "done when" };
        keep({ op: "update_topic", topicId: hit.t.id, patch: Object.fromEntries(changed.map(k => [k, patch[k]])) as TopicPatch },
          `Change ${hit.t.kind === "milestone" ? "milestone" : "topic"} ${quoted(hit.t.name)}: ${changed.map(k => said[k]).join(", ")}`, "change", x);
        break;
      }
      case "add_subject": {
        const name = oneLine(x.name, NAME_MAX);
        if (!name) break;
        if (current.subjects.some(s => low(s.name) === low(name))) { dropped.push(`subject ${quoted(name)} (it's already here; add topics to it instead)`); break; }
        if (addedSubjects.some(a => low(a.name) === low(name))) { dropped.push(`subject ${quoted(name)} (already added)`); break; }
        const parent = parentRef(x);
        if (parent === undefined) { dropped.push(`subject ${quoted(name)} (inside a subject that isn't part of this)`); break; }
        // A "topic" that is one of their subjects here is that subject going
        // inside the new one ("put them all under Semester Five"), never a
        // topic of the same name beside it.
        const named = (Array.isArray(x.topics) ? x.topics : []).map(t => oneLine(t, NAME_MAX)).filter(Boolean);
        const inside = current.subjects.filter(s => named.some(t => low(t) === low(s.name)));
        const topics = named.filter(t => !inside.some(s => low(s.name) === low(t)) && !isPlaceholderTopic(t, name)).slice(0, NAMES_PER_ADD);
        const rawKey = oneLine(x.key, 40);
        const key = rawKey && [...rawKey].every(c => (c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "-" || c === "_") && !addedSubjects.some(a => a.key === rawKey) ? rawKey : `s${ops.length + 1}`;
        subjectTree.push({ id: `+${key}`, parent: parent?.node ?? null });
        if (parent && levelOf(parentsOf(subjectTree), `+${key}`) > SUBJECT_DEPTH_MAX) { subjectTree.pop(); dropped.push(`subject ${quoted(name)} (subjects go at most ${SUBJECT_DEPTH_MAX} levels deep)`); break; }
        addedSubjects.push({ key, name });
        keep({ op: "add_subject", name, topics, key, ...(parent ? parent.ref : {}) },
          `Add subject ${quoted(name)}${parent ? ` inside ${quoted(parent.name)}` : ""}${topics.length ? ` with ${topics.join(", ")}` : ""}`, "add", x);
        for (const s of inside) moveSubject(s, { node: `+${key}`, name, ref: { parentKey: key } }, {});
        break;
      }
      case "move_subject": {
        const s = subjectById(x.subjectId);
        if (!s) { dropped.push("moving a subject that isn't part of this"); break; }
        const parent = parentRef(x);
        if (parent === undefined) { dropped.push(`putting ${quoted(s.name)} inside a subject that isn't part of this`); break; }
        moveSubject(s, parent, x);
        break;
      }
      case "rename_subject": {
        const s = subjectById(x.subjectId);
        const name = oneLine(x.name, NAME_MAX);
        if (!s || !name) { dropped.push("a rename of a subject that isn't part of this"); break; }
        if (s.name === name || touched.has(`name:${s.id}`)) break;
        if (current.subjects.some(v => v.id !== s.id && low(v.name) === low(name)) || addedSubjects.some(a => low(a.name) === low(name))) { dropped.push(`renaming ${quoted(s.name)} (there's already a subject called ${quoted(name)})`); break; }
        touched.add(`name:${s.id}`);
        keep({ op: "rename_subject", subjectId: s.id, name }, `Rename subject ${quoted(s.name)} to ${quoted(name)}`, "change", x);
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
        if (touched.has(hit.t.id)) break;
        removeTopicTree(hit, x);
        break;
      }
      case "remove_subject": {
        const s = subjectById(x.subjectId);
        if (!s) { dropped.push("removing a subject that isn't part of this"); break; }
        removeSubject(s, x);
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
        const minutes = typeof x.estimatedMinutes === "number" && Number.isInteger(x.estimatedMinutes) && x.estimatedMinutes >= 5 && x.estimatedMinutes <= 600 ? x.estimatedMinutes : null;
        const on = waitTargets(`+${finalKey}`, x.after, title);
        for (const n of on) waits.push({ task: `+${finalKey}`, on: n });
        keep({
          op: "add_task", key: finalKey, title, subjectId: subjectId ?? (current.subjects.length === 1 ? current.subjects[0]!.id : null),
          topicName: topicFromParent ?? (oneLine(x.topicName, NAME_MAX) || null), dueDay, priority,
          ...(parentTask ? { parentId: parentTask.id } : parentAdded ? { parentKey: parentAdded.key } : {}),
          ...(minutes ? { estimatedMinutes: minutes } : {}), ...(on.length ? { after: on.map(refOf) } : {}),
        }, `${parentTitle ? `Add step ${quoted(title)} under ${quoted(parentTitle)}` : `Add task ${quoted(title)}`}${dueDay ? `, due ${dueDay}` : ""}${priority ? `, ${priority} priority` : ""}${on.length ? `, after ${on.map(n => quoted(taskById(n)?.title ?? (ops.find(o => o.op === "add_task" && `+${o.key}` === n) as { title?: string } | undefined)?.title ?? n)).join(", ")}` : ""}`, "add", x);
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
        if (x.estimatedMinutes !== undefined) {
          const m = x.estimatedMinutes === null ? null : typeof x.estimatedMinutes === "number" && Number.isInteger(x.estimatedMinutes) && x.estimatedMinutes >= 5 && x.estimatedMinutes <= 600 ? x.estimatedMinutes : undefined;
          if (m !== undefined && m !== t.estimatedMinutes) { change.estimatedMinutes = m; parts.push(m ? `about ${m} min` : "no estimate"); }
        }
        if (x.topicName !== undefined && !t.parentId) {
          const name = x.topicName === null ? null : oneLine(x.topicName, NAME_MAX) || null;
          if (name !== t.topicName) { change.topicName = name; parts.push(name ? `under ${quoted(name)}` : "under no topic"); }
        }
        if (x.after !== undefined) {
          const on = waitTargets(t.id, x.after, t.title);
          const was = t.after ?? [];
          if (on.length !== was.length || on.some(n => !was.includes(n))) {
            for (let i = waits.length - 1; i >= 0; i--) if (waits[i]!.task === t.id) waits.splice(i, 1);
            for (const n of on) waits.push({ task: t.id, on: n });
            change.after = on.map(refOf);
            parts.push(on.length ? `after ${on.map(n => quoted(taskById(n)?.title ?? (ops.find(o => o.op === "add_task" && `+${o.key}` === n) as { title?: string } | undefined)?.title ?? n)).join(", ")}` : "waits on nothing");
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
  // Numbered in their final order (a moved addition may have left a gap).
  return { ops: ops.map((o, i) => ({ ...o, id: `c${i + 1}` })), dropped: dropped.slice(0, 12) };
}

// ── Only what was asked ───────────────────────────────────────────────────────

export const kindOf = (op: ChangeOp["op"]): ChangeKind =>
  op === "add_topics" || op === "rename_topic" || op === "remove_topic" || op === "move_topic" || op === "order_topics" || op === "update_topic" ? "topics"
  : op === "add_subject" || op === "remove_subject" || op === "move_subject" || op === "rename_subject" ? "subjects"
  : op === "add_date" || op === "update_date" || op === "remove_date" ? "dates"
  : op === "add_note" || op === "remove_note" ? "notes" : "tasks";

// Keeps the changes of the kinds the learner's request is about; the rest
// are left out and said ("not asked for"). A subject's removal keeps the
// topic and date removals it brings, a workspace's everything it brings.
// No kinds known (an older reading): all are kept. A request that asks for
// nothing to be removed keeps no removal ("keep everything, just put them
// under Semester Five" never takes a subject away).
export function withinAsk(set: ChangeSet, touches: readonly ChangeKind[], current: WorkspaceDetail, asked: { removes?: boolean | null } = {}): ChangeSet {
  if (asked.removes === false && set.ops.some(o => o.effect === "remove")) {
    const kept = set.ops.filter(o => o.effect !== "remove").map((o, i) => ({ ...o, id: `c${i + 1}` }));
    const left = set.ops.filter(o => o.effect === "remove").map(o => `${o.says.charAt(0).toLowerCase()}${o.says.slice(1)} (you didn't ask to remove anything)`);
    return withinAsk({ ops: kept, dropped: [...set.dropped, ...left].slice(0, 12) }, touches, current);
  }
  if (touches.length === 0) return set;
  const goingSubjects = new Set(set.ops.flatMap(o => (o.op === "remove_subject" ? [o.subjectId] : [])));
  const withSubject = new Set([
    ...current.subjects.filter(s => goingSubjects.has(s.id)).flatMap(s => s.topics.map(t => t.id)),
    ...current.dates.filter(d => d.subjectId !== null && goingSubjects.has(d.subjectId)).map(d => d.id),
  ]);
  // A change to a task's priority alone is about priorities.
  const onlyPriority = (o: ProposedChange) => o.op === "update_task" && o.priority !== undefined && o.title === undefined && o.dueDay === undefined && o.parentId === undefined && o.after === undefined && o.estimatedMinutes === undefined && o.topicName === undefined;
  // A new name for the whole thing is what it is about, whatever kinds were read.
  const ok = (o: ProposedChange) => o.op === "rename" || touches.includes(onlyPriority(o) ? "priorities" : kindOf(o.op))
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
