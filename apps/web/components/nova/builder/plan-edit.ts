// Edits the learner makes to a proposal in the playground, as pure
// functions over the WorkspacePlan. Each keeps the plan's own references
// whole: renaming a milestone moves its tasks with it, renaming a subject
// re-files what was under it, removing a task clears what waited for it.
// The server checks the result again (checkWorkspacePlan); nothing here is
// trusted. Run the tests with `npm test`.

import type { PlanDate, PlanNote, PlanPhase, PlanSubject, PlanTask, WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import { canPlace, subtreeOf, treeOrder } from '@repo/api/nova/product/task-tree'
import { SUBJECT_DEPTH_MAX } from '@repo/api/nova/product/setup-edit.types'

const same = (a: string | null | undefined, b: string | null | undefined) =>
  a != null && b != null && a.toLocaleLowerCase() === b.toLocaleLowerCase()

export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || to < 0 || from >= list.length || to >= list.length) return list
  const next = [...list]
  const [item] = next.splice(from, 1)
  next.splice(to, 0, item!)
  return next
}

// A key no task in the plan has yet.
export function newTaskKey(plan: WorkspacePlan): string {
  let i = plan.tasks.length + 1
  while (plan.tasks.some(t => t.key === `yours-${i}`)) i++
  return `yours-${i}`
}

// ── Tasks ─────────────────────────────────────────────────────────────────────

export function updateTask(plan: WorkspacePlan, key: string, patch: Partial<Omit<PlanTask, 'key'>>): WorkspacePlan {
  return { ...plan, tasks: plan.tasks.map(t => (t.key === key ? { ...t, ...patch } : t)) }
}

export function addTask(plan: WorkspacePlan, title: string, milestone: string | null = null): WorkspacePlan {
  const phase = milestone ? plan.phases.find(p => same(p.name, milestone)) : null
  const task: PlanTask = {
    key: newTaskKey(plan), title, priority: null, subject: phase?.subject ?? plan.subjects[0]?.name ?? null,
    topic: phase?.name ?? null, dueDay: null, estimatedMinutes: null, after: null, parent: null,
  }
  return { ...plan, tasks: [...plan.tasks, task] }
}

// ── Steps (product/task-tree.ts holds the rules) ──────────────────────────────

const nodes = (plan: WorkspacePlan) => plan.tasks.map(t => ({ id: t.key, parent: t.parent ?? null }))

// A step under a task, after its last step, filed where its task is.
export function addStep(plan: WorkspacePlan, parentKey: string, title: string): WorkspacePlan {
  const parent = plan.tasks.find(t => t.key === parentKey)
  if (!parent || !canPlace([...nodes(plan), { id: '+new', parent: null }], '+new', parentKey).ok) return plan
  const step: PlanTask = { key: newTaskKey(plan), title, priority: null, subject: parent.subject, topic: parent.topic, dueDay: null, estimatedMinutes: null, after: null, parent: parentKey }
  const under = subtreeOf(nodes(plan), parentKey)
  const last = Math.max(...under.map(k => plan.tasks.findIndex(t => t.key === k)))
  const tasks = [...plan.tasks]
  tasks.splice(last + 1, 0, step)
  return { ...plan, tasks }
}

// Under another task (null: a task of its own), when the tree allows it.
// A step follows its new task's milestone.
export function setParent(plan: WorkspacePlan, key: string, parent: string | null): WorkspacePlan {
  if (!canPlace(nodes(plan), key, parent).ok) return plan
  const to = parent ? plan.tasks.find(t => t.key === parent) : null
  const moving = new Set(subtreeOf(nodes(plan), key))
  return { ...plan, tasks: plan.tasks.map(t => (t.key === key ? { ...t, parent, ...(to ? { topic: to.topic, subject: to.subject } : {}) } : moving.has(t.key) && to ? { ...t, topic: to.topic, subject: to.subject } : t)) }
}

// The task just above among its siblings, or null.
function siblingBefore(plan: WorkspacePlan, key: string): PlanTask | null {
  const t = plan.tasks.find(x => x.key === key)
  if (!t) return null
  const siblings = plan.tasks.filter(x => (x.parent ?? null) === (t.parent ?? null) && (t.parent ? true : same(x.topic, t.topic) || (!x.topic && !t.topic)))
  const i = siblings.findIndex(x => x.key === key)
  return i > 0 ? siblings[i - 1]! : null
}

