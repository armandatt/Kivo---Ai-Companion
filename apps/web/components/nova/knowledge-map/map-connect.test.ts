// Connecting a card that exists. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { treeOf } from './layout'
import { canConnectFrom, connectCandidates, connectOptions } from './map-connect'

const subject = (id: string, parentId?: string): MapNode => ({ id: `subject:${id}`, type: 'subject', label: id, href: null, subjectId: id, topics: 0, notes: 0, resources: 0, ...(parentId ? { parentId } : {}) })
const topic = (id: string, s: string, label = id, parentId?: string): MapNode => ({ id: `topic:${id}`, type: 'topic', label, href: null, subjectId: s, subjectName: s, sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0, ...(parentId ? { parentId } : {}) })
const task = (id: string, extra: Record<string, unknown> = {}): MapNode => ({ id: `task:${id}`, type: 'task', label: id, href: null, subjectId: 'Finance', subjectName: 'Finance', topicName: null, status: 'todo', priority: null, dueDay: null, estimatedMinutes: null, order: 0, waitsOn: 0, ...extra } as MapNode)
const note = (id: string, s: string | null, topicName: string | null = null): MapNode => ({ id: `note:${id}`, type: 'note', label: id, href: null, subjectId: s, subjectName: s, topicName, topicLinked: !!topicName, updatedAt: '2026-10-01T00:00:00Z' })
const edge = (from: string, to: string, kind: MapEdge['kind']): MapEdge => ({ id: `${from}>${to}`, from, to, kind })

// Finance › (Budgets › Forecasting); AI › (Models, ML Basics › Forecasting*); an
// unrelated "Forecasting" in AI (same title, different place); tasks a › a1, b waits for a.
const nodes: MapNode[] = [subject('Finance'), subject('AI'), subject('Labs', 'AI'),
  topic('budgets', 'Finance', 'Budgets'), topic('fc1', 'Finance', 'Forecasting', 'budgets'),
  topic('models', 'AI', 'Models'), topic('basics', 'AI', 'ML Basics'), topic('fc2', 'AI', 'Forecasting', 'basics'),
  task('a'), task('a1', { parentId: 'a' }), task('b', { waitsOn: 1 }), note('ideas', 'AI'), note('reading', 'Finance', 'Budgets')]
const edges: MapEdge[] = [
  edge('subject:AI', 'subject:Labs', 'contains'),
  edge('subject:Finance', 'topic:budgets', 'has_topic'), edge('topic:budgets', 'topic:fc1', 'subtopic'),
  edge('subject:AI', 'topic:models', 'has_topic'), edge('subject:AI', 'topic:basics', 'has_topic'), edge('topic:basics', 'topic:fc2', 'subtopic'),
  edge('subject:Finance', 'task:a', 'has_task'), edge('task:a', 'task:a1', 'step'), edge('subject:Finance', 'task:b', 'has_task'), edge('task:b', 'task:a', 'depends_on'),
  edge('subject:AI', 'note:ideas', 'filed_under'), edge('topic:budgets', 'note:reading', 'about_topic'),
]
const tree = treeOf(nodes, edges)
const ctx = { nodes, edges, tree }
const at = (id: string) => nodes.find(n => n.id === id)!
const opts = (s: string, t: string) => connectOptions(at(s), at(t), ctx)

test('the picker finds existing cards by name and where they are, never the card itself, and tells same names apart', () => {
  const found = connectCandidates(at('topic:budgets'), nodes, tree, 'forecast')
  assert.deepEqual(found.map(f => [f.node.id, f.context]), [['topic:fc2', 'AI › ML Basics'], ['topic:fc1', 'Finance › Budgets']])
  assert.ok(!connectCandidates(at('topic:budgets'), nodes, tree, '').some(f => f.node.id === 'topic:budgets'))
  assert.deepEqual(connectCandidates(at('topic:budgets'), nodes, tree, 'ml basics').map(f => f.node.id), ['topic:basics', 'topic:fc2'], 'by name first, then by where it is')
  assert.ok(!connectCandidates(at('topic:budgets'), nodes, tree, '').some(f => f.node.type === 'subject'), 'a subject can’t go inside a topic')
  assert.deepEqual(connectCandidates(at('task:a'), nodes, tree, '').map(f => f.node.type), ['task', 'task'], 'tasks connect to tasks')
  assert.equal(canConnectFrom(at('note:ideas')), false)
  assert.deepEqual(connectCandidates(at('topic:budgets'), nodes, tree, 'nothing like this'), [])
})

