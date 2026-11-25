// The Drafts inbox groups drafts by when they were last added to. Run with `npm test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { dayGroup } from './drafts-api'

test('drafts are grouped Today, Yesterday, This week, Earlier by local calendar day', () => {
  const now = new Date(2026, 10, 25, 10, 0)
  assert.equal(dayGroup(new Date(2026, 10, 25, 0, 5).toISOString(), now), 'Today')
  assert.equal(dayGroup(new Date(2026, 10, 24, 23, 59).toISOString(), now), 'Yesterday')
  assert.equal(dayGroup(new Date(2026, 10, 20, 12).toISOString(), now), 'This week')
  assert.equal(dayGroup(new Date(2026, 10, 1).toISOString(), now), 'Earlier')
})