// A step of the task above it (indent), or one level up (outdent).
export const canIndent = (plan: WorkspacePlan, key: string) => { const s = siblingBefore(plan, key); return Boolean(s && canPlace(nodes(plan), key, s.key).ok) }
export function indent(plan: WorkspacePlan, key: string): WorkspacePlan {
  const s = siblingBefore(plan, key)
  return s ? setParent(plan, key, s.key) : plan
}
export function outdent(plan: WorkspacePlan, key: string): WorkspacePlan {
  const t = plan.tasks.find(x => x.key === key)
  if (!t?.parent) return plan
  const up = plan.tasks.find(x => x.key === t.parent)?.parent ?? null
  return setParent(plan, key, up)
}

// A task and its steps go together; whatever waited for one of them waits for nothing.
export function removeTask(plan: WorkspacePlan, key: string): WorkspacePlan {
  const going = new Set(subtreeOf(nodes(plan), key))
  return { ...plan, tasks: plan.tasks.filter(t => !going.has(t.key)).map(t => (t.after && going.has(t.after) ? { ...t, after: null } : t)) }
}

// Up or down among its siblings, its steps with it.
export function reorderTask(plan: WorkspacePlan, key: string, by: -1 | 1): WorkspacePlan {
  const t = plan.tasks.find(x => x.key === key)
  if (!t) return plan
  const siblings = plan.tasks.filter(x => (x.parent ?? null) === (t.parent ?? null))
  const i = siblings.findIndex(x => x.key === key)
  const other = siblings[i + by]
  if (!other) return plan
  const a = subtreeOf(nodes(plan), key), b = subtreeOf(nodes(plan), other.key)
  const block = (keys: string[]) => plan.tasks.filter(x => keys.includes(x.key))
  const first = by === -1 ? [...block(a), ...block(b)] : [...block(b), ...block(a)]
  const at = Math.min(...[...a, ...b].map(k => plan.tasks.findIndex(x => x.key === k)))
  const rest = plan.tasks.filter(x => !a.includes(x.key) && !b.includes(x.key))
  return { ...plan, tasks: [...rest.slice(0, at), ...first, ...rest.slice(at)] }
}

// Tasks as rows of a tree: each with its depth and how many steps it has.
export function treeRows(tasks: PlanTask[]): Array<{ task: PlanTask; depth: number; steps: number }> {
  const all = tasks.map(t => ({ ...t, id: t.key, parent: t.parent ?? null }))
  return treeOrder(all).map(({ item, depth }) => ({ task: tasks.find(t => t.key === item.id)!, depth, steps: subtreeOf(all, item.id).length - 1 }))
}

// ── Priorities: the learner's ─────────────────────────────────────────────────

// Nova's suggestion taken as their own priority, or set aside.
export function acceptSuggestion(plan: WorkspacePlan, key: string): WorkspacePlan {
  return { ...plan, tasks: plan.tasks.map(t => (t.key === key && t.suggestedPriority ? { ...t, priority: t.suggestedPriority, suggestedPriority: null, priorityReason: null } : t)) }
}
export function dismissSuggestion(plan: WorkspacePlan, key: string): WorkspacePlan {
  return { ...plan, tasks: plan.tasks.map(t => (t.key === key ? { ...t, suggestedPriority: null, priorityReason: null } : t)) }
}

// What waits on a task (its "after" names it).
export const waitingOn = (plan: WorkspacePlan, key: string): PlanTask[] => plan.tasks.filter(t => t.after === key)

// Which tasks a task may wait for: any other, except one already waiting
// (directly or not) on it, so an order never loops.
export function possibleAfter(plan: WorkspacePlan, key: string): PlanTask[] {
  const waitsOn = (k: string, seen = new Set<string>()): boolean => {
    const t = plan.tasks.find(x => x.key === k)
    if (!t?.after || seen.has(k)) return false
    if (t.after === key) return true
    seen.add(k)
    return waitsOn(t.after, seen)
  }
  return plan.tasks.filter(t => t.key !== key && !waitsOn(t.key))
}

// ── Milestones (phases) ───────────────────────────────────────────────────────

