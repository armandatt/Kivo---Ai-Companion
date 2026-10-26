// Removing one connection from the map. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { disconnectPlan } from './map-disconnect'

const nodes: MapNode[] = [
  { id: 'subject:sem', type: 'subject', label: 'Semester Five', href: null, subjectId: 'sem', topics: 0, notes: 0, resources: 0 },
  { id: 'subject:os', type: 'subject', label: 'Operating Systems', href: null, subjectId: 'os', topics: 0, notes: 0, resources: 0, parentId: 'sem' },
  { id: 'topic:unit', type: 'topic', label: 'Unit 2', href: null, subjectId: 'os', subjectName: 'Operating Systems', sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0 },
  { id: 'topic:paging', type: 'topic', label: 'Paging', href: null, subjectId: 'os', subjectName: 'Operating Systems', sessions: 2, level: null, masteryPercent: null, notes: 0, resources: 0, parentId: 'unit' },
  { id: 'task:a', type: 'task', label: 'Revise', href: null, subjectId: 'os', subjectName: 'Operating Systems', topicName: 'Paging', status: 'todo', priority: null, dueDay: null, estimatedMinutes: null, order: 0, waitsOn: 1 },
  { id: 'task:b', type: 'task', label: 'Read', href: null, subjectId: 'os', subjectName: 'Operating Systems', topicName: 'Paging', status: 'todo', priority: null, dueDay: null, estimatedMinutes: null, order: 0, waitsOn: 0, parentId: 'a' },
  { id: 'note:n', type: 'note', label: 'TLB notes', href: null, subjectId: 'os', subjectName: 'Operating Systems', topicName: 'Paging', topicLinked: true, updatedAt: '2026-10-01T00:00:00Z' },
  { id: 'resource:r', type: 'resource', label: 'OSTEP', href: null, subjectId: 'os', subjectName: 'Operating Systems', topicName: null, topicLinked: false, url: 'https://x', domain: 'x', savedAt: '', kind: 'saved' },
]
const byId = new Map(nodes.map(n => [n.id, n]))
const e = (from: string, to: string, kind: MapEdge['kind']): MapEdge => ({ id: `${from}>${to}`, from, to, kind })
const plan = (from: string, to: string, kind: MapEdge['kind'], workspace = false) => disconnectPlan(e(from, to, kind), byId, { workspace })

test('each kind of connection comes off by the request of the route that owns it, and no card is deleted', () => {
  const cases: Array<[ReturnType<typeof plan>, unknown]> = [
    [plan('subject:sem', 'subject:os', 'contains'), { route: 'study', edits: [{ op: 'move_subject', subjectId: 'os', parentId: null }] }],
    [plan('topic:unit', 'topic:paging', 'subtopic'), { route: 'study', edits: [{ op: 'move_topic', topicId: 'paging', parentId: null }] }],
    [plan('task:a', 'task:b', 'step'), { route: 'task', taskId: 'b', patch: { parentId: null } }],
    [plan('topic:paging', 'task:a', 'has_task'), { route: 'task', taskId: 'a', patch: { topicName: null } }],
    [plan('subject:os', 'task:a', 'has_task'), { route: 'task', taskId: 'a', patch: { subjectId: null, topicName: null } }],
    [plan('topic:paging', 'note:n', 'about_topic'), { route: 'file', kind: 'note', id: 'n', subjectId: 'os', version: '2026-10-01T00:00:00Z' }],
    [plan('subject:os', 'resource:r', 'filed_under'), { route: 'unfile', kind: 'resource', id: 'r', version: null }],
    [plan('note:n', 'topic:paging', 'links_to'), { route: 'unlink', noteId: 'n', title: 'Paging' }],
    [plan('task:a', 'task:b', 'depends_on'), { route: 'task', taskId: 'a', patch: { stopWaitingFor: 'b' } }],
  ]
  for (const [p, request] of cases) {
    assert.ok(p.ok, JSON.stringify(p))
    assert.deepEqual(p.request, request)
    assert.ok(/Nothing is deleted|Nothing in it changes/.test(p.detail), p.detail)
  }
})

test('a topic always belongs to a subject: that line is explained, not removed', () => {
  const p = plan('subject:os', 'topic:unit', 'has_topic')
  assert.ok(!p.ok && p.why.includes('always belongs to a subject'))
})

test('unfiling from a workspace subject says the card may leave this workspace’s map', () => {
  const p = plan('subject:os', 'note:n', 'filed_under', true)
  assert.ok(p.ok && p.detail.includes('workspace'))
  const gone = disconnectPlan(e('subject:os', 'note:missing', 'filed_under'), byId, { workspace: false })
  assert.ok(!gone.ok && gone.why.includes('changed'))
})
