// ─── Build with Nova: revising a proposal by operations ───────────────────────
// A proposal is revised the way a workspace that exists is changed: Nova
// proposes operations (ChangeOp) on its items by id, checkChanges and
// withinAsk keep only those that are valid and asked for, and code applies
// them here. Everything no operation names stays exactly as it was: its
// keys, names, places, order, priorities, dates and details. The whole plan
// is never written again by the model, so nothing in it can be lost or cut
// short by a revision, whatever its size.
//
// planDetail gives a proposal's items the ids the operations name (s1, t1,
// d1, n1; a task by its key) in the same shape as a workspace's records
// (WorkspaceDetail). applyToPlan plays checked operations on a copy of the
// plan. Pure: no database, no model.

import type { ChangeOp, ChangeSet, WorkspaceDetail } from "./builder.types";
import { topicDetailsOf, topicRows, type PlanSubject, type PlanTask, type PlanTopic, type WorkspacePlan } from "./workspace-plan";

const low = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

export interface PlanIds {
  subject: Map<string, number>;                          // id → index in plan.subjects
  topic:   Map<string, { subject: number; name: string }>; // id → its subject and name
  date:    Map<string, number>;
  note:    Map<string, number>;
}

// The proposal as records with ids, for the model and for checkChanges.
export function planDetail(plan: WorkspacePlan): { detail: WorkspaceDetail; ids: PlanIds } {
  const ids: PlanIds = { subject: new Map(), topic: new Map(), date: new Map(), note: new Map() };
  const subjectId = (name: string | null | undefined) => {
    if (!name) return null;
    const i = plan.subjects.findIndex(s => low(s.name) === low(name));
    return i >= 0 ? `s${i + 1}` : null;
  };
  let n = 0;
  const topicIdOf = new Map<string, string>();
  const subjects = plan.subjects.map((s, i) => {
    ids.subject.set(`s${i + 1}`, i);
    const rows = topicRows(s);
    for (const r of rows) { const id = `t${++n}`; topicIdOf.set(`${i}\n${low(r.topic.name)}`, id); ids.topic.set(id, { subject: i, name: r.topic.name }); }
    return {
      id: `s${i + 1}`, name: s.name, parentId: subjectId(s.parent),
      topics: rows.map(r => ({
        id: topicIdOf.get(`${i}\n${low(r.topic.name)}`)!, name: r.topic.name,
        parentId: r.topic.parent ? topicIdOf.get(`${i}\n${low(r.topic.parent)}`) ?? null : null,
        kind: r.topic.kind ?? null, details: topicDetailsOf(r.topic),
      })),
    };
  });
  const detail: WorkspaceDetail = {
    workspace: null, title: plan.title, subjects,
    tasks: plan.tasks.map(t => ({
      id: t.key, title: t.title, status: "todo", priority: t.priority, dueDay: t.dueDay, subjectId: subjectId(t.subject), topicName: t.topic,
      estimatedMinutes: t.estimatedMinutes, parentId: t.parent ?? null, after: t.after ?? [],
    })),
    notes: plan.notes.map((x, i) => { ids.note.set(`n${i + 1}`, i); return { id: `n${i + 1}`, title: x.title, subjectId: subjectId(x.subject), updatedAt: "" }; }),
    dates: plan.dates.map((d, i) => { ids.date.set(`d${i + 1}`, i); return { id: `d${i + 1}`, title: d.title, day: d.day, kind: d.kind, subjectId: subjectId(d.subject) }; }),
    about: { prerequisites: plan.prerequisites, resources: plan.resources, assumptions: plan.assumptions },
  };
  return { detail, ids };
}

// Items of a list put in the given order where they stand: the first of
// them takes the place of the first that was there, and so on. The others
// keep their places.
function inOrder<T>(list: T[], wanted: T[]): T[] {
  const slots = new Set(wanted);
  const queue = [...wanted, ...list.filter(x => slots.has(x) && !wanted.includes(x))];
  return list.map(x => (slots.has(x) ? queue.shift()! : x));
}

