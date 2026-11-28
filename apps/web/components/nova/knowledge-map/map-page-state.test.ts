import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mapPageState } from './map-page-state'

const ready = (n: number, extra: object = {}) => ({ status: 'ready', nodes: Array.from({ length: n }, (_, i) => ({ id: i })), workspaceId: null, workspaces: [], ...extra })

test('brand-new account (no Nova space yet) gets the two options, not "set up on Today"', () => {
  assert.equal(mapPageState({ status: 'onboarding_incomplete' }, false), 'empty')
  assert.equal(mapPageState({ status: 'not_connected' }, false), 'empty')
})
test('set up but no map yet (onboarding done, Nova opened, failed imports) is still empty', () => {
  assert.equal(mapPageState(ready(0), false), 'empty')
})
test('loading never shows the empty state, and an error is never "empty"', () => {
  assert.equal(mapPageState(null, true), 'loading')
  assert.equal(mapPageState(null, false), 'error')
})
test('a map, or several, shows the map', () => {
  assert.equal(mapPageState(ready(3), false), 'populated')
  assert.equal(mapPageState(ready(9, { workspaces: [{ id: 'a' }, { id: 'b' }] }), false), 'populated')
})
test('one chosen map empty while others exist: the switcher, not first-map options', () => {
  assert.equal(mapPageState(ready(0, { workspaceId: 'a', workspaces: [{ id: 'a' }, { id: 'b' }] }), false), 'scope-empty')
  assert.equal(mapPageState(ready(0, { workspaceId: 'a', workspaces: [{ id: 'a' }] }), false), 'empty')
})
test('a refresh in flight keeps what is shown (no flash back to loading)', () => {
  assert.equal(mapPageState(ready(2), true), 'populated')
})
