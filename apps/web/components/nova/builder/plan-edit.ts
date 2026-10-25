// Edits the learner makes to a proposal in the playground, as pure
// functions over the WorkspacePlan. Each keeps the plan's own references
// whole: renaming a milestone moves its tasks with it, renaming a subject
// re-files what was under it, removing a task clears what waited for it.
// The server checks the result again (checkWorkspacePlan); nothing here is
// trusted. Run the tests with `npm test`.

import { planPreview, type PlanDate, type PlanNote, type PlanPhase, type PlanPriority, type PlanSubject, type PlanTask, type WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import { TASK_DEPTH_MAX, ancestorsOf, descendantsOf, treeOrder, wouldLoop } from '@repo/api/nova/product/task-tree'

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
    topic: phase?.name ?? null, dueDay: null, estimatedMinutes: null, after: null,
  }
  return { ...plan, tasks: [...plan.tasks, task] }
}

// ── Steps (tasks inside tasks; task-tree.ts holds the rules) ──────────────────

const treeOf = (plan: WorkspacePlan) => plan.tasks.map(t => ({ key: t.key, parent: t.parent ?? null }))
export const stepsOf = (plan: WorkspacePlan, key: string): PlanTask[] => plan.tasks.filter(t => (t.parent ?? null) === key)
export const allStepsOf = (plan: WorkspacePlan, key: string): string[] => descendantsOf(treeOf(plan), key)
export const depthIn = (plan: WorkspacePlan, key: string): number => ancestorsOf(treeOf(plan), key).length
// How many levels a task and its steps take (1: none).
const heightOf = (plan: WorkspacePlan, key: string) => 1 + Math.max(0, ...allStepsOf(plan, key).map(k => depthIn(plan, k) - depthIn(plan, key)))

// A step of `parent`, filed where it is, after its last step.
export function addStep(plan: WorkspacePlan, parentKey: string, title: string): WorkspacePlan {
  const parent = plan.tasks.find(t => t.key === parentKey)
  if (!parent || depthIn(plan, parentKey) + 2 > TASK_DEPTH_MAX) return plan
  const step: PlanTask = { key: newTaskKey(plan), title, priority: null, subject: parent.subject, topic: parent.topic, dueDay: null, estimatedMinutes: null, after: null, parent: parentKey }
  // In the list right after the parent's last step (at any depth), so it reads in place.
  const inside = [parentKey, ...allStepsOf(plan, parentKey)]
  const at = Math.max(...inside.map(k => plan.tasks.findIndex(t => t.key === k))) + 1
  return { ...plan, tasks: [...plan.tasks.slice(0, at), step, ...plan.tasks.slice(at)] }
}

// The siblings of a task, in the order they read.
function siblingsOf(plan: WorkspacePlan, key: string): PlanTask[] {
  const t = plan.tasks.find(x => x.key === key)
  if (!t) return []
  const parent = t.parent ?? null
  // Top-level tasks are siblings within their milestone.
  return plan.tasks.filter(x => (x.parent ?? null) === parent && (parent !== null || same(x.topic, t.topic) || (x.topic == null && t.topic == null)))
}

// Indent: becomes a step of the sibling above it (with its own steps).
export function canIndent(plan: WorkspacePlan, key: string): boolean {
  const sib = siblingsOf(plan, key)
  const i = sib.findIndex(t => t.key === key)
  return i > 0 && depthIn(plan, sib[i - 1]!.key) + 1 + heightOf(plan, key) <= TASK_DEPTH_MAX
}
export function indentTask(plan: WorkspacePlan, key: string): WorkspacePlan {
  if (!canIndent(plan, key)) return plan
  const sib = siblingsOf(plan, key)
  const above = sib[sib.findIndex(t => t.key === key) - 1]!
  return moveUnder(plan, key, above.key)
}