export function updatePhase(plan: WorkspacePlan, index: number, patch: Partial<PlanPhase>): WorkspacePlan {
  const before = plan.phases[index]
  if (!before) return plan
  const renamed = patch.name !== undefined && !same(patch.name, before.name)
  return {
    ...plan,
    phases: plan.phases.map((p, i) => (i === index ? { ...p, ...patch } : p)),
    // Its tasks move with it.
    tasks: renamed ? plan.tasks.map(t => (same(t.topic, before.name) ? { ...t, topic: patch.name! } : t)) : plan.tasks,
  }
}

export function addPhase(plan: WorkspacePlan, name: string): WorkspacePlan {
  const phase: PlanPhase = { name, subject: plan.subjects[0]?.name ?? null, weeks: null, hoursPerWeek: null, goals: [], exercises: [], project: null, completion: null, resources: [] }
  return { ...plan, phases: [...plan.phases, phase] }
}

// Its tasks stay, under no milestone.
export function removePhase(plan: WorkspacePlan, index: number): WorkspacePlan {
  const gone = plan.phases[index]
  if (!gone) return plan
  return { ...plan, phases: plan.phases.filter((_, i) => i !== index), tasks: plan.tasks.map(t => (same(t.topic, gone.name) ? { ...t, topic: null } : t)) }
}

export const reorderPhase = (plan: WorkspacePlan, index: number, by: -1 | 1): WorkspacePlan => ({ ...plan, phases: moveItem(plan.phases, index, index + by) })

// ── Subjects and topics ───────────────────────────────────────────────────────

export function renameSubject(plan: WorkspacePlan, index: number, name: string): WorkspacePlan {
  const before = plan.subjects[index]
  if (!before) return plan
  const refile = <T extends { subject: string | null }>(x: T): T => (same(x.subject, before.name) ? { ...x, subject: name } : x)
  return {
    ...plan,
    // The subjects inside it stay inside it.
    subjects: plan.subjects.map((s, i) => (i === index ? { ...s, name } : same(s.parent ?? null, before.name) ? { ...s, parent: name } : s)),
    tasks: plan.tasks.map(refile), phases: plan.phases.map(refile), notes: plan.notes.map(refile), dates: plan.dates.map(refile),
  }
}

export function addSubject(plan: WorkspacePlan, name: string): WorkspacePlan {
  const subject: PlanSubject = { name, topics: [] }
  return { ...plan, subjects: [...plan.subjects, subject] }
}

// What was filed under it stays, filed under nothing; the subjects inside it, on their own.
export function removeSubject(plan: WorkspacePlan, index: number): WorkspacePlan {
  const gone = plan.subjects[index]
  if (!gone) return plan
  const unfile = <T extends { subject: string | null }>(x: T): T => (same(x.subject, gone.name) ? { ...x, subject: null } : x)
  return {
    ...plan,
    subjects: plan.subjects.filter((_, i) => i !== index).map(s => (same(s.parent ?? null, gone.name) ? { ...s, parent: null } : s)),
    tasks: plan.tasks.map(unfile), phases: plan.phases.map(unfile), notes: plan.notes.map(unfile), dates: plan.dates.map(unfile),
  }
}

// The subjects one may go inside: not itself or one inside it, and never
// deeper than subjects go (the server checks the same).
export function parentChoices(plan: WorkspacePlan, index: number): string[] {
  const s = plan.subjects[index]
  if (!s) return []
  const nodes = plan.subjects.map(x => ({ id: x.name.toLowerCase(), parent: x.parent ? x.parent.toLowerCase() : null }))
  return plan.subjects.filter((x, i) => i !== index && canPlace(nodes, s.name.toLowerCase(), x.name.toLowerCase(), SUBJECT_DEPTH_MAX).ok).map(x => x.name)
}

// Puts a subject inside another of the plan's (null: on its own).
export function setSubjectParent(plan: WorkspacePlan, index: number, parent: string | null): WorkspacePlan {
  const s = plan.subjects[index]
  if (!s || (parent !== null && !parentChoices(plan, index).some(n => same(n, parent)))) return plan
  return { ...plan, subjects: plan.subjects.map((x, i) => (i === index ? { ...x, parent } : x)) }
}

