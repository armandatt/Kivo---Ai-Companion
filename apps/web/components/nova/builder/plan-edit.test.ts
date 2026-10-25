// Edits to a proposal in the playground keep its references whole. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { topicRows, type WorkspacePlan } from '@repo/api/nova/product/workspace-plan'
import * as edit from './plan-edit'

const M = { weeks: null, hoursPerWeek: null, goals: [], exercises: [], project: null, completion: null, resources: [] }
const plan = (): WorkspacePlan => ({
  version: 2, kind: 'custom', templateId: null, templateVersion: null, category: null,
  title: 'TrackerX', summary: '', prerequisites: [], resources: [], sources: [], assumptions: [],
  // Milestones are topics of kind milestone, first in their subject.
  subjects: [{ name: 'TrackerX', topics: [
    { name: 'Dashboard', explanation: null, sources: [], kind: 'milestone', milestone: { ...M } },
    { name: 'APIs', explanation: null, sources: [], kind: 'milestone', milestone: { ...M } },
  ] }],
  tasks: [
    { key: 'a', title: 'Widgets', priority: null, subject: 'TrackerX', topic: 'Dashboard', dueDay: null, estimatedMinutes: null, after: [] },
    { key: 'b', title: 'Wire API', priority: null, subject: 'TrackerX', topic: 'APIs', dueDay: '2026-11-01', estimatedMinutes: null, after: ['a'] },
  ],
  notes: [{ key: 'n', title: 'Scope', subject: 'TrackerX', topic: null, body: 'x', origin: 'nova', sources: [] }],
  dates: [{ title: 'Launch', subject: 'TrackerX', kind: 'project', day: '2026-11-10' }],
})

test('renaming a milestone moves its tasks with it; removing one leaves them under none', () => {
  const renamed = edit.updatePhase(plan(), 1, { name: 'Integrations' })
  assert.equal(renamed.tasks.find(t => t.key === 'b')!.topic, 'Integrations')
  const removed = edit.removePhase(plan(), 0)
  assert.equal(edit.milestones(removed).length, 1)
  // A milestone's own fields are edited in place.
  assert.equal(edit.milestones(edit.updatePhase(plan(), 0, { completion: 'Widgets ship' }))[0]!.completion, 'Widgets ship')
  assert.equal(removed.tasks.find(t => t.key === 'a')!.topic, null)
})

test('renaming a subject re-files everything under it; removing it unfiles, never deletes', () => {
  const p = edit.renameSubject(plan(), 0, 'Tracker')
  assert.ok([...p.tasks, ...p.notes, ...p.dates].every(x => x.subject === 'Tracker'))
  assert.ok(edit.milestones(p).every(m => m.subject === 'Tracker'))
  const gone = edit.removeSubject(plan(), 0)
  assert.equal(gone.subjects.length, 0)
  assert.equal(gone.tasks.length, 2)
  assert.ok(gone.tasks.every(t => t.subject === null))
})

test('removing a task clears what waited for it; an order never loops', () => {
  const p = edit.removeTask(plan(), 'a')
  assert.deepEqual(p.tasks[0]!.after, [])
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
  assert.equal(edit.addTopic(plan(), 0, 'dashboard').subjects[0]!.topics.length, 2)
  assert.deepEqual(edit.moveItem([1, 2, 3], 0, 2), [2, 3, 1])
})

// ── Steps and priorities ──────────────────────────────────────────────────────

const keys = (p: WorkspacePlan) => edit.treeRows(p.tasks).map(r => `${'-'.repeat(r.depth)}${r.task.key}`)

test('a step goes under its task, after its other steps, filed where the task is', () => {
  let p = edit.addStep(plan(), 'a', 'Chart widget')
  p = edit.addStep(p, 'a', 'Table widget')
  const first = p.tasks.find(t => t.title === 'Chart widget')!
  p = edit.addStep(p, first.key, 'Pick a chart library')
  assert.deepEqual(edit.treeRows(p.tasks).map(r => `${'-'.repeat(r.depth)}${r.task.title}`), ['Widgets', '-Chart widget', '--Pick a chart library', '-Table widget', 'Wire API'])
  assert.equal(p.tasks.find(t => t.title === 'Pick a chart library')!.topic, 'Dashboard')
  assert.equal(edit.treeRows(p.tasks)[0]!.steps, 3)
})

test('indent makes a task a step of the one above; outdent moves it up a level; never into a loop', () => {
  let p = edit.addTask(plan(), 'Polish', 'Dashboard')
  const polish = p.tasks.find(t => t.title === 'Polish')!.key
  assert.ok(edit.canIndent(p, polish))
  p = edit.indent(p, polish)
  assert.equal(p.tasks.find(t => t.key === polish)!.parent, 'a')
  p = edit.outdent(p, polish)
  assert.equal(p.tasks.find(t => t.key === polish)!.parent, null)
  // A task can't go under its own step.
  const s = edit.addStep(plan(), 'a', 'Step')
  const step = s.tasks.find(t => t.title === 'Step')!.key
  assert.equal(edit.setParent(s, 'a', step), s)
})

