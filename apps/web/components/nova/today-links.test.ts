// Where today's work sits on the record. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaTaskItem } from '@repo/api/nova/product/tasks.types'
import { taskTopicHref, topicRecord } from './today-links'

const topic = (id: string, label: string, subjectName: string, sessions: number, level: 'weak' | 'developing' | 'solid' | null, notes = 0, resources = 0): MapNode =>
  ({ id: `topic:${id}`, type: 'topic', label, href: `/knowledge?topic=${id}`, subjectId: subjectName, subjectName, sessions, level, masteryPercent: level ? 50 : null, notes, resources })
const task = (id: string, subjectName: string | null, topicName: string | null, status: NovaTaskItem['status'] = 'todo') =>
  ({ id, title: id, status, priority: null, subjectId: null, subjectName, topicName, dueDay: null, dueInDays: null, completedAt: null, createdAt: '', updatedAt: '' }) as NovaTaskItem

const map = { nodes: [topic('t1', 'Deadlocks', 'Operating Systems', 3, 'developing', 2, 1), topic('t2', 'Paging', 'Operating Systems', 0, 'weak')] }
const tasks = [task('a', 'Operating Systems', 'deadlocks'), task('b', 'operating systems', ' Deadlocks ', 'done'), task('c', 'Operating Systems', 'Paging'), task('d', null, 'Deadlocks')]

test('a block\'s topic record: the map\'s level, sessions and filed items, and open tasks on it', () => {
  assert.deepEqual(topicRecord(map, tasks, { subjectName: 'operating  systems', topicName: 'DEADLOCKS' }), {
    knowledgeHref: '/knowledge?topic=t1', mapHref: '/map?focus=topic%3At1', level: 'developing', sessions: 3, notes: 2, resources: 1, openTasks: 1,
  })
})

test('no session behind a topic means no level, whatever the map row holds', () => {
  assert.equal(topicRecord(map, tasks, { subjectName: 'Operating Systems', topicName: 'Paging' })?.level, null)
})

test('a topic the map does not have gets nothing', () => {
  assert.equal(topicRecord(map, tasks, { subjectName: 'Operating Systems', topicName: 'Scheduling' }), null)
  assert.equal(topicRecord(map, tasks, { subjectName: 'Databases', topicName: 'Deadlocks' }), null)
})

test('a task links to its topic only when it names both subject and topic and the map has them', () => {
  assert.equal(taskTopicHref(map, tasks[0]), '/knowledge?topic=t1')
  assert.equal(taskTopicHref(map, tasks[3]), null)
  assert.equal(taskTopicHref(null, tasks[0]), null)
})
