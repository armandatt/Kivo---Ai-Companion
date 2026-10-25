// Adding and deleting cards on the map: what is offered, what each would
// touch, and the requests sent. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import type { StudyStructure } from '@repo/api/nova/product/setup-edit.types'
import { treeOf } from './layout'
import { NEW_SUBJECT, addChoices, addRequest, checkName, deletePlan, deleteRequest, madeTopic } from './map-structure'

const subject = (id: string, extra: Partial<MapNode> = {}): MapNode => ({ id: `subject:${id}`, type: 'subject', label: id, href: null, subjectId: id, topics: 0, notes: 0, resources: 0, ...extra } as MapNode)
const topic = (id: string, s: string, parentId?: string, extra: Record<string, unknown> = {}): MapNode => ({ id: `topic:${id}`, type: 'topic', label: id, href: null, subjectId: s, subjectName: s, sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0, ...(parentId ? { parentId } : {}), ...extra } as MapNode)
const task = (id: string, parentId?: string, extra: Record<string, unknown> = {}): MapNode => ({ id: `task:${id}`, type: 'task', label: id, href: null, subjectId: 'os', subjectName: 'os', topicName: 'unit1', status: 'todo', priority: null, dueDay: null, estimatedMinutes: null, order: 0, waitsOn: 0, ...(parentId ? { parentId } : {}), ...extra } as MapNode)
const edge = (from: string, to: string, kind: MapEdge['kind']): MapEdge => ({ id: `${from}>${to}`, from, to, kind })

// os › unit1 › (paging, segmentation); unit1 has task t › (t1 › t11, t2); w waits on t.
const nodes: MapNode[] = [subject('os'), topic('unit1', 'os', undefined, { notes: 2, tasks: [{ id: 't', title: 't', status: 'todo', parentId: null }] }), topic('paging', 'os', 'unit1', { sessions: 3 }), topic('segmentation', 'os', 'unit1'),
  task('t'), task('t1', 't'), task('t11', 't1'), task('t2', 't'), task('w', undefined, { waitsOn: 1 }), subject('empty')]
const edges: MapEdge[] = [
  edge('subject:os', 'topic:unit1', 'has_topic'), edge('topic:unit1', 'topic:paging', 'subtopic'), edge('topic:unit1', 'topic:segmentation', 'subtopic'),
  edge('topic:unit1', 'task:t', 'has_task'), edge('task:t', 'task:t1', 'step'), edge('task:t1', 'task:t11', 'step'), edge('task:t', 'task:t2', 'step'),
  edge('topic:unit1', 'task:w', 'has_task'), edge('task:w', 'task:t', 'depends_on'),
]
const tree = treeOf(nodes, edges)
const structure = (over: { pagingHistory?: boolean; segHistory?: boolean; unitHistory?: boolean } = {}): StudyStructure => ({
  version: 'v1',
  subjects: [
    { id: 'os', name: 'Operating Systems', dates: 0, topics: [
      { id: 'intro', name: 'Intro', hasHistory: false },
      { id: 'unit1', name: 'unit1', hasHistory: !!over.unitHistory },
      { id: 'paging', name: 'paging', parentId: 'unit1', hasHistory: !!over.pagingHistory },
      { id: 'segmentation', name: 'segmentation', parentId: 'unit1', hasHistory: !!over.segHistory },
      { id: 'later', name: 'Later', hasHistory: false },
    ] },
    { id: 'empty', name: 'Empty', dates: 0, topics: [] },
    { id: 'inner', name: 'Inner', parentId: 'empty', dates: 0, topics: [] },
  ],
})
const at = (id: string) => nodes.find(n => n.id === id)!