test('a task moved under another follows its milestone; removing a task removes its steps and what waited for them waits for nothing', () => {
  let p = edit.addStep(plan(), 'a', 'Chart widget')
  p = edit.setParent(p, 'b', 'a')
  assert.equal(p.tasks.find(t => t.key === 'b')!.topic, 'Dashboard')
  assert.deepEqual(keys(p).filter(k => k.endsWith('b')), ['-b'])
  const removed = edit.removeTask(p, 'a')
  assert.deepEqual(removed.tasks, [])
})

test('moving a task up or down takes its steps with it, among its siblings only', () => {
  let p = edit.addStep(plan(), 'a', 'Chart widget')
  p = edit.reorderTask(p, 'b', -1)
  assert.deepEqual(keys(p), ['b', 'a', '-' + p.tasks.find(t => t.title === 'Chart widget')!.key])
})

test("a priority is the learner's: Nova's suggestion is used only when they take it", () => {
  const p = edit.updateTask(plan(), 'a', { suggestedPriority: 'high', priorityReason: 'The launch waits on it' })
  assert.equal(p.tasks[0]!.priority, null)
  const used = edit.acceptSuggestion(p, 'a')
  assert.deepEqual([used.tasks[0]!.priority, used.tasks[0]!.suggestedPriority], ['high', null])
  const dropped = edit.dismissSuggestion(p, 'a')
  assert.deepEqual([dropped.tasks[0]!.priority, dropped.tasks[0]!.suggestedPriority], [null, null])
})

test('a dependency is shown both ways', () => {
  assert.deepEqual(edit.waitingOn(plan(), 'a').map(t => t.key), ['b'])
})

test('a subject goes inside another of the plan; never inside itself or one inside it; renaming or removing the group carries that through', () => {
  let p = plan()
  p.subjects = [{ name: 'Semester Five', topics: [] }, { name: 'Automata', topics: [] }, { name: 'NLP', topics: [] }]
  p = edit.setSubjectParent(p, 1, 'Semester Five')
  p = edit.setSubjectParent(p, 2, 'Automata')
  assert.deepEqual(p.subjects.map(s => s.parent ?? null), [null, 'Semester Five', 'Automata'])
  // Semester Five can't go inside what is inside it.
  assert.deepEqual(edit.parentChoices(p, 0), [])
  assert.equal(edit.setSubjectParent(p, 0, 'NLP'), p)
  const renamed = edit.renameSubject(p, 0, 'Sem 5')
  assert.equal(renamed.subjects[1]!.parent, 'Sem 5')
  const removed = edit.removeSubject(p, 0)
  assert.deepEqual(removed.subjects.map(s => [s.name, s.parent ?? null]), [['Automata', null], ['NLP', 'Automata']])
  assert.equal(edit.setSubjectParent(p, 2, null).subjects[2]!.parent, null)
})

// ── Topics as a tree, waits as a list ─────────────────────────────────────────

const outline = (p: WorkspacePlan) => topicRows(p.subjects[0]!).map(r => `${'-'.repeat(r.depth)}${r.topic.name}`)

test('topics nest and keep their order: added inside, moved inside, moved up and down, renamed and removed with what is inside', () => {
  let p = plan()
  p = edit.addTopic(p, 0, 'Unit 1')
  p = edit.addTopic(p, 0, 'Arrays', 'Unit 1')
  p = edit.addTopic(p, 0, 'Strings', 'Unit 1')
  p = edit.addTopic(p, 0, 'Two pointers', 'Arrays')
  assert.deepEqual(outline(p), ['Dashboard', 'APIs', 'Unit 1', '-Arrays', '--Two pointers', '-Strings'])
  p = edit.reorderTopic(p, 0, p.subjects[0]!.topics.findIndex(t => t.name === 'Strings'), -1)
  assert.deepEqual(outline(p), ['Dashboard', 'APIs', 'Unit 1', '-Strings', '-Arrays', '--Two pointers'])
  // Never inside itself or what is inside it.
  const unit = p.subjects[0]!.topics.findIndex(t => t.name === 'Unit 1')
  assert.ok(!edit.topicParentChoices(p, 0, unit).includes('Two pointers'))
  p = edit.renameTopic(p, 0, p.subjects[0]!.topics.findIndex(t => t.name === 'Arrays'), 'Arrays and lists')
  assert.deepEqual(outline(p).slice(-2), ['-Arrays and lists', '--Two pointers'])
  p = edit.setTopicParent(p, 0, p.subjects[0]!.topics.findIndex(t => t.name === 'Strings'), null)
  assert.equal(outline(p).at(-1), 'Strings')
  p = edit.removeTopic(p, 0, p.subjects[0]!.topics.findIndex(t => t.name === 'Unit 1'))
  assert.deepEqual(outline(p), ['Dashboard', 'APIs', 'Strings'])
})

test('a task waits on several, and never round in a circle', () => {
  let p = edit.addTask(plan(), 'Test it', 'APIs')
  const test3 = p.tasks[2]!.key
  p = edit.toggleWait(p, test3, 'a')
  p = edit.toggleWait(p, test3, 'b')
  assert.deepEqual(p.tasks[2]!.after, ['a', 'b'])
  // a can't wait on what waits on it.
  assert.equal(edit.toggleWait(p, 'a', test3), p)
  p = edit.toggleWait(p, test3, 'a')
  assert.deepEqual(p.tasks[2]!.after, ['b'])
})
