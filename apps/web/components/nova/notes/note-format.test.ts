// The editor's colour menu (note-format.ts colorize, clearColor) and how a
// note draws colour and checklists (note-blocks.ts), 12 Nov.
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { clearColor, colorize } from './note-format'
import { checkItem, inlineTokens } from './note-blocks'

test('a selection is coloured, recoloured, and uncoloured by choosing the same again', () => {
  const t = 'A cache hit is fast.'
  const a = colorize(t, 2, 11, 'teal', false)
  assert.equal(a.text, 'A [cache hit]{.teal} is fast.')
  assert.equal(a.text.slice(a.start, a.end), 'cache hit')
  const b = colorize(a.text, a.start, a.end, 'amber', true)
  assert.equal(b.text, 'A [cache hit]{.hl-amber} is fast.')
  const c = colorize(b.text, b.start, b.end, 'amber', true)
  assert.equal(c.text, t)
})

test('nothing selected: a placeholder to type over; several lines: one span each', () => {
  const p = colorize('Say ', 4, 4, 'blue', false)
  assert.equal(p.text, 'Say [text]{.blue}')
  assert.equal(p.text.slice(p.start, p.end), 'text')
  assert.equal(colorize('one\n\n two ', 0, 10, 'red', false).text, '[one]{.red}\n\n [two]{.red} ')
})

test('clear colour takes off spans and ==marks== in the selection, the words stay', () => {
  const t = 'Keep [this]{.teal} and ==that== but [not]{.blue}.'
  const r = clearColor(t, 0, t.indexOf(' but'))
  assert.equal(r.text, 'Keep this and that but [not]{.blue}.')
})

test('drawn: colour and highlight tokens, their words keep their own marks; anything else stays as written', () => {
  assert.deepEqual(inlineTokens('a [**key** term]{.accent} b'), [
    { kind: 'text', text: 'a ' }, { kind: 'color', text: '**key** term', color: 'accent', highlight: false }, { kind: 'text', text: ' b' },
  ])
  assert.deepEqual(inlineTokens('[x]{.hl-green}'), [{ kind: 'color', text: 'x', color: 'green', highlight: true }])
  assert.deepEqual(inlineTokens('[x]{.purple} and [plain]'), [{ kind: 'text', text: '[x]{.purple} and [plain]' }])
})

test('checklist items', () => {
  assert.deepEqual(checkItem('[ ] Read chapter 3'), { done: false, text: 'Read chapter 3' })
  assert.deepEqual(checkItem('[x] Solve set 2'), { done: true, text: 'Solve set 2' })
  assert.equal(checkItem('[link] text'), null)
  assert.equal(checkItem('Plain item'), null)
})
