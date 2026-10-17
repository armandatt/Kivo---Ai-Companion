// Subject colours. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import type React from 'react'
import { heroStyle, subjectColor, toneStyle } from './subject-color'

test('a subject has the same colour however its name is spaced or cased', () => {
  assert.deepEqual(subjectColor('Operating Systems'), subjectColor('  operating   systems '))
})

test('the colour is one of the palette, and no subject is given amber or rose', () => {
  for (const name of ['Operating Systems', 'Database Systems', 'Computer Networks', 'Engineering Mathematics', 'Data Structures and Algorithms', 'Physics', '']) {
    const c = subjectColor(name)
    assert.match(c.dot, /^bg-(sky|violet|orange|emerald|indigo|pink)-400$/)
  }
  assert.deepEqual(subjectColor(null), subjectColor(''))
})

test('different subjects spread over the palette', () => {
  const names = ['Operating Systems', 'Database Systems', 'Computer Networks', 'Engineering Mathematics', 'Data Structures and Algorithms', 'Physics', 'Chemistry', 'Biology']
  assert.ok(new Set(names.map(n => subjectColor(n).dot)).size >= 4)
})

test('the hue behind a subject\'s classes is the same one its tone and the hero use', () => {
  const c = subjectColor('Operating Systems')
  assert.equal(toneStyle('  operating systems ')['--sh' as keyof React.CSSProperties], c.hue)
  assert.deepEqual(heroStyle(['Operating Systems', 'operating systems', '', null]), { '--h1': c.hue })
})
