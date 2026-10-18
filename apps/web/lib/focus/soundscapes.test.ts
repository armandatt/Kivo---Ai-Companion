// The noise behind the focus soundscapes. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SOUNDS, brownNoise, pinkNoise, seededRandom, whiteNoise } from './soundscapes'

const stats = (a: Float32Array) => {
  let min = Infinity, max = -Infinity, sum = 0, sq = 0
  for (const v of a) { min = Math.min(min, v); max = Math.max(max, v); sum += v; sq += v * v }
  return { min, max, mean: sum / a.length, rms: Math.sqrt(sq / a.length) }
}

test('the same seed gives the same noise', () => {
  assert.deepEqual(whiteNoise(64, seededRandom(7)), whiteNoise(64, seededRandom(7)))
  assert.notDeepEqual(whiteNoise(64, seededRandom(7)), whiteNoise(64, seededRandom(8)))
})

test('every kind of noise stays within full scale and is centred', () => {
  for (const make of [whiteNoise, pinkNoise, brownNoise]) {
    const s = stats(make(48_000 * 6, seededRandom(1)))
    assert.ok(s.min >= -1 && s.max <= 1, `${make.name} clips: ${s.min}..${s.max}`)
    assert.ok(Math.abs(s.mean) < 0.05, `${make.name} drifts: mean ${s.mean}`)
    assert.ok(s.rms > 0.05, `${make.name} is near silent: rms ${s.rms}`)
  }
})

test('brown noise is darker than white: neighbouring samples move together', () => {
  const corr = (a: Float32Array) => { let n = 0; for (let i = 1; i < a.length; i++) n += a[i]! * a[i - 1]!; return n / (a.length - 1) / stats(a).rms ** 2 }
  assert.ok(corr(brownNoise(20_000, seededRandom(3))) > 0.9)
  assert.ok(Math.abs(corr(whiteNoise(20_000, seededRandom(3)))) < 0.1)
})

test('every soundscape has a name and a hint, and ids are unique', () => {
  assert.equal(new Set(SOUNDS.map(s => s.id)).size, SOUNDS.length)
  for (const s of SOUNDS) assert.ok(s.name && s.hint)
})
