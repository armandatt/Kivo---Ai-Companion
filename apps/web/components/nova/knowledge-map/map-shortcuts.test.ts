// The map's keyboard shortcuts. Run with `npm test`.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { SHORTCUTS, enterAction, enterTarget, isMacPlatform, isTypingTarget, keyLabel, navigate, shortcutFor } from './map-shortcuts'

test('each listed key does what the help panel says', () => {
  const cases: Array<[Parameters<typeof shortcutFor>[0], string]> = [
    [{ key: '/' }, 'search'], [{ key: 'k', metaKey: true }, 'search'], [{ key: 'K', ctrlKey: true }, 'search'],
    [{ key: 'Enter' }, 'explore'], [{ key: 'Enter', shiftKey: true }, 'open'], [{ key: ' ' }, 'fold'],
    [{ key: 'Escape' }, 'escape'], [{ key: '+' }, 'zoom_in'], [{ key: '=' }, 'zoom_in'], [{ key: '-' }, 'zoom_out'],
    [{ key: '0' }, 'actual_size'], [{ key: 'f' }, 'fit'], [{ key: 'F', shiftKey: true }, 'fit'], [{ key: 'n' }, 'add'],
    [{ key: 'u' }, 'up'], [{ key: 'Delete' }, 'delete'], [{ key: 'Backspace' }, 'delete'], [{ key: '?', shiftKey: true }, 'help'],
  ]
  for (const [e, action] of cases) assert.equal(shortcutFor(e)?.action, action, JSON.stringify(e))
  assert.deepEqual(shortcutFor({ key: 'ArrowRight' }), { action: 'navigate', arrow: 'right' })
  assert.deepEqual(shortcutFor({ key: 'ArrowUp', shiftKey: true }), { action: 'pan', arrow: 'up' })
  assert.deepEqual(shortcutFor({ key: 'ArrowLeft', altKey: true, shiftKey: true }), { action: 'nudge', arrow: 'left', far: true })
  const listed = new Set(SHORTCUTS.map(s => s.action))
  for (const [e] of cases) assert.ok(listed.has(shortcutFor(e)!.action as never), 'every key has a line in the help panel')
})

test('browser and system shortcuts are left alone', () => {
  for (const e of [
    { key: 'f', ctrlKey: true }, { key: 'f', metaKey: true }, { key: '0', metaKey: true }, { key: '+', ctrlKey: true }, { key: '-', metaKey: true },
    { key: 'r', metaKey: true }, { key: 'l', ctrlKey: true }, { key: 'k', metaKey: true, shiftKey: true }, { key: 'ArrowLeft', metaKey: true },
    { key: 'Tab' }, { key: 'a' }, { key: 'f', altKey: true }, { key: 'k', altKey: true, metaKey: true },
  ]) assert.equal(shortcutFor(e), null, JSON.stringify(e))
})

test('nothing is taken while the learner types', () => {
  const el = (tagName: string, extra: Record<string, unknown> = {}) => ({ tagName, ...extra })
  assert.equal(isTypingTarget(el('INPUT')), true)
  assert.equal(isTypingTarget(el('input', { type: 'search' })), true)
  assert.equal(isTypingTarget(el('TEXTAREA')), true)
  assert.equal(isTypingTarget(el('SELECT')), true)
  assert.equal(isTypingTarget(el('DIV', { isContentEditable: true })), true)
  assert.equal(isTypingTarget(el('SPAN', { closest: (s: string) => (s.includes('contenteditable') ? {} : null) })), true, 'inside an editor')
  assert.equal(isTypingTarget(el('INPUT', { type: 'checkbox' })), false)
  assert.equal(isTypingTarget(el('BUTTON')), false)
  assert.equal(isTypingTarget(el('g', { closest: () => null })), false)
  assert.equal(isTypingTarget(null), false)
})

