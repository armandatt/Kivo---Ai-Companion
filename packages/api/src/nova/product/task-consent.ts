// ─── Build with Nova: only the tasks the learner asked for ────────────────────
// Pure. Subjects, topics, phases and milestones organise what is there; a
// task is work the learner will be held to, so Nova adds one only when they
// asked for tasks (TaskConsent, builder.types.ts: read from their own words,
// quoted, or a button they pressed, in builder-state.ts). A roadmap, a topic
// tree, phases or an imported syllabus is not such a request.
//
// Applied by code to every model reply that could bring tasks: a proposal's
// tasks (filterPlanTasks) and a change's add_task operations
// (filterTaskOps), whatever the model wrote. Nothing here removes a task
// that exists, or one the learner wrote on the page.
//
// No regex: names are compared normalized (builder-state.ts).

import { normalized } from "./builder-state";
import type { ChangeSet, ProposedChange, TaskConsent, WorkspaceDetail } from "./builder.types";
import type { PlanTask, WorkspacePlan } from "./workspace-plan";

interface Outline { subjects: Array<{ name: string; parent: string | null; topics: Array<{ name: string; parent: string | null }> }> }
interface Covered { subjects: Set<string>; topics: Set<string> }

// What the named parts hold: a subject with the subjects and topics inside
// it, a topic (or milestone) with the topics inside it, by normalized name.
export function covered(outline: Outline, scope: readonly string[]): Covered {
  const named = new Set(scope.map(normalized));
  const subjects = new Set<string>(), topics = new Set<string>();
  const subjectIn = (name: string, seen = 0): boolean => {
    if (named.has(normalized(name))) return true;
    const s = outline.subjects.find(x => normalized(x.name) === normalized(name));
    return Boolean(s?.parent) && seen < 12 && subjectIn(s!.parent!, seen + 1);
  };
  for (const s of outline.subjects) {
    const whole = subjectIn(s.name);
    if (whole) subjects.add(normalized(s.name));
    const topicIn = (name: string, seen = 0): boolean => {
      if (named.has(normalized(name))) return true;
      const t = s.topics.find(x => normalized(x.name) === normalized(name));
      return Boolean(t?.parent) && seen < 12 && topicIn(t!.parent!, seen + 1);
    };
    for (const t of s.topics) if (whole || topicIn(t.name)) topics.add(normalized(t.name));
  }
  return { subjects, topics };
}

const inScope = (c: Covered, subject: string | null, topic: string | null) =>
  (topic !== null && c.topics.has(normalized(topic))) || (subject !== null && c.subjects.has(normalized(subject)));

const why = (consent: TaskConsent) =>
  consent.mode === "scoped" ? `you asked for tasks only in ${consent.scope.slice(0, 3).join(", ")}` : "you haven't asked for tasks";

// A proposal's tasks, kept only as far as they were asked for. A step goes
// with the task it is part of; a wait on a task left out is dropped.
export function filterPlanTasks(plan: WorkspacePlan, consent: TaskConsent): { plan: WorkspacePlan; dropped: string[] } {
  if (consent.mode === "all" || plan.tasks.length === 0) return { plan, dropped: [] };
  const byKey = new Map(plan.tasks.map(t => [t.key, t]));
  const rootOf = (t: PlanTask): PlanTask => { let at = t; for (let i = 0; at.parent && byKey.has(at.parent) && i < 12; i++) at = byKey.get(at.parent)!; return at };
  const c = consent.mode === "scoped" ? covered({ subjects: plan.subjects.map(s => ({ name: s.name, parent: s.parent ?? null, topics: s.topics.map(t => ({ name: t.name, parent: t.parent ?? null })) })) }, consent.scope) : null;
  const kept = plan.tasks.filter(t => { const r = rootOf(t); return c !== null && inScope(c, r.subject, r.topic) });
  const keys = new Set(kept.map(t => t.key));
  const left = plan.tasks.length - kept.length;
  if (left === 0) return { plan, dropped: [] };
  return {
    plan: { ...plan, tasks: kept.map(t => (t.after?.some(a => !keys.has(a)) ? { ...t, after: t.after.filter(a => keys.has(a)) } : t)) },
    dropped: [`${left} task${left === 1 ? "" : "s"} (${why(consent)})`],
  };
}

// A change's new tasks, kept only as far as they were asked for: by the
// topic or subject each is filed under, or for a step, the task it is part
// of (one there, or another new one kept). Every other operation stays.
export function filterTaskOps(set: ChangeSet, consent: TaskConsent, current: Pick<WorkspaceDetail, "subjects" | "tasks">): ChangeSet {
  if (consent.mode === "all" || !set.ops.some(o => o.op === "add_task")) return set;
  const subjectName = new Map(current.subjects.map(s => [s.id, s.name]));
  const c = consent.mode === "scoped" ? covered({
    subjects: current.subjects.map(s => ({
      name: s.name, parent: s.parentId ? subjectName.get(s.parentId) ?? null : null,
      topics: s.topics.map(t => ({ name: t.name, parent: t.parentId ? s.topics.find(x => x.id === t.parentId)?.name ?? null : null })),
    })),
  }, consent.scope) : null;
  const tasks = new Map(current.tasks.map(t => [t.id, t]));
  const thereIn = (id: string): boolean => {
    let t = tasks.get(id);
    for (let i = 0; t?.parentId && tasks.has(t.parentId) && i < 12; i++) t = tasks.get(t.parentId);
    return Boolean(t) && c !== null && inScope(c, t!.subjectId ? subjectName.get(t!.subjectId) ?? null : null, t!.topicName);
  };
  const keptKeys = new Set<string>();
  const ok = (o: ProposedChange): boolean => {
    if (o.op !== "add_task") return true;
    if (c === null) return false;
    const yes = o.parentId ? thereIn(o.parentId) : o.parentKey ? keptKeys.has(o.parentKey) : inScope(c, o.subjectId ? subjectName.get(o.subjectId) ?? null : null, o.topicName);
    if (yes) keptKeys.add(o.key);
    return yes;
  };
  // In order: a step is judged after the new task it is part of.
  const verdicts = set.ops.map(ok);
  const added = new Set(set.ops.flatMap(o => (o.op === "add_task" ? [o.key] : [])));
  const kept = set.ops.filter((_, i) => verdicts[i]).map((o, i) => {
    const after = o.op === "add_task" && o.after?.some(a => added.has(a) && !keptKeys.has(a)) ? { after: o.after.filter(a => !added.has(a) || keptKeys.has(a)) } : {};
    return { ...o, ...after, id: `c${i + 1}` } as ProposedChange;
  });
  const left = set.ops.filter((_, i) => !verdicts[i]).map(o => `${o.says.charAt(0).toLowerCase()}${o.says.slice(1)} (${why(consent)})`);
  return { ops: kept, dropped: [...set.dropped, ...left].slice(0, 12) };
}
