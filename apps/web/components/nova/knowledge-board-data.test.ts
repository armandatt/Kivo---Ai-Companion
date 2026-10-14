// Today's Knowledge board and Recently captured. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'
import { dueMarks, recentPages, subjectCards } from './knowledge-board-data'

const subject = (id: string, label: string): MapNode => ({ id: `subject:${id}`, type: 'subject', label, href: `/knowledge?subject=${id}`, subjectId: id, topics: 0, notes: 0, resources: 0 })
const topic = (id: string, label: string, subjectId: string, subjectName: string, sessions = 1): MapNode => ({
  id: `topic:${id}`, type: 'topic', label, href: `/knowledge?topic=${id}`, subjectId, subjectName, sessions,
  level: sessions ? 'developing' : null, masteryPercent: sessions ? 50 : null, notes: 0, resources: 0,
})
const page = (id: string, savedAt: string): MapNode => ({
  id: `resource:${id}`, type: 'resource', label: id, href: `/saved?page=${id}`, subjectId: null, subjectName: null,
  topicName: null, topicLinked: false, url: `https://example.com/${id}`, domain: 'example.com', savedAt, kind: 'saved',
})

const nodes = [
  subject('s2', 'Databases'), subject('s1', 'Operating Systems'),
  topic('t1', 'Paging', 's1', 'Operating Systems'), topic('t2', 'Deadlocks', 's1', 'Operating Systems', 0), topic('t3', 'Joins', 's2', 'Databases'),
  page('old', '2026-09-01T10:00:00Z'), page('new', '2026-10-10T10:00:00Z'), page('mid', '2026-09-20T10:00:00Z'),
]

test('one card per subject, in the map\'s order, holding only that subject\'s topics', () => {
  const cards = subjectCards({ nodes })
  assert.deepEqual(cards.map(c => c.subject.label), ['Databases', 'Operating Systems'])
  assert.deepEqual(cards[0].topics.map(t => t.label), ['Joins'])
  assert.deepEqual(cards[1].topics.map(t => t.label), ['Paging', 'Deadlocks'])
})

test('a subject with no topics still has its card', () => {
  assert.deepEqual(subjectCards({ nodes: [subject('s9', 'Statistics')] }).map(c => c.topics.length), [0])
})

test('due markers are drawn when Today listed every due topic', () => {
  const marks = dueMarks({ count: 1, topics: [{ topicName: 'paging ', subjectName: 'Operating  Systems', daysOverdue: 2 }] })
  const [, os] = subjectCards({ nodes })
  assert.equal(marks.complete, true)
  assert.deepEqual(os.topics.map(t => marks.isDue(t)), [true, false])
})

test('when Today listed only some of the due topics, no topic is marked', () => {
  const marks = dueMarks({ count: 5, topics: [{ topicName: 'Paging', subjectName: 'Operating Systems', daysOverdue: 2 }] })
  const [, os] = subjectCards({ nodes })
  assert.equal(marks.complete, false)
  assert.ok(os.topics.every(t => !marks.isDue(t)))
})

test('a topic of the same name under another subject is not marked', () => {
  const marks = dueMarks({ count: 1, topics: [{ topicName: 'Joins', subjectName: 'Operating Systems', daysOverdue: 1 }] })
  const [db] = subjectCards({ nodes })
  assert.equal(marks.isDue(db.topics[0]), false)
})

test('saved pages newest first by the date they were saved, and only as many as asked', () => {
  assert.deepEqual(recentPages({ nodes }, 2).map(p => p.label), ['new', 'mid'])
  assert.deepEqual(recentPages({ nodes: [] }, 5), [])
})
