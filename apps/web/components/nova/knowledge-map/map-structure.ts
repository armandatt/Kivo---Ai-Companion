// Adding and deleting cards on the map, worked out before anything is sent.
// Pure: it says what the learner can add where, what a deletion would touch,
// and the exact requests each choice makes. The requests go to the routes
// that already own these records (Subject Studio's batch for subjects and
// topics, the task routes for tasks), which check everything again: the map
// never writes a record any other way, and an edit here is the same edit
// everywhere else that shows it.

import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { SUBJECT_NAME_MAX, TOPIC_NAME_MAX, type StudyEdit, type StudyStructure, type StudyTopic } from '@repo/api/nova/product/setup-edit.types'
import { TASK_TITLE_MAX, type TaskInput } from '@repo/api/nova/product/tasks.types'

export const rowId = (id: string) => id.slice(id.indexOf(':') + 1)
export const EXPLANATION_MAX = 600

// ── Adding ───────────────────────────────────────────────────────────────────

export type AddKind = 'topic_inside' | 'topic_beside' | 'subject_inside' | 'task_here' | 'step' | 'task_beside' | 'subject'

export interface AddChoice {
  kind:   AddKind
  label:  string
  // How the new card will stand to this one, in words.
  detail: string
  // What the name is of: a topic, a subject or a task.
  makes:  'topic' | 'subject' | 'task'
  // Something to know before adding (a studied topic that would gain topics).
  note?:  string
}

const quote = (s: string) => `“${s.length > 40 ? `${s.slice(0, 39).trimEnd()}…` : s}”`

// What can be added at a card. Only subjects, topics and tasks: notes and
// saved pages are made on their own pages.
export function addChoices(node: MapNode, nodes: readonly MapNode[]): AddChoice[] {
  if (node.type === 'subject') {
    return [
      { kind: 'topic_inside', makes: 'topic', label: 'Topic', detail: `At the top of ${quote(node.label)}, after its topics.` },
      { kind: 'subject_inside', makes: 'subject', label: 'Subject inside', detail: `A subject of its own, inside ${quote(node.label)}.` },
      { kind: 'task_here', makes: 'task', label: 'Task', detail: `A task filed under ${quote(node.label)}.` },
    ]
  }
  if (node.type === 'topic') {
    const parent = node.parentId ? nodes.find(n => n.id === `topic:${node.parentId}`) : undefined
    const studied = node.studied !== false && node.kind !== 'milestone' && node.sessions > 0
    return [
      { kind: 'topic_inside', makes: 'topic', label: 'Topic inside', detail: `Inside ${quote(node.label)}, after what is there.`,
        ...(studied ? { note: `${quote(node.label)} has study recorded. With a topic inside it, the topics inside are what gets studied; its history stays.` } : {}) },
      { kind: 'topic_beside', makes: 'topic', label: 'Topic beside', detail: parent ? `Next to it, inside ${quote(parent.label)}.` : `Next to it, at the top of ${quote(node.subjectName)}.` },
      { kind: 'task_here', makes: 'task', label: 'Task', detail: `A task filed under ${quote(node.label)}.` },
    ]
  }
  if (node.type === 'task') {
    const parent = node.parentId ? nodes.find(n => n.id === `task:${node.parentId}`) : undefined
    return [
      { kind: 'step', makes: 'task', label: 'Step', detail: `A step of ${quote(node.label)}.` },
      { kind: 'task_beside', makes: 'task', label: parent ? 'Step beside' : 'Task beside', detail: parent ? `Another step of ${quote(parent.label)}.` : node.topicName ? `Another task filed under ${quote(node.topicName)}.` : node.subjectName ? `Another task filed under ${quote(node.subjectName)}.` : 'Another task of its own.' },
    ]
  }
  return []
}

// A subject of its own, from the toolbar. A workspace's map draws only its
// own subjects, so one made there would not appear on it.
export const NEW_SUBJECT: AddChoice = { kind: 'subject', makes: 'subject', label: 'Subject', detail: 'A subject of its own.' }

