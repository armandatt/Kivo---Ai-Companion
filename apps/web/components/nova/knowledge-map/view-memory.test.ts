// What the map remembers between visits. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { chooseOrientation, chosenOrientation, forgetViews, pictureKey, recallView, rememberView } from './view-memory'

function memoryStore() {
  const m = new Map<string, string>()
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), removeItem: (k: string) => void m.delete(k), m }
}
const broken = { getItem: () => { throw new Error('denied') }, setItem: () => { throw new Error('full') }, removeItem: () => { throw new Error('denied') } }

test('the same cards are the same picture, whatever order they arrive in', () => {
  assert.equal(pictureKey(['b', 'a', 'c'], 'tree'), pictureKey(['c', 'b', 'a'], 'tree'))
  assert.notEqual(pictureKey(['a', 'b'], 'tree'), pictureKey(['a', 'b', 'c'], 'tree'), 'a card added is another picture')
  assert.notEqual(pictureKey(['a', 'b'], 'tree'), pictureKey(['a', 'b'], 'outline'))
})

test('a view comes back on the next visit only for the same picture and place', () => {
  const s = memoryStore()
  const pic = pictureKey(['subject:a', 'topic:b'], 'tree')
  rememberView(s, 'ws1/root', pic, { x: 120.4, y: -40.6, k: 0.83333 })
  assert.deepEqual(recallView(s, 'ws1/root', pic), { x: 120, y: -41, k: 0.833 })
  assert.equal(recallView(s, 'ws1/root', pictureKey(['subject:a', 'topic:b', 'topic:c'], 'tree')), null, 'the graph changed: fitted afresh')
  assert.equal(recallView(s, 'ws1/topic:b', pic), null, 'each explored card has its own view')
  assert.equal(recallView(s, 'ws2/root', pic), null)
  rememberView(s, 'ws1/root', pic, { x: 1, y: 2, k: 1 })
  assert.deepEqual(recallView(s, 'ws1/root', pic), { x: 1, y: 2, k: 1 }, 'the latest view replaces the older one')
  for (let i = 0; i < 40; i++) rememberView(s, `w${i}/root`, pic, { x: i, y: 0, k: 1 })
  assert.ok((JSON.parse(s.m.get('kivo-map-view')!) as unknown[]).length <= 24, 'a bounded list')
  forgetViews(s)
  assert.equal(recallView(s, 'w39/root', pic), null)
})

test('a damaged or refused store never breaks the map', () => {
  const s = memoryStore()
  s.m.set('kivo-map-view', '{not json')
  assert.equal(recallView(s, 'a', 'b'), null)
  s.m.set('kivo-map-view', JSON.stringify([{ where: 'a', picture: 'b', view: { x: 'NaN', y: 0, k: 1 } }, { where: 'a', picture: 'b', view: { x: 0, y: 0, k: 0 } }]))
  assert.equal(recallView(s, 'a', 'b'), null, 'an invalid view is ignored')
  assert.equal(recallView(broken, 'a', 'b'), null)
  assert.doesNotThrow(() => rememberView(broken, 'a', 'b', { x: 0, y: 0, k: 1 }))
  assert.doesNotThrow(() => forgetViews(broken))
  assert.equal(recallView(null, 'a', 'b'), null)
})

test('the orientation the learner chose is kept; anything else means the device’s own', () => {
  const s = memoryStore()
  assert.equal(chosenOrientation(s), null)
  chooseOrientation(s, 'outline')
  assert.equal(chosenOrientation(s), 'outline')
  chooseOrientation(s, null)
  assert.equal(chosenOrientation(s), null, 'reset goes back to the device’s own')
  s.m.set('kivo-map-orientation', 'sideways')
  assert.equal(chosenOrientation(s), null)
  assert.equal(chosenOrientation(broken), null)
  assert.doesNotThrow(() => chooseOrientation(broken, 'tree'))
})
