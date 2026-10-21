// How Build with Nova words and draws a proposal, as pure functions the page
// and its tests share:
//
//   - wordsFor: the kind of work Nova read (brief.kind) picks the words the
//     playground uses, so a project is never shown "subjects" and a study
//     plan never "deliverables". Words only: every view and edit is the same.
//   - hintFor: per view, what the learner can ask Nova to change there, and
//     a start to the sentence. Only changes a revision can make (Nova
//     rewrites the proposal with the change asked for); nothing is sent.
//   - planDiff: which items of a proposal are new or changed since the
//     version before, so a new version shows what moved instead of flashing.
//   - messageBlocks: Nova's reply as paragraphs and lists, drawn as React
//     elements (nothing is ever treated as HTML).
// Run the tests with `npm test`.

import type { ChangeSet, DraftView, ProposedChange, WorkKind } from '@repo/api/nova/product/builder.types'
import type { WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import type { PlaygroundView } from './plan-edit'

export type Family = 'academic' | 'project' | 'skill' | 'work' | 'general'

export function familyOf(kind: WorkKind | null | undefined): Family {
  if (kind === 'exam' || kind === 'semester') return 'academic'
  if (kind === 'project') return 'project'
  if (kind === 'skill') return 'skill'
  if (kind === 'work' || kind === 'career') return 'work'
  return 'general'
}

export interface Words {
  views: Record<PlaygroundView, string>
  // The roadmap's items, one and many.
  phase: string
  phases: string
  // The topics view's groups and what is inside them.
  area: string
  areas: string
  topic: string
  topics: string
  // What Nova is doing while it writes a first version, and a new one.
  writing: string
  revising: string
}

const BASE: Words = {
  views: { overview: 'Overview', roadmap: 'Roadmap', board: 'Tasks', topics: 'Topics', timeline: 'Calendar', notes: 'Notes' },
  phase: 'milestone', phases: 'Milestones', area: 'area', areas: 'Areas', topic: 'topic', topics: 'Topics',
  writing: 'Laying out the proposal', revising: 'Updating your proposal',
}

const WORDS: Record<Family, Words> = {
  academic: {
    ...BASE, views: { ...BASE.views, roadmap: 'Phases', topics: 'Subjects' },
    phase: 'phase', phases: 'Phases', area: 'subject', areas: 'Subjects', topic: 'topic', topics: 'Topics',
    writing: 'Organising subjects, topics and revision', revising: 'Updating your study plan',
  },
  project: {
    ...BASE, views: { ...BASE.views, roadmap: 'Milestones', topics: 'Parts' },
    phase: 'milestone', phases: 'Milestones', area: 'area', areas: 'Parts of the project', topic: 'part', topics: 'Parts',
    writing: 'Laying out milestones and tasks', revising: 'Updating your task breakdown',
  },
  skill: {
    ...BASE, views: { ...BASE.views, roadmap: 'Stages', topics: 'Concepts' },
    phase: 'stage', phases: 'Stages', area: 'area', areas: 'Concepts', topic: 'concept', topics: 'Concepts',
    writing: 'Ordering stages, concepts and exercises', revising: 'Updating your learning path',
  },
  work: {
    ...BASE, views: { ...BASE.views, roadmap: 'Milestones', topics: 'Areas' },
    phase: 'milestone', phases: 'Milestones', area: 'area', areas: 'Areas of work', topic: 'item', topics: 'Areas',
    writing: 'Laying out deliverables and action items', revising: 'Updating your work plan',
  },
  general: BASE,
}

export const wordsFor = (kind: WorkKind | null | undefined): Words => WORDS[familyOf(kind)]

// What the learner can ask Nova to change in a view, and how the sentence
// starts when they click it.
export interface Hint { text: string; prefill: string }

const HINTS: Record<Family, Record<PlaygroundView, Hint>> = {
  academic: {
    overview: { text: 'Ask Nova to change the focus, the dates or how much time this takes.', prefill: 'Change the plan so ' },
    roadmap: { text: 'Ask Nova to add revision phases or change their order.', prefill: 'Change the phases: ' },
    board: { text: 'Ask Nova to add, reorder or reprioritise study tasks.', prefill: 'Add a study task: ' },
    topics: { text: 'Ask Nova to add topics or reorganise your syllabus.', prefill: 'Add these topics: ' },
    timeline: { text: 'Ask Nova to adjust exam dates or reschedule your revision.', prefill: 'Reschedule ' },
    notes: { text: 'Ask Nova to expand, summarise or reorganise these notes.', prefill: 'In the notes, ' },
  },
  project: {
    overview: { text: 'Ask Nova to change the scope, the deadline or what comes first.', prefill: 'Change the scope so ' },
    roadmap: { text: 'Ask Nova to change milestones or update your direction.', prefill: 'Change the milestones: ' },
    board: { text: 'Ask Nova to add, split, reorder or reprioritise tasks.', prefill: 'Add a task: ' },
    topics: { text: 'Ask Nova to add or regroup the parts of the project.', prefill: 'Add a part: ' },
    timeline: { text: 'Ask Nova to adjust deadlines or reschedule milestones.', prefill: 'Move the deadline for ' },
    notes: { text: 'Ask Nova to expand, summarise or reorganise these notes.', prefill: 'In the notes, ' },
  },
  skill: {
    overview: { text: 'Ask Nova to change the goal, your level or the time you have.', prefill: 'Change the plan so ' },
    roadmap: { text: 'Ask Nova to change stages or add a practice project.', prefill: 'Change the stages: ' },
    board: { text: 'Ask Nova to add exercises or reorder what to learn first.', prefill: 'Add an exercise: ' },
    topics: { text: 'Ask Nova to add concepts or change their order.', prefill: 'Add these concepts: ' },
    timeline: { text: 'Ask Nova to set target dates or reschedule stages.', prefill: 'Set a target date for ' },
    notes: { text: 'Ask Nova to expand, summarise or reorganise these notes.', prefill: 'In the notes, ' },
  },
  work: {
    overview: { text: 'Ask Nova to change the outcome, the deadline or the priorities.', prefill: 'Change the plan so ' },
    roadmap: { text: 'Ask Nova to change milestones or deliverables.', prefill: 'Change the milestones: ' },
    board: { text: 'Ask Nova to add action items or change priorities.', prefill: 'Add an action item: ' },
    topics: { text: 'Ask Nova to add or regroup areas of work.', prefill: 'Add an area: ' },
    timeline: { text: 'Ask Nova to adjust deadlines or reschedule deliverables.', prefill: 'Move the deadline for ' },
    notes: { text: 'Ask Nova to expand, summarise or reorganise these notes.', prefill: 'In the notes, ' },
  },
  general: {
    overview: { text: 'Ask Nova to change the goal, the dates or the scope.', prefill: 'Change the plan so ' },
    roadmap: { text: 'Ask Nova to change milestones or their order.', prefill: 'Change the milestones: ' },
    board: { text: 'Ask Nova to add, reorder or reprioritise tasks.', prefill: 'Add a task: ' },
    topics: { text: 'Ask Nova to add topics or regroup them.', prefill: 'Add these topics: ' },
    timeline: { text: 'Ask Nova to adjust deadlines or reschedule the plan.', prefill: 'Reschedule ' },
    notes: { text: 'Ask Nova to expand, summarise or reorganise these notes.', prefill: 'In the notes, ' },
  },
}

export const hintFor = (kind: WorkKind | null | undefined, view: PlaygroundView): Hint => HINTS[familyOf(kind)][view]

// ── What changed between two versions ─────────────────────────────────────────

export interface PlanDiff {
  // Every item, when there was no proposal before (the first version).
  fresh: Set<string>
  changed: Set<string>
  removed: string[]
}

const low = (s: string) => s.trim().toLocaleLowerCase()
export const ids = {
  phase: (name: string) => `phase:${low(name)}`,
  task: (key: string) => `task:${key}`,
  subject: (name: string) => `subject:${low(name)}`,
  topic: (subject: string, name: string) => `topic:${low(subject)}/${low(name)}`,
  note: (key: string) => `note:${key}`,
  date: (title: string) => `date:${low(title)}`,
}

// Each item of a plan by its id, with what makes it "the same" and its name.
function itemsOf(plan: WorkspacePlan): Map<string, { sig: string; name: string }> {
  const out = new Map<string, { sig: string; name: string }>()
  for (const p of plan.phases) out.set(ids.phase(p.name), { sig: JSON.stringify([p.goals, p.completion, p.weeks, p.hoursPerWeek, p.project]), name: p.name })
  for (const t of plan.tasks) out.set(ids.task(t.key), { sig: JSON.stringify([t.title, t.priority, t.dueDay, t.topic, t.after, t.estimatedMinutes]), name: t.title })
  for (const s of plan.subjects) {
    out.set(ids.subject(s.name), { sig: '', name: s.name })
    for (const t of s.topics) out.set(ids.topic(s.name, t.name), { sig: t.explanation ?? '', name: t.name })
  }
  for (const n of plan.notes) out.set(ids.note(n.key), { sig: JSON.stringify([n.title, n.body]), name: n.title })
  for (const d of plan.dates) out.set(ids.date(d.title), { sig: d.day, name: d.title })
  return out
}

export function planDiff(before: WorkspacePlan | null, after: WorkspacePlan): PlanDiff {
  const next = itemsOf(after)
  if (!before) return { fresh: new Set(next.keys()), changed: new Set(), removed: [] }
  const prev = itemsOf(before)
  const fresh = new Set<string>(), changed = new Set<string>()
  for (const [id, item] of next) {
    const was = prev.get(id)
    if (!was) fresh.add(id)
    else if (was.sig !== item.sig) changed.add(id)
  }
  const removed = [...prev].filter(([id]) => !next.has(id)).map(([, item]) => item.name)
  return { fresh, changed, removed }
}

// In words, for the line above a new version: "3 new, 1 changed, 2 removed".
export function diffSummary(d: PlanDiff): string | null {
  const parts = [d.fresh.size && `${d.fresh.size} new`, d.changed.size && `${d.changed.size} changed`, d.removed.length && `${d.removed.length} removed`].filter(Boolean)
  return parts.length ? parts.join(', ') : null
}

// ── Nova's words as blocks ────────────────────────────────────────────────────

export type Inline = { text: string; strong: boolean }
export type Block =
  | { type: 'p'; lines: Inline[][] }
  | { type: 'ul' | 'ol'; items: Inline[][] }

// **bold** spans; an unmatched ** is kept as written.
export function inlines(text: string): Inline[] {
  const parts = text.split('**')
  if (parts.length < 3 || parts.length % 2 === 0) return [{ text, strong: false }]
  return parts.map((t, i) => ({ text: t, strong: i % 2 === 1 })).filter(p => p.text !== '')
}

function listItem(line: string): { type: 'ul' | 'ol'; text: string } | null {
  const t = line.trimStart()
  if (t.startsWith('- ') || t.startsWith('• ') || t.startsWith('* ')) return { type: 'ul', text: t.slice(2).trim() }
  let i = 0
  while (i < t.length && i < 3 && t[i]! >= '0' && t[i]! <= '9') i++
  if (i > 0 && (t[i] === '.' || t[i] === ')') && t[i + 1] === ' ') return { type: 'ol', text: t.slice(i + 2).trim() }
  return null
}

export function messageBlocks(text: string): Block[] {
  const blocks: Block[] = []
  for (const raw of text.split('\n')) {
    const line = raw.trimEnd()
    const last = blocks[blocks.length - 1]
    if (!line.trim()) { blocks.push({ type: 'p', lines: [] }); continue }
    const item = listItem(line)
    if (item) {
      if (last && last.type === item.type) last.items.push(inlines(item.text))
      else blocks.push({ type: item.type, items: [inlines(item.text)] })
    } else if (last && last.type === 'p' && last.lines.length > 0) last.lines.push(inlines(line.trim()))
    else blocks.push({ type: 'p', lines: [inlines(line.trim())] })
  }
  return blocks.filter(b => (b.type === 'p' ? b.lines.length > 0 : b.items.length > 0))
}

// ── After approval: the Knowledge Map ─────────────────────────────────────────

// Where the learner sees what was built or changed: each subject of it on the
// Knowledge Map, focused there (the map shows it and what is around it). Only
// once it is stored (status ready, read back from the records): never before.
// One subject is the obvious place to go; several are offered to choose from.
// `touched`: the subjects an approved change set changed (touchedSubjects,
// taken before approval), which is where those changes are to be seen.
export function mapDestinations(draft: Pick<DraftView, 'status' | 'current'> | null, touched: string[] = []): Array<{ label: string; href: string }> {
  if (!draft || draft.status !== 'ready' || !draft.current) return []
  const changed = draft.current.subjects.filter(s => touched.includes(s.id))
  return (changed.length ? changed : draft.current.subjects).map(s => ({ label: s.name, href: `/map?focus=${encodeURIComponent(`subject:${s.id}`)}` }))
}

// The subjects a proposed change set changes, by id, found from its records.
export function touchedSubjects(draft: Pick<DraftView, 'changes' | 'current'> | null): string[] {
  if (!draft?.changes || !draft.current) return []
  const c = draft.current
  const out = new Set<string>()
  const topicSubject = (topicId: string) => c.subjects.find(s => s.topics.some(t => t.id === topicId))?.id
  for (const o of draft.changes.ops) {
    const id = o.op === 'add_topics' ? o.subjectId
      : o.op === 'rename_topic' || o.op === 'remove_topic' ? topicSubject(o.topicId)
      : o.op === 'add_task' || o.op === 'add_note' || o.op === 'add_date' ? o.subjectId
      : o.op === 'update_task' || o.op === 'remove_task' ? c.tasks.find(t => t.id === o.taskId)?.subjectId
      : o.op === 'update_date' ? c.dates.find(d => d.id === o.dateId)?.subjectId : null
    if (id) out.add(id)
  }
  return [...out]
}

// ── Proposed changes, drawn on the records they change ────────────────────────

export interface ChangeMarks {
  addedTopics: Map<string, string[]>          // subject id → names
  renamedTopics: Map<string, string>          // topic id → new name
  removedTopics: Set<string>
  addedTasks: Array<Extract<ProposedChange, { op: 'add_task' }>>
  changedTasks: Map<string, string>           // task id → what changes, in words
  removedTasks: Set<string>
  firstTasks: string[]                        // task ids put first, in order
  movedDates: Map<string, string>             // date id → new day
  addedDates: Array<Extract<ProposedChange, { op: 'add_date' }>>
  addedNotes: Array<Extract<ProposedChange, { op: 'add_note' }>>
  addedSubjects: Array<Extract<ProposedChange, { op: 'add_subject' }>>
}

export function changeMarks(set: ChangeSet | null): ChangeMarks {
  const m: ChangeMarks = {
    addedTopics: new Map(), renamedTopics: new Map(), removedTopics: new Set(), addedTasks: [], changedTasks: new Map(), removedTasks: new Set(),
    firstTasks: [], movedDates: new Map(), addedDates: [], addedNotes: [], addedSubjects: [],
  }
  for (const o of set?.ops ?? []) {
    switch (o.op) {
      case 'add_topics': m.addedTopics.set(o.subjectId, [...(m.addedTopics.get(o.subjectId) ?? []), ...o.names]); break
      case 'rename_topic': m.renamedTopics.set(o.topicId, o.name); break
      case 'remove_topic': m.removedTopics.add(o.topicId); break
      case 'add_task': m.addedTasks.push(o); break
      case 'update_task': m.changedTasks.set(o.taskId, [o.title !== undefined ? `"${o.title}"` : null, o.dueDay !== undefined ? (o.dueDay ? `due ${o.dueDay}` : 'no due day') : null, o.priority !== undefined ? (o.priority ? `${o.priority} priority` : 'no priority') : null].filter(Boolean).join(', ')); break
      case 'remove_task': m.removedTasks.add(o.taskId); break
      case 'order_tasks': m.firstTasks = o.taskIds; break
      case 'add_date': m.addedDates.push(o); break
      case 'update_date': if (o.day) m.movedDates.set(o.dateId, o.day); break
      case 'add_note': m.addedNotes.push(o); break
      case 'add_subject': m.addedSubjects.push(o); break
    }
  }
  return m
}
