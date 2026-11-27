// Bug batch 28 Nov, item 7: a topic's status on the map's lenses. Run with `npm test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { gapsOf, statusOf } from './lens'

const topic = (over: Record<string, unknown> = {}) => ({
  id: 'topic:t', type: 'topic', label: 'WACC', subjectId: 's', subjectName: 'Finance', href: '/knowledge?topic=t',
  sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0, order: 0, studied: true, ...over,
}) as never

test('REGRESSION item 7: status is the learner’s word, else implied by sessions', () => {
  assert.equal(statusOf(topic()), 'not_started')
  assert.equal(statusOf(topic({ sessions: 2 })), 'in_progress')
  assert.equal(statusOf(topic({ status: 'completed' })), 'completed')
})

test('REGRESSION item 7: a topic marked completed is not a "not studied" or "weak" gap; a review due still is', () => {
  assert.deepEqual(gapsOf(topic()), ['unstudied', 'nothing_written'])
  assert.deepEqual(gapsOf(topic({ status: 'completed' })), ['nothing_written'])
  assert.deepEqual(gapsOf(topic({ status: 'completed', sessions: 1, level: 'weak', reviewDue: true, notes: 1 })), ['review_due'])
})
