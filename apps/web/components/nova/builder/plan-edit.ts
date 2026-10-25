// Edits the learner makes to a proposal in the playground, as pure
// functions over the WorkspacePlan. Each keeps the plan's own references
// whole: renaming a milestone or a topic moves its tasks and the topics
// inside it with it, renaming a subject re-files what was under it,
// removing a task clears what waited for it. Milestones are topics of kind
// "milestone" (workspace-plan.ts); topics nest and keep an order.
// The server checks the result again (checkWorkspacePlan); nothing here is
// trusted. Run the tests with `npm test`.

import type { MilestoneDetails, PlanDate, PlanNote, PlanSubject, PlanTask, PlanTopic, WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import { milestonesOf } from '@repo/api/nova/product/workspace-plan'
import { canPlace, subtreeOf, treeOrder, wouldLoop } from '@repo/api/nova/product/task-tree'
import { SUBJECT_DEPTH_MAX } from '@repo/api/nova/product/setup-edit.types'
import { TOPIC_DEPTH_MAX } from '@repo/api/nova/product/topic-tree'

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
  const phase = milestone ? milestones(plan).find(p => same(p.name, milestone)) : null
  const task: PlanTask = {
    key: newTaskKey(plan), title, priority: null, subject: phase?.subject ?? plan.subjects[0]?.name ?? null,
    topic: phase?.name ?? null, dueDay: null, estimatedMinutes: null, after: [], parent: null,
  }
  return { ...plan, tasks: [...plan.tasks, task] }
}

// ── Steps (product/task-tree.ts holds the rules) ──────────────────────────────

const nodes = (plan: WorkspacePlan) => plan.tasks.map(t => ({ id: t.key, parent: t.parent ?? null }))