// Outdent: leaves its parent and sits right after it, a sibling of it.
export const canOutdent = (plan: WorkspacePlan, key: string): boolean => Boolean(plan.tasks.find(t => t.key === key)?.parent)
export function outdentTask(plan: WorkspacePlan, key: string): WorkspacePlan {
  const t = plan.tasks.find(x => x.key === key)
  const parent = t?.parent ? plan.tasks.find(x => x.key === t.parent) : null
  if (!t || !parent) return plan
  const moved = plan.tasks.map(x => (x.key === key ? { ...x, parent: parent.parent ?? null, topic: parent.topic, subject: parent.subject } : x))
  // Placed after the parent's whole block.
  const block = new Set([key, ...descendantsOf(moved.map(x => ({ key: x.key, parent: x.parent ?? null })), key)])
  const rest = moved.filter(x => !block.has(x.key))
  const mine = moved.filter(x => block.has(x.key))
  const parentBlock = [parent.key, ...descendantsOf(rest.map(x => ({ key: x.key, parent: x.parent ?? null })), parent.key)]
  const at = Math.max(...parentBlock.map(k => rest.findIndex(x => x.key === k))) + 1
  return { ...plan, tasks: [...rest.slice(0, at), ...mine, ...rest.slice(at)] }
}

// Moves a task (with its steps) under another task, as its last step. A move
// into its own steps, or past the depth limit, changes nothing.
export function moveUnder(plan: WorkspacePlan, key: string, parentKey: string | null): WorkspacePlan {
  const tree = treeOf(plan)
  if (wouldLoop(tree, key, parentKey)) return plan
  if (parentKey !== null && ancestorsOf(tree, parentKey).length + 1 + heightOf(plan, key) > TASK_DEPTH_MAX) return plan
  const parent = parentKey ? plan.tasks.find(t => t.key === parentKey) : null
  const block = new Set([key, ...allStepsOf(plan, key)])
  const moved = plan.tasks.map(t => (t.key === key ? { ...t, parent: parentKey } : block.has(t.key) ? t : t))
    // A task and its steps follow their new parent's milestone and subject.
    .map(t => (block.has(t.key) && parent ? { ...t, topic: parent.topic, subject: parent.subject } : t))
  const rest = moved.filter(t => !block.has(t.key))
  const mine = moved.filter(t => block.has(t.key))
  if (!parentKey) return { ...plan, tasks: [...rest, ...mine] }
  const target = [parentKey, ...descendantsOf(rest.map(x => ({ key: x.key, parent: x.parent ?? null })), parentKey)]
  const at = Math.max(...target.map(k => rest.findIndex(x => x.key === k))) + 1
  return { ...plan, tasks: [...rest.slice(0, at), ...mine, ...rest.slice(at)] }
}

// Up or down among its siblings, taking its steps with it.
export function reorderTask(plan: WorkspacePlan, key: string, by: -1 | 1): WorkspacePlan {
  const sib = siblingsOf(plan, key)
  const i = sib.findIndex(t => t.key === key)
  const other = sib[i + by]
  if (!other) return plan
  const blockOf = (k: string) => [k, ...allStepsOf(plan, k)]
  const first = by === -1 ? other.key : key, second = by === -1 ? key : other.key
  const a = blockOf(first), b = blockOf(second)
  const all = new Set([...a, ...b])
  const start = Math.min(...[...all].map(k => plan.tasks.findIndex(t => t.key === k)))
  const rest = plan.tasks.filter(t => !all.has(t.key))
  const pick = (keys: string[]) => plan.tasks.filter(t => keys.includes(t.key))
  const at = plan.tasks.slice(0, start).filter(t => !all.has(t.key)).length
  return { ...plan, tasks: [...rest.slice(0, at), ...pick(b), ...pick(a), ...rest.slice(at)] }
}
export const canMove = (plan: WorkspacePlan, key: string, by: -1 | 1): boolean => {
  const sib = siblingsOf(plan, key)
  const i = sib.findIndex(t => t.key === key)
  return i >= 0 && Boolean(sib[i + by])
}

// Removing a task: with its steps (`withSteps`), or its steps move up to
// where it was. Whatever waited for a removed task waits for nothing.
export function removeTask(plan: WorkspacePlan, key: string, opts: { withSteps?: boolean } = {}): WorkspacePlan {
  const t = plan.tasks.find(x => x.key === key)
  if (!t) return plan
  const gone = new Set(opts.withSteps ? [key, ...allStepsOf(plan, key)] : [key])
  return {
    ...plan,
    tasks: plan.tasks.filter(x => !gone.has(x.key)).map(x => ({
      ...x,
      ...(x.after && gone.has(x.after) ? { after: null } : {}),
      ...(x.parent === key ? { parent: t.parent ?? null } : {}),
    })),
  }
}

