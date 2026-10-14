// The neighbourhood Today draws around a topic. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { localGraph } from './local-graph'

const subject: MapNode = { id: 'subject:s1', type: 'subject', label: 'Operating Systems', href: '/knowledge?subject=s1', subjectId: 's1', topics: 2, notes: 2, resources: 1 }
const topic: MapNode = { id: 'topic:t1', type: 'topic', label: 'Deadlocks', href: '/knowledge?topic=t1', subjectId: 's1', subjectName: 'Operating Systems', sessions: 2, level: 'developing', masteryPercent: 48, notes: 1, resources: 1 }
const other: MapNode = { id: 'topic:t2', type: 'topic', label: 'Paging', href: '/knowledge?topic=t2', subjectId: 's1', subjectName: 'Operating Systems', sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0 }
const note: MapNode = { id: 'note:n1', type: 'note', label: 'Banker’s algorithm', href: '/notes/n1', subjectId: 's1', subjectName: 'Operating Systems', topicName: 'Deadlocks', topicLinked: true, updatedAt: '2026-10-01T10:00:00Z' }
const linking: MapNode = { id: 'note:n2', type: 'note', label: 'Exam list', href: '/notes/n2', subjectId: null, subjectName: null, topicName: null, topicLinked: false, updatedAt: '2026-10-02T10:00:00Z' }
const page: MapNode = { id: 'resource:r1', type: 'resource', label: 'Deadlock video', href: '/saved?page=r1', subjectId: 's1', subjectName: 'Operating Systems', topicName: 'Deadlocks', topicLinked: true, url: 'https://example.com/v', domain: 'example.com', savedAt: '2026-10-03T10:00:00Z', kind: 'saved' }
const unfiled: MapNode = { id: 'resource:r2', type: 'resource', label: 'Unfiled page', href: '/saved?page=r2', subjectId: null, subjectName: null, topicName: null, topicLinked: false, url: 'https://example.com/u', domain: 'example.com', savedAt: '2026-10-04T10:00:00Z', kind: 'saved' }

const nodes = [subject, topic, other, note, linking, page, unfiled]
const edges: MapEdge[] = [
  { id: 'e1', from: 'subject:s1', to: 'topic:t1', kind: 'has_topic' },
  { id: 'e2', from: 'subject:s1', to: 'topic:t2', kind: 'has_topic' },
  { id: 'e3', from: 'topic:t1', to: 'note:n1', kind: 'about_topic' },
  { id: 'e4', from: 'topic:t1', to: 'resource:r1', kind: 'about_topic' },
  { id: 'e5', from: 'note:n2', to: 'topic:t1', kind: 'links_to' },
]

test('follows only the stored edges that touch the topic, in the map\'s order', () => {
  const g = localGraph({ nodes, edges }, { subjectName: 'Operating Systems', topicName: 'Deadlocks' })
  assert.ok(g)
  assert.equal(g.topic.id, 'topic:t1')
  assert.deepEqual(g.neighbours.map(n => [n.node.id, n.kind]), [
    ['subject:s1', 'has_topic'], ['note:n1', 'about_topic'], ['resource:r1', 'about_topic'], ['note:n2', 'links_to'],
  ])
  assert.equal(g.hidden, 0)
})

test('a sibling topic or an unfiled page is never drawn as linked', () => {
  const g = localGraph({ nodes, edges }, { subjectName: 'Operating Systems', topicName: 'Deadlocks' })
  const ids = g!.neighbours.map(n => n.node.id)
  assert.ok(!ids.includes('topic:t2'))
  assert.ok(!ids.includes('resource:r2'))
})

test('the topic is found by subject and name, trimmed and in any case', () => {
  assert.equal(localGraph({ nodes, edges }, { subjectName: ' operating  systems', topicName: 'DEADLOCKS ' })?.topic.id, 'topic:t1')
})

test('a topic of the same name under another subject is not this one', () => {
  assert.equal(localGraph({ nodes, edges }, { subjectName: 'Databases', topicName: 'Deadlocks' }), null)
})

test('a topic with no stored edge has no graph', () => {
  assert.equal(localGraph({ nodes, edges: [] }, { subjectName: 'Operating Systems', topicName: 'Deadlocks' }), null)
})

test('past the limit, the rest are counted, not dropped silently', () => {
  const g = localGraph({ nodes, edges }, { subjectName: 'Operating Systems', topicName: 'Deadlocks' }, 2)
  assert.equal(g!.neighbours.length, 2)
  assert.equal(g!.hidden, 2)
})

test('an edge to a node the map did not send is skipped', () => {
  const g = localGraph({ nodes, edges: [...edges, { id: 'e9', from: 'topic:t1', to: 'note:gone', kind: 'about_topic' }] }, { subjectName: 'Operating Systems', topicName: 'Deadlocks' })
  assert.ok(!g!.neighbours.some(n => n.node.id === 'note:gone'))
})