test('what can be added depends on the card, and only rectangles take children', () => {
  assert.deepEqual(addChoices(at('subject:os'), nodes).map(c => c.kind), ['topic_inside', 'subject_inside', 'task_here'])
  assert.deepEqual(addChoices(at('topic:unit1'), nodes).map(c => c.kind), ['topic_inside', 'topic_beside', 'task_here'])
  assert.deepEqual(addChoices(at('task:t'), nodes).map(c => c.kind), ['step', 'task_beside'])
  assert.equal(addChoices(at('task:t1'), nodes)[1]!.label, 'Step beside')
  assert.deepEqual(addChoices({ id: 'note:n', type: 'note', label: 'n', href: null, subjectId: null, subjectName: null, topicName: null, topicLinked: false, updatedAt: '' }, nodes), [])
  assert.ok(addChoices(at('topic:paging'), nodes)[0]!.note, 'a studied topic says what gaining a topic inside means')
  assert.equal(addChoices(at('topic:segmentation'), nodes)[0]!.note, undefined)
})

test('each choice makes the request of the route that owns it', () => {
  const [inside, beside, taskHere] = addChoices(at('topic:paging'), nodes)
  assert.deepEqual(addRequest(inside!, at('topic:paging'), '  TLB   misses ', 'Why a TLB miss is slow', 'k1'),
    { route: 'study', edits: [{ op: 'add_topics', subjectId: 'os', names: ['TLB misses'], parentId: 'paging' }], explanation: 'Why a TLB miss is slow', name: 'TLB misses', subjectId: 'os', parentId: 'paging' })
  assert.deepEqual((addRequest(beside!, at('topic:paging'), 'Thrashing', '', 'k1') as { edits: unknown }).edits, [{ op: 'add_topics', subjectId: 'os', names: ['Thrashing'], parentId: 'unit1' }])
  assert.deepEqual(addRequest(taskHere!, at('topic:paging'), 'Read ch. 8', '', 'k1'), { route: 'task', input: { title: 'Read ch. 8', subjectId: 'os', topicName: 'paging', clientKey: 'k1' } })
  const [step, besideStep] = addChoices(at('task:t1'), nodes)
  assert.deepEqual(addRequest(step!, at('task:t1'), 'x', '', 'k2'), { route: 'task', input: { title: 'x', parentId: 't1', clientKey: 'k2' } })
  assert.deepEqual(addRequest(besideStep!, at('task:t1'), 'y', '', 'k2'), { route: 'task', input: { title: 'y', parentId: 't', clientKey: 'k2' } })
  assert.deepEqual(addRequest(addChoices(at('subject:os'), nodes)[1]!, at('subject:os'), 'Kernels', '', 'k'), { route: 'study', edits: [{ op: 'add_subject', name: 'Kernels', topics: [], parentId: 'os' }], explanation: null, name: 'Kernels', subjectId: null, parentId: null })
  assert.deepEqual((addRequest(NEW_SUBJECT, null, 'DBMS', '', 'k') as { edits: unknown }).edits, [{ op: 'add_subject', name: 'DBMS', topics: [] }])
  assert.equal(checkName(NEW_SUBJECT, '   '), 'Give the subject a name.')
  assert.match(checkName(inside!, 'x'.repeat(121))!, /120/)
  assert.equal(checkName(inside!, 'Paging'), null)
})

test('the topic a batch made is found in what the server sent back, even renamed', () => {
  const before = structure()
  const after = structure()
  after.subjects[0]!.topics.push({ id: 'new1', name: 'paging (unit1)', parentId: 'unit1', hasHistory: false })
  const req = addRequest(addChoices(at('topic:unit1'), nodes)[0]!, at('topic:unit1'), 'paging', '', 'k') as Extract<ReturnType<typeof addRequest>, { route: 'study' }>
  assert.equal(madeTopic(before, after, req)?.id, 'new1')
  assert.equal(madeTopic(after, after, req), null)
})

