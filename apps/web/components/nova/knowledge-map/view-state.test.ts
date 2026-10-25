// What the map keeps across a reload of its data. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fitKey, focusToApply, keepValid, type FitInputs } from './view-state'

const base: FitInputs = { shown: { subject: true, topic: true, note: true, resource: true, task: true }, subject: '', scope: null, showLinks: true, portrait: false, generation: 1 }

test('a reload of the same picture keeps the view: nothing in the fit key comes from the data', () => {
  // A reload builds new objects with the same values; the key is the same.
  const reloaded: FitInputs = { ...base, shown: { ...base.shown } }
  assert.equal(fitKey(reloaded), fitKey(base))
  // Moving a card changes neither the filters nor the layout generation.
  assert.equal(fitKey({ ...base }), fitKey(base))
})

test('asking for a different picture, a new frame shape, or a loaded or reset layout refits', () => {
  const key = fitKey(base)
  for (const changed of [
    { ...base, shown: { ...base.shown, note: false } },
    { ...base, subject: 'os' },
    { ...base, scope: 'note:n1' },
    { ...base, showLinks: false },
    { ...base, portrait: true },
    { ...base, generation: 2 },
  ]) assert.notEqual(fitKey(changed), key, JSON.stringify(changed))
})

test('a selection, scope or hover is kept while its item is on the map, and dropped once it is gone', () => {
  const ids = new Set(['note:n1', 'topic:t1'])
  assert.equal(keepValid('note:n1', ids), 'note:n1')
  assert.equal(keepValid('note:gone', ids), null)
  assert.equal(keepValid(null, ids), null)
  assert.equal(keepValid('note:n1', new Set(['topic:t1'])), null, 'deleted or archived elsewhere')
})

test('a ?focus= link applies on the first view only', () => {
  const ids = new Set(['note:n1'])
  assert.equal(focusToApply('note:n1', ids, false), 'note:n1')
  assert.equal(focusToApply('note:n1', ids, true), null, 'a reload does not re-apply it')
  assert.equal(focusToApply('note:missing', ids, false), null)
  assert.equal(focusToApply(null, ids, false), null)
})