// A step under a task, after its last step, filed where its task is.
export function addStep(plan: WorkspacePlan, parentKey: string, title: string): WorkspacePlan {
  const parent = plan.tasks.find(t => t.key === parentKey)
  if (!parent || !canPlace([...nodes(plan), { id: '+new', parent: null }], '+new', parentKey).ok) return plan
  const step: PlanTask = { key: newTaskKey(plan), title, priority: null, subject: parent.subject, topic: parent.topic, dueDay: null, estimatedMinutes: null, after: [], parent: parentKey }
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
  return { ...plan, tasks: plan.tasks.filter(t => !going.has(t.key)).map(t => (t.after?.some(a => going.has(a)) ? { ...t, after: t.after.filter(a => !going.has(a)) } : t)) }
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
export const waitingOn = (plan: WorkspacePlan, key: string): PlanTask[] => plan.tasks.filter(t => t.after?.includes(key))

const waitsOf = (plan: WorkspacePlan) => plan.tasks.flatMap(t => (t.after ?? []).map(on => ({ task: t.key, on })))

// Which tasks a task may wait for: any other, except one already waiting
// (directly or not) on it, so waits never go round in a circle.
export function possibleAfter(plan: WorkspacePlan, key: string): PlanTask[] {
  const waits = waitsOf(plan)
  return plan.tasks.filter(t => t.key !== key && !wouldLoop(waits.filter(w => !(w.task === key && w.on === t.key)), key, t.key))
}

// Waits on `on` too, or no longer: a task may wait on several.
export function toggleWait(plan: WorkspacePlan, key: string, on: string): WorkspacePlan {
  const t = plan.tasks.find(x => x.key === key)
  if (!t) return plan
  const has = (t.after ?? []).includes(on)
  if (!has && !possibleAfter(plan, key).some(x => x.key === on)) return plan
  return updateTask(plan, key, { after: has ? (t.after ?? []).filter(a => a !== on) : [...(t.after ?? []), on] })
}

// ── Milestones: topics of kind milestone ──────────────────────────────────────

export interface Milestone extends MilestoneDetails { name: string; subject: string | null }
const NO_DETAILS: MilestoneDetails = { weeks: null, hoursPerWeek: null, goals: [], exercises: [], project: null, completion: null, resources: [] }

// The plan's milestones in order, each with its fields.
export function milestones(plan: WorkspacePlan): Milestone[] {
  return milestonesOf(plan).map(m => ({ ...NO_DETAILS, ...(m.topic.milestone ?? {}), name: m.topic.name, subject: m.subject }))
}

// A topic's subject and itself, by its subject's index and its own.
function withTopic(plan: WorkspacePlan, si: number, ti: number, change: (s: PlanSubject, t: PlanTopic) => { subject: PlanSubject; tasks?: PlanTask[] } | null): WorkspacePlan {
  const s = plan.subjects[si], t = s?.topics[ti]
  if (!s || !t) return plan
  const out = change(s, t)
  if (!out) return plan
  return { ...plan, subjects: plan.subjects.map((x, i) => (i === si ? out.subject : x)), ...(out.tasks ? { tasks: out.tasks } : {}) }
}

export function updatePhase(plan: WorkspacePlan, index: number, patch: Partial<Milestone>): WorkspacePlan {
  const m = milestonesOf(plan)[index]
  if (!m) return plan
  const { name, ...rest } = patch
  const details: Partial<MilestoneDetails> = { ...rest }
  delete (details as { subject?: unknown }).subject
  const renamed = name !== undefined && !same(name, m.topic.name)
  let next = withTopic(plan, m.subjectIndex, m.index, (s, t) => ({
    subject: { ...s, topics: s.topics.map(x => (x === t ? { ...t, milestone: { ...NO_DETAILS, ...(t.milestone ?? {}), ...details } } : x)) },
  }))
  if (renamed) next = renameTopic(next, m.subjectIndex, m.index, name!)
  return next
}

// At the end of the milestones of the first subject (one named after the
// plan when it has none), before its other topics.
export function addPhase(plan: WorkspacePlan, name: string): WorkspacePlan {
  const base = plan.subjects.length ? plan : { ...plan, subjects: [{ name: plan.title, topics: [] }] }
  const s = base.subjects[0]!
  if (!name.trim() || s.topics.some(t => same(t.name, name.trim()))) return plan
  const topic: PlanTopic = { name: name.trim(), explanation: null, sources: [], kind: 'milestone', milestone: { ...NO_DETAILS } }
  const last = s.topics.reduce((at, t, i) => (t.kind === 'milestone' && !t.parent ? i : at), -1)
  const topics = [...s.topics.slice(0, last + 1), topic, ...s.topics.slice(last + 1)]
  return { ...base, subjects: base.subjects.map((x, i) => (i === 0 ? { ...x, topics } : x)) }
}

// Its tasks stay, under no milestone; what was inside it moves up.
export function removePhase(plan: WorkspacePlan, index: number): WorkspacePlan {
  const m = milestonesOf(plan)[index]
  return m ? removeTopicOnly(plan, m.subjectIndex, m.index) : plan
}

// Before or after the milestone beside it in the same subject.
export function reorderPhase(plan: WorkspacePlan, index: number, by: -1 | 1): WorkspacePlan {
  const all = milestonesOf(plan)
  const a = all[index], b = all[index + by]
  if (!a || !b || a.subjectIndex !== b.subjectIndex) return plan
  return { ...plan, subjects: plan.subjects.map((s, i) => (i === a.subjectIndex ? { ...s, topics: moveItem(s.topics, a.index, b.index) } : s)) }
}

// ── Subjects and topics ───────────────────────────────────────────────────────

export function renameSubject(plan: WorkspacePlan, index: number, name: string): WorkspacePlan {
  const before = plan.subjects[index]
  if (!before) return plan
  const refile = <T extends { subject: string | null }>(x: T): T => (same(x.subject, before.name) ? { ...x, subject: name } : x)
  return {
    ...plan,
    // The subjects inside it stay inside it.
    subjects: plan.subjects.map((s, i) => (i === index ? { ...s, name } : same(s.parent ?? null, before.name) ? { ...s, parent: name } : s)),
    tasks: plan.tasks.map(refile), notes: plan.notes.map(refile), dates: plan.dates.map(refile),
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
    tasks: plan.tasks.map(t => (same(t.subject, gone.name) ? { ...t, subject: null, topic: null } : t)), notes: plan.notes.map(unfile), dates: plan.dates.map(unfile),
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

// Inside `parent` (a topic of the subject, by name), after the topics there;
// null: at the top. A subject holds a name once.
export function addTopic(plan: WorkspacePlan, subjectIndex: number, name: string, parent: string | null = null): WorkspacePlan {
  const s = plan.subjects[subjectIndex]
  if (!s || !name.trim() || s.topics.some(t => same(t.name, name.trim()))) return plan
  if (parent !== null && !s.topics.some(t => same(t.name, parent))) return plan
  const topic: PlanTopic = { name: name.trim(), explanation: null, sources: [], ...(parent ? { parent } : {}) }
  // After the last topic inside the parent (or the subject's last).
  const inside = parent ? topicSubtree(s, parent) : null
  const at = inside ? Math.max(...s.topics.map((t, i) => (inside.has(t.name.toLowerCase()) ? i : -1))) + 1 : s.topics.length
  return { ...plan, subjects: plan.subjects.map((x, i) => (i === subjectIndex ? { ...x, topics: [...x.topics.slice(0, at), topic, ...x.topics.slice(at)] } : x)) }
}

// A topic and everything inside it, by name in lower case.
function topicSubtree(s: PlanSubject, name: string): Set<string> {
  return new Set(subtreeOf(s.topics.map(t => ({ id: t.name.toLowerCase(), parent: t.parent ? t.parent.toLowerCase() : null })), name.toLowerCase()))
}

// Renamed, with the topics inside it and the tasks filed under it following.
export function renameTopic(plan: WorkspacePlan, subjectIndex: number, topicIndex: number, name: string): WorkspacePlan {
  return withTopic(plan, subjectIndex, topicIndex, (s, t) => {
    if (!name.trim()) return null
    const was = t.name
    return {
      subject: { ...s, topics: s.topics.map(x => (x === t ? { ...x, name } : same(x.parent ?? null, was) ? { ...x, parent: name } : x)) },
      tasks: plan.tasks.map(k => (same(k.topic, was) && (k.subject === null || same(k.subject, s.name)) ? { ...k, topic: name } : k)),
    }
  })
}

// With everything inside it; its tasks stay, filed under no topic.
export function removeTopic(plan: WorkspacePlan, subjectIndex: number, topicIndex: number): WorkspacePlan {
  return withTopic(plan, subjectIndex, topicIndex, (s, t) => {
    const going = topicSubtree(s, t.name)
    return {
      subject: { ...s, topics: s.topics.filter(x => !going.has(x.name.toLowerCase())) },
      tasks: plan.tasks.map(k => (k.topic && going.has(k.topic.toLowerCase()) && (k.subject === null || same(k.subject, s.name)) ? { ...k, topic: null } : k)),
    }
  })
}

// Only this topic: what was inside it moves up to where it was.
function removeTopicOnly(plan: WorkspacePlan, subjectIndex: number, topicIndex: number): WorkspacePlan {
  return withTopic(plan, subjectIndex, topicIndex, (s, t) => ({
    subject: { ...s, topics: s.topics.filter(x => x !== t).map(x => (same(x.parent ?? null, t.name) ? { ...x, parent: t.parent ?? null } : x)) },
    tasks: plan.tasks.map(k => (same(k.topic, t.name) ? { ...k, topic: null } : k)),
  }))
}

// The topics of a subject with topics inside them (lower case): they organise; the rest are studied.
export const parentNames = (s: PlanSubject): Set<string> => new Set(s.topics.filter(t => t.parent).map(t => t.parent!.toLowerCase()))

// The topics one may go inside: not itself or one inside it, never deeper than topics go.
export function topicParentChoices(plan: WorkspacePlan, subjectIndex: number, topicIndex: number): string[] {
  const s = plan.subjects[subjectIndex], t = s?.topics[topicIndex]
  if (!s || !t) return []
  const nodes = s.topics.map(x => ({ id: x.name.toLowerCase(), parent: x.parent ? x.parent.toLowerCase() : null }))
  return s.topics.filter(x => x !== t && canPlace(nodes, t.name.toLowerCase(), x.name.toLowerCase(), TOPIC_DEPTH_MAX).ok).map(x => x.name)
}

// Inside another topic of its subject (null: at the top), after the topics there.
export function setTopicParent(plan: WorkspacePlan, subjectIndex: number, topicIndex: number, parent: string | null): WorkspacePlan {
  return withTopic(plan, subjectIndex, topicIndex, (s, t) => {
    if (parent !== null && !topicParentChoices(plan, subjectIndex, topicIndex).some(n => same(n, parent))) return null
    const moved = { ...t, parent }
    const rest = s.topics.filter(x => x !== t)
    const inside = parent ? topicSubtree({ ...s, topics: rest }, parent) : null
    const at = inside ? Math.max(...rest.map((x, i) => (inside.has(x.name.toLowerCase()) ? i : -1))) + 1 : rest.length
    return { subject: { ...s, topics: [...rest.slice(0, at), moved, ...rest.slice(at)] } }
  })
}

// Up or down among the topics beside it (its own topics stay inside it).
export function reorderTopic(plan: WorkspacePlan, subjectIndex: number, topicIndex: number, by: -1 | 1): WorkspacePlan {
  return withTopic(plan, subjectIndex, topicIndex, (s, t) => {
    const siblings = s.topics.filter(x => same(x.parent ?? '', t.parent ?? '') || (!x.parent && !t.parent))
    const other = siblings[siblings.indexOf(t) + by]
    if (!other) return null
    return { subject: { ...s, topics: moveItem(s.topics, topicIndex, s.topics.indexOf(other)) } }
  })
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
  const phases = milestones(plan)
  const groups = phases.map((p, index) => ({ milestone: p.name as string | null, index: index as number | null, tasks: plan.tasks.filter(t => same(rootOf(t).topic, p.name)) }))
  const rest = plan.tasks.filter(t => !phases.some(p => same(rootOf(t).topic, p.name)))
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
  const phases = milestones(plan).length
  if (phases > 0) out.push('roadmap')
  out.push('board')
  if (plan.subjects.length > 0) out.push('topics')
  out.push('timeline')
  if (plan.notes.length > 0) out.push('notes')
  return out
}
