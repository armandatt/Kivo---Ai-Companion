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

// ── Steps (tasks inside tasks) ────────────────────────────────────────────────

const keys = (p: WorkspacePlan) => p.tasks.map(t => `${t.key}<${t.parent ?? ''}`)

test('a step goes under its task, filed where the task is, and reads right after it', () => {
  const p = edit.addStep(edit.addStep(plan(), 'a', 'Sketch'), 'a', 'Build')
  const steps = p.tasks.filter(t => t.parent === 'a')
  assert.deepEqual(steps.map(t => t.title), ['Sketch', 'Build'])
  assert.ok(steps.every(t => t.topic === 'Dashboard' && t.subject === 'TrackerX'))
  assert.deepEqual(p.tasks.map(t => t.title).slice(0, 3), ['Widgets', 'Sketch', 'Build'])
  // Nested again, to any depth the limit allows.
  const deeper = edit.addStep(p, steps[1]!.key, 'Button')
  assert.equal(edit.depthIn(deeper, deeper.tasks.find(t => t.title === 'Button')!.key), 2)
})

test('the milestone groups count a task and its steps together (25 Oct: "0 tasks" everywhere)', () => {
  const p = edit.addStep(plan(), 'a', 'Sketch')
  const groups = edit.tasksByMilestone(p)
  assert.deepEqual(groups[0]!.rows.map(r => `${r.task.title}:${r.depth}`), ['Widgets:0', 'Sketch:1'])
  // A step whose own topic says otherwise still goes with its task.
  const odd = { ...p, tasks: p.tasks.map(t => (t.title === 'Sketch' ? { ...t, topic: 'APIs' } : t)) }
  assert.deepEqual(edit.tasksByMilestone(odd)[0]!.rows.map(r => r.task.title), ['Widgets', 'Sketch'])
})

test('indent makes a task a step of the one above; outdent puts it back after its parent', () => {
  const two = edit.addTask(plan(), 'Charts', 'Dashboard')
  const charts = two.tasks.at(-1)!.key
  assert.equal(edit.canIndent(two, 'a'), false)
  const indented = edit.indentTask(two, charts)
  assert.equal(indented.tasks.find(t => t.key === charts)!.parent, 'a')
  const out = edit.outdentTask(indented, charts)
  assert.equal(out.tasks.find(t => t.key === charts)!.parent, null)
  assert.equal(out.tasks.find(t => t.key === charts)!.topic, 'Dashboard')
})

test('moving a task takes its steps with it, and never inside its own steps', () => {
  const p = edit.addStep(edit.addTask(plan(), 'Charts', 'Dashboard'), 'a', 'Sketch')
  const charts = p.tasks.find(t => t.title === 'Charts')!.key
  const moved = edit.reorderTask(p, charts, -1)
  assert.deepEqual(moved.tasks.filter(t => t.topic === 'Dashboard').map(t => t.title), ['Charts', 'Widgets', 'Sketch'])
  const sketch = p.tasks.find(t => t.title === 'Sketch')!.key
  assert.equal(edit.moveUnder(p, 'a', sketch), p)
})

test('removing a task: with its steps, or its steps move up; what waited for it waits for nothing', () => {
  const p = edit.addStep(edit.addStep(plan(), 'a', 'Sketch'), 'a', 'Build')
  const withSteps = edit.removeTask(p, 'a', { withSteps: true })
  assert.deepEqual(withSteps.tasks.map(t => t.title), ['Wire API'])
  assert.equal(withSteps.tasks[0]!.after, null)
  const kept = edit.removeTask(p, 'a')
  assert.deepEqual(kept.tasks.filter(t => ['Sketch', 'Build'].includes(t.title)).map(t => t.parent), [null, null])
  assert.ok(keys(kept).every(k => !k.endsWith('<a')))
})

test("a suggestion is Nova's until the learner accepts it: all, a group's, or none", () => {
  const p = { ...plan(), tasks: plan().tasks.map(t => ({ ...t, suggestedPriority: 'high' as const, priorityReason: 'due first' })) }
  assert.equal(edit.suggestionsOpen(p), 2)
  const one = edit.acceptSuggestions(p, ['a'])
  assert.deepEqual(one.tasks.map(t => t.priority), ['high', null])
  assert.equal(edit.suggestionsOpen(one), 1)
  const none = edit.clearSuggestions(p)
  assert.deepEqual(none.tasks.map(t => [t.priority, t.suggestedPriority ?? null]), [[null, null], [null, null]])
  // The learner's own choice is never replaced by accepting.
  const mine = edit.acceptSuggestions(edit.setPriority(p, 'a', 'low'))
  assert.equal(mine.tasks[0]!.priority, 'low')
})