test('modifier keys are shown for the learner’s own keyboard', () => {
  assert.equal(isMacPlatform('MacIntel'), true)
  assert.equal(isMacPlatform('macOS'), true)
  assert.equal(isMacPlatform('Win32'), false)
  assert.equal(isMacPlatform('Linux x86_64'), false)
  assert.equal(keyLabel('Mod+K', true), '⌘K')
  assert.equal(keyLabel('Mod+K', false), 'Ctrl+K')
  assert.equal(keyLabel('Shift+Enter', true), '⇧Enter')
})

// subject › (A › (A1, A2), B); a loose note.
const tree = {
  children: new Map([['s', ['a', 'b']], ['a', ['a1', 'a2']]]),
  parent: new Map([['a', 's'], ['b', 's'], ['a1', 'a'], ['a2', 'a']]),
  roots: ['s', 'loose'],
}
const all = new Set(['s', 'a', 'b', 'a1', 'a2', 'loose'])

test('the arrow keys move along the tree that is drawn', () => {
  const go = (from: string, arrow: 'left' | 'right' | 'up' | 'down', shown = all) => navigate(from, arrow, tree, shown, { outline: false })
  assert.deepEqual(go('s', 'right'), { to: 'a' })
  assert.deepEqual(go('a', 'right'), { to: 'a1' })
  assert.deepEqual(go('a1', 'down'), { to: 'a2' })
  assert.deepEqual(go('a2', 'up'), { to: 'a1' })
  assert.deepEqual(go('a2', 'left'), { to: 'a' })
  assert.deepEqual(go('a', 'down'), { to: 'b' })
  assert.deepEqual(go('s', 'down'), { to: 'loose' }, 'cards at the top go one to the next')
  assert.equal(go('b', 'right').to, null)
  assert.match((go('b', 'right') as { why: string }).why, /Nothing is inside/)
  assert.match((go('s', 'left') as { why: string }).why, /top of the map/)
  assert.match((go('a2', 'down') as { why: string }).why, /last/)
  // Folded or hidden cards are not reached; the reason says so.
  const folded = new Set(['s', 'a', 'b', 'loose'])
  const r = navigate('a', 'right', tree, folded, { outline: false, folded: true })
  assert.equal(r.to, null)
  assert.match((r as { why: string }).why, /folded/)
})

test('in the outline, up and down go row by row', () => {
  const rows = ['s', 'a', 'a1', 'a2', 'b', 'loose']
  assert.deepEqual(navigate('a2', 'down', tree, all, { outline: true, rows }), { to: 'b' })
  assert.deepEqual(navigate('b', 'up', tree, all, { outline: true, rows }), { to: 'a2' })
  assert.deepEqual(navigate('a1', 'left', tree, all, { outline: true, rows }), { to: 'a' })
  assert.equal(navigate('loose', 'down', tree, all, { outline: true, rows }).to, null)
})

test('Enter acts on the card chosen last, never a stale one', () => {
  const onMap = new Set(['a', 'b', 'c', 'd'])
  // Search picked b; then arrows to c, then d; focus is still catching up on c.
  assert.equal(enterTarget({ chosen: 'd', focused: 'c', selected: 'd', onMap }), 'd')
  // Tab reached c without selecting it: c is chosen.
  assert.equal(enterTarget({ chosen: 'c', focused: 'c', selected: 'a', onMap }), 'c')
  // Nothing chosen this visit: the focused card, then the selection.
  assert.equal(enterTarget({ chosen: null, focused: 'b', selected: 'a', onMap }), 'b')
  assert.equal(enterTarget({ chosen: null, focused: null, selected: 'a', onMap }), 'a')
  // A card deleted since is never acted on.
  assert.equal(enterTarget({ chosen: 'gone', focused: null, selected: 'gone', onMap }), null)
})

test('Enter explores; a card with nothing inside opens details; the explored card does nothing twice', () => {
  const explorable = (id: string) => id === 'unit'
  assert.equal(enterAction('unit', { exploring: null, explorable }), 'explore')
  assert.equal(enterAction('leaf', { exploring: null, explorable }), 'details')
  assert.equal(enterAction('unit', { exploring: 'unit', explorable }), 'already')
  assert.equal(enterAction(null, { exploring: null, explorable }), 'none')
})
