// The saved-pages library opens as a board unless the learner chose List.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { DEFAULT_SAVED_VIEW, SAVED_VIEW_KEY, readSavedView, savedViewFrom, writeSavedView } from './saved-view'

const memory = (init: Record<string, string> = {}) => {
  const m = new Map(Object.entries(init))
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m }
}

test('no preference opens the board', () => {
  assert.equal(DEFAULT_SAVED_VIEW, 'grid')
  assert.equal(readSavedView(memory()), 'grid')
  assert.equal(savedViewFrom(null), 'grid')
  assert.equal(savedViewFrom(undefined), 'grid')
})

test('a saved Board preference opens the board', () => {
  assert.equal(readSavedView(memory({ [SAVED_VIEW_KEY]: 'grid' })), 'grid')
})

test('a saved List preference is kept', () => {
  assert.equal(readSavedView(memory({ [SAVED_VIEW_KEY]: 'list' })), 'list')
})

test('an unknown value opens the board', () => {
  assert.equal(savedViewFrom('table'), 'grid')
})

test('the choice persists', () => {
  const s = memory()
  writeSavedView('list', s)
  assert.equal(readSavedView(s), 'list')
  writeSavedView('grid', s)
  assert.equal(readSavedView(s), 'grid')
})

test('storage that throws opens the board and does not crash', () => {
  const broken = { getItem: () => { throw new Error('blocked') }, setItem: () => { throw new Error('blocked') } }
  assert.equal(readSavedView(broken), 'grid')
  assert.doesNotThrow(() => writeSavedView('list', broken))
})
