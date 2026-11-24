// Founder review #02: a resting view sits on whole device pixels.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { snapView } from './map-camera'

test('a fractional resting offset is rounded to the device pixel grid; the zoom is kept', () => {
  assert.deepEqual(snapView({ x: 100.37, y: -20.6, k: 0.8312 }, 1), { x: 100, y: -21, k: 0.8312 })
  assert.deepEqual(snapView({ x: 100.37, y: -20.6, k: 0.8312 }, 2), { x: 100.5, y: -20.5, k: 0.8312 })
})

test('a view already on the grid is returned as it is (no redraw)', () => {
  const v = { x: 12, y: 40.5, k: 1 }
  assert.equal(snapView(v, 2), v)
})

test('a bad device pixel ratio falls back to 1', () => {
  assert.deepEqual(snapView({ x: 1.4, y: 1.6, k: 1 }, 0), { x: 1, y: 2, k: 1 })
})
