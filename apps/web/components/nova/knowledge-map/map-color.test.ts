// A map's own colour. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mapColor } from './map-color'
import { subjectColor } from '../subject-color'

test('a workspace map keeps its colour by id, whatever it is called', () => {
  assert.deepEqual(mapColor({ id: 'cmw1', title: 'AI roadmap' }), mapColor({ id: 'cmw1', title: 'Renamed later' }))
})

test("a subject's map is its subject's colour, so the map and its cards agree", () => {
  assert.deepEqual(mapColor({ id: 'subject:abc', title: 'Operating Systems', kind: 'subject' }), subjectColor('Operating Systems'))
})

test('Everything has no map colour', () => {
  assert.equal(mapColor(null), null)
})

test('different workspaces spread over the palette', () => {
  const hues = new Set(Array.from({ length: 30 }, (_, i) => mapColor({ id: `cmw${i}x${i * 7}`, title: 't' })!.hue))
  assert.ok(hues.size >= 4, `only ${hues.size} hues for 30 maps`)
})