export function addTopic(plan: WorkspacePlan, subjectIndex: number, name: string): WorkspacePlan {
  const s = plan.subjects[subjectIndex]
  if (!s || !name.trim() || s.topics.some(t => same(t.name, name.trim()))) return plan
  return { ...plan, subjects: plan.subjects.map((x, i) => (i === subjectIndex ? { ...x, topics: [...x.topics, { name: name.trim(), explanation: null, sources: [] }] } : x)) }
}

export function renameTopic(plan: WorkspacePlan, subjectIndex: number, topicIndex: number, name: string): WorkspacePlan {
  return { ...plan, subjects: plan.subjects.map((x, i) => (i === subjectIndex ? { ...x, topics: x.topics.map((t, k) => (k === topicIndex ? { ...t, name } : t)) } : x)) }
}

export function removeTopic(plan: WorkspacePlan, subjectIndex: number, topicIndex: number): WorkspacePlan {
  return { ...plan, subjects: plan.subjects.map((x, i) => (i === subjectIndex ? { ...x, topics: x.topics.filter((_, k) => k !== topicIndex) } : x)) }
}

// ── Dates and notes ───────────────────────────────────────────────────────────

export const updateDate = (plan: WorkspacePlan, index: number, patch: Partial<PlanDate>): WorkspacePlan =>
  ({ ...plan, dates: plan.dates.map((d, i) => (i === index ? { ...d, ...patch } : d)) })
export const removeDate = (plan: WorkspacePlan, index: number): WorkspacePlan => ({ ...plan, dates: plan.dates.filter((_, i) => i !== index) })
export function addDate(plan: WorkspacePlan, title: string, day: string): WorkspacePlan {
  const date: PlanDate = { title, day, kind: 'other', subject: plan.subjects[0]?.name ?? null }
  return { ...plan, dates: [...plan.dates, date] }
}

export const updateNote = (plan: WorkspacePlan, key: string, patch: Partial<Pick<PlanNote, 'title' | 'body'>>): WorkspacePlan =>
  ({ ...plan, notes: plan.notes.map(n => (n.key === key ? { ...n, ...patch } : n)) })
export const removeNote = (plan: WorkspacePlan, key: string): WorkspacePlan => ({ ...plan, notes: plan.notes.filter(n => n.key !== key) })

// ── Reading it back ───────────────────────────────────────────────────────────

// Tasks under each milestone, in the plan's order, then those under none.
// A step goes with its task, wherever its own topic says.
export function tasksByMilestone(plan: WorkspacePlan): Array<{ milestone: string | null; index: number | null; tasks: PlanTask[] }> {
  const rootOf = (t: PlanTask): PlanTask => { let at = t; for (let i = 0; at.parent && i < 12; i++) at = plan.tasks.find(x => x.key === at.parent) ?? at; return at }
  const groups = plan.phases.map((p, index) => ({ milestone: p.name as string | null, index: index as number | null, tasks: plan.tasks.filter(t => same(rootOf(t).topic, p.name)) }))
  const rest = plan.tasks.filter(t => !plan.phases.some(p => same(rootOf(t).topic, p.name)))
  return rest.length > 0 || groups.length === 0 ? [...groups, { milestone: null, index: null, tasks: rest }] : groups
}

// Everything with a day, soonest first: dates and tasks due.
export function timeline(plan: WorkspacePlan): Array<{ day: string; label: string; kind: 'date' | 'task'; ref: number | string }> {
  return [
    ...plan.dates.map((d, i) => ({ day: d.day, label: d.title, kind: 'date' as const, ref: i })),
    ...plan.tasks.filter(t => t.dueDay).map(t => ({ day: t.dueDay!, label: t.title, kind: 'task' as const, ref: t.key })),
  ].sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : a.kind === b.kind ? 0 : a.kind === 'date' ? -1 : 1))
}

// Which views the plan has something for. Overview always.
export type PlaygroundView = 'overview' | 'roadmap' | 'board' | 'topics' | 'timeline' | 'notes'
export function viewsFor(plan: WorkspacePlan | null): PlaygroundView[] {
  if (!plan) return ['overview']
  const out: PlaygroundView[] = ['overview']
  if (plan.phases.length > 0) out.push('roadmap')
  out.push('board')
  if (plan.subjects.length > 0) out.push('topics')
  out.push('timeline')
  if (plan.notes.length > 0 || plan.phases.length > 0) out.push('notes')
  return out
}
