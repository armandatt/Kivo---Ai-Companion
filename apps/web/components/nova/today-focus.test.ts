// The subject chosen for today on Today. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deviceDay, focusFromStorage, planQuery } from './today-focus'

test('a choice lasts for the day it was made on, and only that day', () => {
  const stored = JSON.stringify({ day: '2026-10-20', subject: 'DSA' })
  assert.equal(focusFromStorage(stored, '2026-10-20'), 'DSA')
  assert.equal(focusFromStorage(stored, '2026-10-21'), null)
})

test('anything unreadable is no choice', () => {
  assert.equal(focusFromStorage(null, '2026-10-20'), null)
  assert.equal(focusFromStorage('not json', '2026-10-20'), null)
  assert.equal(focusFromStorage(JSON.stringify({ day: '2026-10-20', subject: '  ' }), '2026-10-20'), null)
  assert.equal(focusFromStorage(JSON.stringify({ day: '2026-10-20', subject: 4 }), '2026-10-20'), null)
})

test('the request names the time and the subject, encoded, or nothing', () => {
  assert.equal(planQuery(null, null), '')
  assert.equal(planQuery(40, null), '?minutes=40')
  assert.equal(planQuery(null, 'Operating Systems'), '?subject=Operating+Systems')
  assert.equal(planQuery(30, 'C++ & DSA'), '?minutes=30&subject=C%2B%2B+%26+DSA')
})

test("the device's day is its own calendar day", () => {
  assert.equal(deviceDay(new Date(2026, 0, 5, 23, 30)), '2026-01-05')
})