const MAX: Record<AddChoice['makes'], number> = { topic: TOPIC_NAME_MAX, subject: SUBJECT_NAME_MAX, task: TASK_TITLE_MAX }

export const cleanName = (s: string) => s.split(/\s+/).filter(Boolean).join(' ')

export function checkName(choice: AddChoice, raw: string): string | null {
  const name = cleanName(raw)
  if (!name) return choice.makes === 'task' ? 'Give the task a title.' : `Give the ${choice.makes} a name.`
  if (name.length > MAX[choice.makes]) return `That is longer than ${MAX[choice.makes]} characters.`
  return null
}

export type AddRequest =
  | { route: 'study'; edits: StudyEdit[]; explanation: string | null; name: string; subjectId: string | null; parentId: string | null }
  | { route: 'task'; input: TaskInput }

// The request a choice makes. clientKey: one per open dialog, so a double
// click or a retry makes one task.
export function addRequest(choice: AddChoice, node: MapNode | null, rawName: string, rawExplanation: string, clientKey: string): AddRequest {
  const name = cleanName(rawName)
  const explanation = cleanName(rawExplanation).slice(0, EXPLANATION_MAX) || null
  const subjectId = node?.subjectId ?? null
  switch (choice.kind) {
    case 'subject':
      return { route: 'study', edits: [{ op: 'add_subject', name, topics: [] }], explanation: null, name, subjectId: null, parentId: null }
    case 'subject_inside':
      return { route: 'study', edits: [{ op: 'add_subject', name, topics: [], parentId: subjectId }], explanation: null, name, subjectId: null, parentId: null }
    case 'topic_inside': {
      const parentId = node?.type === 'topic' ? rowId(node.id) : null
      return { route: 'study', edits: [{ op: 'add_topics', subjectId: subjectId!, names: [name], parentId }], explanation, name, subjectId, parentId }
    }
    case 'topic_beside': {
      const parentId = node?.type === 'topic' ? node.parentId ?? null : null
      return { route: 'study', edits: [{ op: 'add_topics', subjectId: subjectId!, names: [name], parentId }], explanation, name, subjectId, parentId }
    }
    case 'task_here':
      return { route: 'task', input: { title: name, subjectId, ...(node?.type === 'topic' ? { topicName: node.label } : {}), clientKey } }
    case 'step':
      return { route: 'task', input: { title: name, parentId: node ? rowId(node.id) : null, clientKey } }
    case 'task_beside':
      return node?.type === 'task' && node.parentId
        ? { route: 'task', input: { title: name, parentId: node.parentId, clientKey } }
        : { route: 'task', input: { title: name, subjectId, topicName: node?.type === 'task' ? node.topicName : null, clientKey } }
  }
}

// The topic a study batch made: in the structure the server sent back, under
// that subject and parent, named as asked (the server may have added
// "(Parent)" to a name already taken there), and not there before.
export function madeTopic(before: StudyStructure | null, after: StudyStructure, req: Extract<AddRequest, { route: 'study' }>): StudyTopic | null {
  const old = new Set(before?.subjects.flatMap(s => s.topics.map(t => t.id)) ?? [])
  const subject = after.subjects.find(s => s.id === req.subjectId)
  const fresh = subject?.topics.filter(t => !old.has(t.id) && (t.parentId ?? null) === req.parentId) ?? []
  return fresh.find(t => t.name === req.name) ?? fresh.find(t => t.name.startsWith(req.name)) ?? null
}

export function madeSubject(before: StudyStructure | null, after: StudyStructure, name: string): string | null {
  const old = new Set(before?.subjects.map(s => s.id) ?? [])
  return after.subjects.find(s => !old.has(s.id) && s.name.toLowerCase() === name.toLowerCase())?.id ?? null
}

// ── Deleting ─────────────────────────────────────────────────────────────────
// What goes is always said before it goes. A card with cards inside it has
// two ways: only the card (what is inside moves up a level, or a task's steps
// become tasks of their own), chosen first; or the card and everything
// inside, which the learner has to tick before it can be confirmed. Nothing
// with recorded study is ever deleted: a studied topic can be archived, and
// keeps its history.

