// What is connected to a topic. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { topicConnections } from './connections'

const topic = (id: string, subjectId: string): MapNode => ({ id: `topic:${id}`, type: 'topic', label: id, href: `/knowledge?topic=${id}`, subjectId, subjectName: subjectId, sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0 })
const note = (id: string): MapNode => ({ id: `note:${id}`, type: 'note', label: id, href: `/notes/${id}`, subjectId: null, subjectName: null, topicName: null, topicLinked: false, updatedAt: '2026-10-01T00:00:00Z' })
const page = (id: string): MapNode => ({ id: `resource:${id}`, type: 'resource', label: id, href: null, subjectId: null, subjectName: null, topicName: null, topicLinked: false, url: 'https://e.x', domain: 'e.x', savedAt: '2026-10-01T00:00:00Z', kind: 'saved' })
const edge = (from: string, to: string, kind: MapEdge['kind']): MapEdge => ({ id: `${from}>${to}`, from, to, kind })

const nodes = [
  topic('deadlocks', 'os'), topic('paging', 'os'), topic('transactions', 'db'), topic('locks', 'db'), topic('graphs', 'dsa'),
  note('coffman'), note('isolation'), note('cycles'), note('loose'), page('bankers'),
]
const edges = [
  edge('topic:deadlocks', 'note:coffman', 'about_topic'),
  edge('topic:deadlocks', 'resource:bankers', 'about_topic'),
  edge('note:coffman', 'topic:transactions', 'links_to'),     // filed here, links there
  edge('topic:locks', 'note:isolation', 'about_topic'),
  edge('note:isolation', 'topic:deadlocks', 'links_to'),      // filed there, links here
  edge('note:cycles', 'topic:deadlocks', 'links_to'),
  edge('note:cycles', 'topic:graphs', 'links_to'),            // links to both
  edge('note:loose', 'note:coffman', 'links_to'),             // note to note: not a topic relation
]

test('what is filed under the topic, notes and saved pages, in map order', () => {
  assert.deepEqual(topicConnections({ nodes, edges }, 'topic:deadlocks').filed.map(n => n.id), ['note:coffman', 'resource:bankers'])
})

test('notes whose [[links]] name the topic', () => {
  assert.deepEqual(topicConnections({ nodes, edges }, 'topic:deadlocks').mentionedIn.map(n => n.id), ['note:isolation', 'note:cycles'])
})

test('related topics each come with the note that joins them, and how', () => {
  const related = topicConnections({ nodes, edges }, 'topic:deadlocks').related.map(r => [r.topic.id, r.via.id, r.relation])
  assert.deepEqual(related, [
    ['topic:transactions', 'note:coffman', 'filed_here_links_there'],
    ['topic:locks', 'note:isolation', 'filed_there_links_here'],
    ['topic:graphs', 'note:cycles', 'links_to_both'],
  ])
})

test('no relation without a note: a topic that shares only a subject is not related', () => {
  const c = topicConnections({ nodes, edges }, 'topic:paging')
  assert.deepEqual(c, { filed: [], mentionedIn: [], related: [] })
})

test('the other side sees the same note, and a topic is never related to itself', () => {
  const c = topicConnections({ nodes, edges: [...edges, edge('note:cycles', 'topic:deadlocks', 'links_to')] }, 'topic:graphs')
  assert.deepEqual(c.related.map(r => r.topic.id), ['topic:deadlocks'])
  assert.ok(!topicConnections({ nodes, edges }, 'topic:transactions').related.some(r => r.topic.id === 'topic:transactions'))
})
