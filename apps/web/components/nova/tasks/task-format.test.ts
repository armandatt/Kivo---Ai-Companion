// "Tomorrow" on Today's task list is the learner's next calendar day.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { nextDay } from './task-format'

test('the day after, across month, year and leap-day ends', () => {
  assert.equal(nextDay('2026-10-14'), '2026-10-15')
  assert.equal(nextDay('2026-10-31'), '2026-11-01')
  assert.equal(nextDay('2026-12-31'), '2027-01-01')
  assert.equal(nextDay('2028-02-28'), '2028-02-29')
  assert.equal(nextDay('2027-02-28'), '2027-03-01')
})
