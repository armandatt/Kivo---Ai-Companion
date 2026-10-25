// Edits to a proposal in the playground keep its references whole. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type { WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import * as edit from './plan-edit'

const plan = (): WorkspacePlan => ({
  version: 1, kind: 'custom', templateId: null, templateVersion: null, category: null,
  title: 'TrackerX', summary: '', prerequisites: [], resources: [], sources: [], assumptions: [],
  subjects: [{ name: 'TrackerX', topics: [{ name: 'Dashboard', explanation: null, sources: [] }] }],
  phases: [
    { name: 'Dashboard', subject: 'TrackerX', weeks: null, hoursPerWeek: null, goals: [], exercises: [], project: null, completion: null, resources: [] },
    { name: 'APIs', subject: 'TrackerX', weeks: null, hoursPerWeek: null, goals: [], exercises: [], project: null, completion: null, resources: [] },
  ],
  tasks: [
    { key: 'a', title: 'Widgets', priority: null, subject: 'TrackerX', topic: 'Dashboard', dueDay: null, estimatedMinutes: null, after: null },
    { key: 'b', title: 'Wire API', priority: null, subject: 'TrackerX', topic: 'APIs', dueDay: '2026-11-01', estimatedMinutes: null, after: 'a' },
  ],
  notes: [{ key: 'n', title: 'Scope', subject: 'TrackerX', topic: null, body: 'x', origin: 'nova', sources: [] }],
  dates: [{ title: 'Launch', subject: 'TrackerX', kind: 'project', day: '2026-11-10' }],
})

test('renaming a milestone moves its tasks with it; removing one leaves them under none', () => {
  const renamed = edit.updatePhase(plan(), 1, { name: 'Integrations' })
  assert.equal(renamed.tasks.find(t => t.key === 'b')!.topic, 'Integrations')
  const removed = edit.removePhase(plan(), 0)
  assert.equal(removed.phases.length, 1)
  assert.equal(removed.tasks.find(t => t.key === 'a')!.topic, null)
})

test('renaming a subject re-files everything under it; removing it unfiles, never deletes', () => {
  const p = edit.renameSubject(plan(), 0, 'Tracker')
  assert.ok([...p.tasks, ...p.phases, ...p.notes, ...p.dates].every(x => x.subject === 'Tracker'))
  const gone = edit.removeSubject(plan(), 0)
  assert.equal(gone.subjects.length, 0)
  assert.equal(gone.tasks.length, 2)
  assert.ok(gone.tasks.every(t => t.subject === null))
})

test('removing a task clears what waited for it; an order never loops', () => {
  const p = edit.removeTask(plan(), 'a')
  assert.equal(p.tasks[0]!.after, null)
  // a cannot wait for b, since b already waits for a.
  assert.deepEqual(edit.possibleAfter(plan(), 'a').map(t => t.key), [])
  assert.deepEqual(edit.possibleAfter(plan(), 'b').map(t => t.key), ['a'])
})

test('new tasks get a free key and their milestone', () => {
  const p = edit.addTask(edit.addTask(plan(), 'Test it', 'APIs'), 'Ship')
  assert.equal(new Set(p.tasks.map(t => t.key)).size, 4)
  assert.equal(p.tasks[2]!.topic, 'APIs')
  assert.equal(p.tasks[3]!.topic, null)
})

test('reading back: tasks by milestone, the timeline soonest first, views that have content', () => {
  assert.deepEqual(edit.tasksByMilestone(plan()).map(g => [g.milestone, g.tasks.map(t => t.key)]), [['Dashboard', ['a']], ['APIs', ['b']]])
  assert.deepEqual(edit.timeline(plan()).map(i => i.label), ['Wire API', 'Launch'])
  assert.deepEqual(edit.viewsFor(plan()), ['overview', 'roadmap', 'board', 'topics', 'timeline', 'notes'])
  assert.deepEqual(edit.viewsFor(null), ['overview'])
  // A topic already there, in any case, is not added twice.
  assert.equal(edit.addTopic(plan(), 0, 'dashboard').subjects[0]!.topics.length, 1)
  assert.deepEqual(edit.moveItem([1, 2, 3], 0, 2), [2, 3, 1])
})