test('a task with steps: keeping them is first; deleting them too must be ticked', () => {
  const plan = deletePlan(at('task:t'), edges, tree, null)
  assert.ok(plan.ok)
  assert.deepEqual(plan.options.map(o => [o.mode, !!o.confirm]), [['keep_steps', false], ['with_steps', true]])
  assert.match(plan.options[1]!.detail, /3 steps/)
  assert.ok(plan.stays.some(s => s.includes('1 task waiting on it')), 'what waits on it is said')
  assert.deepEqual(deleteRequest(at('task:t'), 'keep_steps', tree, null), { route: 'task', lift: ['t1', 't2'], remove: 't' })
  assert.deepEqual(deleteRequest(at('task:t'), 'with_steps', tree, null), { route: 'task', lift: [], remove: 't' })
  const leaf = deletePlan(at('task:t2'), edges, tree, null)
  assert.ok(leaf.ok && leaf.options.length === 1 && leaf.options[0]!.mode === 'only')
})

test('a topic with topics inside: only it by default (they move up in its place), or the branch, ticked', () => {
  const plan = deletePlan(at('topic:unit1'), edges, tree, structure())
  assert.ok(plan.ok)
  assert.deepEqual(plan.options.map(o => [o.mode, !!o.confirm, !!o.blocked]), [['lift', false, false], ['branch', true, false]])
  assert.ok(plan.stays[0]!.includes('2 notes') && plan.stays[0]!.includes('1 task'), 'what is filed under it stays, and it says so')
  assert.deepEqual(deleteRequest(at('topic:unit1'), 'lift', tree, structure()), { route: 'study', edits: [
    { op: 'move_topic', topicId: 'paging', parentId: null, index: 2 },
    { op: 'move_topic', topicId: 'segmentation', parentId: null, index: 3 },
    { op: 'remove_topic', topicId: 'unit1' },
  ] })
  assert.deepEqual(deleteRequest(at('topic:unit1'), 'branch', tree, structure()), { route: 'study', edits: [
    { op: 'remove_topic', topicId: 'paging' }, { op: 'remove_topic', topicId: 'segmentation' }, { op: 'remove_topic', topicId: 'unit1' },
  ] }, 'deepest first, so each is empty when it goes')
})

test('nothing with recorded study is deleted', () => {
  const blocked = deletePlan(at('topic:unit1'), edges, tree, structure({ segHistory: true }))
  assert.ok(blocked.ok)
  assert.match(blocked.options[1]!.blocked!, /segmentation/)
  assert.equal(blocked.options[0]!.blocked, undefined, 'only the card itself can still go, its topics kept')
  const studied = deletePlan(at('topic:paging'), edges, tree, structure({ pagingHistory: true }))
  assert.ok(!studied.ok)
  assert.deepEqual(studied.archive, { topicId: 'paging' }, 'archive instead: the history stays')
  const studiedParent = deletePlan(at('topic:unit1'), edges, tree, structure({ unitHistory: true }))
  assert.ok(!studiedParent.ok && !studiedParent.archive)
})

test('a subject goes only when empty; notes and pages are deleted on their own pages', () => {
  const full = deletePlan(at('subject:os'), edges, tree, structure())
  assert.ok(!full.ok)
  assert.match(full.why, /5 topics/)
  const empty = deletePlan(at('subject:empty'), edges, tree, structure())
  assert.ok(empty.ok)
  assert.ok(empty.stays.some(s => s.includes('Inner')), 'a subject inside it stands on its own')
  assert.deepEqual(deleteRequest(at('subject:empty'), 'only', tree, structure()), { route: 'study', edits: [{ op: 'remove_subject', subjectId: 'empty' }] })
  const stale = deletePlan(topic('gone', 'os'), edges, tree, structure())
  assert.ok(!stale.ok && /changed/.test(stale.why))
  const n = deletePlan({ id: 'note:n', type: 'note', label: 'n', href: '/notes/n', subjectId: null, subjectName: null, topicName: null, topicLinked: false, updatedAt: '' }, edges, tree, null)
  assert.ok(!n.ok && n.href?.to === '/notes/n')
})
