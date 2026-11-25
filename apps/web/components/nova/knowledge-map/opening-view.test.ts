// Founder review #16: an imported map opens readable, with the opening.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { OPEN_K, arrivedFromImport, openingView, opensWithEntrance } from './opening-view'

const FRAME = { width: 1200, height: 800 }

test('a small map that fits at a readable size ends fitted', () => {
  const fit = { k: 0.9, x: 100, y: 50 }
  assert.deepEqual(openingView(fit, FRAME, [{ x: 0, y: 0 }], false), fit)
})

test('a large map ends at a readable zoom on the subject nearest the middle, never at the far-out limit', () => {
  // Fitted, a 6000-unit map is 0.1: unreadable. Its middle is at map (2900, 1900).
  const fit = { k: 0.1, x: 600 - 2900 * 0.1, y: 400 - 1900 * 0.1 }
  const subjects = [{ x: 0, y: 0 }, { x: 3000, y: 2000 }, { x: 6000, y: 4000 }]
  const v = openingView(fit, FRAME, subjects, false)
  assert.equal(v.k, OPEN_K)
  // The nearest subject (3000, 2000) is in the middle of the frame.
  assert.equal(Math.round(3000 * v.k + v.x), 600)
  assert.equal(Math.round(2000 * v.k + v.y), 400)
})

test('a nested map centres on a subject inside another when that is nearest', () => {
  const fit = { k: 0.2, x: 600 - 1000 * 0.2, y: 400 - 1000 * 0.2 }
  const v = openingView(fit, FRAME, [{ x: 0, y: 0 }, { x: 1050, y: 980 }], false)
  assert.equal(Math.round(1050 * v.k + v.x), 600)
})

test('a phone keeps its own top-down fit', () => {
  const fit = { k: 0.62, x: 12, y: 56 }
  assert.deepEqual(openingView({ ...fit, k: 0.3 }, FRAME, [{ x: 5, y: 5 }], true), { ...fit, k: 0.3 })
})

test('which views open with the full opening', () => {
  assert.equal(opensWithEntrance({ top: true, first: false, arrivedFromImport: false, remembered: true }), true)
  assert.equal(opensWithEntrance({ top: false, first: true, arrivedFromImport: true, remembered: false }), true, 'a just-imported map')
  assert.equal(opensWithEntrance({ top: false, first: true, arrivedFromImport: true, remembered: true }), false, 'a view the learner left keeps it')
  assert.equal(opensWithEntrance({ top: false, first: true, arrivedFromImport: false, remembered: false }), false, 'an ordinary link inside a card')
  assert.equal(opensWithEntrance({ top: false, first: false, arrivedFromImport: true, remembered: false }), false, 'only the first view')
})

test('the import page marks its link', () => {
  assert.equal(arrivedFromImport('?explore=subject%3Aabc&arrive=import'), true)
  assert.equal(arrivedFromImport('?explore=subject%3Aabc'), false)
})
