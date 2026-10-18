// Where the creature can go and where an arrow sends it. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { PLACES, placeToward, unlockedPlaces } from './places'

test('places open with days in a row: three from the start, all by sixty', () => {
  assert.deepEqual(unlockedPlaces(0).map(p => p.id), ['center', 'home', 'grove'])
  assert.deepEqual(unlockedPlaces(7).map(p => p.id), ['center', 'home', 'grove', 'training', 'plaza'])
  assert.equal(unlockedPlaces(60).length, PLACES.length)
})

test('an arrow points the way the screen does: camera behind, looking along +z at yaw 0', () => {
  const all = unlockedPlaces(365)
  const at = { x: 0, z: 0 }
  // Up is away from the camera (+z): the shrine and the sanctuary lie that way; the shrine (6, 13) is nearer straight on than the tower.
  assert.equal(placeToward(at, 'up', 0, all, 'center')?.id, 'shrine')
  // Down (−z): home (−9, −8) is both nearer and straighter than the plaza (10, −6).
  assert.equal(placeToward(at, 'down', 0, all, 'center')?.id, 'home')
  // Screen right at yaw 0 is −x: home and the training hall lie that way, home nearer.
  assert.equal(placeToward(at, 'right', 0, all, 'center')?.id, 'home')
  assert.equal(placeToward({ x: -9, z: -8 }, 'right', 0, all, 'home'), null)
  // From home, up: the training hall (−14, 5) is straighter ahead than the campfire.
  assert.equal(placeToward({ x: -9, z: -8 }, 'up', 0, all, 'home')?.id, 'training')
  // Left is +x: the plaza (10, −6) is nearer and straighter than the grove (12, 8).
  assert.equal(placeToward(at, 'left', 0, all, 'center')?.id, 'plaza')
})

test('turning the camera half round swaps the arrows', () => {
  const all = unlockedPlaces(365)
  assert.equal(placeToward({ x: 0, z: 0 }, 'left', Math.PI, all, 'center')?.id, placeToward({ x: 0, z: 0 }, 'right', 0, all, 'center')?.id)
  assert.equal(placeToward({ x: 0, z: 0 }, 'down', Math.PI, all, 'center')?.id, 'shrine')
})

test('only open places, never the one it is at, and null when nothing lies that way', () => {
  const start = unlockedPlaces(0)
  assert.equal(placeToward({ x: 0, z: 0 }, 'up', 0, start, 'center')?.id, 'grove')
  assert.equal(placeToward({ x: 12, z: 8 }, 'left', 0, start, 'grove'), null)
})