test('AI under Finance: the same subject moves inside, nothing is copied, and the move is said', () => {
  const [o] = opts('subject:Finance', 'subject:AI')
  assert.equal(o!.relation, 'hierarchy')
  assert.deepEqual(o!.request, { route: 'study', edits: [{ op: 'move_subject', subjectId: 'AI', parentId: 'Finance' }] })
  assert.equal(o!.blocked, undefined)
  const [labs] = opts('subject:Finance', 'subject:Labs')
  assert.match(labs!.moves!, /moves out of “AI”/, 'leaving its current parent is said before saving')
})

test('a topic from another subject goes inside a topic in one batch, with its history', () => {
  const [o] = opts('topic:budgets', 'topic:models')
  assert.deepEqual(o!.request, { route: 'study', edits: [{ op: 'move_topic', topicId: 'models', toSubjectId: 'Finance' }, { op: 'move_topic', topicId: 'models', parentId: 'budgets' }] })
  assert.match(o!.detail, /history/)
  assert.match(o!.moves!, /out of “AI”/)
  const [same] = opts('topic:fc1', 'topic:basics')
  assert.ok(same!.request!.route === 'study' && same!.request!.edits.length === 2)
})

test('no self, no circle, no repeat', () => {
  assert.match(opts('topic:fc1', 'topic:budgets')[0]!.blocked!, /is inside/, 'a card can’t go inside one inside it')
  assert.match(opts('subject:Finance', 'topic:budgets')[0]!.blocked!, /already inside/)
  assert.match(opts('topic:budgets', 'topic:fc1')[0]!.blocked!, /already inside/)
  assert.match(opts('subject:AI', 'subject:Labs')[0]!.blocked!, /already inside/)
  assert.match(opts('task:a', 'task:a1')[0]!.blocked!, /already inside/)
  assert.match(opts('task:a1', 'task:a')[0]!.blocked!, /is inside/, 'a task can’t become a step of its own step')
  assert.match(opts('topic:budgets', 'note:reading')[0]!.blocked!, /already/)
})

test('tasks: a step (moves it) or a wait either way (a link); a wait already there or round a circle is refused', () => {
  const o = opts('task:a', 'task:b')
  assert.deepEqual(o.map(x => [x.key, x.relation]), [['step', 'hierarchy'], ['waits_for', 'link'], ['waited_on', 'link']])
  assert.deepEqual(o[0]!.request, { route: 'task', taskId: 'b', patch: { parentId: 'a' } })
  assert.match(o[1]!.blocked!, /circle/, 'b already waits for a, so a can’t wait for b')
  assert.match(o[2]!.blocked!, /already there/)
  const fresh = opts('task:a1', 'task:b')
  assert.deepEqual(fresh[1]!.request, { route: 'task', taskId: 'a1', patch: { waitFor: 'b' } })
  assert.equal(fresh[1]!.moves, null, 'a link moves nothing')
})

test('a note can be filed under a topic (moves it) or linked to it (a [[link]]; it stays where it is)', () => {
  const o = opts('topic:budgets', 'note:ideas')
  assert.deepEqual(o.map(x => [x.key, x.relation]), [['file', 'hierarchy'], ['link', 'link']])
  assert.deepEqual(o[0]!.request, { route: 'file', kind: 'note', id: 'ideas', to: { subjectId: 'Finance', topicName: 'Budgets' }, version: '2026-10-01T00:00:00Z' })
  assert.ok(o[1]!.request?.route === 'link' && o[1]!.request.plan.title === 'Budgets')
  // A step filed elsewhere: it becomes a task of its own, and says so.
  const step = opts('topic:budgets', 'task:a1')[0]!
  assert.deepEqual(step.request, { route: 'task', taskId: 'a1', patch: { parentId: null, subjectId: 'Finance', topicName: 'Budgets' } })
  assert.match(step.moves!, /stops being a step/)
})
