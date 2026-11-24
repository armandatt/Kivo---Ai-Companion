import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { NovaTaskItem, NovaTasksReady } from '@repo/api/nova/product/tasks.types'
import { boardFor, dayTasks, dueNotPlanned, flowStatusFor } from './day-board-model'

const task = (id: string, over: Partial<NovaTaskItem> = {}): NovaTaskItem => ({
  id, title: id, status: 'todo', priority: null, subjectId: null, subjectName: null, topicName: null,
  dueDay: null, dueInDays: null, estimatedMinutes: null, parentId: null, position: null,
  createdAt: '2026-11-24T00:00:00Z', updatedAt: '2026-11-24T00:00:00Z', ...over,
} as unknown as NovaTaskItem)
const view = (tasks: NovaTaskItem[]) => ({ status: 'ready', tasks, subjects: [], counts: { todo: 9, in_progress: 9, done: 9 } } as unknown as NovaTasksReady)
const item = (id: string, taskId: string | null, addedBy: 'learner' | 'nova' = 'learner', kind: 'task' | 'topic' | 'focus' = 'task') =>
  ({ id, kind, taskId, addedBy, status: 'planned' as const })

test('today shows only tasks in the day, with their steps, counted as cards', () => {
  const tasks = [task('a'), task('a1', { parentId: 'a', status: 'done' }), task('b', { status: 'in_progress' }), task('c')]
  const flow = { items: [item('i1', 'a'), item('i2', 'b', 'nova'), item('i3', null, 'learner', 'focus')] }
  const today = boardFor('today', view(tasks), tasks, flow)
  assert.deepEqual(today.tasks.map(t => t.id), ['a', 'a1', 'b'])
  assert.deepEqual(today.view.counts, { todo: 1, in_progress: 1, done: 0 })  // the step is inside a's card
  const all = boardFor('all', view(tasks), tasks, flow)
  assert.equal(all.tasks.length, 4)
  assert.equal(all.view.counts.todo, 9)
})

test('no flow yet: an empty board for today, never all the tasks', () => {
  const tasks = [task('a'), task('b')]
  assert.deepEqual(boardFor('today', view(tasks), tasks, null).tasks, [])
})

test('who added each task is kept: the learner or Nova', () => {
  const m = dayTasks({ items: [item('i1', 'a'), item('i2', 'b', 'nova'), item('i3', 'a', 'nova')] })
  assert.deepEqual(m.get('a'), { itemId: 'i1', addedBy: 'learner' })
  assert.deepEqual(m.get('b'), { itemId: 'i2', addedBy: 'nova' })
})

test('due work not in the plan: open, due today or late, not a step, not already in today', () => {
  const tasks = [
    task('late', { dueInDays: -2 }), task('today', { dueInDays: 0 }), task('tomorrow', { dueInDays: 1 }),
    task('done', { dueInDays: -1, status: 'done' }), task('step', { dueInDays: 0, parentId: 'today' }), task('planned', { dueInDays: 0 }),
  ]
  const due = dueNotPlanned(tasks, { items: [item('i', 'planned')] })
  assert.deepEqual(due.map(t => t.id), ['late', 'today'])
})

test('a task finished on the board is done for today; reopened, it is back in today', () => {
  assert.equal(flowStatusFor('done', 'planned'), 'done')
  assert.equal(flowStatusFor('done', 'done'), null)
  assert.equal(flowStatusFor('todo', 'done'), 'planned')
  assert.equal(flowStatusFor('in_progress', 'planned'), null)
  assert.equal(flowStatusFor('todo', 'later'), null)
})
