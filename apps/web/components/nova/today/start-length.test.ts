// How long a new session on a Today item is offered for (start-length.ts).
// A second session on the same item continues from what is left (12 Nov).
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { suggestedFor } from './start-length'

test("first session: today's time", () => {
  assert.deepEqual(suggestedFor({ minutes: 60, ref: null, spentMinutes: null, remainingMinutes: 60 }), { minutes: 60, basis: 'today' })
})

test('after 25 of 60 minutes: the 35 left, said as what is left', () => {
  assert.deepEqual(suggestedFor({ minutes: 60, ref: null, spentMinutes: 25, remainingMinutes: 35 }), { minutes: 35, basis: 'remaining' })
})

test('time used up: the shortest session, not zero and not the whole time again', () => {
  assert.deepEqual(suggestedFor({ minutes: 30, ref: null, spentMinutes: 40, remainingMinutes: 0 }), { minutes: 5, basis: 'remaining' })
})

test('no time for today: the estimate, then a standard block (unchanged)', () => {
  assert.deepEqual(suggestedFor({ minutes: null, ref: { minutes: 45 } }), { minutes: 45, basis: 'estimate' })
  assert.deepEqual(suggestedFor({ minutes: null, ref: null }), { minutes: 25, basis: 'standard' })
})

test('an API that does not send the new fields yet behaves as before', () => {
  assert.deepEqual(suggestedFor({ minutes: 60, ref: null }), { minutes: 60, basis: 'today' })
})