// ── Priorities: the learner's; Nova's only suggests ───────────────────────────

export function setPriority(plan: WorkspacePlan, key: string, priority: PlanPriority | null): WorkspacePlan {
  return updateTask(plan, key, { priority })
}

// Takes Nova's suggestion as the learner's priority, for these tasks (a
// milestone's, or all), where one is suggested and none is set.
export function acceptSuggestions(plan: WorkspacePlan, keys?: readonly string[]): WorkspacePlan {
  const pick = keys ? new Set(keys) : null
  return { ...plan, tasks: plan.tasks.map(t => ((!pick || pick.has(t.key)) && !t.priority && t.suggestedPriority ? { ...t, priority: t.suggestedPriority } : t)) }
}

// Leaves Nova's suggestions out: nothing is set, and no suggestion shows.
export function clearSuggestions(plan: WorkspacePlan, keys?: readonly string[]): WorkspacePlan {
  const pick = keys ? new Set(keys) : null
  return { ...plan, tasks: plan.tasks.map(t => ((!pick || pick.has(t.key)) && t.suggestedPriority ? { ...t, suggestedPriority: null, priorityReason: null } : t)) }
}

export const suggestionsOpen = (plan: WorkspacePlan, keys?: readonly string[]): number =>
  plan.tasks.filter(t => (!keys || keys.includes(t.key)) && !t.priority && t.suggestedPriority).length

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
    subjects: plan.subjects.map((s, i) => (i === index ? { ...s, name } : s)),
    tasks: plan.tasks.map(refile), phases: plan.phases.map(refile), notes: plan.notes.map(refile), dates: plan.dates.map(refile),
  }
}

export function addSubject(plan: WorkspacePlan, name: string): WorkspacePlan {
  const subject: PlanSubject = { name, topics: [] }
  return { ...plan, subjects: [...plan.subjects, subject] }
}

// What was filed under it stays, filed under nothing.
export function removeSubject(plan: WorkspacePlan, index: number): WorkspacePlan {
  const gone = plan.subjects[index]
  if (!gone) return plan
  const unfile = <T extends { subject: string | null }>(x: T): T => (same(x.subject, gone.name) ? { ...x, subject: null } : x)
  return {
    ...plan,
    subjects: plan.subjects.filter((_, i) => i !== index),
    tasks: plan.tasks.map(unfile), phases: plan.phases.map(unfile), notes: plan.notes.map(unfile), dates: plan.dates.map(unfile),
  }
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

// Tasks under each milestone, in reading order (each task followed by its
// steps, with their depth), then those under none. A step goes with its
// task's group whatever its own topic says.
export type TaskRow = { task: PlanTask; depth: number }
export function tasksByMilestone(plan: WorkspacePlan): Array<{ milestone: string | null; index: number | null; tasks: PlanTask[]; rows: TaskRow[] }> {
  const rows = treeOrder(plan.tasks.map(t => ({ ...t, parent: t.parent ?? null }))).map(r => ({ task: r.item as PlanTask, depth: r.depth }))
  // Each row's group: its top-level task's milestone.
  let root: PlanTask | null = null
  const grouped = rows.map(r => { if (r.depth === 0) root = r.task; return { ...r, root: root! } })
  const groupOf = (topic: string | null) => plan.phases.findIndex(p => same(topic, p.name))
  const groups = plan.phases.map((p, index) => {
    const mine = grouped.filter(r => groupOf(r.root.topic) === index)
    return { milestone: p.name as string | null, index: index as number | null, tasks: mine.map(r => r.task), rows: mine.map(({ task, depth }) => ({ task, depth })) }
  })
  const rest = grouped.filter(r => groupOf(r.root.topic) === -1)
  const other = { milestone: null, index: null, tasks: rest.map(r => r.task), rows: rest.map(({ task, depth }) => ({ task, depth })) }
  return rest.length > 0 || groups.length === 0 ? [...groups, other] : groups
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
  // The notes Kivo writes from the plan count: they are made too.
  if (plan.notes.length > 0 || planPreview(plan).written.length > 0) out.push('notes')
  return out
}