export type DeleteMode = 'only' | 'lift' | 'branch' | 'keep_steps' | 'with_steps'

export interface DeleteOption {
  mode:     DeleteMode
  label:    string
  detail:   string
  // Set when this way can't be taken, and why.
  blocked?: string
  // A way that takes more than the card: the learner ticks this first.
  confirm?: string
}

export type DeletePlan =
  | { ok: true; what: string; title: string; options: DeleteOption[]; stays: string[] }
  | { ok: false; what: string; title: string; why: string; archive?: { topicId: string }; href?: { to: string; label: string } }

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`

type Tree = { children: ReadonlyMap<string, readonly string[]> }

export function deletePlan(node: MapNode, edges: readonly MapEdge[], tree: Tree, structure: StudyStructure | null): DeletePlan {
  const title = node.label
  if (node.type === 'note' || node.type === 'resource') {
    const what = node.type === 'note' ? 'note' : 'saved page'
    return { ok: false, what, title, why: `A ${what} is deleted on its own page, where you can see what is in it.`, href: node.href ? { to: node.href, label: node.type === 'note' ? 'Open the note' : 'Open in Saved' } : undefined }
  }

  if (node.type === 'task') {
    const direct = (tree.children.get(node.id) ?? []).filter(c => c.startsWith('task:'))
    let all = 0
    const walk = (id: string) => { for (const c of tree.children.get(id) ?? []) if (c.startsWith('task:')) { all++; walk(c) } }
    walk(node.id)
    const waitingOnIt = edges.filter(e => e.kind === 'depends_on' && e.to === node.id).length
    const stays: string[] = []
    if (waitingOnIt) stays.push(`${count(waitingOnIt, 'task')} waiting on it will no longer wait for it.`)
    if (node.waitsOn) stays.push(`Its ${count(node.waitsOn, 'wait')} on other tasks go with it; those tasks stay.`)
    if (all === 0) return { ok: true, what: 'task', title, options: [{ mode: 'only', label: 'Delete this task', detail: 'Only this task.' }], stays }
    return {
      ok: true, what: 'task', title, stays,
      options: [
        { mode: 'keep_steps', label: 'Delete the task, keep its steps', detail: `Its ${count(direct.length, 'step')} become tasks of their own${all > direct.length ? ', with their own steps under them' : ''}.` },
        { mode: 'with_steps', label: 'Delete the task and its steps', detail: `The task and all ${count(all, 'step')} under it.`, confirm: `Also delete its ${count(all, 'step')}` },
      ],
    }
  }

  if (node.type === 'topic') {
    const s = structure?.subjects.find(x => x.id === node.subjectId)
    const t = s?.topics.find(x => x.id === rowId(node.id))
    if (!s || !t) return { ok: false, what: 'topic', title, why: 'This topic has changed since the map loaded. The map has been reloaded: try again.' }
    const inside: StudyTopic[] = []
    const walk = (id: string) => { for (const c of s.topics.filter(x => (x.parentId ?? null) === id)) { inside.push(c); walk(c.id) } }
    walk(t.id)
    const filed = [node.notes && count(node.notes, 'note'), node.resources && count(node.resources, 'saved page'), node.tasks?.length && count(node.tasks.length, 'task')].filter(Boolean)
    const stays = filed.length ? [`What is filed under it (${filed.join(', ')}) stays, under ${s.name}.`] : []
    if (t.hasHistory) {
      return inside.length === 0
        ? { ok: false, what: 'topic', title, why: 'This topic has recorded study, so deleting it would delete that record. Archive it instead: it leaves the map and every list, and its history stays. You can restore it in Subject Studio.', archive: { topicId: t.id } }
        : { ok: false, what: 'topic', title, why: 'This topic has recorded study, so it can’t be deleted. Its topics can be moved or deleted one by one.' }
    }
    if (inside.length === 0) return { ok: true, what: 'topic', title, stays, options: [{ mode: 'only', label: 'Delete this topic', detail: 'Only this topic.' }] }
    const direct = inside.filter(x => (x.parentId ?? null) === t.id)
    const parentName = t.parentId ? s.topics.find(x => x.id === t.parentId)?.name : null
    const studied = inside.filter(x => x.hasHistory)
    return {
      ok: true, what: 'topic', title, stays,
      options: [
        { mode: 'lift', label: 'Delete only this topic', detail: `The ${count(direct.length, 'topic')} inside it move up into ${parentName ? quote(parentName) : `the top of ${s.name}`}, in its place.` },
        { mode: 'branch', label: 'Delete the topic and everything inside', detail: `The topic and all ${count(inside.length, 'topic')} inside it.`, confirm: `Also delete the ${count(inside.length, 'topic')} inside it`,
          ...(studied.length ? { blocked: `${studied.slice(0, 3).map(x => `${quote(x.name)}${x.archived ? ' (archived)' : ''}`).join(', ')}${studied.length > 3 ? ` and ${studied.length - 3} more` : ''} ${studied.length === 1 ? 'has' : 'have'} recorded study, so this branch can’t be deleted whole.` } : {}) },
      ],
    }
  }

  // A subject.
  const s = structure?.subjects.find(x => x.id === node.subjectId)
  if (!s) return { ok: false, what: 'subject', title, why: 'This subject has changed since the map loaded. The map has been reloaded: try again.' }
  if (s.topics.length > 0 || s.dates > 0) {
    const has = [s.topics.length && count(s.topics.length, 'topic'), s.dates && count(s.dates, 'date')].filter(Boolean).join(' and ')
    return { ok: false, what: 'subject', title, why: `${s.name} still has ${has}. A subject is deleted once it is empty: delete or move ${s.topics.length ? 'its topics' : 'its dates'} first.`, href: { to: s.dates ? '/settings/study#exams' : '/knowledge', label: s.dates ? 'Open dates' : 'Edit subjects on Knowledge' } }
  }
  const inner = structure!.subjects.filter(x => x.parentId === s.id)
  const stays = [`Its notes, tasks and saved pages stay, filed under nothing.`]
  if (inner.length) stays.push(`${inner.map(x => quote(x.name)).join(', ')} ${inner.length === 1 ? 'stays as a subject' : 'stay as subjects'} of ${inner.length === 1 ? 'its' : 'their'} own.`)
  return { ok: true, what: 'subject', title, stays, options: [{ mode: 'only', label: 'Delete this subject', detail: 'Only the subject.' }] }
}

export type DeleteRequest =
  | { route: 'study'; edits: StudyEdit[] }
  | { route: 'task'; lift: string[]; remove: string }

// The requests a deletion makes. Topics deepest first, so each is empty when
// it goes; a lifted branch moves up in the deleted topic's place.
export function deleteRequest(node: MapNode, mode: DeleteMode, tree: Tree, structure: StudyStructure | null): DeleteRequest {
  if (node.type === 'task') {
    const direct = (tree.children.get(node.id) ?? []).filter(c => c.startsWith('task:')).map(rowId)
    return { route: 'task', lift: mode === 'keep_steps' ? direct : [], remove: rowId(node.id) }
  }
  if (node.type === 'subject') return { route: 'study', edits: [{ op: 'remove_subject', subjectId: node.subjectId! }] }
  const s = structure!.subjects.find(x => x.id === node.subjectId)!
  const id = rowId(node.id)
  const t = s.topics.find(x => x.id === id)!
  const kids = (p: string | null) => s.topics.filter(x => (x.parentId ?? null) === p)
  if (mode === 'lift') {
    const parent = t.parentId ?? null
    const at = kids(parent).findIndex(x => x.id === id)
    const moves: StudyEdit[] = kids(id).map((c, i) => ({ op: 'move_topic', topicId: c.id, parentId: parent, index: at + 1 + i }))
    return { route: 'study', edits: [...moves, { op: 'remove_topic', topicId: id }] }
  }
  const order: string[] = []
  const walk = (p: string) => { for (const c of kids(p)) { walk(c.id); order.push(c.id) } }
  if (mode === 'branch') walk(id)
  return { route: 'study', edits: [...order.map(topicId => ({ op: 'remove_topic' as const, topicId })), { op: 'remove_topic', topicId: id }] }
}
