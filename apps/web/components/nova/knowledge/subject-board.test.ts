// The Knowledge Space's subject board. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapEdge, MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { boardNeighbourhood, subjectBoard } from './subject-board'

const subject = (id: string): MapNode => ({ id: `subject:${id}`, type: 'subject', label: id, href: null, subjectId: id, topics: 0, notes: 0, resources: 0 })
const topic = (id: string, subjectId: string): MapNode => ({ id: `topic:${id}`, type: 'topic', label: id, href: null, subjectId, subjectName: subjectId, sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0 })
const note = (id: string, subjectId: string | null): MapNode => ({ id: `note:${id}`, type: 'note', label: id, href: `/notes/${id}`, subjectId, subjectName: subjectId, topicName: null, topicLinked: false, updatedAt: '2026-10-01T00:00:00Z' })
const page = (id: string, subjectId: string | null): MapNode => ({ id: `resource:${id}`, type: 'resource', label: id, href: null, subjectId, subjectName: subjectId, topicName: null, topicLinked: false, url: 'https://e.x', domain: 'e.x', savedAt: '2026-10-01T00:00:00Z', kind: 'saved' })
const edge = (from: string, to: string, kind: MapEdge['kind']): MapEdge => ({ id: `${from}>${to}`, from, to, kind })

const nodes = [
  subject('os'), subject('db'),
  topic('paging', 'os'), topic('deadlocks', 'os'), topic('joins', 'db'),
  note('n-paging', 'os'), page('p-deadlocks', 'os'), note('n-os', 'os'), note('n-db', 'db'), note('n-free', null),
]
const edges = [
  edge('subject:os', 'topic:paging', 'has_topic'), edge('subject:os', 'topic:deadlocks', 'has_topic'), edge('subject:db', 'topic:joins', 'has_topic'),
  edge('topic:paging', 'note:n-paging', 'about_topic'), edge('topic:deadlocks', 'resource:p-deadlocks', 'about_topic'),
  edge('subject:os', 'note:n-os', 'filed_under'), edge('subject:db', 'note:n-db', 'filed_under'),
  edge('note:n-os', 'topic:deadlocks', 'links_to'), edge('note:n-db', 'topic:paging', 'links_to'), edge('note:n-free', 'note:n-db', 'links_to'),
]

test('a subject\'s topics in map order, each with only what is filed under it', () => {
  const board = subjectBoard({ nodes, edges }, 'os')
  assert.deepEqual(board.topics.map(t => t.topic.id), ['topic:paging', 'topic:deadlocks'])
  assert.deepEqual(board.topics[0].items.map(i => i.id), ['note:n-paging'])
  assert.deepEqual(board.topics[1].items.map(i => i.id), ['resource:p-deadlocks'])
})

test('items filed under the subject alone are kept apart from the topics', () => {
  assert.deepEqual(subjectBoard({ nodes, edges }, 'os').loose.map(i => i.id), ['note:n-os'])
})

test('links are the stored [[links]] that touch this subject, from either side', () => {
  const ids = subjectBoard({ nodes, edges }, 'os').links.map(l => l.id)
  assert.deepEqual(ids, ['note:n-os>topic:deadlocks', 'note:n-db>topic:paging'])
})

test('another subject, or one with nothing on record, gets only its own', () => {
  const db = subjectBoard({ nodes, edges }, 'db')
  assert.deepEqual(db.topics.map(t => t.topic.id), ['topic:joins'])
  assert.deepEqual(db.links.map(l => l.id), ['note:n-db>topic:paging', 'note:n-free>note:n-db'])
  assert.deepEqual(subjectBoard({ nodes, edges }, 'none'), { topics: [], loose: [], links: [] })
})

test('pointing at a topic lights what is filed under it and what its links reach', () => {
  const board = subjectBoard({ nodes, edges }, 'os')
  assert.deepEqual([...boardNeighbourhood(board, 'topic:deadlocks')].sort(), ['note:n-os', 'resource:p-deadlocks', 'topic:deadlocks'])
  assert.deepEqual([...boardNeighbourhood(board, 'note:n-paging')].sort(), ['note:n-db', 'note:n-paging', 'topic:paging'])
  assert.deepEqual([...boardNeighbourhood(board, 'note:n-os')].sort(), ['note:n-os', 'topic:deadlocks'])
})