// The operations, already checked against planDetail(plan), played on a
// copy of the plan. The result is checked again by the caller
// (checkWorkspacePlan) like any plan.
export function applyToPlan(plan: WorkspacePlan, set: ChangeSet | ChangeOp[]): WorkspacePlan {
  const { ids } = planDetail(plan);
  const p: WorkspacePlan = JSON.parse(JSON.stringify(plan));
  const ops: ChangeOp[] = Array.isArray(set) ? set : set.ops;
  // Subjects and topics by their original id, followed through renames and removals.
  const subjects: Array<PlanSubject | null> = [...p.subjects];
  const subjectOf = (id: string | null | undefined): PlanSubject | null => (id && ids.subject.has(id) ? subjects[ids.subject.get(id)!] ?? null : addedSubjects.get(id ?? "") ?? null);
  const addedSubjects = new Map<string, PlanSubject>();
  const topicRef = new Map<string, { s: PlanSubject; t: PlanTopic }>();
  for (const [id, at] of ids.topic) {
    const s = p.subjects[at.subject]!;
    const t = s.topics.find(x => x.name === at.name);
    if (t) topicRef.set(id, { s, t });
  }
  const addedTopics = new Map<string, { s: PlanSubject; t: PlanTopic }>();
  const topicOf = (id: string | null | undefined) => (id ? topicRef.get(id) ?? null : null);
  // Task keys: an added task whose key is taken gets another.
  const keyFor = new Map<string, string>();
  const taskKey = (ref: string) => keyFor.get(ref) ?? ref;
  const subjectName = (id: string | null | undefined) => subjectOf(id)?.name ?? null;

  for (const o of ops) {
    switch (o.op) {
      case "rename":
        p.title = o.title;
        break;
      case "add_subject": {
        const parent = o.parentKey ? addedSubjects.get(o.parentKey)?.name ?? null : subjectName(o.parentId);
        const s: PlanSubject = { name: o.name, topics: o.topics.map(name => ({ name, explanation: null, sources: [] })), ...(parent ? { parent } : {}) };
        p.subjects.push(s);
        if (o.key) addedSubjects.set(o.key, s);
        break;
      }
      case "move_subject": {
        const s = subjectOf(o.subjectId);
        if (!s) break;
        const parent = o.parentKey ? addedSubjects.get(o.parentKey)?.name ?? null : subjectName(o.parentId);
        if (parent) s.parent = parent; else delete s.parent;
        break;
      }
      case "rename_subject": {
        const s = subjectOf(o.subjectId);
        if (!s) break;
        const was = s.name;
        s.name = o.name;
        for (const x of p.subjects) if (x.parent && low(x.parent) === low(was)) x.parent = o.name;
        for (const t of p.tasks) if (t.subject && low(t.subject) === low(was)) t.subject = o.name;
        for (const d of p.dates) if (d.subject && low(d.subject) === low(was)) d.subject = o.name;
        for (const n of p.notes) if (n.subject && low(n.subject) === low(was)) n.subject = o.name;
        break;
      }
      case "remove_subject": {
        const s = subjectOf(o.subjectId);
        if (!s) break;
        p.subjects = p.subjects.filter(x => x !== s);
        if (ids.subject.has(o.subjectId)) subjects[ids.subject.get(o.subjectId)!] = null;
        for (const x of p.subjects) if (x.parent && low(x.parent) === low(s.name)) delete x.parent;
        // Its notes and tasks stay, unfiled (as for a workspace); its dates go by their own operations.
        for (const t of p.tasks) if (t.subject && low(t.subject) === low(s.name)) { t.subject = null; t.topic = null; }
        for (const n of p.notes) if (n.subject && low(n.subject) === low(s.name)) { n.subject = null; n.topic = null; }
        for (const d of p.dates) if (d.subject && low(d.subject) === low(s.name)) d.subject = null;
        break;
      }
      case "add_topics": {
        const s = subjectOf(o.subjectId);
        if (!s) break;
        const parent = o.parentKey ? addedTopics.get(o.parentKey)?.t.name ?? null : topicOf(o.parentId)?.t.name ?? null;
        o.names.forEach((name, i) => {
          const t: PlanTopic = { name, explanation: null, sources: [], ...(parent ? { parent } : {}), ...(o.kind === "milestone" ? { kind: "milestone" as const, milestone: { weeks: null, hoursPerWeek: null, goals: [], exercises: [], project: null, completion: null, resources: [] } } : {}) };
          s.topics.push(t);
          const key = o.keys?.[i];
          if (key) addedTopics.set(key, { s, t });
        });
        break;
      }
      case "rename_topic": {
        const hit = topicOf(o.topicId);
        if (!hit) break;
        const was = hit.t.name;
        hit.t.name = o.name;
        for (const x of hit.s.topics) if (x.parent && low(x.parent) === low(was)) x.parent = o.name;
        for (const t of p.tasks) if (t.topic && low(t.topic) === low(was) && (!t.subject || low(t.subject) === low(hit.s.name))) t.topic = o.name;
        for (const n of p.notes) if (n.topic && low(n.topic) === low(was) && (!n.subject || low(n.subject) === low(hit.s.name))) n.topic = o.name;
        break;
      }
      case "move_topic": {
        const hit = topicOf(o.topicId);
        if (!hit) break;
        const parent = o.parentKey ? addedTopics.get(o.parentKey)?.t.name ?? null : o.parentId ? topicOf(o.parentId)?.t.name ?? null : null;
        if (parent) hit.t.parent = parent; else delete hit.t.parent;
        // Its place among the topics it now sits beside.
        const siblings = hit.s.topics.filter(x => x !== hit.t && low(x.parent) === low(parent));
        const at = o.index === undefined || o.index === null ? siblings.length : Math.max(0, Math.min(o.index, siblings.length));
        const rest = hit.s.topics.filter(x => x !== hit.t);
        const before = siblings[at];
        const where = before ? rest.indexOf(before) : siblings.length ? rest.indexOf(siblings[siblings.length - 1]!) + 1 : rest.length;
        hit.s.topics = [...rest.slice(0, where), hit.t, ...rest.slice(where)];
        break;
      }
      case "order_topics": {
        const hits = o.topicIds.map(id => topicOf(id)).filter((h): h is { s: PlanSubject; t: PlanTopic } => h !== null);
        if (hits.length < 2) break;
        const s = hits[0]!.s;
        s.topics = inOrder(s.topics, hits.map(h => h.t));
        break;
      }
      case "update_topic": {
        const hit = topicOf(o.topicId);
        if (!hit) break;
        if (o.patch.explanation !== undefined) hit.t.explanation = o.patch.explanation;
        if (hit.t.kind === "milestone") {
          const m = hit.t.milestone ?? { weeks: null, hoursPerWeek: null, goals: [], exercises: [], project: null, completion: null, resources: [] };
          for (const k of ["weeks", "hoursPerWeek", "goals", "exercises", "project", "completion"] as const) if (o.patch[k] !== undefined) (m as unknown as Record<string, unknown>)[k] = o.patch[k];
          hit.t.milestone = m;
        }
        break;
      }
      case "remove_topic": {
        const hit = topicOf(o.topicId);
        if (!hit) break;
        // What was inside it and is not removed (never, after checkChanges) moves up.
        for (const x of hit.s.topics) if (x.parent && low(x.parent) === low(hit.t.name)) { if (hit.t.parent) x.parent = hit.t.parent; else delete x.parent; }
        hit.s.topics = hit.s.topics.filter(x => x !== hit.t);
        for (const t of p.tasks) if (t.topic && low(t.topic) === low(hit.t.name)) t.topic = null;
        topicRef.delete(o.topicId);
        break;
      }
      case "add_task": {
        let key = o.key;
        for (let i = 2; p.tasks.some(t => t.key === key); i++) key = `${o.key}-${i}`;
        keyFor.set(o.key, key);
        const t: PlanTask = {
          key, title: o.title, priority: o.priority, subject: subjectName(o.subjectId), topic: o.topicName, dueDay: o.dueDay,
          estimatedMinutes: o.estimatedMinutes ?? null, after: (o.after ?? []).map(taskKey),
          parent: o.parentKey ? taskKey(o.parentKey) : o.parentId ?? null,
        };
        p.tasks.push(t);
        break;
      }
      case "update_task": {
        const t = p.tasks.find(x => x.key === o.taskId);
        if (!t) break;
        if (o.title !== undefined) t.title = o.title;
        if (o.dueDay !== undefined) t.dueDay = o.dueDay;
        if (o.priority !== undefined) { t.priority = o.priority; delete t.suggestedPriority; delete t.priorityReason; }
        if (o.parentId !== undefined) t.parent = o.parentId;
        if (o.estimatedMinutes !== undefined) t.estimatedMinutes = o.estimatedMinutes;
        if (o.topicName !== undefined) t.topic = o.topicName;
        if (o.after !== undefined) t.after = o.after.map(taskKey);
        break;
      }
      case "remove_task": {
        const going = new Set([o.taskId]);
        for (let grew = true; grew;) { grew = false; for (const t of p.tasks) if (t.parent && going.has(t.parent) && !going.has(t.key)) { going.add(t.key); grew = true; } }
        p.tasks = p.tasks.filter(t => !going.has(t.key));
        for (const t of p.tasks) if (t.after?.some(a => going.has(a))) t.after = t.after.filter(a => !going.has(a));
        break;
      }
      case "order_tasks": {
        const wanted = o.taskIds.map(id => p.tasks.find(t => t.key === id)).filter((t): t is PlanTask => Boolean(t));
        p.tasks = inOrder(p.tasks, wanted);
        break;
      }
      case "add_date":
        p.dates.push({ title: o.title, day: o.day, subject: subjectName(o.subjectId), kind: o.kind });
        break;
      case "update_date": {
        const i = ids.date.get(o.dateId);
        const d = i === undefined ? undefined : plan.dates[i] && p.dates.find(x => x.title === plan.dates[i]!.title && x.day === plan.dates[i]!.day);
        if (!d) break;
        if (o.title !== undefined) d.title = o.title;
        if (o.day !== undefined) d.day = o.day;
        break;
      }
      case "remove_date": {
        const i = ids.date.get(o.dateId);
        const was = i === undefined ? undefined : plan.dates[i];
        if (was) p.dates = p.dates.filter(x => !(x.title === was.title && x.day === was.day));
        break;
      }
      case "add_note":
        p.notes.push({ key: `note-${p.notes.length + 1}`, title: o.title, subject: subjectName(o.subjectId), topic: o.topicName, body: o.body, origin: "nova", sources: [] });
        break;
      case "remove_note": {
        const i = ids.note.get(o.noteId);
        const was = i === undefined ? undefined : plan.notes[i];
        if (was) p.notes = p.notes.filter(x => x.key !== was.key);
        break;
      }
    }
  }
  return p;
}
