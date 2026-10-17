// Today's task list: the next calendar day, and the task groups. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { groupTasks, localDayKey, nextDay, taskGroup } from './task-format'

test('the day after, across month, year and leap-day ends', () => {
  assert.equal(nextDay('2026-10-14'), '2026-10-15')
  assert.equal(nextDay('2026-10-31'), '2026-11-01')
  assert.equal(nextDay('2026-12-31'), '2027-01-01')
  assert.equal(nextDay('2028-02-28'), '2028-02-29')
  assert.equal(nextDay('2027-02-28'), '2027-03-01')
})

const t = (id: string, dueInDays: number | null, status: 'todo' | 'in_progress' | 'done' = 'todo') => ({ id, dueInDays, status })

test('each task falls in one group from its own due day and status', () => {
  assert.equal(taskGroup(t('a', -2)), 'overdue')
  assert.equal(taskGroup(t('b', 0)), 'today')
  assert.equal(taskGroup(t('c', 5, 'in_progress')), 'today')
  assert.equal(taskGroup(t('d', -1, 'in_progress')), 'overdue')
  assert.equal(taskGroup(t('e', 3)), 'upcoming')
  assert.equal(taskGroup(t('f', null)), 'someday')
})

test('groups come in a fixed order, empty ones are left out, and the given order is kept inside each', () => {
  const groups = groupTasks([t('x', 4), t('y', null), t('z', 1), t('w', -3)])
  assert.deepEqual(groups.map(g => g.key), ['overdue', 'upcoming', 'someday'])
  assert.deepEqual(groups[1].tasks.map(x => x.id), ['x', 'z'])
})

test('a day key is the device calendar day, offset across a month end', () => {
  assert.equal(localDayKey(0, new Date(2026, 9, 31, 23, 30)), '2026-10-31')
  assert.equal(localDayKey(1, new Date(2026, 9, 31, 23, 30)), '2026-11-01')
})
