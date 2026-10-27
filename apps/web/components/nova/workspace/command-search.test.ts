// The command palette's search. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { MapNode } from '@repo/api/nova/product/knowledge-map.types'
import type { NovaTaskItem } from '@repo/api/nova/product/tasks.types'
import { commandEntries, searchCommands } from './command-search'

const pages = [{ path: '/home', label: 'Today' }, { path: '/knowledge', label: 'Knowledge' }, { path: '/notes', label: 'Notes' }]
const nodes: MapNode[] = [
  { id: 'subject:s1', type: 'subject', label: 'Operating Systems', href: '/knowledge?subject=s1', subjectId: 's1', topics: 2, notes: 1, resources: 0 },
  { id: 'topic:t1', type: 'topic', label: 'Deadlocks', href: '/knowledge?topic=t1', subjectId: 's1', subjectName: 'Operating Systems', sessions: 0, level: null, masteryPercent: null, notes: 0, resources: 0 },
  { id: 'topic:t2', type: 'topic', label: 'Memory management', href: '/knowledge?topic=t2', subjectId: 's1', subjectName: 'Operating Systems', sessions: 2, level: 'weak', masteryPercent: 30, notes: 0, resources: 0 },
  { id: 'note:n1', type: 'note', label: 'Deadlock conditions', href: '/notes/n1', subjectId: 's1', subjectName: 'Operating Systems', topicName: 'Deadlocks', topicLinked: true, updatedAt: '2026-10-01T00:00:00Z' },
  { id: 'note:n2', type: 'note', label: 'Unreachable', href: null, subjectId: null, subjectName: null, topicName: null, topicLinked: false, updatedAt: '2026-10-01T00:00:00Z' },
  { id: 'resource:r1', type: 'resource', label: 'Banker’s algorithm explained', href: '/saved?page=r1', subjectId: 's1', subjectName: 'Operating Systems', topicName: null, topicLinked: false, url: 'https://ex.com/b', domain: 'ex.com', savedAt: '2026-10-02T00:00:00Z', kind: 'saved' },
]
const task = (id: string, title: string, status: NovaTaskItem['status'] = 'todo') =>
  ({ id, title, status, priority: null, subjectId: null, subjectName: null, topicName: null, dueDay: null, dueInDays: null, completedAt: null, createdAt: '', updatedAt: '' }) as NovaTaskItem

const entries = commandEntries({ pages, nodes, tasks: [task('a', 'Revise deadlock prevention'), task('b', 'Deadlock quiz', 'done')] })

test('every entry opens a real address; nodes without one and finished tasks are left out', () => {
  assert.ok(entries.every(e => e.href.startsWith('/')))
  assert.equal(entries.find(e => e.id === 'note:n2'), undefined)
  assert.equal(entries.find(e => e.id === 'task:b'), undefined)
  assert.equal(entries.find(e => e.id === 'task:a')?.href, '/home?board=open')
})

test('nothing typed lists the pages in the sidebar order', () => {
  assert.deepEqual(searchCommands(entries, '  ').map(e => e.label), ['Today', 'Knowledge', 'Notes'])
})

test('a name that starts with the query comes before one that only contains it', () => {
  const found = searchCommands(entries, 'deadlock').map(e => e.id)
  assert.deepEqual(found, ['topic:t1', 'note:n1', 'task:a'])
})

test('a word inside a name matches, and a subject finds what is filed under it last', () => {
  assert.deepEqual(searchCommands(entries, 'management').map(e => e.id), ['topic:t2'])
  const bySubject = searchCommands(entries, 'operating').map(e => e.id)
  assert.equal(bySubject[0], 'subject:s1')
  assert.ok(bySubject.includes('topic:t1'))
})

test('a saved page is found by its site, and nothing matches nothing', () => {
  assert.deepEqual(searchCommands(entries, 'ex.com').map(e => e.id), ['resource:r1'])
  assert.deepEqual(searchCommands(entries, 'zzzz'), [])
})

test('the list is capped', () => {
  assert.equal(searchCommands(entries, 'o', 2).length, 2)
})
